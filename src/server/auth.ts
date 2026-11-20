import { randomBytes } from 'node:crypto';
import { hash, passwordValid, PublicError } from '../core/security.mjs';
import { query, sql } from './db';
import { configurationIssues } from '../core/configuration.mjs';

export type Principal = { role: 'admin' | 'viewer'; hash: string };
export async function throttle(key: string, max = 30, seconds = 60) {
  const [row] = await query(sql`INSERT INTO rate_limits(key,count,reset_at) VALUES(${key},1,now()+${seconds}*interval '1 second')
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.reset_at<now() THEN 1 ELSE rate_limits.count+1 END,
    reset_at=CASE WHEN rate_limits.reset_at<now() THEN now()+${seconds}*interval '1 second' ELSE rate_limits.reset_at END RETURNING count`);
  if (row.count > max) throw new PublicError('Muitas tentativas. Aguarde antes de tentar novamente.', 429);
}
export function sameOrigin(request: Request) {
  const expected = new URL(process.env.HUB_ORIGIN || 'http://127.0.0.1:3000').origin;
  if (request.headers.get('origin') !== expected) throw new PublicError('Origem não autorizada', 403);
}
export function cookieValue(request: Request, name = 'hub_session') {
  return request.headers.get('cookie')?.split(';').map(c => c.trim()).find(c => c.startsWith(`${name}=`))?.slice(name.length + 1) || '';
}
export async function principal(request: Request, write = false): Promise<Principal> {
  const token = cookieValue(request);
  if (!token) throw new PublicError('Faça login para continuar.', 401);
  const [session] = await query(sql`SELECT * FROM sessions WHERE hash=${hash(token)} AND expires_at>now()`);
  if (!session) throw new PublicError('Sessão expirada.', 401);
  if (write && session.role !== 'admin') throw new PublicError('Acesso de administrador necessário.', 403);
  if (write) sameOrigin(request);
  await throttle(`api:${session.hash}`, 240);
  return { hash: session.hash, role: session.role };
}
export async function login(password: string) {
  if (configurationIssues().length) throw new PublicError('Execute npm run check:config no computador do servidor para verificar o acesso. No primeiro uso, execute npm run setup.', 503);
  if (!passwordValid(password, process.env.ADMIN_PASSWORD_HASH)) throw new PublicError('Senha inválida.', 401);
  const token = randomBytes(32).toString('base64url');
  await query(sql`INSERT INTO sessions(hash,role,expires_at) VALUES(${hash(token)},'admin',now()+interval '8 hours')`);
  return token;
}
export function sessionCookie(token: string, age = 28800) {
  return `hub_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}
