// Browser stand-in for lib/crypto.mjs, used only by the clickable demo (not secure, not for production).
function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); }
const long = (s) => fnv(s) + fnv('a' + s) + fnv('b' + s) + fnv('c' + s) + fnv('d' + s);
export const hmac = (secret, s) => long(secret + '|' + s);
export const sha256hex = (s) => long(s);
export const randomInt = (a, b) => a + Math.floor(Math.random() * (b - a));
export const safeEqual = (a, b) => String(a) === String(b);
export const b64uEncode = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const b64uDecode = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
