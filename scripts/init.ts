import { readFile } from 'node:fs/promises';
import { db, transaction, passwordHash, audit, closeDatabase, validateMigrationTarget } from '../lib/db.ts';
import { passwordSchema } from '../lib/domain.ts';

if (!process.argv.includes('--apply')) {
  console.log('PostgreSQL 스키마와 최초 관리자 생성은 --apply 지정 시에만 실행됩니다. 먼저 백업과 DB_MIGRATION_TARGET을 확인하세요.');
} else {
  validateMigrationTarget();
  const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await transaction(async () => {
    await db().prepare(schema).run();
    const existing = await db().prepare('SELECT id FROM admins WHERE id=?').get('admin');
    if (!existing && !process.argv.includes('--schema-only')) {
      const initial = passwordSchema.parse(process.env.INITIAL_ADMIN_PASSWORD);
      await db().prepare('INSERT INTO admins(id,password,role,must_change) VALUES(?,?,?,1) ON CONFLICT(id) DO NOTHING')
        .run('admin', passwordHash(initial), 'ADMIN');
      await audit('system', 'INIT_ADMIN', null);
    }
  });
  console.log('PostgreSQL 스키마가 준비되었습니다. 기존 관리자 계정은 변경하지 않았습니다.');
  await closeDatabase();
}
