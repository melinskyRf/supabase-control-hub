import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Writable } from 'node:stream';
import { passwordHash } from '../src/core/security.mjs';

if (!stdin.isTTY || !stdout.isTTY) {
  console.error('Abra CONFIGURAR.cmd na pasta do projeto para cadastrar sua senha na janela privada.');
  process.exit(1);
}
let hidden = false;
const output = new Writable({ write(chunk, encoding, callback) { if (!hidden) stdout.write(chunk, encoding); callback(); } });
const rl = createInterface({ input: stdin, output, terminal: true });
async function passwordQuestion(prompt) {
  stdout.write(prompt);
  hidden = true;
  try { return await rl.question(''); }
  finally { hidden = false; stdout.write('\n'); }
}
try {
  if (await readFile('.env.local','utf8').then(()=>true,()=>false)) throw new Error('.env.local já existe. Preserve suas chaves; edite a configuração existente.');
  console.log('Configuração privada do Supabase Control Hub. A senha será digitada de forma oculta.');
  const password = await passwordQuestion('Crie uma senha com 14 a 256 caracteres: ');
  if (password.length < 14 || password.length > 256) throw new Error('A senha precisa ter de 14 a 256 caracteres.');
  if (await passwordQuestion('Repita a senha: ') !== password) throw new Error('As senhas não coincidem.');
  const config = [
    'HUB_ORIGIN=http://127.0.0.1:3000',
    `HUB_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}`,
    `ADMIN_PASSWORD_HASH=${passwordHash(password)}`,
    `AGENT_READ_TOKEN=${randomBytes(32).toString('base64url')}`,
    '# DATABASE_URL=postgresql://hub:password@localhost:5432/control_hub',
    '# SUPABASE_OAUTH_CLIENT_ID=', '# SUPABASE_OAUTH_CLIENT_SECRET=',
    '# PG_DUMP_PATH=C:/Program Files/PostgreSQL/17/bin/pg_dump.exe',
    '# PG_RESTORE_PATH=C:/Program Files/PostgreSQL/17/bin/pg_restore.exe',
  ].join('\n')+'\n';
  await writeFile('.env.local',config,{flag:'wx',mode:0o600});
  console.log('\nAcesso configurado. Execute npm run dev e abra http://127.0.0.1:3000. Guarde uma cópia segura da chave de criptografia.');
} catch (error) { console.error(error instanceof Error ? error.message : 'Falha na configuração'); process.exitCode=1; }
finally { rl.close(); }
