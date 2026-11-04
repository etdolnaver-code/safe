import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { get, mutate } from '@/lib/service';
import { HttpError, json } from '@/lib/security';
import { DatabaseUnavailableError } from '@/lib/db';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handler(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  let path: string[] = [];
  try {
    ({ path } = await context.params);
    return req.method === 'GET' ? await get(req, path) : await mutate(req, path);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    if (e instanceof ZodError)
      return json(
        { error: e.issues[0]?.message ?? '입력값을 확인하세요.', fields: e.flatten() },
        400,
      );
    const reference = randomUUID();
    const endpoint = path[0] === 'admin' ? path.slice(0, 2).join('/') : path[0] ?? 'unknown';
    const category = e instanceof DatabaseUnavailableError ? 'database_' + e.kind : 'internal';
    console.error('API_FAILURE', { reference, endpoint, category });
    if (e instanceof DatabaseUnavailableError)
      return json({ error: '데이터 저장소에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.', reference }, 503);
    return json({ error: '처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.', reference }, 500);
  }
}
export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
