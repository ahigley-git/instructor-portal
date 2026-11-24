// The few crypto helpers the portal needs, kept in one place so the browser
// demo can swap in its own versions.
import crypto from 'node:crypto';

export const hmac = (secret, s) => crypto.createHmac('sha256', secret).update(s).digest('base64url');
export const sha256hex = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const randomInt = (a, b) => crypto.randomInt(a, b);
export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
export const b64uEncode = (s) => Buffer.from(s, 'utf8').toString('base64url');
export const b64uDecode = (s) => Buffer.from(s, 'base64url').toString('utf8');
