import { refreshAlerts } from '../../../server/alerts';
import { randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { query, database, sql } from '../../../server/db';
import { principal, sameOrigin, throttle, login, sessionCookie, cookieValue } from '../../../server/auth';
import { decrypt, encrypt, hash, PublicError, safeMessage, projectOrigin } from '../../../core/security.mjs';
import { credentials, discover, collect, oauthToken } from '../../../server/supabase';
import { snapshot, compare } from '../../../server/schema';
import { audit, state, registerApplication, plan, executeSwitch, resolveRoute, recoverApplication } from '../../../server/engine';
import { queueBackup, runBackup, restoreBackup, downloadBackup } from '../../../server/backups';
import { configurationIssues } from '../../../core/configuration.mjs';

export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
const ref = z.string().regex(/^[a-z0-9]{20}$/); const id = z.string().uuid();
const text = z.string().trim().min(1).max(160);
const connectionInput = z.object({ name: text, accountId: text, token: z.string().min(10).max(4096), databaseUrl: z.string().max(2048).optional(), storageKey: z.string().max(4096).optional() });
async function body(request: Request) {
  if (Number(request.headers.get('content-length') || 0) > 32768) throw new PublicError('Corpo muito grande.', 413);
  const value = await request.text(); if (Buffer.byteLength(value) > 32768) throw new PublicError('Corpo muito grande.', 413);
  return JSON.parse(value);
}
function json(value: unknown, status = 200) { return NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } }); }
async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  try {
    const pathname = (await context.params).path.join('/'); const url = new URL(request.url);
    if (pathname === 'health' && request.method === 'GET') return json({ ok: true, configured: configurationIssues().length === 0 });
    if (pathname === 'auth/login' && request.method === 'POST') {
      sameOrigin(request); await throttle('login:global', 10, 60);
      const input = z.object({ password: z.string().min(1).max(256) }).parse(await body(request));
      const token = await login(input.password);
      await audit('admin', 'auth.login', 'session'); return NextResponse.json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie(token) } });
    }
    if (pathname === 'route' && request.method === 'GET') {
      const token = request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
      await throttle(`route:${hash(token)}`, 120);
      return json(await resolveRoute(id.parse(url.searchParams.get('applicationId')), token));
    }
    if (pathname === 'agent/snapshot' && request.method === 'GET') {
      const token = request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
      if (!process.env.AGENT_READ_TOKEN || hash(token) !== hash(process.env.AGENT_READ_TOKEN)) throw new PublicError('Token de leitura inválido.', 401);
      await throttle('agent:global', 60); return json(await state());
    }
    const who = await principal(request, request.method !== 'GET');
    if (pathname === 'auth/logout' && request.method === 'POST') {
      await query(sql`DELETE FROM sessions WHERE hash=${who.hash}`); return NextResponse.json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie('', 0) } });
    }
    if (pathname === 'state' && request.method === 'GET') return json(await state());
    if (pathname === 'backups/download' && request.method === 'GET') {
      const backup = await downloadBackup(id.parse(url.searchParams.get('id')));
      await audit(who.role, 'backup.download', backup.job.project_ref, { id: backup.job.id });
      return new Response(Readable.toWeb(createReadStream(backup.filename)) as ReadableStream, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${backup.job.id}.hub"`, 'Cache-Control': 'no-store' } });
    }
    if (pathname === 'oauth/start' && request.method === 'POST') {
      if (!process.env.SUPABASE_OAUTH_CLIENT_ID) throw new PublicError('Cadastre e configure seu aplicativo OAuth primeiro.', 409);
      const input = z.object({ name: text }).parse(await body(request));
      const stateToken = randomBytes(32).toString('base64url'); const verifier = randomBytes(48).toString('base64url');
      await query(sql`INSERT INTO oauth_states(hash,session_hash,verifier,name,expires_at) VALUES(${hash(stateToken)},${who.hash},${encrypt({ verifier }, hash(stateToken))},${input.name},now()+interval '10 minutes')`);
      const redirect = `${process.env.HUB_ORIGIN}/api/oauth/callback`;
      const params = new URLSearchParams({ client_id: process.env.SUPABASE_OAUTH_CLIENT_ID, redirect_uri: redirect, response_type: 'code', state: stateToken,
        code_challenge: Buffer.from(hash(verifier), 'hex').toString('base64url'), code_challenge_method: 'S256' });
      return json({ url: `https://api.supabase.com/v1/oauth/authorize?${params}` });
    }
    if (pathname === 'oauth/callback' && request.method === 'GET') {
      const stateToken = url.searchParams.get('state') || '';
      const [pending] = await query(sql`DELETE FROM oauth_states WHERE hash=${hash(stateToken)} AND session_hash=${who.hash} AND expires_at>now() RETURNING *`);
      if (!pending) throw new PublicError('Estado OAuth inválido ou expirado.', 403);
      const { decrypt } = await import('../../../core/security.mjs');
      const { verifier } = decrypt(pending.verifier, hash(stateToken));
      const tokens = await oauthToken(new URLSearchParams({ grant_type: 'authorization_code', code: url.searchParams.get('code') || '', code_verifier: verifier, redirect_uri: `${process.env.HUB_ORIGIN}/api/oauth/callback` }));
      const connectionId = randomUUID();
      await query(sql`INSERT INTO connections(id,name,account_id,kind,secret) VALUES(${connectionId},${pending.name},${`oauth:${connectionId}`},'oauth',${encrypt(tokens,connectionId)})`);
      await discover(connectionId); await audit(who.role, 'connection.oauth', connectionId);
      return NextResponse.redirect(new URL('/?view=accounts', process.env.HUB_ORIGIN));
    }
    if (pathname !== 'action' || request.method !== 'POST') throw new PublicError('Endpoint inexistente.', 404);
    const raw = await body(request); const action = z.string().max(80).parse(raw.action); const input = raw.input;
    let result: unknown = { ok: true }; let resource = 'hub';
    switch (action) {
      case 'connection.create': {
        const value = connectionInput.parse(input); const connectionId = randomUUID(); resource = connectionId;
        await query(sql`INSERT INTO connections(id,name,account_id,kind,secret) VALUES(${connectionId},${value.name},${value.accountId},'pat',${encrypt({ access_token: value.token, database_url: value.databaseUrl, storage_key: value.storageKey },connectionId)})`);
        result = { id: connectionId }; break;
      }
      case 'connection.update': {
        const value = z.object({ id, name: text, enabled: z.boolean(), token: z.string().min(10).max(4096).optional() }).parse(input); resource = value.id;
        await (await database()).transaction(async db => {
          const [connection] = await db.query(sql`SELECT id,secret FROM connections WHERE id=${value.id} FOR UPDATE`);
          if (!connection) throw new PublicError('Conexão inexistente.',404);
          if (value.token) {
            const { refresh_token: _, expires_at: __, ...old } = decrypt(connection.secret, value.id);
            await db.query(sql`UPDATE connections SET secret=${encrypt({ ...old, access_token:value.token },value.id)},kind='pat' WHERE id=${value.id}`);
          }
          await db.query(sql`UPDATE connections SET name=${value.name},enabled=${value.enabled} WHERE id=${value.id}`);
        }); break;
      }
      case 'connection.delete': {
        const value = z.object({ id, confirmation: z.literal('DELETE') }).parse(input); resource = value.id;
        await query(sql`DELETE FROM connections WHERE id=${value.id}`); break;
      }
      case 'connection.discover': { const value = z.object({ id }).parse(input); resource = value.id; result = await discover(value.id); break; }
      case 'project.manual': {
        const value = z.object({ connectionId: id, ref, organizationId: text, name: text, publishableKey: z.string().min(10).max(4096), environment: text }).parse(input); resource = value.ref;
        await credentials(value.connectionId); projectOrigin(value.ref);
        if (value.publishableKey.startsWith('sb_secret_')) throw new PublicError('Use uma chave publicável, nunca uma chave secreta.');
        if (value.publishableKey.split('.').length === 3) { try { const claims = JSON.parse(Buffer.from(value.publishableKey.split('.')[1], 'base64url').toString()); if (claims.role !== 'anon') throw new Error(); } catch { throw new PublicError('Chave JWT deve ter role anon.'); } }
        else if (!value.publishableKey.startsWith('sb_publishable_')) throw new PublicError('Formato de chave publicável inválido.');
        await (await database()).transaction(async db => {
          await db.query(sql`INSERT INTO organizations(id,name) VALUES(${value.organizationId},${value.organizationId}) ON CONFLICT DO NOTHING`);
          await db.query(sql`INSERT INTO projects(ref,organization_id,name,publishable_key,environment) VALUES(${value.ref},${value.organizationId},${value.name},${value.publishableKey},${value.environment}) ON CONFLICT(ref) DO UPDATE SET publishable_key=excluded.publishable_key,environment=excluded.environment`);
          await db.query(sql`INSERT INTO project_connections(project_ref,connection_id) VALUES(${value.ref},${value.connectionId}) ON CONFLICT DO NOTHING`);
        }); break;
      }
      case 'organization.restrict': { const value = z.object({ id: text, restricted: z.boolean() }).parse(input); resource = value.id; await query(sql`UPDATE organizations SET restricted=${value.restricted} WHERE id=${value.id}`); break; }
      case 'metrics.collect': {
        const value = z.object({ ref: ref.optional() }).parse(input || {});
        const projects = value.ref ? [{ref:value.ref}] : await query(sql`SELECT DISTINCT p.ref FROM projects p JOIN project_connections pc ON pc.project_ref=p.ref JOIN connections c ON c.id=pc.connection_id WHERE c.enabled=true`);
        result = []; for (const p of projects) (result as unknown[]).push(await collect(p.ref)); await refreshAlerts(); break;
      }
      case 'schema.snapshot': { const value = z.object({ ref }).parse(input); resource = value.ref; result = await snapshot(value.ref); break; }
      case 'schema.compare': { const value = z.object({ source: ref, target: ref }).parse(input); result = await compare(value.source,value.target); break; }
      case 'capacity.save': {
        const value = z.object({ scope: z.enum(['PROJECT_LEVEL','ORGANIZATION_LEVEL','ACCOUNT_LEVEL','APPLICATION_POLICY']), resourceId: text, category: z.enum(['database_bytes','storage_bytes','egress_bytes','ram_bytes','ram_used_bytes','api_requests']), capacity: z.number().positive().finite(), source: text, warning:z.number().int().min(1).max(99), elevated:z.number().int().min(1).max(99), critical:z.number().int().min(1).max(100), period:z.string().max(30).default('') }).refine(v => v.warning<v.elevated && v.elevated<v.critical, 'Threshold order').parse(input);
        if (value.category==='egress_bytes' && !/^\d{4}-\d{2}$/.test(value.period)) throw new PublicError('Transferência exige período YYYY-MM.');
        resource = value.resourceId;
        await query(sql`INSERT INTO capacity_limits(id,scope,resource_id,category,capacity,unit,source,warning,elevated,critical,period) VALUES(${randomUUID()},${value.scope},${value.resourceId},${value.category},${value.capacity},${value.category==='api_requests'?'requests':'bytes'},${value.source},${value.warning},${value.elevated},${value.critical},${value.period}) ON CONFLICT(scope,resource_id,category,period) DO UPDATE SET capacity=excluded.capacity,source=excluded.source,warning=excluded.warning,elevated=excluded.elevated,critical=excluded.critical`); break;
      }
      case 'application.recover': { const value=z.object({ applicationId:id,version:z.number().int().positive(),confirmation:z.string() }).parse(input); result=await recoverApplication(value.applicationId,value.version,value.confirmation,who.role);break; }
      case 'application.create': { const value = z.object({ name:text, activeRef:ref, dataPolicy:z.enum(['independent','synchronized','restored']), authMode:z.enum(['none','supabase','external']) }).parse(input); result = await registerApplication(value); break; }
      case 'application.pause': { const value=z.object({ id,paused:z.boolean() }).parse(input);resource=value.id;await query(sql`UPDATE applications SET paused=${value.paused} WHERE id=${value.id}`); break; }
      case 'pool.save': {
        const evidence = z.object({ source_ref:ref,target_ref:ref,schema_hash:z.string().regex(/^[a-f0-9]{64}$/),reference:z.string().min(4).max(500),expires_at:z.iso.datetime(),policy:z.enum(['synchronized','restored']).optional() }).nullable().optional();
        const value=z.object({ applicationId:id,ref,priority:z.number().int().min(0).max(10000),enabled:z.boolean(),role:z.enum(['primary','reserve','backup']),dataEvidence:evidence,identityEvidence:evidence }).parse(input); resource=value.applicationId;
        await query(sql`INSERT INTO pool_members(application_id,project_ref,priority,enabled,role,data_evidence,identity_evidence) VALUES(${value.applicationId},${value.ref},${value.priority},${value.enabled},${value.role},${JSON.stringify(value.dataEvidence||null)}::jsonb,${JSON.stringify(value.identityEvidence||null)}::jsonb) ON CONFLICT(application_id,project_ref) DO UPDATE SET priority=excluded.priority,enabled=excluded.enabled,role=excluded.role,data_evidence=excluded.data_evidence,identity_evidence=excluded.identity_evidence`); break;
      }
      case 'failover.plan': { const value=z.object({ applicationId:id,target:ref.optional() }).parse(input);result=await plan(value.applicationId,value.target,true);break; }
      case 'failover.execute': { const value=z.object({ applicationId:id,target:ref,version:z.number().int().positive(),confirmation:z.string() }).parse(input);if(value.confirmation!==`SWITCH ${value.target}`)throw new PublicError('Confirmação inválida.');result=await executeSwitch(value.applicationId,value.target,value.version,who.role);break; }
      case 'backup.create': { const value=z.object({ ref,kind:z.enum(['database','schema','storage']) }).parse(input);result=await queueBackup(value.ref,value.kind);if(!process.env.DATABASE_URL) await runBackup((result as {id:string}).id);break; }
      case 'backup.restore': { const value=z.object({ id,target:ref,confirmation:z.string() }).parse(input);result=await restoreBackup(value.id,value.target,value.confirmation,who.role);break; }
      case 'backup.schedule': { const value=z.object({ ref,everyHours:z.number().int().min(1).max(8760),kind:z.enum(['database','schema','storage']),enabled:z.boolean() }).parse(input);if(!process.env.DATABASE_URL)throw new PublicError('Agendamento requer PostgreSQL externo e worker.',409);await query(sql`INSERT INTO backup_schedules(project_ref,every_hours,kind,enabled) VALUES(${value.ref},${value.everyHours},${value.kind},${value.enabled}) ON CONFLICT(project_ref) DO UPDATE SET every_hours=excluded.every_hours,kind=excluded.kind,enabled=excluded.enabled`);break; }
      default: throw new PublicError('Ação desconhecida.',404);
    }
    await audit(who.role,action,resource); return json(result);
  } catch (error) { return json({ error: safeMessage(error) },error instanceof PublicError ? error.status : 400); }
}
export const GET=handle; export const POST=handle;
