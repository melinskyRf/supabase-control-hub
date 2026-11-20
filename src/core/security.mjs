import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hash(value) { return createHash('sha256').update(value).digest('hex'); }
export function passwordHash(password, salt = randomBytes(16).toString('hex')) { return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`; }
export function passwordValid(password, stored) {
  if (!stored || !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(stored)) return false;
  const [salt, expected] = stored.split(':');
  return timingSafeEqual(Buffer.from(expected, 'hex'), scryptSync(password, salt, 64));
}
function keyBytes(key) {
  if (!key || !/^[a-f0-9]{64}$/i.test(key)) throw new Error('Configure a 32-byte HUB_ENCRYPTION_KEY');
  return Buffer.from(key, 'hex');
}
export function encrypt(value, context, key = process.env.HUB_ENCRYPTION_KEY) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', keyBytes(key), iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}
export function decrypt(envelope, context, key = process.env.HUB_ENCRYPTION_KEY) {
  const [version, iv, tag, ciphertext] = envelope.split('.');
  if (version !== 'v1') throw new Error('Unsupported encrypted credential version');
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(key), Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8'));
}
export function projectOrigin(ref) {
  if (!/^[a-z0-9]{20}$/.test(ref)) throw new Error('Project Ref must have 20 lowercase letters or numbers');
  return `https://${ref}.supabase.co`;
}
export function safeMessage(error) {
  if (error?.name === 'ZodError') return 'Dados inválidos. Confira os campos do formulário.';
  // Upstream bodies, headers and SQL errors are intentionally not returned.
  return error instanceof PublicError ? error.message : 'Não foi possível concluir a operação. Consulte a configuração e tente novamente.';
}
export class PublicError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
