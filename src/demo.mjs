// Clickable demo: runs the real portal logic in the browser against sample data.
import { createPortal } from '../lib/core.mjs';
import { seedTabs } from '../lib/seed.mjs';

const DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: (\d{1,2}):(\d{2}))?$/;
const serial = (v) => { const m = String(v).match(DATE_RE); if (!m) return v; return Date.UTC(+m[3], +m[1] - 1, +m[2], +(m[4] || 0), +(m[5] || 0)) / 86400000 + 25569; };
const tabs = seedTabs();
for (const rows of Object.values(tabs)) for (let i = 1; i < rows.length; i++) rows[i] = rows[i].map(serial);
const head = (t) => tabs[t][0];
const store = {
  url: '#demo-sheet',
  async readTabs(names) { const o = {}; for (const n of names) o[n] = JSON.parse(JSON.stringify(tabs[n] || [])); return o; },
  async updateRows(t, ups) { for (const u of ups) for (const [k, v] of Object.entries(u.values)) { const c = head(t).indexOf(k); while (tabs[t].length < u.row) tabs[t].push([]); tabs[t][u.row - 1][c] = serial(v); } },
  async appendRows(t, objs) { for (const o of objs) tabs[t].push(head(t).map((h) => (o[h] === undefined ? '' : serial(o[h])))); }
};
const mem = new Map();
const kv = { get: async (k) => (mem.has(k) ? JSON.parse(JSON.stringify(mem.get(k))) : null), set: async (k, v) => { mem.set(k, v); }, del: async (k) => { mem.delete(k); } };
const sent = [];
const mailer = { async send(m) { sent.push(m); } };
let nf = 0;
const files = { async ensureFolder() { nf++; return { id: 'demo' + nf, url: '#demo-folder' }; }, async upload() { nf++; return { id: 'f' + nf, url: '#demo-file' }; } };
const portal = createPortal({ store, files, mailer, kv, cfg: { secret: 'demo', adminEmails: ['admin@resqedu.com', 'ryan.kelly@resqedu.com', 'matt.shen@resqedu.com'],
  replyTo: 'admin@resqedu.com', certFolderId: 'demo', siteUrl: '' } });

// Sample people and requests
const now = '11/20/2026 9:00';
const addIns = (name, email, creds, status, roles, about) => tabs.Instructors.push(head('Instructors').map((h) => ({ Name: name, Email: email, Phone: '651-555-01' + String(tabs.Instructors.length).padStart(2, '0'),
  Credentials: creds, Status: status, 'Qualified roles': roles, Applied: serial(now), About: about || '' }[h] ?? '')));
addIns('Adam Higley', 'admin@resqedu.com', 'Paramedic, EMT Instructor (MN OEMS), AHA BLS Instructor', 'Approved', 'Primary Instructor, Assistant Instructor, Skills Evaluator, AHA BLS Instructor');
addIns('Matt Shen', 'matt.shen@resqedu.com', 'Paramedic, EMT Instructor (MN OEMS)', 'Approved', 'Primary Instructor, Assistant Instructor, Station Medic');
addIns('Sarah Lund', 'sarah@example.com', 'EMT, AHA BLS Instructor', 'Approved', 'Assistant Instructor, AHA BLS Instructor', 'EMT with Lake Johanna FD, 4 years.');
addIns('Jordan Ruiz', 'jordan@example.com', 'Paramedic, Psychomotor evaluator', 'Pending', '', 'Paramedic at a metro service, wants evaluator and station medic slots.');
addIns('Priya Nair', 'priya@example.com', 'Student / pre-health (patient role)', 'Approved', '', 'Pre-med at St. Thomas.');
let rn = 0;
const addReq = (slot, email, name, status) => tabs.Requests.push(head('Requests').map((h) => ({ 'Request ID': 'RDEMO' + (++rn), 'Slot ID': slot, Email: email, Name: name, Status: status, Requested: serial('11/2' + rn + '/2026 10:00'), Updated: serial(now) }[h] ?? '')));
addReq('EMT-2027-01-D01-AM-PRI', 'admin@resqedu.com', 'Adam Higley', 'Approved');
addReq('EMT-2027-01-D01-PM-PRI', 'admin@resqedu.com', 'Adam Higley', 'Approved');
addReq('EMT-2027-01-D02-AM-PRI', 'matt.shen@resqedu.com', 'Matt Shen', 'Approved');
addReq('EMT-2027-01-D01-PM-BLS', 'sarah@example.com', 'Sarah Lund', 'Approved');
addReq('EMT-2027-01-D03-PM-AST', 'sarah@example.com', 'Sarah Lund', 'Pending');
addReq('EMT-2027-01-D11-PM-EVAL', 'jordan@example.com', 'Jordan Ruiz', 'Pending');
addReq('EMT-2027-01-D10-AM-MED', 'jordan@example.com', 'Jordan Ruiz', 'Pending');
addReq('EMT-2027-01-D04-PM-PAT', 'priya@example.com', 'Priya Nair', 'Pending');
addReq('EMT-2027-01-D02-AM-PRI', 'sarah@example.com', 'Sarah Lund', 'Waitlist');
// Example pay so the money views have something to show (the real sheet starts at $0)
const payCol = head('Slots').indexOf('Pay ($)');
for (const r of tabs.Slots.slice(1)) { if (r[2] === 'Assistant Instructor') r[payCol] = 100; if (r[2] === 'AHA BLS Instructor') r[payCol] = 130; }

const bar = () => document.getElementById('demo-msg');
window.__DEMO_API = async (fn, args) => {
  try {
    const r = await portal[fn](...args);
    if (fn === 'apiRequestCode' || fn === 'apiSignup') {
      const m = [...sent].reverse().find((x) => /code: \d{6}/.test(x.subject));
      if (m) bar().textContent = 'Demo: your login code is ' + /code: (\d{6})/.exec(m.subject)[1] + ' (in real life it arrives by email).';
      for (const k of [...mem.keys()]) if (k.startsWith('rl:')) mem.delete(k);
    }
    return JSON.parse(JSON.stringify(r ?? null));
  } catch (e) { const err = new Error(e.message); err.session = e.session; throw err; }
};
window.__demoLogin = async (email) => {
  for (const k of [...mem.keys()]) if (k.startsWith('rl:')) mem.delete(k);
  await portal.apiRequestCode(email);
  const m = [...sent].reverse().find((x) => x.to === email && /code: \d{6}/.test(x.subject));
  const { token } = await portal.apiVerifyCode(email, /code: (\d{6})/.exec(m.subject)[1]);
  window.__portalLogin(token);
  bar().textContent = 'Demo: logged in as ' + email + '. Nothing here is saved or emailed.';
};
window.addEventListener('DOMContentLoaded', () => window.__portalStart && window.__portalStart());
