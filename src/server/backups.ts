import { spawn } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, stat, unlink, open, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import { createClient } from '@supabase/supabase-js';
import { query, sql } from './db';
import { credentials, connectionFor } from './supabase';
import { audit } from './engine';
import { PublicError, projectOrigin } from '../core/security.mjs';

const folder = () => path.resolve(process.env.BACKUP_DIRECTORY || 'backups');
function artifact(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new PublicError('Backup inválido.');
  return path.join(folder(), `${id}.hub`);
}
function key() {
  if (!/^[a-f0-9]{64}$/i.test(process.env.HUB_ENCRYPTION_KEY || '')) throw new PublicError('Chave de criptografia ausente.');
  return Buffer.from(process.env.HUB_ENCRYPTION_KEY!, 'hex');
}
async function processEnv(ref: string) {
  const { database_url } = await credentials(await connectionFor(ref));
  if (!database_url) throw new PublicError('Configure a conexão PostgreSQL de backup nesta conta.', 409);
  const url = new URL(database_url);
  const directHost = url.hostname === `db.${ref}.supabase.co`;
  const poolerHost = /^[a-z0-9.-]+\.pooler\.supabase\.com$/.test(url.hostname) && decodeURIComponent(url.username).endsWith(`.${ref}`);
  if (!directHost && !poolerHost) throw new PublicError('A conexão PostgreSQL não corresponde ao projeto selecionado.', 409);
  if (!['postgres:','postgresql:'].includes(url.protocol) || !(/^[a-z0-9.-]+\.supabase\.co$/.test(url.hostname) || /^[a-z0-9.-]+\.pooler\.supabase\.com$/.test(url.hostname))) throw new PublicError('Host PostgreSQL não autorizado.');
  const args = ['--host', url.hostname, '--port', url.port || '5432', '--username', decodeURIComponent(url.username), '--dbname', url.pathname.slice(1) || 'postgres', '--no-password'];
  if (args.some(a => a.includes('\0') || a.includes('\n'))) throw new PublicError('Conexão PostgreSQL inválida.');
  const env = { ...process.env, PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: 'verify-full', PGCONNECT_TIMEOUT: '15' };
  return { args, env };
}
export async function queueBackup(ref: string, kind: string) {
  projectOrigin(ref); await connectionFor(ref);
  if (kind !== 'storage' && !process.env.PG_DUMP_PATH) throw new PublicError('pg_dump ainda não configurado no servidor.', 409);
  const id = randomUUID();
  await query(sql`INSERT INTO backup_jobs(id,project_ref,kind) VALUES(${id},${ref},${kind})`);
  return { id, state: 'QUEUED' };
}
async function* storageExport(ref: string) {
  const { storage_key } = await credentials(await connectionFor(ref));
  if (!storage_key) throw new PublicError('Credencial de Storage ausente.', 409);
  const client = createClient(projectOrigin(ref), storage_key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: buckets, error } = await client.storage.listBuckets(); if (error || !buckets) throw new PublicError('Não foi possível listar os buckets.', 502);
  yield JSON.stringify({ format: 'hub-storage-v1', project: ref, buckets, createdAt: new Date().toISOString() }) + '\n';
  let total = 0;
  for (const bucket of buckets) {
    const pending = [''];
    while (pending.length) {
      const prefix = pending.pop()!;
      for (let offset = 0; ; offset += 100) {
        const { data: objects, error: listError } = await client.storage.from(bucket.id).list(prefix, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } });
        if (listError || !objects) throw new PublicError('Erro na exportação do Storage.', 502);
        for (const object of objects) {
          const name = prefix ? `${prefix}/${object.name}` : object.name;
          if (!object.id) { pending.push(name); continue; }
          if (++total > 100000 || Number(object.metadata?.size) > 64 * 1024 * 1024) throw new PublicError('Exportação excede o limite operacional de 100 mil objetos ou 64 MB por arquivo.');
          const { data: blob, error: downloadError } = await client.storage.from(bucket.id).download(name);
          if (downloadError || !blob || blob.size > 64 * 1024 * 1024) throw new PublicError('Download de objeto falhou ou excedeu 64 MB.');
          yield JSON.stringify({ bucket: bucket.id, name, metadata: object.metadata, base64: Buffer.from(await blob.arrayBuffer()).toString('base64') }) + '\n';
        }
        if (objects.length < 100) break;
      }
    }
  }
}
export async function runBackup(id: string) {
  const [job] = await query(sql`UPDATE backup_jobs SET state='RUNNING' WHERE id=${id} AND state='QUEUED' RETURNING *`);
  if (!job) return;
  await mkdir(folder(), { recursive: true, mode: 0o700 });
  const destination = artifact(id); const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv); cipher.setAAD(Buffer.from(`${id}:${job.project_ref}:${job.kind}`));
  let child: ReturnType<typeof spawn> | undefined;
  try {
    let input: Readable;
    let exit: Promise<void> = Promise.resolve();
    if (job.kind === 'storage') input = Readable.from(storageExport(job.project_ref));
    else {
      const { args, env } = await processEnv(job.project_ref);
      child = spawn(process.env.PG_DUMP_PATH!, [...args, '--format=custom', '--no-owner', '--no-acl', ...(job.kind === 'schema' ? ['--schema-only'] : [])], { env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 1200000 });
      child.stderr?.resume();
      exit = new Promise((resolve,reject) => { child!.once('error',reject); child!.once('close',code => code === 0 ? resolve() : reject(new Error('pg_dump failed'))); });
      // Observe rejection immediately, while pipeline drains stdout.
      exit.catch(() => undefined); input = child.stdout!;
    }
    const out = createWriteStream(destination, { flags: 'wx', mode: 0o600 });
    out.write(Buffer.concat([Buffer.from('HBAK1'), iv]));
    await pipeline(input, cipher, out, { signal: AbortSignal.timeout(1200000) }); await exit;
    const file = await open(destination, 'a'); await file.write(cipher.getAuthTag()); await file.close();
    const digest = await checksum(destination); const info = await stat(destination);
    await query(sql`UPDATE backup_jobs SET state='COMPLETED',filename=${`${id}.hub`},digest=${digest},bytes=${info.size},completed_at=now() WHERE id=${id}`);
    await audit('worker', 'backup.completed', job.project_ref, { id, kind: job.kind });
  } catch {
    child?.kill(); await unlink(destination).catch(() => undefined);
    await query(sql`UPDATE backup_jobs SET state='FAILED',error='Exportação falhou. Verifique credenciais, pg_dump e permissões.',completed_at=now() WHERE id=${id}`);
  }
}
async function checksum(filename: string) {
  const digest = createHash('sha256'); for await (const chunk of createReadStream(filename)) digest.update(chunk); return digest.digest('hex');
}
export async function downloadBackup(id: string) {
  const [job] = await query(sql`SELECT * FROM backup_jobs WHERE id=${id} AND state='COMPLETED' AND expires_at>now()`);
  if (!job || await checksum(artifact(id)) !== job.digest) throw new PublicError('Backup indisponível ou integridade inválida.', 409);
  return { job, filename: artifact(id) };
}
export async function restoreBackup(id: string, targetRef: string, confirmation: string, actor: string) {
  if (confirmation !== `RESTORE ${targetRef}`) throw new PublicError('Confirmação de restauração inválida.');
  const inUse = await query(sql`SELECT id FROM applications WHERE active_ref=${targetRef}`);
  if (inUse.length) throw new PublicError('Não é permitido restaurar sobre um projeto ativo. Remova-o do roteamento primeiro.', 409);
  const { job, filename } = await downloadBackup(id);
  if (job.kind !== 'storage' && !process.env.PG_RESTORE_PATH) throw new PublicError('pg_restore não configurado.', 409);
  const temp = await mkdtemp(path.join(tmpdir(), 'hub-restore-'));
  try {
    const file = await open(filename, 'r'); const header = Buffer.alloc(17); const tag = Buffer.alloc(16);
    const info = await file.stat(); await file.read(header, 0, 17, 0); await file.read(tag, 0, 16, info.size - 16); await file.close();
    if (header.subarray(0,5).toString() !== 'HBAK1') throw new PublicError('Formato de backup inválido.');
    const decipher = createDecipheriv('aes-256-gcm', key(), header.subarray(5));
    decipher.setAAD(Buffer.from(`${id}:${job.project_ref}:${job.kind}`)); decipher.setAuthTag(tag);
    const plaintext = path.join(temp, 'restore.dump');
    // Authenticate the entire artifact before any database mutation.
    await pipeline(createReadStream(filename, { start: 17, end: info.size - 17 }), decipher, createWriteStream(plaintext, { mode: 0o600 }));
    await audit(actor, 'backup.restore.started', targetRef, { id });
    if (job.kind === 'storage') {
      const restored = await restoreStorage(plaintext,targetRef);
      await audit(actor,'backup.restore.completed',targetRef,{id,...restored});
      return {restored:true,requiresValidation:true,...restored};
    }
    const { args, env } = await processEnv(targetRef);
    const child = spawn(process.env.PG_RESTORE_PATH!, [...args, '--clean', '--if-exists', '--no-owner', '--no-acl', '--single-transaction', plaintext], { env, shell: false, windowsHide: true, stdio: ['ignore','ignore','pipe'], timeout: 1200000 });
    child.stderr?.resume(); const result = await once(child, 'close');
    if (result[0] !== 0) throw new PublicError('Restauração falhou; transação revertida. Verifique os logs do PostgreSQL.', 502);
    await audit(actor, 'backup.restore.completed', targetRef, { id });
    // No automatic continuity attestation: operator must validate application data and Auth separately.
    return { restored: true, requiresValidation: true };
  } finally { await rm(temp, { recursive: true, force: true }); }
}
async function restoreStorage(filename:string,targetRef:string) {
  const {storage_key}=await credentials(await connectionFor(targetRef));
  if (!storage_key) throw new PublicError('Credencial de Storage do destino ausente.',409);
  const client=createClient(projectOrigin(targetRef),storage_key,{auth:{persistSession:false,autoRefreshToken:false}});
  const lines=createInterface({input:createReadStream(filename),crlfDelay:Infinity});
  let header=false;let objects=0;const buckets=new Set<string>();
  try {
    for await (const line of lines) {
      const item=JSON.parse(line);
      if(!header){
        if(item.format!=='hub-storage-v1'||!Array.isArray(item.buckets))throw new PublicError('Manifesto Storage inválido.');
        const existing=await client.storage.listBuckets();
        if(existing.error||!existing.data)throw new PublicError('Não foi possível verificar buckets no destino.',502);
        // Empty destination requirement prevents accidental overwrite and makes partial retries explicit.
        if(item.buckets.some((b:any)=>existing.data.some((e:any)=>e.id===b.id)))throw new PublicError('O destino já contém um bucket do backup. Use um destino vazio; restaurações parciais precisam de revisão.',409);
        for(const bucket of item.buckets){
          if(typeof bucket.id!=='string'||buckets.has(bucket.id))throw new PublicError('Bucket inválido ou duplicado.');
          const result=await client.storage.createBucket(bucket.id,{public:!!bucket.public,fileSizeLimit:bucket.file_size_limit||undefined,allowedMimeTypes:bucket.allowed_mime_types||undefined});
          if(result.error)throw new PublicError('Falha ao criar bucket; restauração pode estar parcial.',502);
          buckets.add(bucket.id);
        }
        header=true;continue;
      }
      if(!buckets.has(item.bucket)||typeof item.name!=='string'||!item.name||typeof item.base64!=='string'||item.base64.length>90*1024*1024||++objects>100000)throw new PublicError('Objeto Storage inválido ou acima do limite.');
      const bytes=Buffer.from(item.base64,'base64');
      if(bytes.length>64*1024*1024)throw new PublicError('Objeto excede 64 MB.');
      const result=await client.storage.from(item.bucket).upload(item.name,bytes,{upsert:false,contentType:item.metadata?.mimetype||'application/octet-stream'});
      if(result.error)throw new PublicError('Falha de upload; restauração parcial exige revisão antes de tentar novamente.',502);
    }
    if(!header)throw new PublicError('Manifesto Storage ausente.');
    return {buckets:buckets.size,objects};
  } finally { lines.close(); }
}
export async function retainBackups() {
  const expired = await query(sql`SELECT id FROM backup_jobs WHERE expires_at<now() AND state='COMPLETED'`);
  for (const job of expired) {
    await unlink(artifact(job.id)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    await query(sql`UPDATE backup_jobs SET state='EXPIRED',filename=NULL WHERE id=${job.id}`);
  }
}
