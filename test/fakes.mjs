// In-memory stand-ins for Google Sheets/Drive, Brevo and Netlify Blobs.
// Dates become Sheets serial numbers, like the real API returns.
import { createPortal } from '../lib/core.mjs';
import { seedTabs } from '../lib/seed.mjs';

const DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: (\d{1,2}):(\d{2}))?$/;
export const serial = (v) => {
  const m = String(v).match(DATE_RE);
  if (!m) return v;
  const t = Date.UTC(+m[3], +m[1] - 1, +m[2], +(m[4] || 0), +(m[5] || 0));
  return t / 86400000 + 25569;
};

export function seed() {
  const tabs = seedTabs();
  for (const rows of Object.values(tabs)) for (let i = 1; i < rows.length; i++) rows[i] = rows[i].map(serial);
  return tabs;
}

export function memStore(tabs) {
  const head = (t) => tabs[t][0].map(String);
  return {
    url: 'https://docs.google.com/spreadsheets/d/TEST',
    async readTabs(names) { const o = {}; for (const n of names) o[n] = JSON.parse(JSON.stringify(tabs[n] || [])); return o; },
    async updateRows(t, ups) {
      const h = head(t);
      for (const u of ups) for (const [k, v] of Object.entries(u.values)) {
        const c = h.indexOf(k); if (c < 0) throw new Error('missing col ' + k);
        while (tabs[t].length < u.row) tabs[t].push([]);
        tabs[t][u.row - 1][c] = serial(v);
      }
    },
    async appendRows(t, objs) { for (const o of objs) tabs[t].push(head(t).map((h) => (o[h] === undefined ? '' : serial(o[h])))); }
  };
}

export function memFiles() {
  const made = [];
  return { made,
    async ensureFolder(parent, name) { made.push({ folder: name, parent }); return { id: 'F' + made.length, url: 'https://drive.google.com/drive/folders/F' + made.length }; },
    async upload({ folderId, name, mime }) { made.push({ file: name, folderId, mime }); return { id: 'D' + made.length, url: 'https://drive.google.com/file/d/D' + made.length + '/view' }; } };
}
export function memKv() { const m = new Map(); return { get: async (k) => (m.has(k) ? structuredClone(m.get(k)) : null), set: async (k, v) => m.set(k, structuredClone(v)), del: async (k) => m.delete(k), _m: m }; }
export function memMailer() { const sent = []; return { sent, send: async (msg) => { sent.push(msg); } }; }

export function makePortal(tabs = seed(), cfgOver = {}) {
  const kv = memKv(), mailer = memMailer(), files = memFiles();
  const portal = createPortal({ store: memStore(tabs), files, mailer, kv, cfg: {
    secret: 'test-secret', adminEmails: ['admin@resqedu.com', 'ryan.kelly@resqedu.com'], replyTo: 'admin@resqedu.com',
    certFolderId: 'ROOT', siteUrl: 'https://instructors.resqedu.com', ...cfgOver } });
  return { portal, tabs, kv, mailer, files };
}

export function lastCode(mailer, to) {
  const m = [...mailer.sent].reverse().find((x) => /code: \d{6}/.test(x.subject) && (!to || x.to === to.toLowerCase()));
  return /code: (\d{6})/.exec(m.subject)[1];
}
