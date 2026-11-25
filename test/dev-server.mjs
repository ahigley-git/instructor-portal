// Local preview: serves public/ and runs the portal against in-memory test data.
// Usage: npm run preview   (login codes are printed to the console and at /__mail)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { makePortal } from './fakes.mjs';
import { ACTIONS } from '../lib/core.mjs';

const ctx = makePortal();
const origSend = ctx.mailer.send;
ctx.mailer.send = async (m) => { console.log('EMAIL to', m.to, '|', m.subject); return origSend(m); };
const root = path.resolve('public');
const port = Number(process.env.PORT || 8888);
const types = { '.pdf': 'application/pdf', '.html': 'text/html', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

http.createServer(async (req, res) => {
  const m = req.url.match(/^\/api\/([A-Za-z]+)$/);
  if (m) {
    let body = '';
    for await (const c of req) body += c;
    res.setHeader('Content-Type', 'application/json');
    if (!ACTIONS.includes(m[1])) { res.statusCode = 404; return res.end('{}'); }
    try { res.end(JSON.stringify({ ok: true, data: await ctx.portal[m[1]](...(JSON.parse(body).args || [])) })); }
    catch (e) { if (!e.expected) console.error(e); res.end(JSON.stringify({ ok: false, error: e.message, session: !!e.session })); }
    return;
  }
  if (req.url === '/__mail') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(ctx.mailer.sent)); }
  if (req.url === '/__clear') { for (const k of [...ctx.kv._m.keys()]) if (k.startsWith('rl:')) ctx.kv._m.delete(k); return res.end('ok'); }
  if (req.url === '/__reminders') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(await ctx.portal.runReminders())); }
  const u = req.url.split('?')[0];
  const f = path.join(root, u === '/' ? 'index.html' : u);
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('Content-Type', types[path.extname(f)] || 'application/octet-stream');
  fs.createReadStream(f).pipe(res);
}).listen(port, () => console.log('Preview on http://localhost:' + port));
