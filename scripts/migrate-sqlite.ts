import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { db, transaction, decrypt, closeDatabase, validateMigrationTarget } from '../lib/db.ts';

type Cell = string | number | null;
type Row = Record<string, Cell>;
const tables = [
  'admins', 'visitors', 'visitor_drafts', 'videos', 'view_events',
  'registrations', 'rate_limits', 'audit', 'sessions',
] as const;
const sourcePath = resolve(process.env.SQLITE_MIGRATION_PATH ?? './data/mbco.sqlite');
const source = new DatabaseSync(sourcePath, { readOnly: true });
const snapshots = new Map<string, Row[]>();
try {
  for (const table of tables) snapshots.set(table, source.prepare('SELECT * FROM ' + table).all() as Row[]);
  const encrypted = [
    snapshots.get('registrations')?.[0]?.data,
    snapshots.get('visitor_drafts')?.[0]?.data,
    snapshots.get('audit')?.[0]?.details,
  ].find((value): value is string => typeof value === 'string');
  if (!/^[a-fA-F0-9]{64}$/.test(process.env.DATA_ENCRYPTION_KEY ?? ''))
    throw new Error('기존 DATA_ENCRYPTION_KEY가 없거나 형식이 잘못되었습니다.');
  if (encrypted) decrypt(encrypted); // Only checks the key; no private data is printed.
  console.log('SQLite 읽기 및 암호화 키 확인 완료. 테이블별 건수:');
  for (const table of tables) console.log(table + ': ' + snapshots.get(table)!.length);
  if (!process.argv.includes('--apply')) {
    console.log('읽기 전용 점검입니다. PostgreSQL에는 연결하거나 쓰지 않았습니다.');
  } else {
    validateMigrationTarget();
    const backupDir = join(dirname(sourcePath), 'backups');
    await mkdir(backupDir, { recursive: true });
    const backupPath = join(backupDir, 'mbco-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID() + '.sqlite');
    await backup(source, backupPath);
    const saved = new DatabaseSync(backupPath, { readOnly: true });
    try {
      for (const table of tables) {
        const backed = saved.prepare('SELECT * FROM ' + table).all() as Row[];
        const original = snapshots.get(table)!;
        const encode = (rows: Row[]) => rows.map((row) => JSON.stringify(row)).sort().join('\n');
        if (encode(backed) !== encode(original))
          throw new Error('SQLite 백업 값이 원본 점검 시점과 다릅니다: ' + table);
      }
    } finally { saved.close(); }
    console.log('SQLite 백업 및 건수 검증 완료: ' + backupPath);
    await transaction(async () => {
      for (const table of tables) {
        const row = await db().prepare('SELECT COUNT(*) AS count FROM ' + table).get() as { count: number };
        if (Number(row.count) !== 0) throw new Error('대상 PostgreSQL 테이블이 비어 있지 않습니다: ' + table);
      }
      for (const table of tables) {
        for (const row of snapshots.get(table)!) {
          const columns = Object.keys(row);
          const placeholders = columns.map(() => '?').join(',');
          await db().prepare('INSERT INTO ' + table + '(' + columns.map((c) => '"' + c.replaceAll('"', '""') + '"').join(',') + ') VALUES(' + placeholders + ')')
            .run(...Object.values(row));
        }
      }
      const auditCount = snapshots.get('audit')!.length;
      if (auditCount) await db().prepare("SELECT setval(pg_get_serial_sequence('audit','id'), (SELECT MAX(id) FROM audit))").run();
      for (const table of tables) {
        const row = await db().prepare('SELECT COUNT(*) AS count FROM ' + table).get() as { count: number };
        if (Number(row.count) !== snapshots.get(table)!.length)
          throw new Error('이전 건수 검증에 실패했습니다: ' + table);
        const original = snapshots.get(table)!;
        const columns = original.length ? Object.keys(original[0]) : [];
        const expected = original.map((item) => JSON.stringify(columns.map((column) => item[column]))).sort();
        const actual = (await db().prepare('SELECT * FROM ' + table).all() as Row[])
          .map((item) => JSON.stringify(columns.map((column) => item[column]))).sort();
        if (JSON.stringify(expected) !== JSON.stringify(actual))
          throw new Error('이전 값 검증에 실패했습니다: ' + table);
      }
    });
    console.log('PostgreSQL 이전 및 건수 검증 완료. 원본 SQLite와 백업은 보존했습니다.');
    await closeDatabase();
  }
} finally { source.close(); }
