import crypto from 'node:crypto';
import { ENV } from '../config/env';

const KEY = Buffer.from(ENV.ENCRYPTION_KEY, 'hex');
const ALG = 'aes-256-gcm';

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv(ALG, KEY, iv);
  let out = c.update(plain, 'utf8', 'hex');
  out += c.final('hex');
  return `${iv.toString('hex')}:${out}:${c.getAuthTag().toString('hex')}`;
}

export function decrypt(data: string): string {
  const [iv, body, tag] = data.split(':');
  const d = crypto.createDecipheriv(ALG, KEY, Buffer.from(iv, 'hex'));
  d.setAuthTag(Buffer.from(tag, 'hex'));
  return d.update(body, 'hex', 'utf8') + d.final('utf8');
}
