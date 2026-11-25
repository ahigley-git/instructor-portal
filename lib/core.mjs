// ResQ Instructor Portal — business logic.
// Storage, files, email and key-value services are passed in, so this file has
// no Netlify- or Google-specific code and can be tested with fakes.
import { hmac, sha256hex, randomInt, safeEqual, b64uEncode, b64uDecode } from './crypto.mjs';
import { TABS, SCALE_RULES, openingsFor } from './seed.mjs';

export { TABS, SCALE_RULES };
export const ACCOUNT_STATUSES = ['Pending', 'Approved', 'Declined', 'Inactive'];
const LOGIN_STATUSES = ['Pending', 'Approved'];
export const HOLD = ['Pending', 'Approved', 'Drop requested']; // statuses that take an opening
export const CREDENTIALS = ['EMR', 'EMT', 'AEMT', 'Paramedic', 'RN', 'Physician / PA / NP', 'AHA BLS Instructor', 'AHA ACLS/PALS Instructor',
  'EMT Instructor (MN OEMS)', 'Psychomotor evaluator', 'Firefighter', 'Student / pre-health (patient role)', 'Other'];
const SESSION_DAYS = 30;
const TZ = 'America/Chicago';
const MAX_UPLOAD_B64 = 5_600_000; // about 4 MB of file
export const TRACKS = ['Instructor', 'Patient'];
export const DOC_KINDS = { 'Cert card': { private: false }, 'Resume': { private: false }, 'W-9': { private: true }, 'Direct deposit': { private: true } };
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const ALERT_TYPES = ['New course', 'Openings added', 'Near-term openings'];
export const DIGESTS = { 'Off': 0, 'Weekly': 7, 'Every 2 weeks': 14, 'Monthly': 30 };
const NEAR_TERM_DAYS = 14;

export const S = {
  adminSignup: 'Email admins: new instructor signup',
  adminRequest: 'Email admins: new slot request',
  adminDrop: 'Email admins: drop request',
  insAccount: 'Email instructor: account approved or declined',
  insSlot: 'Email instructor: slot status change',
  insReminder: 'Email instructor: session reminder',
  insPaid: 'Email instructor: marked paid',
  insAlerts: 'Email instructors: opening alerts',
  insDigest: 'Email instructors: open-slot digests',
  reminderDays: 'Reminder days before session',
  adminEmails: 'Admin alert emails'
};

export class PortalError extends Error {
  constructor(msg, opts = {}) { super(msg); this.session = !!opts.session; this.expected = true; }
}
const fail = (m) => { throw new PortalError(m); };
const sessionFail = () => { throw new PortalError('Your session has ended. Log in again.', { session: true }); };

// ---------- helpers ----------
const normEmail = (e) => String(e ?? '').trim().toLowerCase();
const clean = (s, max = 200) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isBlank = (v) => v === '' || v === null || v === undefined;
const list = (v) => String(v ?? '').split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
const yes = (v) => /^(y|yes|true|on|1)$/i.test(String(v ?? '').trim());
const money = (v) => { const n = Number(String(v ?? '').replace(/[$,]/g, '')); return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0; };
const fmtMoney = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
export function normTime(v) {
  if (isBlank(v)) return '';
  if (typeof v === 'number' && v > 0 && v < 1) { const m = Math.round(v * 1440); return String(Math.floor(m / 60)).padStart(2, '0') + String(m % 60).padStart(2, '0'); }
  const s = String(v).replace(/[^0-9]/g, '');
  return s ? s.padStart(4, '0').slice(-4) : String(v);
}
const fmtTime = (t) => (t && t.length === 4 ? t.slice(0, 2) + t.slice(2) : t);
const uid = (p) => p + Date.now().toString(36).toUpperCase() + randomInt(100, 999);
const slug = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);

// Google Sheets serial date -> JS Date (wall clock, stored as UTC)
export function toDate(v) {
  if (v instanceof Date) return v;
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000));
  if (typeof v === 'string' && v.trim()) {
    const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    const d = new Date(v); if (!isNaN(d)) return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()));
  }
  return null;
}
const isoOf = (v) => { const d = toDate(v); return d ? d.toISOString().slice(0, 10) : ''; };
const stamp = (v) => { const d = toDate(v); return d ? d.getTime() : 0; };
const fmtDate = (v) => { const d = toDate(v); return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : ''; };
const fmtDay = (iso) => { const d = toDate(iso); return d ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : ''; };
export const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const addDays = (iso, n) => { const d = toDate(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mdY = (iso) => { const [y, m, d] = iso.split('-').map(Number); return m + '/' + d + '/' + y; };
export function nowForSheet() {
  return new Date().toLocaleString('en-US', { timeZone: TZ, month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: false }).replace(',', '');
}
const todayForSheet = () => mdY(todayISO());

/**
 * store: { readTabs(names), updateRows(tab, [{row, values:{header:value}}]), appendRows(tab, [{header:value}]), url }
 * files: { ensureFolder(parentId, name) -> {id, url}, upload({folderId, name, mime, base64}) -> {id, url} } | null
 * mailer: { send({to, subject, html}) }
 * kv: { get, set, del }
 * cfg: { secret, adminEmails[], replyTo, certFolderId, privateFolderId, siteUrl }
 */
export function createPortal({ store, files, mailer, kv, cfg }) {
  // ---------- reading ----------
  function toObjects(rows) {
    if (!rows || !rows.length) return [];
    const head = rows[0].map((h) => String(h ?? '').trim());
    const out = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const o = { _row: i + 1 }; let any = false;
      head.forEach((h, j) => { if (h) { o[h] = r[j] ?? ''; if (!isBlank(r[j])) any = true; } });
      if (any) out.push(o);
    }
    return out;
  }

  async function everything() {
    const names = Object.values(TABS);
    const raw = await store.readTabs(names);
    const t = Object.fromEntries(names.map((n) => [n, toObjects(raw[n])]));
    const settings = {};
    for (const r of t[TABS.settings]) if (r['Setting']) settings[String(r['Setting']).trim()] = { row: r._row, value: r['Value'] };
    const roles = t[TABS.roles].filter((r) => r['Role']).map((r) => ({
      row: r._row, name: String(r['Role']).trim(), code: String(r['Code'] || ''), description: String(r['Description'] || ''),
      requirements: String(r['Requirements'] || ''), openToAll: yes(r['Open to all approved']), active: isBlank(r['Active']) || yes(r['Active']),
      order: Number(r['Order']) || 99
    })).sort((a, b) => a.order - b.order);
    const ins = t[TABS.ins].filter((r) => r['Email']).map((r) => ({
      row: r._row, name: String(r['Name'] || ''), email: normEmail(r['Email']), phone: String(r['Phone'] || ''),
      credentials: list(r['Credentials']), status: String(r['Status'] || 'Pending').trim(), roles: list(r['Qualified roles']),
      folder: String(r['Cert folder'] || ''), applied: r['Applied'], decided: r['Decided'], about: String(r['About'] || ''), notes: String(r['Admin notes'] || ''),
      alerts: isBlank(r['Alerts']) ? ['New course'] : list(r['Alerts']).filter((a) => ALERT_TYPES.includes(a)),
      digest: DIGESTS[String(r['Digest'] || '').trim()] !== undefined ? String(r['Digest']).trim() : 'Off',
      reminders: !/^(off|no)$/i.test(String(r['Reminders'] || '').trim()), digestSent: r['Digest sent']
    }));
    const certs = t[TABS.certs].filter((r) => r['Email']).map((r) => ({
      row: r._row, email: normEmail(r['Email']), credential: String(r['Credential'] || ''), expires: r['Expires'], uploaded: r['Uploaded'],
      fileName: String(r['File name'] || ''), link: String(r['Link'] || ''), kind: String(r['Kind'] || 'Cert card').trim() || 'Cert card'
    }));
    const apps = (t[TABS.apps] || []).filter((r) => r['Email']).map((r) => ({ row: r._row, email: normEmail(r['Email']), raw: r }));
    const agreements = (t[TABS.agreements] || []).filter((r) => r['Agreement']).map((r) => ({
      name: String(r['Agreement']).trim(), version: String(r['Version'] || '1'), appliesTo: String(r['Applies to'] || 'Instructor').trim(), text: String(r['Text'] || '')
    }));
    const courses = t[TABS.courses].filter((r) => r['Course ID']).map((r) => ({
      row: r._row, id: String(r['Course ID']).trim(), name: String(r['Course'] || r['Course ID']), start: isoOf(r['Start']), end: isoOf(r['End']),
      location: String(r['Location'] || ''), status: String(r['Status'] || 'Open').trim(), students: Number(r['Students']) || '', description: String(r['Description'] || '')
    }));
    const sessions = t[TABS.sessions].filter((r) => r['Session ID']).map((r) => ({
      row: r._row, id: String(r['Session ID']).trim(), courseId: String(r['Course ID']).trim(), day: Number(r['Day']) || '', date: isoOf(r['Date']),
      block: String(r['Block'] || ''), start: normTime(r['Start']), end: normTime(r['End']), topic: String(r['Topic'] || ''), status: String(r['Status'] || 'Open').trim()
    })).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    const slots = t[TABS.slots].filter((r) => r['Slot ID']).map((r) => ({
      row: r._row, id: String(r['Slot ID']).trim(), sessionId: String(r['Session ID']).trim(), role: String(r['Role'] || '').trim(),
      openings: Math.max(0, Number(r['Openings']) || 0), pay: money(r['Pay ($)']), call: normTime(r['Call']), release: normTime(r['Release']),
      notes: String(r['Notes'] || ''), status: String(r['Status'] || 'Open').trim(), scale: SCALE_RULES[String(r['Scale'] || '').trim()] !== undefined ? String(r['Scale'] || '').trim() : ''
    }));
    const reqs = t[TABS.reqs].filter((r) => r['Request ID']).map((r) => ({
      row: r._row, id: String(r['Request ID']), slotId: String(r['Slot ID']).trim(), email: normEmail(r['Email']), name: String(r['Name'] || ''),
      status: String(r['Status'] || 'Pending').trim(), requested: stamp(r['Requested']), updated: r['Updated'], decidedBy: String(r['Decided by'] || ''),
      amount: isBlank(r['Amount ($)']) ? null : money(r['Amount ($)']), paidOn: r['Paid on'], reminderSent: r['Reminder sent'], note: String(r['Note'] || '')
    }));
    const all = { settings, roles, ins, certs, courses, sessions, slots, reqs, apps, agreements };
    all.sessionById = new Map(sessions.map((s) => [s.id, s]));
    all.courseById = new Map(courses.map((c) => [c.id, c]));
    all.slotById = new Map(slots.map((s) => [s.id, s]));
    return all;
  }

  const setting = (all, key, dflt) => (all.settings[key] && !isBlank(all.settings[key].value) ? all.settings[key].value : dflt);
  const on = (all, key) => { const v = setting(all, key, 'On'); return !/^(off|no|false|0)$/i.test(String(v).trim()); };
  const adminRecipients = (all) => { const l = list(setting(all, S.adminEmails, '')); return l.length ? l : cfg.adminEmails; };
  const isAdminEmail = (e) => cfg.adminEmails.map(normEmail).includes(normEmail(e));

  // ---------- identity & tokens ----------
  function identify(all, email) {
    if (!email) return null;
    const ins = all.ins.find((i) => i.email === email) || null;
    const isAdmin = isAdminEmail(email);
    if (!isAdmin && !(ins && LOGIN_STATUSES.includes(ins.status))) return null;
    return { email, ins, isAdmin, name: ins ? ins.name : email };
  }
  const hashKey = (s) => sha256hex(cfg.secret + '|' + s).slice(0, 40);
  function makeToken(email) { const p = email + '|' + (Date.now() + SESSION_DAYS * 86400000); return b64uEncode(p) + '.' + hmac(cfg.secret, p); }
  function readToken(token) {
    if (typeof token !== 'string' || !token.includes('.')) sessionFail();
    const [p, s] = token.split('.');
    let payload; try { payload = b64uDecode(p); } catch { sessionFail(); }
    if (!s || !safeEqual(s, hmac(cfg.secret, payload))) sessionFail();
    const [email, exp] = payload.split('|');
    if (!(Number(exp) > Date.now())) sessionFail();
    return email;
  }
  function auth(token, all) { const who = identify(all, readToken(token)); if (!who) sessionFail(); return who; }
  function adminAuth(token, all) { const who = auth(token, all); if (!who.isAdmin) fail('Admins only.'); return who; }

  // ---------- email ----------
  const prefsToken = (email) => { const p = normEmail(email) + '|prefs'; return b64uEncode(p) + '.' + hmac(cfg.secret, 'prefs|' + p); };
  function readPrefsToken(t) {
    const bad = () => fail('This email settings link isn\'t valid. Log in to the portal to change your settings.');
    if (typeof t !== 'string' || !t.includes('.')) bad();
    const [p, sig] = t.split('.');
    let payload; try { payload = b64uDecode(p); } catch { bad(); }
    if (!sig || !safeEqual(sig, hmac(cfg.secret, 'prefs|' + payload)) || !payload.endsWith('|prefs')) bad();
    return payload.slice(0, -6);
  }
  const manageUrl = (email) => (cfg.siteUrl || '') + '/?manage=' + encodeURIComponent(prefsToken(email));
  // Links are written as plain text, not <a> tags: Brevo rewrites every <a> link through its click-tracking
  // domain (sendibt2.com), which some browsers flag. Mail apps turn plain URLs into direct links on their own.
  const wrap = (body, to) => '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1C1C1C;line-height:1.5;max-width:560px">' + body +
    '<p style="margin-top:20px">' + (cfg.siteUrl ? '<b>Instructor Portal:</b> ' + esc(cfg.siteUrl) + '<br>' : '') +
    'ResQ Education</p>' + (to && !isAdminEmail(to) ? '<p style="font-size:12px;color:#777;margin-top:18px">You get this because you have a ResQ Instructor Portal account. ' +
    'To change which emails you get, go to: ' + esc(manageUrl(to)) + '</p>' : '') + '</div>';
  async function send(all, key, to, subject, body) {
    if (key && !on(all, key)) return;
    const tos = Array.isArray(to) ? to : [to];
    for (const t of tos) {
      if (!t) continue;
      try { await mailer.send({ to: t, subject, html: wrap(body, t) }); } catch (e) { console.error('email failed', subject, e); }
    }
  }
  async function sendCode(email, first) {
    const code = String(randomInt(100000, 1000000));
    await kv.set('otp:' + hashKey(email), { code, tries: 0, exp: Date.now() + 600000 });
    try {
      await mailer.send({ to: email, subject: 'Your ResQ Instructor Portal code: ' + code, html: wrap(
        '<p>Hi ' + esc(first || 'there') + ',</p><p>Your login code for the ResQ Instructor Portal is:</p>' +
        '<p style="font-size:30px;font-weight:700;letter-spacing:6px;color:#B73B35;margin:16px 0">' + code + '</p>' +
        '<p>It expires in 10 minutes. If you didn\'t ask for it, you can ignore this email.</p>', email) });
    } catch (e) {
      console.error('login email failed', e);
      const b = e && e.brevo;
      if (!b) throw e;
      let hint = 'Brevo returned error ' + b.status + ': ' + b.message;
      if (/not verified|ip/i.test(b.message)) hint += '. Check Brevo > Security > Authorized IPs.';
      else if (b.status === 401) hint += '. Check the BREVO_API_KEY setting in Netlify.';
      else if (/sender/i.test(b.message)) hint += '. Check the sender address is verified in Brevo.';
      throw new PortalError('We couldn\'t send your login code. ' + hint);
    }
  }
  async function rateLimit(email) {
    const k = 'rl:' + hashKey(email);
    const rl = await kv.get(k);
    if (rl && rl.until > Date.now()) fail('A code was just sent. Wait a minute before asking for another.');
    await kv.set(k, { until: Date.now() + 60000 });
  }

  // ---------- slot logic ----------
  const reqsFor = (all, slotId) => all.reqs.filter((r) => r.slotId === slotId);
  const byQueue = (a, b) => (a.requested - b.requested) || (a.row - b.row);
  const holders = (all, slotId) => reqsFor(all, slotId).filter((r) => HOLD.includes(r.status)).sort(byQueue);
  const waitlist = (all, slotId) => reqsFor(all, slotId).filter((r) => r.status === 'Waitlist').sort(byQueue);
  function ctx(all, slot) {
    const session = all.sessionById.get(slot.sessionId) || {};
    const course = all.courseById.get(session.courseId) || {};
    return { session, course };
  }
  function slotLabel(all, slot) {
    const { session, course } = ctx(all, slot);
    return slot.role + ', ' + (course.name || '') + ' Day ' + (session.day || '?') + ' ' + (session.block || '') + ' (' + fmtDay(session.date) + ', ' +
      fmtTime(slot.call || session.start) + '–' + fmtTime(slot.release || session.end) + ')';
  }
  const payOf = (all, r) => (r.amount !== null && r.amount !== undefined ? r.amount : ((all.slotById.get(r.slotId) || {}).pay || 0));
  const qualified = (all, ins, roleName) => {
    if (!ins || ins.status !== 'Approved') return false;
    const role = all.roles.find((r) => r.name === roleName);
    return (role && role.openToAll) || ins.roles.includes(roleName);
  };
  async function setReq(all, r, status, by, extra = {}) {
    const values = { 'Status': status, 'Updated': nowForSheet(), ...extra };
    if (by !== undefined) values['Decided by'] = by;
    await store.updateRows(TABS.reqs, [{ row: r.row, values }]);
    r.status = status;
  }
  async function promote(all, slot, freedBy) {
    const moved = [];
    let open = slot.openings - holders(all, slot.id).length;
    for (const w of waitlist(all, slot.id)) {
      if (open <= 0) break;
      await setReq(all, w, 'Pending');
      moved.push(w); open--;
      await send(all, S.insSlot, w.email, 'You moved up: ' + slot.role + ' is now held for you',
        '<p>A spot opened up and your waitlist request moved up. You\'re now holding:</p><p><b>' + esc(slotLabel(all, slot)) + '</b></p><p>It\'s pending until a ResQ admin approves it.</p>');
    }
    if (freedBy && open > 0) {
      const { session } = ctx(all, slot);
      const today = todayISO();
      if (session.date && session.date >= today && session.date <= addDays(today, NEAR_TERM_DAYS)) await notifyOpenings(all, 'Near-term openings', [slot], [freedBy]);
    }
    return moved;
  }

  // ---------- opening alerts and digests ----------
  // Who may request a slot: approved accounts for roles they're cleared for (plus open-to-all roles like Patient);
  // patient applicants (and patients applying to become instructors) may hold open-to-all roles while their account is pending. Pending instructors can't request.
  function canRequest(all, ins, roleName) {
    if (!ins) return { ok: false, why: 'Apply first. Admin-only accounts can\'t hold slots.' };
    const role = all.roles.find((r) => r.name === roleName) || {};
    const app = appOf(all, ins.email) || {};
    const patientAccess = app.track === 'Patient' || !!(app.upgrade && app.upgrade.status);
    if (ins.status === 'Approved') {
      if (role.openToAll || ins.roles.includes(roleName)) return { ok: true };
      return { ok: false, why: 'You\'re not cleared for ' + roleName + ' yet. Ask ResQ if you\'d like to be considered for it.' };
    }
    if (ins.status === 'Pending' && patientAccess && role.openToAll) return { ok: true };
    if (ins.status === 'Pending') return { ok: false, why: 'Your application is still being reviewed. You can request slots once ResQ approves it.' };
    return { ok: false, why: 'Your account isn\'t active.' };
  }
  const mayGetOpenings = (all, ins) => { if (ins.status === 'Approved') return true; const a = appOf(all, ins.email) || {}; return ins.status === 'Pending' && (a.track === 'Patient' || !!(a.upgrade && a.upgrade.status)); };
  function relevantRoles(all, ins) {
    const app = appOf(all, ins.email);
    if (app && app.track === 'Patient') return new Set(['Patient']);
    if (app && app.upgrade && app.upgrade.status) return new Set([...(ins.status === 'Approved' ? ins.roles : []), 'Patient']); // patient who applied to instruct
    // Roles they're cleared for; before approval (or if none are ticked yet), the roles they applied for.
    const mine = ins.status === 'Approved' && ins.roles.length ? ins.roles : (app ? app.rolesWanted : []);
    return new Set(mine);
  }
  function openItems(all, slots, ins) {
    const today = todayISO(), roles = relevantRoles(all, ins);
    const activeSessions = new Set(all.reqs.filter((r) => r.email === ins.email && (HOLD.includes(r.status) || r.status === 'Waitlist'))
      .map((r) => (all.slotById.get(r.slotId) || {}).sessionId));
    return slots.map((sl) => ({ sl, ...ctx(all, sl), left: sl.openings - holders(all, sl.id).length }))
      .filter((x) => x.left > 0 && roles.has(x.sl.role) && x.sl.status === 'Open' && x.session.status === 'Open' && x.course.status === 'Open' &&
        x.session.date >= today && !activeSessions.has(x.session.id))
      .sort((a, b) => (a.session.date + a.sl.call).localeCompare(b.session.date + b.sl.call));
  }
  function itemsHtml(items) {
    let html = '', course = '';
    for (const x of items.slice(0, 60)) {
      if (x.course.name !== course) { if (course) html += '</ul>'; course = x.course.name; html += '<p style="margin:14px 0 4px"><b>' + esc(course) + '</b>' + (x.course.location ? ' · ' + esc(x.course.location) : '') + '</p><ul style="margin:0;padding-left:20px">'; }
      html += '<li>' + esc(fmtDay(x.session.date)) + ', Day ' + esc(x.session.day) + ' ' + esc(x.session.block) + ': <b>' + esc(x.sl.role) + '</b> ' + esc(x.sl.call) + '–' + esc(x.sl.release) +
        ' (' + x.left + ' open' + (x.sl.pay > 0 ? ', ' + fmtMoney(x.sl.pay) : '') + ')</li>';
    }
    if (course) html += '</ul>';
    if (items.length > 60) html += '<p>…and ' + (items.length - 60) + ' more in the portal.</p>';
    return html;
  }
  const ALERT_COPY = {
    'New course': ['New ResQ course open for sign-up', 'A new course just opened in the Instructor Portal. Openings in roles that fit you:'],
    'Openings added': ['More openings added', 'ResQ added openings in roles that fit you:'],
    'Near-term openings': ['Short-notice opening', 'A spot just opened up in the next two weeks:']
  };
  async function notifyOpenings(all, kind, slots, exclude = []) {
    if (!on(all, S.insAlerts)) return 0;
    let n = 0;
    for (const ins of all.ins) {
      if (!mayGetOpenings(all, ins) || !ins.alerts.includes(kind) || exclude.includes(ins.email)) continue;
      const items = openItems(all, slots, ins);
      if (!items.length) continue;
      const [subject, intro] = ALERT_COPY[kind];
      await send(all, null, ins.email, subject + (kind === 'New course' ? ': ' + items[0].course.name : ''),
        '<p>Hi ' + esc(ins.name.split(' ')[0]) + ',</p><p>' + intro + '</p>' + itemsHtml(items) + '<p>Log in to request a slot. The first request holds it.</p>');
      n++;
    }
    return n;
  }
  const statusText = { Pending: 'is held for you and pending approval', Approved: 'is approved', Declined: 'was declined', Waitlist: 'is on the waitlist',
    Dropped: 'was dropped', 'Drop requested': 'has a drop request waiting for approval' };
  async function tellInstructor(all, r, slot, extra = '') {
    await send(all, S.insSlot, r.email, 'Slot ' + r.status.toLowerCase() + ': ' + slot.role + ' (' + fmtDay((ctx(all, slot).session || {}).date) + ')',
      '<p>Your request for <b>' + esc(slotLabel(all, slot)) + '</b> ' + (statusText[r.status] || ('is now ' + esc(r.status))) + '.</p>' + extra +
      (r.status === 'Approved' && slot.notes ? '<p><b>Notes:</b> ' + esc(slot.notes) + '</p>' : '') +
      (r.status === 'Approved' && !payrollReady(all, r.email) ? '<p>Before we can pay you, upload your W-9 and direct deposit form on the Application tab. Blank forms are there to download.</p>' : ''));
  }

  // ---------- applications ----------
  const agreementsFor = (all, track) => all.agreements.filter((a) => a.appliesTo === 'Both' || a.appliesTo === track);
  const splitRef = (v) => { const [name = '', relationship = '', phone = '', email = ''] = String(v || '').split('|').map((x) => x.trim()); return { name, relationship, phone, email }; };
  function appOf(all, email) {
    const a = all.apps.find((x) => x.email === email);
    if (!a) return null;
    const r = a.raw;
    return { row: a.row, track: TRACKS.includes(String(r['Track'])) ? String(r['Track']) : 'Instructor', submitted: fmtDate(r['Submitted']), updated: fmtDate(r['Updated']),
      address: String(r['Address'] || ''), emergencyName: String(r['Emergency contact'] || ''), emergencyPhone: String(r['Emergency phone'] || ''),
      agency: String(r['Agency'] || ''), years: String(r['Years in EMS'] ?? ''), teaching: String(r['Teaching experience'] || ''), rolesWanted: list(r['Roles wanted']),
      availability: String(r['Availability'] || ''),
      licenses: { mnEms: String(r['MN EMS license #'] || ''), mnEmsExp: isoOf(r['MN EMS exp']), nremt: String(r['NREMT #'] || ''), nremtExp: isoOf(r['NREMT exp']),
        aha: String(r['AHA instructor ID'] || ''), ahaExp: isoOf(r['AHA exp']), other: String(r['Other licenses'] || '') },
      refs: [splitRef(r['Reference 1']), splitRef(r['Reference 2'])], agreements: String(r['Agreements'] || ''),
      upgrade: { status: String(r['Upgrade status'] || '').trim(), requested: fmtDate(r['Upgrade requested']) } };
  }
  function checklist(all, email) {
    const app = appOf(all, email);
    const track = app ? app.track : 'Instructor';
    const docs = all.certs.filter((c) => c.email === email);
    const has = (k) => docs.some((d) => d.kind === k);
    const agreed = !!app && agreementsFor(all, track).every((a) => app.agreements.includes(a.name));
    const items = [{ key: 'application', label: 'Application', done: !!app }];
    if (track === 'Instructor') {
      items.push({ key: 'Cert card', label: 'Cert card', done: has('Cert card') }, { key: 'Resume', label: 'Resume', done: has('Resume') },
        { key: 'references', label: 'References', done: !!app && app.refs.every((x) => x.name && (x.phone || x.email)) });
    }
    items.push({ key: 'agreements', label: 'Agreements', done: agreed });
    // Payroll forms aren't part of the application; they're needed before the first payment.
    const pay = [{ key: 'W-9', label: 'W-9', done: has('W-9') }, { key: 'Direct deposit', label: 'Direct deposit', done: has('Direct deposit') }];
    return { track, items, complete: items.every((i) => i.done), missing: items.filter((i) => !i.done).map((i) => i.label),
      payroll: { items: pay, complete: pay.every((i) => i.done), missing: pay.filter((i) => !i.done).map((i) => i.label) } };
  }
  function readApplication(all, p, email) {
    p = p || {};
    const track = p.track === 'Patient' ? 'Patient' : 'Instructor';
    const name = clean(p.name, 80), phone = clean(p.phone, 30);
    if (!name || name.split(/\s+/).length < 2) fail('Add your first and last name.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('Enter a valid email address.');
    if (!phone) fail('Add a mobile phone number so we can reach you on class days.');
    const emName = clean(p.emergencyName, 80), emPhone = clean(p.emergencyPhone, 30);
    if (!emName || !emPhone) fail('Add an emergency contact name and phone.');
    const iso = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? mdY(v) : '');
    const creds = (Array.isArray(p.credentials) ? p.credentials : []).filter((c) => CREDENTIALS.includes(c));
    const roleNames = all.roles.map((r) => r.name);
    const rolesWanted = (Array.isArray(p.rolesWanted) ? p.rolesWanted : []).filter((r) => roleNames.includes(r));
    const days = (Array.isArray(p.days) ? p.days : []).filter((d) => DAYS.includes(d));
    const availability = [days.join(', '), clean(p.availabilityNotes, 300)].filter(Boolean).join('. ');
    const L = p.licenses || {};
    const lic = { mnEms: clean(L.mnEms, 40), nremt: clean(L.nremt, 40), aha: clean(L.aha, 40) };
    const refs = (Array.isArray(p.refs) ? p.refs : []).slice(0, 2).map((x) => ({ name: clean(x && x.name, 80), relationship: clean(x && x.relationship, 80),
      phone: clean(x && x.phone, 30), email: normEmail(clean(x && x.email, 120)) }));
    const need = agreementsFor(all, track);
    const agreed = Array.isArray(p.agreed) ? p.agreed : [];
    const missingAgreement = need.find((a) => !agreed.includes(a.name));
    if (missingAgreement) fail('Read and check "' + missingAgreement.name + '" to submit.');
    if (track === 'Instructor') {
      if (!clean(p.address, 200)) fail('Add your mailing address.');
      if (!creds.length) fail('Pick at least one certification (pick "Other" and explain if none fit).');
      if (!lic.mnEms && !lic.nremt && !lic.aha) fail('Add at least one license or certification number (MN EMS, NREMT or AHA instructor ID).');
      if (!rolesWanted.length) fail('Pick at least one role you want to teach.');
      if (refs.length < 2 || refs.some((x) => !x.name || (!x.phone && !x.email))) fail('Add two professional references, each with a phone or email.');
    }
    const now = nowForSheet();
    return {
      ins: { 'Name': name, 'Phone': phone, 'Credentials': (track === 'Patient' && !creds.length ? ['Student / pre-health (patient role)'] : creds).join(', '),
        'About': clean(p.teaching, 1000) },
      app: { 'Email': email, 'Track': track, 'Updated': now, 'Address': clean(p.address, 200), 'Emergency contact': emName, 'Emergency phone': emPhone,
        'Agency': clean(p.agency, 120), 'Years in EMS': clean(p.years, 10), 'Teaching experience': clean(p.teaching, 1000), 'Roles wanted': (track === 'Patient' ? ['Patient'] : rolesWanted).join(', '),
        'Availability': availability, 'MN EMS license #': lic.mnEms, 'MN EMS exp': iso(L.mnEmsExp), 'NREMT #': lic.nremt, 'NREMT exp': iso(L.nremtExp),
        'AHA instructor ID': lic.aha, 'AHA exp': iso(L.ahaExp), 'Other licenses': clean(L.other, 300),
        'Reference 1': refs[0] ? [refs[0].name, refs[0].relationship, refs[0].phone, refs[0].email].join(' | ') : '',
        'Reference 2': refs[1] ? [refs[1].name, refs[1].relationship, refs[1].phone, refs[1].email].join(' | ') : '',
        'Agreements': need.map((a) => a.name + ' v' + a.version + ' (' + todayForSheet() + ')').join('; ') },
      track, name
    };
  }
  async function saveApplication(all, email, a) {
    const ex = all.apps.find((x) => x.email === email);
    if (ex) await store.updateRows(TABS.apps, [{ row: ex.row, values: a.app }]);
    else await store.appendRows(TABS.apps, [{ ...a.app, 'Submitted': a.app['Updated'] }]);
  }

  function payrollReady(all, email) {
    if (!all._payroll) all._payroll = new Map();
    if (!all._payroll.has(email)) { const k = new Set(all.certs.filter((c) => c.email === email).map((c) => c.kind)); all._payroll.set(email, k.has('W-9') && k.has('Direct deposit')); }
    return all._payroll.get(email);
  }

  // ---------- shaping output ----------
  function slotView(all, slot, who) {
    const h = holders(all, slot.id), w = waitlist(all, slot.id);
    const mine = who.email ? reqsFor(all, slot.id).filter((r) => r.email === who.email && (HOLD.includes(r.status) || r.status === 'Waitlist')) : [];
    const my = mine[0];
    const v = { id: slot.id, role: slot.role, openings: slot.openings, pay: slot.pay, call: slot.call, release: slot.release, notes: slot.notes, status: slot.status, scale: slot.scale,
      over: Math.max(0, h.length - slot.openings),
      held: h.length, approved: h.filter((r) => r.status !== 'Pending').length, waitlist: w.length,
      mine: my ? { id: my.id, status: my.status, position: my.status === 'Waitlist' ? w.findIndex((x) => x.id === my.id) + 1 : 0 } : null,
      qualified: qualified(all, who.ins, slot.role), canRequest: who.ins ? canRequest(all, who.ins, slot.role).ok : false };
    if (who.isAdmin) v.people = [...h, ...w].map((r) => ({ id: r.id, email: r.email, name: r.name, status: r.status }));
    return v;
  }
  function scheduleView(all, who) {
    const today = todayISO();
    return all.courses.filter((c) => who.isAdmin || c.status === 'Open').map((c) => ({
      id: c.id, name: c.name, start: c.start, end: c.end, location: c.location, status: c.status, students: c.students, description: c.description,
      sessions: all.sessions.filter((s) => s.courseId === c.id && (who.isAdmin || (s.status === 'Open' && s.date >= today))).map((s) => ({
        id: s.id, day: s.day, date: s.date, dateText: fmtDay(s.date), block: s.block, start: s.start, end: s.end, topic: s.topic, status: s.status, past: s.date < today,
        slots: all.slots.filter((sl) => sl.sessionId === s.id && (who.isAdmin || sl.status === 'Open')).map((sl) => slotView(all, sl, who))
      }))
    }));
  }
  function requestView(all, r) {
    const slot = all.slotById.get(r.slotId) || { role: '(removed slot)', id: r.slotId };
    const { session, course } = ctx(all, slot);
    const today = todayISO();
    const amount = payOf(all, r);
    const paid = !isBlank(r.paidOn);
    return { id: r.id, slotId: r.slotId, email: r.email, name: r.name, status: r.status, role: slot.role, course: course.name || '', courseId: course.id || '',
      sessionId: session.id || '', day: session.day || '', block: session.block || '', date: session.date || '', dateText: fmtDay(session.date),
      call: slot.call || session.start || '', release: slot.release || session.end || '', notes: slot.notes || '', topic: session.topic || '',
      location: course.location || '', amount, amountSet: r.amount !== null, paid, paidOn: fmtDate(r.paidOn), requested: r.requested ? new Date(r.requested).toISOString() : '',
      position: r.status === 'Waitlist' ? waitlist(all, r.slotId).findIndex((x) => x.id === r.id) + 1 : 0,
      pay: r.status === 'Approved' ? (paid ? 'Paid' : (session.date && session.date < today ? 'Owed' : 'Upcoming')) : '',
      past: !!(session.date && session.date < today), note: r.note, payrollReady: payrollReady(all, r.email) };
  }
  function earnings(views) {
    const e = { upcoming: 0, owed: 0, paid: 0, approved: 0 };
    for (const v of views) if (v.status === 'Approved') { e.approved++; if (v.pay === 'Paid') e.paid += v.amount; else if (v.pay === 'Owed') e.owed += v.amount; else e.upcoming += v.amount; }
    return e;
  }
  const publicIns = (all, i) => {
    const mine = all.reqs.filter((r) => r.email === i.email).map((r) => requestView(all, r));
    return { name: i.name, email: i.email, phone: i.phone, credentials: i.credentials, status: i.status, roles: i.roles, folder: i.folder,
      applied: fmtDate(i.applied), about: i.about, notes: i.notes, admin: isAdminEmail(i.email),
      certs: all.certs.filter((c) => c.email === i.email).map((c) => ({ kind: c.kind, credential: c.credential, expires: fmtDate(c.expires), uploaded: fmtDate(c.uploaded),
        fileName: DOC_KINDS[c.kind] && DOC_KINDS[c.kind].private ? '' : c.fileName, link: DOC_KINDS[c.kind] && DOC_KINDS[c.kind].private ? '' : c.link })),
      application: appOf(all, i.email), checklist: checklist(all, i.email), prefs: { alerts: i.alerts, digest: i.digest, reminders: i.reminders },
      holding: mine.filter((v) => HOLD.includes(v.status) || v.status === 'Waitlist').length, earnings: earnings(mine) };
  };

  function findSlotForWrite(all, slotId) {
    const slot = all.slotById.get(String(slotId));
    if (!slot) fail('That slot no longer exists. Refresh the page.');
    return slot;
  }

  // ---------- API ----------
  const api = {
    async apiRequestCode(email) {
      email = normEmail(email);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('Enter a valid email address.');
      await rateLimit(email);
      const all = await everything();
      const who = identify(all, email);
      if (who) await sendCode(email, who.ins ? who.ins.name.split(' ')[0] : '');
      const known = all.ins.find((i) => i.email === email);
      return { sent: true, unknown: !known && !isAdminEmail(email) };
    },

    async apiSignup(p) {
      p = p || {};
      const email = normEmail(clean(p.email, 120));
      const all = await everything();
      const a = readApplication(all, p, email);
      const existing = all.ins.find((i) => i.email === email);
      if (existing && ['Declined', 'Inactive'].includes(existing.status)) fail('This email already has an account that isn\'t active. Contact ResQ to reopen it.');
      await rateLimit(email);
      if (!existing) {
        await store.appendRows(TABS.ins, [{ 'Email': email, 'Status': 'Pending', 'Applied': nowForSheet(), ...a.ins }]);
        await saveApplication(all, email, a);
        all.ins.push({ email, name: a.name, status: 'Pending', roles: [], credentials: [] });
        const app = a.app;
        await send(all, S.adminSignup, adminRecipients(all), 'New ' + (a.track === 'Patient' ? 'patient' : 'instructor') + ' application: ' + a.name,
          '<p><b>' + esc(a.name) + '</b> applied through the Instructor Portal (' + esc(a.track) + ' application).</p><p>Email: ' + esc(email) + '<br>Phone: ' + esc(a.ins['Phone']) +
          '<br>Certifications: ' + esc(a.ins['Credentials'] || '-') + '<br>Roles wanted: ' + esc(app['Roles wanted'] || '-') + '<br>Availability: ' + esc(app['Availability'] || '-') + '</p>' +
          '<p>Review the application and documents in the Approvals tab.</p>');
      } else if (!all.apps.some((x) => x.email === email)) {
        await saveApplication(all, email, a);
      }
      await sendCode(email, a.name.split(' ')[0]);
      return { sent: true, existing: !!existing };
    },

    async apiSaveApplication(token, p) {
      const all = await everything();
      const who = auth(token, all);
      if (!who.ins) fail('Your email isn\'t on the instructor list. Use "Apply" on the login page.');
      const cur = appOf(all, who.email);
      if (cur && cur.track === 'Patient' && p && p.track === 'Instructor') fail('Use "Apply to be an instructor" to send an instructor application.');
      const a = readApplication(all, p, who.email);
      await store.updateRows(TABS.ins, [{ row: who.ins.row, values: a.ins }]);
      await saveApplication(all, who.email, a);
      return { saved: true };
    },

    async apiApplyInstructor(token, p) {
      const all = await everything();
      const who = auth(token, all);
      const cur = who.ins && appOf(all, who.email);
      if (!cur || cur.track !== 'Patient') fail('This is for patients who want to apply to instruct.');
      const a = readApplication(all, { ...(p || {}), track: 'Instructor' }, who.email);
      await store.updateRows(TABS.ins, [{ row: who.ins.row, values: a.ins }]);
      await store.updateRows(TABS.apps, [{ row: cur.row, values: { ...a.app, 'Upgrade status': 'Pending', 'Upgrade requested': nowForSheet() } }]);
      await send(all, S.adminSignup, adminRecipients(all), 'Instructor application from a patient: ' + a.name,
        '<p><b>' + esc(a.name) + '</b> (' + esc(who.email) + ') works with ResQ as a patient and just applied to become an instructor.</p>' +
        '<p>Certifications: ' + esc(a.ins['Credentials'] || '-') + '<br>Roles wanted: ' + esc(a.app['Roles wanted'] || '-') + '</p><p>Review it under Instructor applications in the Approvals tab. They keep their patient access in the meantime.</p>');
      return { submitted: true };
    },

    async apiUploadDoc(token, p) {
      const all = await everything();
      const who = auth(token, all);
      if (!who.ins) fail('Apply as an instructor first.');
      p = p || {};
      const kind = DOC_KINDS[p.kind] ? p.kind : 'Cert card';
      const priv = DOC_KINDS[kind].private;
      if (!files || !(priv ? cfg.privateFolderId : cfg.certFolderId)) fail('Uploads aren\'t set up yet. Email this document to ' + (cfg.replyTo || 'ResQ') + ' for now.');
      const data = String(p.data || '').replace(/^data:[^,]*,/, '');
      if (!data) fail('Pick a file to upload.');
      if (data.length > MAX_UPLOAD_B64) fail('That file is too big. Upload a file under 4 MB (a phone photo or PDF works).');
      const okMime = kind === 'Resume' ? /^(application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document)$/
        : /^(application\/pdf|image\/(png|jpeg|heic|heif|webp))$/;
      const mime = okMime.test(p.mime) ? p.mime : fail(kind === 'Resume' ? 'Upload your resume as a PDF or Word file.' : 'Upload a PDF or a photo (JPG, PNG, HEIC).');
      const ext = clean(p.fileName, 120).split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'pdf';
      const credential = kind === 'Cert card' ? (clean(p.credential, 60) || 'Certification') : kind;
      const expires = kind === 'Cert card' && /^\d{4}-\d{2}-\d{2}$/.test(String(p.expires || '')) ? mdY(p.expires) : '';
      let folderId;
      if (priv) folderId = cfg.privateFolderId;
      else {
        folderId = (who.ins.folder.match(/folders\/([A-Za-z0-9_-]+)/) || [])[1];
        if (!folderId) {
          const f = await files.ensureFolder(cfg.certFolderId, who.ins.name + ' (' + who.email + ')');
          folderId = f.id;
          await store.updateRows(TABS.ins, [{ row: who.ins.row, values: { 'Cert folder': f.url } }]);
          who.ins.folder = f.url;
        }
      }
      const name = (priv ? kind + ' - ' + who.ins.name + ' - ' + todayISO() : credential + (expires ? ' exp ' + p.expires : '') + ' - ' + who.ins.name) + '.' + ext;
      const up = await files.upload({ folderId, name, mime, base64: data });
      await store.appendRows(TABS.certs, [{ 'Uploaded': nowForSheet(), 'Email': who.email, 'Credential': credential, 'Expires': expires,
        'File name': priv ? '(private)' : name, 'Link': priv ? '' : up.url, 'File ID': priv ? '' : up.id, 'Kind': kind }]);
      if (priv) {
        // Always sent (not switchable): guards against someone swapping in their own bank account.
        await send(all, null, who.email, 'Your ' + kind + ' form was uploaded',
          '<p>Hi ' + esc(who.ins.name.split(' ')[0]) + ',</p><p>A new <b>' + esc(kind) + '</b> form was just uploaded to your ResQ Instructor Portal account (' + esc(nowForSheet()) + ' Central).</p>' +
          '<p>If you did this, you\'re all set. <b>If you didn\'t, reply to this email or call ResQ right away</b> so we don\'t send payments to the wrong account.</p>');
      }
      return { uploaded: true, kind, fileName: priv ? kind : name };
    },

    async apiPublicConfig() {
      const all = await everything();
      return { credentials: CREDENTIALS, days: DAYS, agreements: all.agreements,
        roles: all.roles.filter((r) => r.active).map((r) => ({ name: r.name, description: r.description, requirements: r.requirements, openToAll: r.openToAll })) };
    },

    async apiVerifyCode(email, code) {
      email = normEmail(email);
      code = String(code ?? '').replace(/\D/g, '');
      const key = 'otp:' + hashKey(email);
      const rec = await kv.get(key);
      if (!rec || rec.exp < Date.now()) fail('That code has expired. Ask for a new one.');
      if (rec.code !== code) {
        rec.tries++;
        if (rec.tries >= 5) { await kv.del(key); fail('Too many tries. Ask for a new code.'); }
        await kv.set(key, rec);
        fail('That code isn\'t right. Check the email and try again.');
      }
      await kv.del(key);
      if (!identify(await everything(), email)) fail('This email doesn\'t have portal access.');
      return { token: makeToken(email) };
    },

    async apiGetData(token) {
      const all = await everything();
      const who = auth(token, all);
      const mine = all.reqs.filter((r) => r.email === who.email).map((r) => requestView(all, r))
        .sort((a, b) => (a.date + a.call).localeCompare(b.date + b.call));
      const out = {
        me: { email: who.email, name: who.name, isAdmin: who.isAdmin, isInstructor: !!who.ins,
          status: who.ins ? who.ins.status : '', phone: who.ins ? who.ins.phone : '', credentials: who.ins ? who.ins.credentials : [],
          roles: who.ins ? who.ins.roles : [], about: who.ins ? who.ins.about : '',
          application: who.ins ? appOf(all, who.email) : null, checklist: who.ins ? checklist(all, who.email) : null,
          prefs: who.ins ? { alerts: who.ins.alerts, digest: who.ins.digest, reminders: who.ins.reminders } : null },
        config: { credentials: CREDENTIALS, contact: cfg.replyTo, uploads: !!(files && cfg.certFolderId), privateUploads: !!(files && cfg.privateFolderId), today: todayISO(),
          days: DAYS, scaleRules: SCALE_RULES, agreements: all.agreements, alertTypes: ALERT_TYPES, digests: Object.keys(DIGESTS),
          roles: all.roles.filter((r) => r.active || who.isAdmin).map((r) => ({ name: r.name, description: r.description, requirements: r.requirements, openToAll: r.openToAll, active: r.active, order: r.order })) },
        courses: scheduleView(all, who),
        requests: mine,
        earnings: earnings(mine),
        certs: all.certs.filter((c) => c.email === who.email).map((c) => ({ kind: c.kind, credential: c.credential, expires: fmtDate(c.expires), uploaded: fmtDate(c.uploaded), fileName: c.fileName }))
      };
      if (who.isAdmin) {
        out.admin = {
          instructors: all.ins.map((i) => publicIns(all, i)),
          requests: all.reqs.map((r) => requestView(all, r)).sort((a, b) => (a.date + a.call).localeCompare(b.date + b.call)),
          settings: Object.entries(all.settings).map(([k, v]) => ({ key: k, value: v.value })),
          sheetUrl: store.url, certFolderId: cfg.certFolderId || ''
        };
      }
      return out;
    },

    async apiUpdateProfile(token, p) {
      const all = await everything();
      const who = auth(token, all);
      if (!who.ins) fail('Your email isn\'t on the instructor list. Sign up first.');
      p = p || {};
      const values = {};
      if (p.name !== undefined) { const n = clean(p.name, 80); if (!n) fail('Name can\'t be blank.'); values['Name'] = n; }
      if (p.phone !== undefined) values['Phone'] = clean(p.phone, 30);
      if (p.about !== undefined) values['About'] = clean(p.about, 1000);
      if (Array.isArray(p.credentials)) values['Credentials'] = p.credentials.filter((c) => CREDENTIALS.includes(c)).join(', ');
      await store.updateRows(TABS.ins, [{ row: who.ins.row, values }]);
      return { updated: true };
    },

    async apiRequestSlot(token, slotId, note) {
      const all = await everything();
      const who = auth(token, all);
      if (!who.ins) fail('Apply first. Admin-only accounts can\'t hold slots.');
      const slot = findSlotForWrite(all, slotId);
      const may = canRequest(all, who.ins, slot.role);
      if (!may.ok) fail(may.why);
      const { session, course } = ctx(all, slot);
      if (slot.status !== 'Open' || session.status !== 'Open' || course.status !== 'Open') fail('This slot isn\'t open for sign-up.');
      if (session.date < todayISO()) fail('This session has already happened.');
      const active = (r) => HOLD.includes(r.status) || r.status === 'Waitlist';
      if (reqsFor(all, slot.id).some((r) => r.email === who.email && active(r))) fail('You already requested this slot.');
      const clash = all.reqs.find((r) => r.email === who.email && active(r) && r.slotId !== slot.id && (all.slotById.get(r.slotId) || {}).sessionId === session.id);
      if (clash) fail('You already have a slot in this block (' + (all.slotById.get(clash.slotId) || {}).role + '). Drop it first to switch roles.');
      const full = holders(all, slot.id).length >= slot.openings;
      const status = full ? 'Waitlist' : 'Pending';
      const id = uid('R');
      const now = nowForSheet();
      await store.appendRows(TABS.reqs, [{ 'Request ID': id, 'Slot ID': slot.id, 'Email': who.email, 'Name': who.ins.name, 'Status': status, 'Requested': now, 'Updated': now, 'Note': clean(note, 300) }]);
      const r = { id, slotId: slot.id, email: who.email, name: who.ins.name, status, requested: Date.now(), row: 0, amount: null };
      all.reqs.push(r);
      const pos = full ? waitlist(all, slot.id).length : 0;
      await tellInstructor(all, r, slot, full ? '<p>You\'re #' + pos + ' on the waitlist. If a spot opens, it\'s held for you automatically and we\'ll email you.</p>' :
        (who.ins.status !== 'Approved' ? '<p>Your instructor account is still being reviewed. The slot stays held for you while we review it.</p>' : ''));
      await send(all, S.adminRequest, adminRecipients(all), (full ? 'Waitlist: ' : 'Slot request: ') + who.ins.name + ', ' + slot.role,
        '<p><b>' + esc(who.ins.name) + '</b> (' + esc(who.email) + ') ' + (full ? 'joined the waitlist for' : 'requested') + ':</p><p>' + esc(slotLabel(all, slot)) + '</p>' +
        '<p>Account: ' + esc(who.ins.status) + (qualified(all, who.ins, slot.role) ? '' : ' (not yet marked qualified for ' + esc(slot.role) + ')') + '</p>' +
        (note ? '<p>Note: ' + esc(clean(note, 300)) + '</p>' : ''));
      return { status, position: pos, id };
    },

    async apiDrop(token, requestId, reason) {
      const all = await everything();
      const who = auth(token, all);
      const r = all.reqs.find((x) => x.id === requestId);
      if (!r || r.email !== who.email) fail('That request wasn\'t found. Refresh the page.');
      const slot = all.slotById.get(r.slotId) || { id: r.slotId, role: 'slot', notes: '' };
      if (r.status === 'Pending' || r.status === 'Waitlist') {
        await setReq(all, r, 'Dropped', undefined, reason ? { 'Note': clean(reason, 300) } : {});
        await tellInstructor(all, r, slot);
        if (slot.openings !== undefined) await promote(all, slot, who.email);
        return { status: 'Dropped' };
      }
      if (r.status === 'Approved') {
        if (!isBlank(r.paidOn)) fail('This slot was already paid. Contact ResQ to change it.');
        await setReq(all, r, 'Drop requested', undefined, reason ? { 'Note': clean(reason, 300) } : {});
        await tellInstructor(all, r, slot, '<p>You\'re still on the schedule until an admin approves the drop.</p>');
        await send(all, S.adminDrop, adminRecipients(all), 'Drop request: ' + r.name + ', ' + slot.role,
          '<p><b>' + esc(r.name) + '</b> asked to drop an approved slot:</p><p>' + esc(slotLabel(all, slot)) + '</p><p>Reason: ' + esc(clean(reason, 300) || '-') + '</p>');
        return { status: 'Drop requested' };
      }
      if (r.status === 'Drop requested') {
        await setReq(all, r, 'Approved');
        return { status: 'Approved' };
      }
      fail('This request can\'t be dropped.');
    },

    async apiUploadCert(token, p) { return api.apiUploadDoc(token, { ...(p || {}), kind: 'Cert card' }); },

    // ----- admin -----
    async apiAdminInstructor(token, email, ch) {
      const all = await everything();
      const who = adminAuth(token, all);
      ch = ch || {};
      const ins = all.ins.find((i) => i.email === normEmail(email));
      if (!ins) fail('Instructor not found. Refresh the page.');
      const values = {};
      if (ch.roles !== undefined) {
        const names = all.roles.map((r) => r.name);
        values['Qualified roles'] = (Array.isArray(ch.roles) ? ch.roles : []).filter((r) => names.includes(r)).join(', ');
      }
      if (ch.notes !== undefined) values['Admin notes'] = clean(ch.notes, 1000);
      if (ch.phone !== undefined) values['Phone'] = clean(ch.phone, 30);
      if (ch.upgrade !== undefined) {
        const app = appOf(all, ins.email);
        if (!app || !app.upgrade.status) fail('This person has no instructor application from the patient track.');
        if (!['Approved', 'Declined'].includes(ch.upgrade)) fail('Unknown decision.');
        const roles = values['Qualified roles'] !== undefined ? list(values['Qualified roles']) : ins.roles;
        const teaching = roles.filter((r) => !(all.roles.find((x) => x.name === r) || {}).openToAll);
        if (ch.upgrade === 'Approved' && !teaching.length) fail('Tick at least one instructor role to approve the application.');
        if (ch.upgrade === 'Approved') {
          if (ins.status !== 'Approved') { values['Status'] = 'Approved'; values['Decided'] = nowForSheet(); values['Decided by'] = who.email; }
          await store.updateRows(TABS.apps, [{ row: app.row, values: { 'Upgrade status': 'Approved' } }]);
        } else {
          values['Qualified roles'] = ins.roles.filter((r) => (all.roles.find((x) => x.name === r) || {}).openToAll).join(', ');
          await store.updateRows(TABS.apps, [{ row: app.row, values: { 'Upgrade status': 'Declined', 'Track': 'Patient' } }]);
        }
        await store.updateRows(TABS.ins, [{ row: ins.row, values }]);
        await send(all, S.insAccount, ins.email, ch.upgrade === 'Approved' ? 'You\'re approved to teach with ResQ Education' : 'Your ResQ instructor application',
          '<p>Hi ' + esc(ins.name.split(' ')[0]) + ',</p>' + (ch.upgrade === 'Approved'
            ? '<p>Your instructor application is approved. You\'re cleared for: <b>' + esc(teaching.join(', ')) + '</b>. You can request those slots in the portal now, and patient slots as before.</p>'
            : '<p>Thanks for applying to instruct. We\'re not able to approve it right now. You\'re still on our patient list and can keep signing up for patient slots. Reply to this email if you have questions.</p>'));
        return { updated: true };
      }
      const changed = ch.status !== undefined && ch.status !== ins.status;
      if (ch.status !== undefined) {
        if (!ACCOUNT_STATUSES.includes(ch.status)) fail('Unknown account status.');
        values['Status'] = ch.status;
        if (changed) { values['Decided'] = nowForSheet(); values['Decided by'] = who.email; }
      }
      await store.updateRows(TABS.ins, [{ row: ins.row, values }]);
      if (changed) {
        ins.status = ch.status;
        if (ch.status === 'Approved') {
          const roles = values['Qualified roles'] !== undefined ? list(values['Qualified roles']) : ins.roles;
          await send(all, S.insAccount, ins.email, 'You\'re approved to teach with ResQ Education',
            '<p>Hi ' + esc(ins.name.split(' ')[0]) + ',</p><p>Your ResQ Instructor Portal account is approved.' +
            (roles.length ? ' You\'re cleared for: <b>' + esc(roles.join(', ')) + '</b>.' : '') + '</p><p>Any slots you\'re holding will be reviewed next. You can also request more slots now.</p>');
        } else if (ch.status === 'Declined' || ch.status === 'Inactive') {
          for (const r of all.reqs.filter((x) => x.email === ins.email && (x.status === 'Pending' || x.status === 'Waitlist'))) {
            await setReq(all, r, 'Declined', who.email);
            const slot = all.slotById.get(r.slotId); if (slot) await promote(all, slot, ins.email);
          }
          await send(all, S.insAccount, ins.email, 'Your ResQ Instructor Portal account',
            '<p>Hi ' + esc(ins.name.split(' ')[0]) + ',</p><p>Your Instructor Portal account is now <b>' + esc(ch.status.toLowerCase()) + '</b>, and any slots you were holding were released. ' +
            'If you have questions, reply to this email.</p>');
        }
      }
      return { updated: true };
    },

    async apiAdminRequest(token, requestId, action, amount) {
      const all = await everything();
      const who = adminAuth(token, all);
      const r = all.reqs.find((x) => x.id === requestId);
      if (!r) fail('That request wasn\'t found. Refresh the page.');
      const slot = all.slotById.get(r.slotId);
      if (!slot) fail('That slot no longer exists.');
      const ins = all.ins.find((i) => i.email === r.email);
      if (action === 'approve') {
        if (!['Pending', 'Waitlist'].includes(r.status)) fail('Only pending or waitlisted requests can be approved.');
        if (!ins || ins.status !== 'Approved') fail('Approve ' + r.name + '\'s instructor account first (Instructors tab).');
        if (!qualified(all, ins, slot.role)) fail(r.name + ' isn\'t marked qualified for ' + slot.role + '. Tick the role on their account first.');
        if (r.status === 'Waitlist' && holders(all, slot.id).length >= slot.openings) fail('This slot is full. Add an opening or decline someone first.');
        await setReq(all, r, 'Approved', who.email);
        await tellInstructor(all, r, slot);
      } else if (action === 'decline') {
        if (!['Pending', 'Waitlist', 'Approved', 'Drop requested'].includes(r.status)) fail('This request is already closed.');
        await setReq(all, r, 'Declined', who.email);
        await tellInstructor(all, r, slot);
        await promote(all, slot, r.email);
      } else if (action === 'approveDrop') {
        if (r.status !== 'Drop requested') fail('There\'s no drop request on this slot.');
        await setReq(all, r, 'Dropped', who.email);
        await tellInstructor(all, r, slot, '<p>Your drop request was approved. Thanks for letting us know.</p>');
        await promote(all, slot, r.email);
      } else if (action === 'denyDrop') {
        if (r.status !== 'Drop requested') fail('There\'s no drop request on this slot.');
        await setReq(all, r, 'Approved', who.email);
        await tellInstructor(all, r, slot, '<p>Your drop request wasn\'t approved, so you\'re still on the schedule. Reply to this email if you need to talk it through.</p>');
      } else if (action === 'paid') {
        if (r.status !== 'Approved') fail('Only approved slots can be marked paid.');
        const pc = checklist(all, r.email).payroll;
        if (!pc.complete) fail(r.name + ' hasn\'t uploaded their ' + pc.missing.join(' and ') + ' yet. Payroll forms are required before payment.');
        const amt = amount === undefined || amount === null || amount === '' ? payOf(all, r) : money(amount);
        await store.updateRows(TABS.reqs, [{ row: r.row, values: { 'Paid on': todayForSheet(), 'Amount ($)': amt, 'Updated': nowForSheet() } }]);
        await send(all, S.insPaid, r.email, 'Payment sent: ' + fmtMoney(amt) + ' for ' + slot.role,
          '<p>Hi ' + esc(r.name.split(' ')[0]) + ',</p><p>We marked your slot as paid: <b>' + fmtMoney(amt) + '</b> for ' + esc(slotLabel(all, slot)) + '.</p><p>Thank you for teaching with ResQ.</p>');
      } else if (action === 'unpaid') {
        await store.updateRows(TABS.reqs, [{ row: r.row, values: { 'Paid on': '', 'Updated': nowForSheet() } }]);
      } else if (action === 'amount') {
        await store.updateRows(TABS.reqs, [{ row: r.row, values: { 'Amount ($)': amount === '' || amount === null ? '' : money(amount), 'Updated': nowForSheet() } }]);
      } else fail('Unknown action.');
      return { updated: true };
    },

    async apiAdminAssign(token, slotId, email) {
      const all = await everything();
      const who = adminAuth(token, all);
      const slot = findSlotForWrite(all, slotId);
      const ins = all.ins.find((i) => i.email === normEmail(email));
      if (!ins) fail('Pick an instructor from the list.');
      if (ins.status !== 'Approved') fail(ins.name + '\'s account isn\'t approved yet.');
      if (!qualified(all, ins, slot.role)) fail(ins.name + ' isn\'t marked qualified for ' + slot.role + '.');
      if (reqsFor(all, slot.id).some((r) => r.email === ins.email && (HOLD.includes(r.status) || r.status === 'Waitlist'))) fail(ins.name + ' is already on this slot.');
      if (holders(all, slot.id).length >= slot.openings) fail('This slot is full. Add an opening first.');
      const now = nowForSheet();
      const r = { id: uid('R'), slotId: slot.id, email: ins.email, name: ins.name, status: 'Approved', amount: null };
      await store.appendRows(TABS.reqs, [{ 'Request ID': r.id, 'Slot ID': slot.id, 'Email': ins.email, 'Name': ins.name, 'Status': 'Approved', 'Requested': now, 'Updated': now, 'Decided by': who.email, 'Note': 'Assigned by admin' }]);
      all.reqs.push(r);
      await tellInstructor(all, r, slot, '<p>A ResQ admin put you on this slot.</p>');
      return { assigned: true };
    },

    async apiAdminSaveCourse(token, c) {
      const all = await everything();
      adminAuth(token, all);
      c = c || {};
      const iso = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? mdY(v) : '');
      const values = {};
      if (c.name !== undefined) values['Course'] = clean(c.name, 120);
      if (c.start !== undefined) values['Start'] = iso(c.start);
      if (c.end !== undefined) values['End'] = iso(c.end);
      if (c.location !== undefined) values['Location'] = clean(c.location, 120);
      if (c.status !== undefined) { if (!['Open', 'Hidden', 'Closed'].includes(c.status)) fail('Unknown course status.'); values['Status'] = c.status; }
      if (c.students !== undefined) values['Students'] = c.students === '' ? '' : Math.max(0, Math.round(Number(c.students) || 0));
      if (c.description !== undefined) values['Description'] = clean(c.description, 1000);
      const ex = c.id && all.courseById.get(c.id);
      if (ex) {
        await store.updateRows(TABS.courses, [{ row: ex.row, values }]);
        let alerted = 0;
        if (values['Status'] === 'Open' && ex.status !== 'Open') {
          ex.status = 'Open';
          const ids = new Set(all.sessions.filter((x) => x.courseId === ex.id).map((x) => x.id));
          alerted = await notifyOpenings(all, 'New course', all.slots.filter((sl) => ids.has(sl.sessionId)));
        }
        return { id: ex.id, alerted };
      }
      if (!values['Course']) fail('Give the course a name.');
      let id = slug(values['Course']) || 'COURSE'; while (all.courseById.has(id)) id = slug(values['Course']).slice(0, 18) + '-' + randomInt(100, 999);
      await store.appendRows(TABS.courses, [{ 'Course ID': id, 'Status': 'Hidden', ...values }]);
      return { id };
    },

    async apiAdminSaveSession(token, s) {
      const all = await everything();
      adminAuth(token, all);
      s = s || {};
      const values = {};
      if (s.day !== undefined) values['Day'] = s.day === '' ? '' : Math.round(Number(s.day) || 0);
      if (s.date !== undefined) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s.date))) fail('Pick a date.'); values['Date'] = mdY(s.date); }
      if (s.block !== undefined) values['Block'] = clean(s.block, 20);
      if (s.start !== undefined) values['Start'] = normTime(s.start);
      if (s.end !== undefined) values['End'] = normTime(s.end);
      if (s.topic !== undefined) values['Topic'] = clean(s.topic, 200);
      if (s.status !== undefined) { if (!['Open', 'Hidden', 'Cancelled'].includes(s.status)) fail('Unknown session status.'); values['Status'] = s.status; }
      const ex = s.id && all.sessionById.get(s.id);
      if (ex) { await store.updateRows(TABS.sessions, [{ row: ex.row, values }]); return { id: ex.id }; }
      if (!all.courseById.has(s.courseId)) fail('Pick a course.');
      if (!values['Date']) fail('Pick a date.');
      const id = s.courseId + '-' + uid('S');
      await store.appendRows(TABS.sessions, [{ 'Session ID': id, 'Course ID': s.courseId, 'Status': 'Open', ...values }]);
      return { id };
    },

    async apiAdminSaveSlot(token, s) {
      const all = await everything();
      adminAuth(token, all);
      s = s || {};
      const values = {};
      if (s.role !== undefined) { if (!all.roles.some((r) => r.name === s.role)) fail('Pick a role.'); values['Role'] = s.role; }
      if (s.openings !== undefined) values['Openings'] = Math.max(0, Math.min(50, Math.round(Number(s.openings) || 0)));
      if (s.pay !== undefined) values['Pay ($)'] = money(s.pay);
      if (s.call !== undefined) values['Call'] = normTime(s.call);
      if (s.release !== undefined) values['Release'] = normTime(s.release);
      if (s.notes !== undefined) values['Notes'] = clean(s.notes, 500);
      if (s.status !== undefined) { if (!['Open', 'Closed'].includes(s.status)) fail('Unknown slot status.'); values['Status'] = s.status; }
      if (s.scale !== undefined) { if (SCALE_RULES[s.scale] === undefined) fail('Unknown staffing rule.'); values['Scale'] = s.scale; }
      const ex = s.id && all.slotById.get(s.id);
      if (ex) {
        await store.updateRows(TABS.slots, [{ row: ex.row, values }]);
        if (values['Openings'] !== undefined && values['Openings'] > ex.openings) {
          ex.openings = values['Openings']; await promote(all, ex);
          if (values['Status'] === undefined || values['Status'] === 'Open') await notifyOpenings(all, 'Openings added', [ex]);
        }
        return { id: ex.id };
      }
      const sess = all.sessionById.get(s.sessionId);
      if (!sess) fail('Pick a session.');
      if (!values['Role']) fail('Pick a role.');
      const id = s.sessionId + '-' + uid('X');
      const row = { 'Slot ID': id, 'Session ID': sess.id, 'Openings': 1, 'Pay ($)': 0, 'Status': 'Open', 'Call': sess.start, 'Release': sess.end, ...values };
      await store.appendRows(TABS.slots, [row]);
      const fresh = { id, sessionId: sess.id, role: row['Role'], openings: row['Openings'], pay: money(row['Pay ($)']), call: row['Call'], release: row['Release'], notes: row['Notes'] || '', status: 'Open' };
      all.slotById.set(id, fresh);
      await notifyOpenings(all, 'Openings added', [fresh]);
      return { id };
    },

    async apiAdminBulkPay(token, courseId, role, block, pay) {
      const all = await everything();
      adminAuth(token, all);
      if (!all.courseById.has(courseId)) fail('Pick a course.');
      const amt = money(pay);
      const targets = all.slots.filter((sl) => {
        const s = all.sessionById.get(sl.sessionId);
        return s && s.courseId === courseId && sl.role === role && (!block || block === 'All' || s.block === block);
      });
      if (!targets.length) fail('No ' + role + ' slots match in this course.');
      await store.updateRows(TABS.slots, targets.map((t) => ({ row: t.row, values: { 'Pay ($)': amt } })));
      return { updated: targets.length };
    },

    async apiAdminStaffing(token, courseId, students, apply) {
      const all = await everything();
      adminAuth(token, all);
      const course = all.courseById.get(courseId);
      if (!course) fail('Pick a course.');
      const n = Math.round(Number(students));
      if (!(n >= 1 && n <= 40)) fail('Enter the number of students enrolled (1 to 40).');
      const changes = [], over = [];
      for (const s of all.sessions.filter((x) => x.courseId === course.id)) {
        for (const sl of all.slots.filter((x) => x.sessionId === s.id && x.scale)) {
          const to = openingsFor(sl.scale, n);
          if (to === null) continue;
          const held = holders(all, sl.id).length;
          if (to !== sl.openings) changes.push({ slotId: sl.id, row: sl.row, day: s.day, block: s.block, date: s.date, dateText: fmtDay(s.date), role: sl.role, from: sl.openings, to, held, rule: SCALE_RULES[sl.scale] });
          if (held > to) over.push({ slotId: sl.id, day: s.day, block: s.block, role: sl.role, held, to });
        }
      }
      if (apply) {
        if (changes.length) await store.updateRows(TABS.slots, changes.map((c) => ({ row: c.row, values: { 'Openings': c.to } })));
        await store.updateRows(TABS.courses, [{ row: course.row, values: { 'Students': n } }]);
        const grown = [];
        for (const c of changes) if (c.to > c.from) { const sl = all.slotById.get(c.slotId); sl.openings = c.to; await promote(all, sl); grown.push(sl); }
        for (const c of changes) if (c.to < c.from) all.slotById.get(c.slotId).openings = c.to;
        if (grown.length) await notifyOpenings(all, 'Openings added', grown);
      }
      return { students: n, applied: !!apply, changes: changes.map(({ row, ...c }) => c), over };
    },

    async apiAdminCopyCourse(token, courseId, name, newStart) {
      const all = await everything();
      adminAuth(token, all);
      const src = all.courseById.get(courseId);
      if (!src) fail('Pick a course to copy.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(newStart || ''))) fail('Pick the new Day 1 date.');
      name = clean(name, 120) || src.name + ' (copy)';
      const srcSessions = all.sessions.filter((s) => s.courseId === src.id);
      const base = src.start || (srcSessions[0] || {}).date;
      if (!base) fail('The source course has no start date.');
      const shift = Math.round((stamp(newStart) - stamp(base)) / 86400000);
      let id = slug(name) || 'COURSE'; while (all.courseById.has(id)) id = slug(name).slice(0, 18) + '-' + randomInt(100, 999);
      await store.appendRows(TABS.courses, [{ 'Course ID': id, 'Course': name, 'Start': mdY(newStart), 'End': src.end ? mdY(addDays(src.end, shift)) : '',
        'Location': src.location, 'Status': 'Hidden', 'Students': src.students, 'Description': src.description }]);
      const sessRows = [], slotRows = [];
      for (const s of srcSessions) {
        const sid = s.id.startsWith(src.id) ? id + s.id.slice(src.id.length) : id + '-' + s.id;
        sessRows.push({ 'Session ID': sid, 'Course ID': id, 'Day': s.day, 'Date': mdY(addDays(s.date, shift)), 'Block': s.block, 'Start': s.start, 'End': s.end, 'Topic': s.topic, 'Status': s.status });
        for (const sl of all.slots.filter((x) => x.sessionId === s.id)) {
          slotRows.push({ 'Slot ID': sl.id.startsWith(s.id) ? sid + sl.id.slice(s.id.length) : sid + '-' + sl.id, 'Session ID': sid, 'Role': sl.role, 'Openings': sl.openings,
            'Pay ($)': sl.pay, 'Call': sl.call, 'Release': sl.release, 'Notes': sl.notes, 'Status': sl.status, 'Scale': sl.scale });
        }
      }
      if (sessRows.length) await store.appendRows(TABS.sessions, sessRows);
      if (slotRows.length) await store.appendRows(TABS.slots, slotRows);
      return { id, sessions: sessRows.length, slots: slotRows.length };
    },

    async apiAdminSaveRole(token, r) {
      const all = await everything();
      adminAuth(token, all);
      r = r || {};
      const values = {};
      if (r.description !== undefined) values['Description'] = clean(r.description, 300);
      if (r.requirements !== undefined) values['Requirements'] = clean(r.requirements, 300);
      if (r.openToAll !== undefined) values['Open to all approved'] = r.openToAll ? 'Yes' : 'No';
      if (r.active !== undefined) values['Active'] = r.active ? 'Yes' : 'No';
      if (r.order !== undefined) values['Order'] = Number(r.order) || 99;
      const ex = all.roles.find((x) => x.name === r.original);
      if (ex) { await store.updateRows(TABS.roles, [{ row: ex.row, values }]); return { updated: true }; }
      const name = clean(r.name, 60);
      if (!name) fail('Name the role.');
      if (all.roles.some((x) => x.name.toLowerCase() === name.toLowerCase())) fail('That role already exists.');
      await store.appendRows(TABS.roles, [{ 'Role': name, 'Code': slug(name).slice(0, 6), 'Active': 'Yes', 'Open to all approved': 'No', 'Order': all.roles.length + 1, ...values }]);
      return { added: true };
    },

    async apiAdminSettings(token, changes) {
      const all = await everything();
      adminAuth(token, all);
      const ups = [], adds = [];
      for (const [k, v] of Object.entries(changes || {})) {
        if (!Object.values(S).includes(k)) continue;
        const val = k === S.reminderDays ? Math.max(0, Math.min(30, Math.round(Number(v) || 0))) : k === S.adminEmails ? list(v).map(normEmail).join(', ') : (v === true || v === 'On' ? 'On' : 'Off');
        if (all.settings[k]) ups.push({ row: all.settings[k].row, values: { 'Value': val } }); else adds.push({ 'Setting': k, 'Value': val });
      }
      if (ups.length) await store.updateRows(TABS.settings, ups);
      if (adds.length) await store.appendRows(TABS.settings, adds);
      return { updated: ups.length + adds.length };
    },

    // ----- scheduled -----
    async runReminders() {
      const all = await everything();
      if (!on(all, S.insReminder)) return { sent: 0 };
      const days = Number(setting(all, S.reminderDays, 3)) || 0;
      const today = todayISO(), until = addDays(today, days);
      let n = 0;
      for (const r of all.reqs) {
        if (r.status !== 'Approved' || !isBlank(r.reminderSent)) continue;
        const rIns = all.ins.find((i) => i.email === r.email);
        if (rIns && !rIns.reminders) continue;
        const slot = all.slotById.get(r.slotId); if (!slot) continue;
        const { session, course } = ctx(all, slot);
        if (!session.date || session.date < today || session.date > until) continue;
        await send(all, null, r.email, 'Reminder: ' + slot.role + ' on ' + fmtDay(session.date),
          '<p>Hi ' + esc(r.name.split(' ')[0]) + ',</p><p>You\'re on the schedule for <b>' + esc(slotLabel(all, slot)) + '</b>' + (course.location ? ' at ' + esc(course.location) : '') + '.</p>' +
          (session.topic ? '<p>Topic: ' + esc(session.topic) + '</p>' : '') + (slot.notes ? '<p><b>Notes:</b> ' + esc(slot.notes) + '</p>' : '') +
          '<p>If something has come up, log in and request a drop as soon as you can.</p>');
        await store.updateRows(TABS.reqs, [{ row: r.row, values: { 'Reminder sent': nowForSheet() } }]);
        n++;
      }
      return { sent: n };
    },

    async runDigests() {
      const all = await everything();
      if (!on(all, S.insDigest)) return { sent: 0 };
      const now = Date.now();
      let n = 0;
      for (const ins of all.ins) {
        const every = DIGESTS[ins.digest];
        if (!every || !mayGetOpenings(all, ins)) continue;
        const last = toDate(ins.digestSent);
        if (last && now - last.getTime() < (every - 0.5) * 86400000) continue;
        const items = openItems(all, all.slots, ins);
        if (!items.length) continue;
        await send(all, null, ins.email, 'Open ResQ teaching slots (' + items.length + ')',
          '<p>Hi ' + esc(ins.name.split(' ')[0]) + ',</p><p>Here are the open slots in roles that fit you:</p>' + itemsHtml(items) +
          '<p>Log in to request a slot. The first request holds it.</p>');
        await store.updateRows(TABS.ins, [{ row: ins.row, values: { 'Digest sent': nowForSheet() } }]);
        n++;
      }
      return { sent: n };
    },

    // ----- email settings -----
    async apiPrefsGet(t) {
      const email = readPrefsToken(t);
      const all = await everything();
      const ins = all.ins.find((i) => i.email === email);
      if (!ins) fail('We couldn\'t find this account. Contact ResQ.');
      return { name: ins.name, email, alerts: ins.alerts, digest: ins.digest, reminders: ins.reminders, roles: [...relevantRoles(all, ins)], alertTypes: ALERT_TYPES, digests: Object.keys(DIGESTS) };
    },
    async apiPrefsSave(t, p) {
      const email = readPrefsToken(t);
      return savePrefs(email, p);
    },
    async apiSaveMyPrefs(token, p) {
      const all = await everything();
      const who = auth(token, all);
      return savePrefs(who.email, p, all);
    }
  };
  async function savePrefs(email, p, all) {
    all = all || await everything();
    const ins = all.ins.find((i) => i.email === email);
    if (!ins) fail('We couldn\'t find this account. Contact ResQ.');
    p = p || {};
    const alerts = (Array.isArray(p.alerts) ? p.alerts : []).filter((a) => ALERT_TYPES.includes(a));
    const digest = DIGESTS[p.digest] !== undefined ? p.digest : 'Off';
    await store.updateRows(TABS.ins, [{ row: ins.row, values: { 'Alerts': alerts.length ? alerts.join(', ') : 'None', 'Digest': digest, 'Reminders': p.reminders === false ? 'Off' : 'On' } }]);
    return { saved: true };
  }
  return api;
}

export const ACTIONS = ['apiPublicConfig', 'apiRequestCode', 'apiSignup', 'apiVerifyCode', 'apiGetData', 'apiUpdateProfile', 'apiSaveApplication', 'apiRequestSlot', 'apiDrop', 'apiUploadCert', 'apiUploadDoc', 'apiAdminStaffing',
  'apiAdminInstructor', 'apiAdminRequest', 'apiAdminAssign', 'apiAdminSaveCourse', 'apiAdminSaveSession', 'apiAdminSaveSlot', 'apiAdminBulkPay',
  'apiAdminCopyCourse', 'apiAdminSaveRole', 'apiAdminSettings', 'apiPrefsGet', 'apiPrefsSave', 'apiSaveMyPrefs', 'apiApplyInstructor'];
