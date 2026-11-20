import { latestObservations } from './capacity.mjs';

/** Only complete, fresh observations can establish or resolve a capacity alert. */
export function evaluateLimits(projects, observations, limits, now = Date.now()) {
  const latest = latestObservations(observations);
  return limits.map(limit => {
    const members = [...new Set(projects.filter(p => limit.scope === 'PROJECT_LEVEL' ? p.ref === limit.resource_id : limit.scope === 'ORGANIZATION_LEVEL' && p.organization_id === limit.resource_id).map(p => p.ref))];
    const values = members.map(ref => latest.find(o => o.scope === 'PROJECT_LEVEL' && o.resource_id === ref && o.category === limit.category && (o.period || '') === (limit.period || '')));
    const valid = members.length > 0 && values.every(o => {
      const time = new Date(o?.collected_at).getTime();
      return o?.value != null && Number.isFinite(Number(o.value)) && Number(o.value) >= 0 && Number.isFinite(time) && time <= now + 10000 && now - time <= 180000;
    });
    if (!valid) return { limitId: limit.id, resourceId: limit.resource_id, category: limit.category, severity: 'unknown', percent: null, message: 'Observações ausentes, inválidas ou desatualizadas.' };
    const percent = values.reduce((sum,o) => sum + Number(o.value),0) / Number(limit.capacity) * 100;
    if (!Number.isFinite(percent) || Number(limit.capacity) <= 0) return { limitId: limit.id, resourceId: limit.resource_id, category: limit.category, severity: 'unknown', percent: null, message: 'Capacidade inválida.' };
    const severity = percent >= 100 ? 'exhausted' : percent >= limit.critical ? 'critical' : percent >= limit.elevated ? 'elevated' : percent >= limit.warning ? 'warning' : 'normal';
    return { limitId: limit.id, resourceId: limit.resource_id, category: limit.category, severity, percent, message: `Utilização observada: ${percent.toFixed(2)}%.` };
  });
}
