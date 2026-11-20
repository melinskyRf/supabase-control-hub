import { existsSync } from 'node:fs';
import { configurationIssues } from '../src/core/configuration.mjs';

try {
  if (existsSync('.env.local')) process.loadEnvFile('.env.local');
  const issues = configurationIssues();
  if (issues.length) {
    console.error('Configuração pendente:');
    for (const issue of issues) console.error(`- ${issue}`);
    console.error('Primeiro acesso: abra INICIAR.cmd para cadastrar senha e autenticador. Preserve as chaves de uma configuração existente.');
    process.exitCode = 1;
  } else {
    console.log('Acesso administrativo configurado.');
    console.log(process.env.DATABASE_URL ? 'Banco de controle: PostgreSQL externo.' : 'Banco de controle: PGlite local; mantenha apenas um servidor aberto.');
  }
} catch {
  console.error('Não foi possível ler .env.local. Verifique o arquivo e as permissões locais.');
  process.exitCode = 1;
}
