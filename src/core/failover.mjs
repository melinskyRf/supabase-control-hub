import { createHash } from 'node:crypto';
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export function fingerprint(value) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
export function schemaDifference(source, target) {
  if (!source || !target) return { compatible: false, differences: ['Snapshot de schema ausente'] };
  const keys = [...new Set([...Object.keys(source), ...Object.keys(target)])];
  const differences = keys.filter(key => fingerprint(source[key] ?? null) !== fingerprint(target[key] ?? null));
  return { compatible: differences.length === 0 && keys.length > 0, differences };
}
/** @param {{app: any, source: any, target: any, member: any, capacityReasons?: string[], now?: number}} input */
export function eligibility({ app, source, target, member, capacityReasons = [], now = Date.now() }) {
  const reasons = [...capacityReasons];
  const fresh = (value, age) => { const time = new Date(value).getTime(); return !!value && Number.isFinite(time) && time <= now + 10000 && now - time <= age; };
  if (!member?.enabled || !target?.authorized) reasons.push('Destino sem conexão autorizada ativa');
  if (target?.restricted) reasons.push('Organização restrita');
  if (source?.ref === target?.ref) reasons.push('Destino já é o projeto ativo');
  if (target?.health !== 'healthy' || !fresh(target?.checked_at, 180000)) reasons.push('Saúde ausente, inválida ou desatualizada');
  if (!fresh(source?.schema_at, 300000) || !fresh(target?.schema_at, 300000)) reasons.push('Validação de schema desatualizada');
  const diff = schemaDifference(source?.schema_snapshot, target?.schema_snapshot);
  if (!diff.compatible) reasons.push(`Schemas incompatíveis: ${diff.differences.join(', ')}`);
  if (!target?.publishable_key) reasons.push('Chave publicável do destino ausente');
  const evidenceValid = evidence => evidence?.source_ref === source?.ref && evidence?.target_ref === target?.ref && evidence?.schema_hash === fingerprint(target?.schema_snapshot) && typeof evidence?.reference === 'string' && evidence.reference.length > 3 && new Date(evidence.expires_at).getTime() > now;
  if (app.data_policy !== 'independent') {
    const evidence = member?.data_evidence;
    if (!evidenceValid(evidence) || evidence.policy !== app.data_policy) reasons.push('Continuidade dos dados sem atestado vigente');
  }
  // Supabase Auth sessions are project-specific: fail closed even with matching auth tables.
  if (app.auth_mode === 'supabase') reasons.push('Supabase Auth exige migração de identidade e reconexão de sessões; troca automática bloqueada');
  if (app.auth_mode === 'external' && !evidenceValid(member?.identity_evidence)) reasons.push('Identidade externa sem atestado vigente');
  if (app.last_switch && now - new Date(app.last_switch).getTime() < app.cooldown_seconds * 1000) reasons.push('Cooldown em andamento');
  if (app.blocked) reasons.push('Aplicação aguarda resolução administrativa');
  return { eligible: reasons.length === 0, reasons, differences: diff.differences };
}
