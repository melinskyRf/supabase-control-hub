import { randomUUID } from 'node:crypto';
import { query, sql } from './db';
import { evaluateLimits } from '../core/alerts.mjs';

export async function refreshAlerts() {
  const [projects,observations,limits] = await Promise.all([
    query(sql`SELECT ref,organization_id FROM projects`),
    query(sql`SELECT DISTINCT ON(scope,resource_id,category,period) * FROM observations ORDER BY scope,resource_id,category,period,collected_at DESC`),
    query(sql`SELECT * FROM capacity_limits`),
  ]);
  for (const evaluation of evaluateLimits(projects,observations,limits)) {
    if (evaluation.severity === 'unknown') continue; // Missing telemetry cannot resolve a previous alert.
    const existing = await query(sql`SELECT id,severity FROM alerts WHERE limit_id=${evaluation.limitId} AND resolved_at IS NULL`);
    if (evaluation.severity === 'normal') {
      await query(sql`UPDATE alerts SET resolved_at=now(),updated_at=now() WHERE limit_id=${evaluation.limitId} AND resolved_at IS NULL`);
      continue;
    }
    if (existing.length) await query(sql`UPDATE alerts SET severity=${evaluation.severity},percent=${evaluation.percent},message=${evaluation.message},updated_at=now() WHERE id=${existing[0].id}`);
    else await query(sql`INSERT INTO alerts(id,limit_id,resource_id,category,severity,percent,message) VALUES(${randomUUID()},${evaluation.limitId},${evaluation.resourceId},${evaluation.category},${evaluation.severity},${evaluation.percent},${evaluation.message}) ON CONFLICT (limit_id) WHERE resolved_at IS NULL DO NOTHING`);
  }
}
