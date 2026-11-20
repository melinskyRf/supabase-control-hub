/** Report names and corrective actions only, never environment values. */
export function configurationIssues(environment = process.env) {
  const issues = [];
  if (!/^[a-f0-9]{64}$/i.test(environment.HUB_ENCRYPTION_KEY || '')) issues.push('HUB_ENCRYPTION_KEY: configure uma chave de 32 bytes em hexadecimal.');
  if (!/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(environment.ADMIN_PASSWORD_HASH || '')) issues.push('ADMIN_PASSWORD_HASH: cadastre a senha com npm run setup.');
  try {
    const origin = new URL(environment.HUB_ORIGIN || 'http://127.0.0.1:3000');
    const local = ['127.0.0.1','localhost','[::1]'].includes(origin.hostname);
    if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash ||
      (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && local && environment.NODE_ENV !== 'production'))) throw new Error();
  } catch { issues.push('HUB_ORIGIN: use a origem HTTPS do painel ou HTTP local no desenvolvimento, sem caminho ou credenciais.'); }
  if (environment.NODE_ENV === 'production') {
    try {
      const url = new URL(environment.DATABASE_URL || '');
      if (!['postgres:','postgresql:'].includes(url.protocol) || !url.hostname) throw new Error();
    } catch { issues.push('DATABASE_URL: produção requer um PostgreSQL de controle independente.'); }
  }
  return issues;
}
