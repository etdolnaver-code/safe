import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const sourcePath = resolve(process.env.SQLITE_MIGRATION_PATH ?? './data/mbco.sqlite');
const backupDir = join(dirname(sourcePath), 'backups');
await mkdir(backupDir, { recursive: true });
const destination = join(backupDir, 'mbco-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID() + '.sqlite');
const source = new DatabaseSync(sourcePath, { readOnly: true });
try {
  await backup(source, destination);
  const saved = new DatabaseSync(destination, { readOnly: true });
  try {
    for (const table of ['admins', 'videos', 'registrations', 'audit']) {
      const count = (source.prepare('SELECT COUNT(*) AS count FROM ' + table).get() as { count: number }).count;
      const backed = (saved.prepare('SELECT COUNT(*) AS count FROM ' + table).get() as { count: number }).count;
      if (count !== backed) throw new Error('백업 검증 실패: ' + table);
    }
  } finally { saved.close(); }
  console.log('SQLite 백업 검증 완료: ' + destination);
} finally { source.close(); }
