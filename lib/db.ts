import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import pg, { type PoolClient, type QueryResultRow } from 'pg';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from 'node:crypto';
const { Pool, types } = pg;
types.setTypeParser(20, (value) => Number(value));
let pool: pg.Pool | undefined;
const transactionClient = new AsyncLocalStorage<PoolClient>();
const localTransaction = new AsyncLocalStorage<boolean>();
let localDatabase: DatabaseSync | undefined;
let localQueue: Promise<void> = Promise.resolve();
export class DatabaseUnavailableError extends Error {
  readonly kind: 'configuration' | 'connection' | 'authentication' | 'schema' | 'query';
  constructor(kind: 'configuration' | 'connection' | 'authentication' | 'schema' | 'query', cause?: unknown) {
    super('Database unavailable', { cause });
    this.kind = kind;
  }
}
export function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}
export function passwordMatches(password: string, stored: string) {
  const [salt, key] = stored.split(':');
  if (!salt || !key) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(key, 'hex');
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}
function key() {
  const raw = process.env.DATA_ENCRYPTION_KEY ?? '';
  if (!/^[a-fA-F0-9]{64}$/.test(raw))
    throw new DatabaseUnavailableError('configuration');
  return Buffer.from(raw, 'hex');
}
export function encrypt(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv.toString('hex'), cipher.getAuthTag().toString('hex'), data.toString('base64')].join(
    '.',
  );
}
export function decrypt<T>(value: string): T {
  const [iv, tag, data] = value.split('.');
  const cipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'hex'));
  cipher.setAuthTag(Buffer.from(tag, 'hex'));
  return JSON.parse(
    Buffer.concat([cipher.update(Buffer.from(data, 'base64')), cipher.final()]).toString('utf8'),
  );
}
export function validateConfiguration() {
  key();
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new DatabaseUnavailableError('configuration');
  let url: URL;
  try { url = new URL(raw); } catch { throw new DatabaseUnavailableError('configuration'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || !url.password)
    throw new DatabaseUnavailableError('configuration');
  // Marketplace Postgres providers supply their own host and user. Validate the
  // shape here, then let the TLS handshake and database permissions verify them.
  // node-postgres URI SSL parameters override the explicit TLS policy below.
  url.searchParams.delete('sslmode');
  url.searchParams.delete('sslrootcert');
  return url.toString();
}
export function validateMigrationTarget() {
  const url = new URL(validateConfiguration());
  const expected = process.env.DB_MIGRATION_TARGET;
  const actual = url.host + url.pathname;
  if (!expected || expected !== actual)
    throw new DatabaseUnavailableError('configuration');
  return actual;
}
function localSqliteEnabled() {
  return process.env.VERCEL !== '1' &&
    ((process.env.NODE_ENV !== 'production' && process.env.LOCAL_SQLITE_DEV === 'true') ||
      (process.env.NODE_ENV === 'production' && process.env.LOCAL_SQLITE_TEST === 'true'));
}
function sqliteDatabase() {
  if (localDatabase) return localDatabase;
  key();
  const configuredPath = process.env.DATABASE_PATH;
  if (!configuredPath)
    throw new DatabaseUnavailableError('configuration');
  const path = resolve(configuredPath);
  mkdirSync(dirname(path), { recursive: true });
  localDatabase = new DatabaseSync(path);
  localDatabase.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS admins(id TEXT PRIMARY KEY,password TEXT NOT NULL,role TEXT NOT NULL CHECK(role='ADMIN'),must_change INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,admin_id TEXT NOT NULL REFERENCES admins(id),created_at INTEGER NOT NULL,last_seen INTEGER NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS visitors(token_hash TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS visitor_drafts(visitor_hash TEXT PRIMARY KEY,data TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS videos(id TEXT PRIMARY KEY,title TEXT NOT NULL,youtube_id TEXT NOT NULL,sort_order INTEGER NOT NULL,visible INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS view_events(id TEXT PRIMARY KEY,visitor_hash TEXT NOT NULL,video_id TEXT NOT NULL REFERENCES videos(id),title TEXT NOT NULL,opened_at TEXT NOT NULL,youtube_id TEXT,completed_at TEXT,started_at TEXT);
CREATE TABLE IF NOT EXISTS registrations(id TEXT PRIMARY KEY,receipt TEXT UNIQUE NOT NULL,request_key TEXT UNIQUE NOT NULL,visitor_hash TEXT NOT NULL,payload_hash TEXT NOT NULL,created_at TEXT NOT NULL,start_date TEXT NOT NULL,end_date TEXT NOT NULL,data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS registration_dates ON registrations(created_at,start_date,end_date);
CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,reset_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT,details TEXT NOT NULL);`);
  const columns = localDatabase.prepare('PRAGMA table_info(view_events)').all() as { name: string }[];
  for (const name of ['youtube_id', 'completed_at', 'started_at']) {
    if (!columns.some((column) => column.name === name))
      localDatabase.exec('ALTER TABLE view_events ADD COLUMN ' + name + ' TEXT');
  }
  if (!localDatabase.prepare('SELECT id FROM admins LIMIT 1').get()) {
    const initial = process.env.INITIAL_ADMIN_PASSWORD;
    if (!initial) throw new DatabaseUnavailableError('configuration');
    localDatabase.prepare('INSERT INTO admins VALUES(?,?,?,?)')
      .run('admin', passwordHash(initial), 'ADMIN', 1);
  }
  console.info('LOCAL_SQLITE_DEV enabled for this development process');
  return localDatabase;
}
async function withLocalLock<T>(fn: () => Promise<T> | T): Promise<T> {
  const previous = localQueue;
  let release!: () => void;
  localQueue = new Promise<void>((resolveLock) => { release = resolveLock; });
  await previous;
  try { return await fn(); } finally { release(); }
}
async function localQuery<T extends QueryResultRow>(sql: string, values: unknown[]) {
  const execute = () => {
    const statement = sqliteDatabase().prepare(sql.replace(/\s+FOR UPDATE\s*$/i, ''));
    const parameters = values as (string | number | null)[];
    if (/^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql)) {
      const rows = statement.all(...parameters) as unknown as T[];
      return { rows, rowCount: rows.length };
    }
    const result = statement.run(...parameters);
    return { rows: [] as T[], rowCount: Number(result.changes) };
  };
  try {
    return localTransaction.getStore() ? execute() : await withLocalLock(execute);
  } catch (cause) {
    if (cause instanceof DatabaseUnavailableError) throw cause;
    throw new DatabaseUnavailableError('query', cause);
  }
}
function databasePool() {
  if (pool) return pool;
  pool = new Pool({
    connectionString: validateConfiguration(), max: 1, connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000, statement_timeout: 10000, query_timeout: 12000,
    ssl: process.env.VERCEL !== '1' && process.env.DATABASE_SSL === 'false'
      ? false : {
        rejectUnauthorized: true,
        ca: process.env.DATABASE_SSL_CA_BASE64
          ? Buffer.from(process.env.DATABASE_SSL_CA_BASE64, 'base64').toString('utf8')
          : undefined,
      },
  });
  pool.on('error', () => { /* pg discards broken idle clients; never log connection details. */ });
  return pool;
}
export async function closeDatabase() {
  if (localDatabase) {
    localDatabase.close();
    localDatabase = undefined;
  }
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
function bind(sql: string) {
  let index = 0;
  return sql.replace(/\?/g, () => '$' + ++index);
}
async function query<T extends QueryResultRow>(sql: string, values: unknown[]) {
  if (localSqliteEnabled()) return localQuery<T>(sql, values);
  const client = transactionClient.getStore();
  try { return await (client ?? databasePool()).query<T>(bind(sql), values); }
  catch (cause) {
    if (cause instanceof DatabaseUnavailableError) throw cause;
    const code = (cause as { code?: string }).code ?? '';
    if (code.startsWith('23')) throw cause;
    const kind = code === '28P01' ? 'authentication'
      : code === '42P01' ? 'schema'
      : !code || code.startsWith('08') || code === 'ETIMEDOUT' ? 'connection' : 'query';
    throw new DatabaseUnavailableError(kind, cause);
  }
}
export function db() {
  return {
    prepare(sql: string) {
      return {
        async get<T extends QueryResultRow = QueryResultRow>(...values: unknown[]): Promise<T | undefined> {
          return (await query<T>(sql, values)).rows[0];
        },
        async all<T extends QueryResultRow = QueryResultRow>(...values: unknown[]): Promise<T[]> {
          return (await query<T>(sql, values)).rows;
        },
        async run(...values: unknown[]): Promise<{ changes: number }> {
          return { changes: (await query(sql, values)).rowCount ?? 0 };
        },
      };
    },
  };
}
export async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  if (localSqliteEnabled()) {
    return withLocalLock(async () => {
      const local = sqliteDatabase();
      local.exec('BEGIN IMMEDIATE');
      try {
        const result = await localTransaction.run(true, fn);
        local.exec('COMMIT');
        return result;
      } catch (error) {
        local.exec('ROLLBACK');
        throw error;
      }
    });
  }
  const client = await databasePool().connect().catch((cause: unknown) => {
    const kind = (cause as { code?: string }).code === '28P01' ? 'authentication' : 'connection';
    throw new DatabaseUnavailableError(kind, cause);
  });
  try {
    await client.query('BEGIN');
    const result = await transactionClient.run(client, fn);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
export async function audit(actor: string, action: string, target: string | null, details: unknown = {}) {
  await db().prepare('INSERT INTO audit(at,actor,action,target,details) VALUES(?,?,?,?,?)')
    .run(new Date().toISOString(), actor, action, target, encrypt(details));
}
