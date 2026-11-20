export const categories = ['database_bytes', 'storage_bytes', 'egress_bytes', 'ram_bytes', 'ram_used_bytes', 'api_requests'];
export function formatBytes(value) {
  if (value == null || !Number.isFinite(value)) return 'Não monitorado';
  if (value === 0) return '0 B';
  const index = Math.min(4, Math.max(0, Math.floor(Math.log(Math.abs(value)) / Math.log(1000))));
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value / 1000 ** index)} ${['B','KB','MB','GB','TB'][index]}`;
}
export function latestObservations(observations) {
  const seen = new Map();
  for (const row of observations) {
    const key = [row.scope, row.resource_id, row.category, row.period || ''].join(':');
    if (!seen.has(key) || new Date(row.collected_at) > new Date(seen.get(key).collected_at)) seen.set(key, row);
  }
  return [...seen.values()];
}
export function aggregate(projects, observations, limits, category, period = '') {
  const unique = [...new Map(projects.map(p => [p.ref, p])).values()];
  const latest = latestObservations(observations).filter(o => o.category === category && (o.period || '') === period);
  const measured = unique.map(p => latest.find(o => o.scope === 'PROJECT_LEVEL' && o.resource_id === p.ref));
  const known = measured.filter(o => o?.value != null && Number.isFinite(Number(o.value)));
  const used = known.length ? known.reduce((sum, o) => sum + Number(o.value), 0) : null;
  const orgs = [...new Set(unique.map(p => p.organization_id))];
  let capacity = 0; let covered = 0;
  for (const org of orgs) {
    const members = unique.filter(p => p.organization_id === org);
    const shared = limits.find(l => l.scope === 'ORGANIZATION_LEVEL' && l.resource_id === org && l.category === category && (l.period || '') === period);
    if (shared) { capacity += Number(shared.capacity); covered += members.length; continue; }
    for (const p of members) {
      const limit = limits.find(l => l.scope === 'PROJECT_LEVEL' && l.resource_id === p.ref && l.category === category && (l.period || '') === period);
      if (limit) { capacity += Number(limit.capacity); covered++; }
    }
  }
  const complete = unique.length > 0 && known.length === unique.length && covered === unique.length;
  return { used, capacity: covered ? capacity : null, remaining: complete ? Math.max(0, capacity - used) : null,
    percent: complete && capacity > 0 ? used / capacity * 100 : null, complete, measured: known.length, total: unique.length };
}
