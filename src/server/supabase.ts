import { randomUUID } from 'node:crypto';
import { decrypt, encrypt, PublicError, projectOrigin } from '../core/security.mjs';
import { database, query, sql, type Row } from './db';

type Credentials = { access_token?: string; refresh_token?: string; expires_at?: number; database_url?: string; storage_key?: string };
export async function oauthToken(body: URLSearchParams) {
  if (!process.env.SUPABASE_OAUTH_CLIENT_ID || !process.env.SUPABASE_OAUTH_CLIENT_SECRET) throw new PublicError('OAuth ainda não configurado.', 503);
  const response = await fetch('https://api.supabase.com/v1/oauth/token', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: {
    Authorization: `Basic ${Buffer.from(`${process.env.SUPABASE_OAUTH_CLIENT_ID}:${process.env.SUPABASE_OAUTH_CLIENT_SECRET}`).toString('base64')}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  }, body });
  if (!response.ok) throw new PublicError('O Supabase recusou a autorização OAuth.', 502);
  const result = await response.json();
  if (!result.access_token || !result.refresh_token || !result.expires_in) throw new PublicError('Resposta OAuth incompleta.', 502);
  return { access_token: result.access_token, refresh_token: result.refresh_token, expires_at: Date.now() + result.expires_in * 1000 };
}
export async function credentials(connectionId: string): Promise<Credentials> {
  // Serialize refreshes across web/worker processes; never overwrite a newly rotated refresh token.
  return (await database()).transaction(async db => {
    const [connection] = await db.query(sql`SELECT * FROM connections WHERE id=${connectionId} AND enabled=true FOR UPDATE`);
    if (!connection) throw new PublicError('Conexão desativada ou inexistente.', 409);
    let value = decrypt(connection.secret, connection.id) as Credentials;
    if (connection.kind === 'oauth' && (value.expires_at || 0) < Date.now() + 60000) {
      const refreshed = await oauthToken(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: value.refresh_token || '' }));
      value = { ...value, ...refreshed };
      await db.query(sql`UPDATE connections SET secret=${encrypt(value, connection.id)} WHERE id=${connection.id}`);
    }
    return value;
  });
}
export async function management<T = any>(connectionId: string, pathname: string, body?: unknown): Promise<T> {
  if (!/^\/v1\/(projects|organizations)(\/|$)/.test(pathname) || pathname.includes('..')) throw new Error('Invalid Management API path');
  const token = (await credentials(connectionId)).access_token;
  if (!token) throw new PublicError('Esta operação exige um token da Management API.', 409);
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try {
      response = await fetch(`https://api.supabase.com${pathname}`, { method: body === undefined ? 'GET' : 'POST',
        redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch { if (attempt < 2) { await new Promise(r => setTimeout(r, 300 * 2 ** attempt)); continue; } throw new PublicError('Falha de rede ao consultar Supabase.', 502); }
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      const delay = Math.min(5000, Math.max(300 * 2 ** attempt, Number(response.headers.get('retry-after') || 0) * 1000));
      await new Promise(r => setTimeout(r, delay)); continue;
    }
    if (!response.ok) throw new PublicError(response.status === 403 ? 'Permissão insuficiente no token Supabase.' : `Supabase respondeu HTTP ${response.status}.`, 502);
    return await response.json() as T;
  }
  throw new PublicError('Supabase indisponível após novas tentativas.', 502);
}
export async function connectionFor(ref: string) {
  projectOrigin(ref);
  const rows = await query(sql`SELECT c.id FROM connections c JOIN project_connections pc ON pc.connection_id=c.id WHERE pc.project_ref=${ref} AND c.enabled=true ORDER BY c.created_at`);
  if (!rows.length) throw new PublicError('Projeto sem conexão autorizada ativa.', 409);
  return rows[0].id as string;
}
export async function readOnly(ref: string, statement: string) {
  const connectionId = await connectionFor(ref);
  const result = await management<any>(connectionId, `/v1/projects/${ref}/database/query/read-only`, { query: statement });
  if (!Array.isArray(result)) throw new PublicError('Formato de consulta Supabase inesperado.', 502);
  return result;
}
export async function discover(connectionId: string) {
  const organizations = await management<Row[]>(connectionId, '/v1/organizations');
  const projects = await management<Row[]>(connectionId, '/v1/projects');
  if (!Array.isArray(organizations) || !Array.isArray(projects)) throw new PublicError('Formato de descoberta inesperado.', 502);
  await (await database()).transaction(async db => {
    for (const org of organizations) {
      if (!org.id || !org.name) throw new PublicError('Organização sem identificador.', 502);
      await db.query(sql`INSERT INTO organizations(id,name) VALUES(${org.id},${org.name}) ON CONFLICT(id) DO UPDATE SET name=excluded.name`);
    }
    for (const p of projects) {
      const ref = p.id || p.ref; projectOrigin(ref);
      if (!p.organization_id) throw new PublicError('Projeto sem organização.', 502);
      await db.query(sql`INSERT INTO organizations(id,name) VALUES(${p.organization_id},${p.organization_id}) ON CONFLICT DO NOTHING`);
      await db.query(sql`INSERT INTO projects(ref,organization_id,name,region,status) VALUES(${ref},${p.organization_id},${p.name},${p.region || ''},${p.status || 'UNKNOWN'})
        ON CONFLICT(ref) DO UPDATE SET organization_id=excluded.organization_id,name=excluded.name,region=excluded.region,status=excluded.status`);
    }
    // Reconcile only this connection, preserving the same projects reached through other credentials.
    await db.query(sql`DELETE FROM project_connections WHERE connection_id=${connectionId}`);
    for (const p of projects) await db.query(sql`INSERT INTO project_connections(project_ref,connection_id) VALUES(${p.id || p.ref},${connectionId})`);
  });
  return { projects: projects.length, organizations: organizations.length };
}
export async function observe(ref: string, category: string, value: number | null, source: string, error?: string) {
  await query(sql`INSERT INTO observations(id,scope,resource_id,category,value,unit,source,error)
    VALUES(${randomUUID()},'PROJECT_LEVEL',${ref},${category},${value},'bytes',${source},${error || null})`);
}
export async function collect(ref: string) {
  const errors: string[] = [];
  const measurement = (value: unknown) => {
    if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !/^\d+(\.\d+)?$/.test(value))) throw new Error('Missing or invalid measurement');
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) throw new Error('Invalid measurement');
    return bytes;
  };
  try {
    const rows = await readOnly(ref, "select pg_catalog.pg_database_size(pg_catalog.current_database())::text as bytes");
    const bytes = measurement(rows[0]?.bytes);
    await observe(ref, 'database_bytes', bytes, 'Management API read-only / pg_database_size');
    await query(sql`UPDATE projects SET health='healthy',checked_at=now() WHERE ref=${ref}`);
  } catch {
    errors.push('Banco: coleta indisponível ou sem permissão');
    await observe(ref, 'database_bytes', null, 'Management API read-only', errors.at(-1));
    await query(sql`UPDATE projects SET health='unknown',checked_at=now() WHERE ref=${ref}`);
  }
  try {
    const rows = await readOnly(ref, "select coalesce(sum((metadata->>'size')::numeric),0)::text as bytes from storage.objects");
    const bytes = measurement(rows[0]?.bytes);
    await observe(ref, 'storage_bytes', bytes, 'Management API read-only / storage.objects metadata.size');
  } catch {
    errors.push('Storage: coleta indisponível ou sem permissão');
    await observe(ref, 'storage_bytes', null, 'Management API read-only', errors.at(-1));
  }
  return { ref, errors };
}
