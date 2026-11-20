import { randomBytes, randomUUID } from 'node:crypto';
import { database, query, sql, type Row } from './db';
import { collect } from './supabase';
import { snapshot } from './schema';
import { eligibility } from '../core/failover.mjs';
import { latestObservations } from '../core/capacity.mjs';
import { evaluateLimits } from '../core/alerts.mjs';
import { hash, PublicError } from '../core/security.mjs';

export async function audit(actor: string, action: string, resource: string, details: unknown = {}) {
  await query(sql`INSERT INTO audit(id,actor,action,resource,details) VALUES(${randomUUID()},${actor},${action},${resource},${JSON.stringify(details)}::jsonb)`);
}
export async function state() {
  const [connections, organizations, projects, applications, members, observations, limits, operations, logs, backups, schedules, alerts, projectConnections] = await Promise.all([
    query(sql`SELECT id,name,account_id,kind,enabled,created_at FROM connections ORDER BY created_at`),
    query(sql`SELECT * FROM organizations ORDER BY name`),
    query(sql`SELECT p.*,EXISTS(SELECT 1 FROM project_connections pc JOIN connections c ON c.id=pc.connection_id WHERE pc.project_ref=p.ref AND c.enabled=true) AS authorized FROM projects p ORDER BY p.name`),
    query(sql`SELECT id,name,active_ref,version,paused,data_policy,auth_mode,cooldown_seconds,last_switch,blocked FROM applications ORDER BY name`),
    query(sql`SELECT * FROM pool_members ORDER BY priority`),
    query(sql`SELECT * FROM observations WHERE collected_at>now()-interval '31 days' ORDER BY collected_at DESC LIMIT 20000`),
    query(sql`SELECT * FROM capacity_limits`), query(sql`SELECT * FROM operations ORDER BY created_at DESC LIMIT 100`),
    query(sql`SELECT * FROM audit ORDER BY created_at DESC LIMIT 100`),
    query(sql`SELECT id,project_ref,kind,state,digest,bytes,error,created_at,completed_at,expires_at FROM backup_jobs ORDER BY created_at DESC LIMIT 100`),
    query(sql`SELECT * FROM backup_schedules`), query(sql`SELECT * FROM alerts ORDER BY created_at DESC LIMIT 200`), query(sql`SELECT project_ref,connection_id FROM project_connections`),
  ]);
  // Snapshots may contain proprietary function bodies. Only schema comparison API returns section names.
  return { connections, organizations, projects: projects.map(({ schema_snapshot: _, ...p }) => p), applications, members, observations, limits, operations, logs, backups, schedules, alerts, projectConnections,
    capabilities: { oauth: !!process.env.SUPABASE_OAUTH_CLIENT_ID && !!process.env.SUPABASE_OAUTH_CLIENT_SECRET, worker: !!process.env.DATABASE_URL, databaseBackups: !!process.env.PG_DUMP_PATH, storageBackups: true }, serverTime: new Date().toISOString() };
}
async function project(ref: string) {
  const [p] = await query(sql`SELECT p.*,o.restricted,EXISTS(SELECT 1 FROM project_connections pc JOIN connections c ON c.id=pc.connection_id WHERE pc.project_ref=p.ref AND c.enabled=true) AS authorized FROM projects p JOIN organizations o ON o.id=p.organization_id WHERE p.ref=${ref}`);
  if (!p) throw new PublicError('Projeto inexistente.', 404);
  return p;
}
export async function capacityReasons(target: Row, applicationId?: string) {
  const limits = await query(sql`SELECT * FROM capacity_limits WHERE
    (scope='PROJECT_LEVEL' AND resource_id=${target.ref}) OR
    (scope='ORGANIZATION_LEVEL' AND resource_id=${target.organization_id}) OR
    (scope='APPLICATION_POLICY' AND resource_id=${applicationId || ''}) OR
    (scope='ACCOUNT_LEVEL' AND resource_id IN (SELECT c.account_id FROM connections c JOIN project_connections pc ON pc.connection_id=c.id WHERE pc.project_ref=${target.ref} AND c.enabled=true))`);
  const observations = latestObservations(await query(sql`SELECT DISTINCT ON(scope,resource_id,category,period) * FROM observations ORDER BY scope,resource_id,category,period,collected_at DESC`));
  const projects = await query(sql`SELECT ref,organization_id FROM projects`);
  const evaluations = evaluateLimits(projects, observations, limits);
  const reasons: string[] = [];
  for (const category of ['database_bytes','storage_bytes']) if (!limits.some(l => l.category === category && ['PROJECT_LEVEL','ORGANIZATION_LEVEL'].includes(l.scope))) reasons.push(`Capacidade desconhecida: ${category}`);
  for (const limit of limits) {
    if (['ACCOUNT_LEVEL','APPLICATION_POLICY'].includes(limit.scope)) { reasons.push('Limite de conta/aplicação exige avaliação administrativa antes da troca'); continue; }
    const evaluation = evaluations.find((e: { limitId: string; severity: string }) => e.limitId === limit.id);
    if (!evaluation || evaluation.severity === 'unknown') reasons.push(`Métrica ausente/desatualizada: ${limit.category} (${limit.scope})`);
    else if (['critical','exhausted'].includes(evaluation.severity)) reasons.push(`Capacidade crítica: ${limit.category} (${limit.scope})`);
  }
  return reasons;
}
export async function plan(applicationId: string, targetRef?: string, refresh = false) {
  const [app] = await query(sql`SELECT * FROM applications WHERE id=${applicationId}`);
  if (!app?.active_ref) throw new PublicError('Defina o projeto inicial da aplicação.', 409);
  if (refresh) { await collect(app.active_ref); await snapshot(app.active_ref); }
  const source = await project(app.active_ref);
  const members = await query(sql`SELECT * FROM pool_members WHERE application_id=${applicationId} ORDER BY priority,project_ref`);
  const candidates = [];
  for (const member of members.filter(m => m.project_ref !== source.ref && (!targetRef || m.project_ref === targetRef))) {
    if (refresh) { await collect(member.project_ref); try { await snapshot(member.project_ref); } catch { /* missing/old snapshots are rejected below */ } }
    const target = await project(member.project_ref);
    candidates.push({ ref: target.ref, name: target.name, priority: member.priority,
      ...eligibility({ app, source, target, member, capacityReasons: await capacityReasons(target, app.id) }) });
  }
  return { applicationId, version: app.version, from: source.ref, candidates, selected: candidates.find(c => c.eligible)?.ref || null };
}
export async function transition(operationId: string, state: string, details: unknown = {}) {
  await query(sql`UPDATE operations SET state=${state},details=${JSON.stringify(details)}::jsonb,updated_at=now() WHERE id=${operationId}`);
}
export async function executeSwitch(applicationId: string, toRef: string, expectedVersion: number, actor: string, automatic = false) {
  const id = randomUUID();
  const [app] = await query(sql`SELECT * FROM applications WHERE id=${applicationId}`);
  if (!app || app.version !== expectedVersion) throw new PublicError('A rota mudou. Refaça o planejamento.', 409);
  if (automatic && app.paused) throw new PublicError('Automações pausadas.', 409);
  try { await query(sql`INSERT INTO operations(id,application_id,from_ref,to_ref,state,reason) VALUES(${id},${applicationId},${app.active_ref},${toRef},'PLANNING',${automatic ? 'capacity' : 'manual'})`); }
  catch { throw new PublicError('Já existe uma alternância em andamento.', 409); }
  let switched = false;
  try {
    await transition(id, 'VALIDATING');
    const result = await plan(applicationId, toRef, true);
    if (!result.candidates.find(c => c.ref === toRef)?.eligible) throw new PublicError(result.candidates[0]?.reasons.join('; ') || 'Destino fora do pool.', 409);
    await transition(id, 'SWITCHING');
    // Fence SDK route discovery before mutating the route. No direct-client write fencing is implied.
    const changed = await query(sql`UPDATE applications SET active_ref=${toRef},version=version+1,last_switch=now(),blocked=true WHERE id=${applicationId} AND version=${expectedVersion} AND blocked=false ${automatic ? sql`AND paused=false` : sql``} RETURNING id`);
    if (!changed.length) throw new PublicError('Versão concorrente ou aplicação bloqueada.', 409);
    switched = true;
    await transition(id, 'VERIFYING');
    await collect(toRef);
    const verified = await project(toRef);
    if (verified.health !== 'healthy') throw new PublicError('Verificação após troca falhou.', 502);
    await (await database()).transaction(async db => {
      await db.query(sql`UPDATE applications SET blocked=false WHERE id=${applicationId} AND active_ref=${toRef} AND version=${expectedVersion + 1}`);
      await db.query(sql`UPDATE operations SET state='COMPLETED',updated_at=now() WHERE id=${id}`);
      await db.query(sql`INSERT INTO audit(id,actor,action,resource,details) VALUES(${randomUUID()},${actor},'failover.completed',${applicationId},${JSON.stringify({ id, from: app.active_ref, to: toRef })}::jsonb)`);
    });
    return { id, state: 'COMPLETED' };
  } catch (error) {
    if (!switched) { await transition(id, 'BLOCKED', { message: error instanceof PublicError ? error.message : 'Falha de validação' }); throw error; }
    await transition(id, 'ROLLING_BACK');
    await collect(app.active_ref).catch(() => undefined);
    const original = await project(app.active_ref);
    const healthy = original.health === 'healthy';
    await (await database()).transaction(async db => {
      await db.query(sql`UPDATE applications SET active_ref=${app.active_ref},version=version+1,blocked=${!healthy} WHERE id=${applicationId} AND version=${expectedVersion + 1}`);
      await db.query(sql`UPDATE operations SET state=${healthy ? 'ROLLED_BACK' : 'NEEDS_ATTENTION'},updated_at=now() WHERE id=${id}`);
    });
    await audit(actor, healthy ? 'failover.rolled_back' : 'failover.needs_attention', applicationId, { id });
    throw new PublicError(healthy ? 'Destino falhou; rota anterior restaurada e verificada.' : 'Falha no destino e na origem. Roteamento bloqueado para revisão.', 502);
  }
}
export async function registerApplication(input: { name: string; activeRef: string; dataPolicy: string; authMode: string }) {
  const p = await project(input.activeRef);
  if (!p.authorized) throw new PublicError('Projeto inicial sem autorização.', 409);
  const id = randomUUID(); const machineToken = randomBytes(32).toString('base64url');
  await (await database()).transaction(async db => {
    await db.query(sql`INSERT INTO applications(id,name,active_ref,data_policy,auth_mode,machine_hash) VALUES(${id},${input.name},${input.activeRef},${input.dataPolicy},${input.authMode},${hash(machineToken)})`);
    await db.query(sql`INSERT INTO pool_members(application_id,project_ref,role) VALUES(${id},${input.activeRef},'primary')`);
  });
  return { id, machineToken };
}
export async function resolveRoute(applicationId: string, token: string) {
  const [app] = await query(sql`SELECT a.*,p.publishable_key FROM applications a JOIN projects p ON p.ref=a.active_ref WHERE a.id=${applicationId} AND a.machine_hash=${hash(token)}`);
  if (!app) throw new PublicError('Credencial da aplicação inválida.', 401);
  if (app.blocked) throw new PublicError('Roteamento temporariamente bloqueado.', 503);
  const running = await query(sql`SELECT id FROM operations WHERE application_id=${applicationId} AND state IN ('SWITCHING','VERIFYING','ROLLING_BACK')`);
  if (running.length) throw new PublicError('Alternância em verificação.', 503);
  const p = await project(app.active_ref);
  if (!p.authorized || p.restricted || !p.publishable_key) throw new PublicError('Projeto ativo indisponível para roteamento.', 503);
  return { applicationId, version: app.version, ref: p.ref, url: `https://${p.ref}.supabase.co`, publishableKey: p.publishable_key, ttlSeconds: 0 };
}

/** Explicit recovery of the current route after operator investigation. Never changes its project. */
export async function recoverApplication(applicationId: string, expectedVersion: number, confirmation: string, actor: string) {
  const [app] = await query(sql`SELECT * FROM applications WHERE id=${applicationId}`);
  if (!app || !app.blocked || app.version !== expectedVersion) throw new PublicError('Aplicação não bloqueada ou versão alterada.',409);
  if (confirmation !== `RECOVER ${app.active_ref}`) throw new PublicError('Confirmação de recuperação inválida.');
  await collect(app.active_ref);
  const active = await project(app.active_ref);
  if (!active.authorized || active.restricted || active.health !== 'healthy' || !active.publishable_key) throw new PublicError('Rota atual não passou na verificação de autorização e saúde.',409);
  return (await database()).transaction(async db => {
    const [locked] = await db.query(sql`SELECT * FROM applications WHERE id=${applicationId} FOR UPDATE`);
    if (!locked?.blocked || locked.version !== expectedVersion) throw new PublicError('Rota alterada durante a recuperação.',409);
    const running = await db.query(sql`SELECT id FROM operations WHERE application_id=${applicationId} AND state IN ('PLANNING','VALIDATING','SWITCHING','VERIFYING','ROLLING_BACK')`);
    if (running.length) throw new PublicError('Aguarde a conclusão ou recuperação da operação pelo worker.',409);
    await db.query(sql`UPDATE applications SET blocked=false,paused=true,version=version+1 WHERE id=${applicationId}`);
    await db.query(sql`INSERT INTO audit(id,actor,action,resource,details) VALUES(${randomUUID()},${actor},'application.recovered',${applicationId},${JSON.stringify({ref:app.active_ref,previousVersion:expectedVersion})}::jsonb)`);
    return { recovered:true, ref:app.active_ref, version:expectedVersion+1, paused:true };
  });
}
