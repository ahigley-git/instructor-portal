import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePortal, lastCode } from './fakes.mjs';
import { buildSchedule } from '../lib/seed.mjs';

const clearRl = (ctx) => { for (const k of [...ctx.kv._m.keys()]) if (k.startsWith('rl:')) ctx.kv._m.delete(k); };
async function login(ctx, email) {
  clearRl(ctx);
  await ctx.portal.apiRequestCode(email);
  return (await ctx.portal.apiVerifyCode(email, lastCode(ctx.mailer, email))).token;
}
const AGREE_I = ['Instructor code of conduct', 'Independent contractor and pay terms', 'Background check acknowledgment'];
export const fullApp = (name, email, creds = ['EMT'], extra = {}) => ({ track: 'Instructor', name, email, phone: '651-555-0100', address: '1 Main St, Cottage Grove, MN',
  emergencyName: 'Sam Doe', emergencyPhone: '651-555-0199', credentials: creds, rolesWanted: ['Assistant Instructor'], days: ['Mon', 'Sat'], availabilityNotes: 'Off B shift',
  licenses: { mnEms: '123456', mnEmsExp: '2028-03-31', nremt: 'E1234567', nremtExp: '2028-03-31' }, agency: 'Cottage Grove FD', years: '5', teaching: 'CPR instructor',
  refs: [{ name: 'Ref One', relationship: 'Captain', phone: '651-555-0001' }, { name: 'Ref Two', relationship: 'Medic', email: 'r2@x.com' }], agreed: AGREE_I, ...extra });
// Signs someone up; instructor-track accounts are approved (and cleared for teaching roles) unless opt.pending.
async function signup(ctx, name, email, creds = ['EMT'], opt = {}) {
  clearRl(ctx);
  const patient = creds.includes('Student / pre-health (patient role)');
  await ctx.portal.apiSignup(patient ? { track: 'Patient', name, email, phone: '651-555-0100', emergencyName: 'Mom', emergencyPhone: '651-555-0102', agreed: ['Patient code of conduct and waiver', 'Independent contractor and pay terms'] } : fullApp(name, email, creds));
  const token = (await ctx.portal.apiVerifyCode(email, lastCode(ctx.mailer, email))).token;
  if (!patient && !opt.pending) {
    ctx._adm = ctx._adm || await login(ctx, 'admin@resqedu.com');
    await ctx.portal.apiAdminInstructor(ctx._adm, email, { status: 'Approved', roles: opt.roles || ['Primary Instructor', 'Assistant Instructor', 'Skills Evaluator'] });
  }
  return token;
}
const rejects = (p, re) => assert.rejects(p, (e) => (re ? re.test(e.message) : true));
const slot = (d, id) => d.courses.flatMap((c) => c.sessions).flatMap((s) => s.slots).find((s) => s.id === id);
const reqOf = (d, slotId) => d.requests.find((r) => r.slotId === slotId);

test('seed schedule: two cohorts, AM/PM blocks, 3:1 staffing, $0 pay', () => {
  const { courses, sessions, slots } = buildSchedule();
  assert.equal(courses.length, 2);
  assert.equal(sessions.length, 46); // 11 days x 2 + Day 12 AM, per cohort
  const jan = slots.filter((s) => s[0].startsWith('EMT-2027-01'));
  assert.equal(jan.filter((s) => s[2] === 'Primary Instructor').length, 23);
  assert.ok(jan.every((s) => s[4] === 0));
  const d4pm = jan.filter((s) => s[1] === 'EMT-2027-01-D04-PM');
  assert.deepEqual(d4pm.map((s) => [s[2], s[3]]), [['Primary Instructor', 1], ['Assistant Instructor', 3], ['Patient', 3]]);
  const d11pm = jan.filter((s) => s[1] === 'EMT-2027-01-D11-PM').map((s) => s[2] + ':' + s[3]);
  assert.deepEqual(d11pm, ['Primary Instructor:1', 'Assistant Instructor:3', 'Skills Evaluator:6', 'Patient:2']);
  assert.equal(sessions.find((s) => s[0] === 'EMT-2027-06-D01-AM')[3], '5/31/2027');
});

test('signup, login and pending accounts', async () => {
  const ctx = makePortal();
  await ctx.portal.apiRequestCode('stranger@x.com');
  assert.equal(ctx.mailer.sent.length, 0);
  await rejects(ctx.portal.apiSignup(fullApp('Jo', 'jo@x.com')), /first and last/);
  await rejects(ctx.portal.apiSignup(fullApp('Jo Smith', 'jo@x.com', [])), /certification/);
  await rejects(ctx.portal.apiSignup(fullApp('Jo Smith', 'jo@x.com', ['EMT'], { refs: [{ name: 'A', phone: '1' }] })), /two professional references/);
  await rejects(ctx.portal.apiSignup(fullApp('Jo Smith', 'jo@x.com', ['EMT'], { agreed: ['Instructor code of conduct'] })), /Independent contractor/);
  await rejects(ctx.portal.apiSignup(fullApp('Jo Smith', 'jo@x.com', ['EMT'], { licenses: {} })), /license or certification number/);
  const t = await signup(ctx, 'Jo Smith', 'Jo@X.com', ['EMT'], { pending: true });
  assert.ok(ctx.mailer.sent.some((m) => m.to === 'admin@resqedu.com' && /New instructor application/.test(m.subject)));
  const d = await ctx.portal.apiGetData(t);
  assert.equal(d.me.status, 'Pending');
  assert.equal(d.admin, undefined);
  assert.equal(d.courses.length, 2);
  // tampered token
  await rejects(ctx.portal.apiGetData(t.split('.')[0] + '.x'), /session/);
  const forged = Buffer.from('admin@resqedu.com|' + (Date.now() + 1e9)).toString('base64url') + '.' + t.split('.')[1];
  await rejects(ctx.portal.apiGetData(forged), /session/);
});

test('wrong code lockout and rate limit', async () => {
  const ctx = makePortal();
  await signup(ctx, 'Jo Smith', 'jo@x.com');
  clearRl(ctx);
  await ctx.portal.apiRequestCode('jo@x.com');
  await rejects(ctx.portal.apiRequestCode('jo@x.com'), /Wait a minute/);
  const good = lastCode(ctx.mailer, 'jo@x.com'), bad = good === '111111' ? '222222' : '111111';
  for (let i = 0; i < 4; i++) await rejects(ctx.portal.apiVerifyCode('jo@x.com', bad), /isn't right/);
  await rejects(ctx.portal.apiVerifyCode('jo@x.com', bad), /Too many/);
});

test('holds, waitlist, approval rules, auto-promote', async () => {
  const ctx = makePortal();
  const admin = await login(ctx, 'admin@resqedu.com');
  const a = await signup(ctx, 'Amy Able', 'amy@x.com', ['EMT'], { pending: true });
  const b = await signup(ctx, 'Ben Baker', 'ben@x.com');
  const SL = 'EMT-2027-01-D01-AM-PRI'; // 1 opening
  // A pending instructor can't request anything, not even patient slots
  await rejects(ctx.portal.apiRequestSlot(a, SL), /still being reviewed/);
  await rejects(ctx.portal.apiRequestSlot(a, 'EMT-2027-01-D04-PM-PAT'), /still being reviewed/);
  let d0 = await ctx.portal.apiGetData(a);
  assert.equal(slot(d0, SL).canRequest, false);
  // Approved but not cleared for the role: blocked
  await ctx.portal.apiAdminInstructor(admin, 'amy@x.com', { status: 'Approved', roles: [] });
  assert.ok(ctx.mailer.sent.some((m) => m.to === 'amy@x.com' && /approved to teach/.test(m.subject)));
  await rejects(ctx.portal.apiRequestSlot(a, SL), /not cleared for Primary Instructor/);
  assert.equal((await ctx.portal.apiRequestSlot(a, 'EMT-2027-01-D04-PM-PAT')).status, 'Pending'); // Patient is open to all approved
  await ctx.portal.apiAdminInstructor(admin, 'amy@x.com', { roles: ['Primary Instructor', 'Not a role'] });
  let r = await ctx.portal.apiRequestSlot(a, SL);
  assert.equal(r.status, 'Pending');
  await rejects(ctx.portal.apiRequestSlot(a, SL), /already requested/);
  r = await ctx.portal.apiRequestSlot(b, SL);
  assert.equal(r.status, 'Waitlist'); assert.equal(r.position, 1);
  let d = await ctx.portal.apiGetData(b);
  assert.equal(slot(d, SL).mine.position, 1);
  assert.equal(slot(d, SL).people, undefined); // names hidden from instructors
  // Can't hold two roles in one block
  await rejects(ctx.portal.apiRequestSlot(a, 'EMT-2027-01-D01-AM-PRI'.replace('PRI', 'X')), /no longer exists/);
  const amyReq = reqOf(await ctx.portal.apiGetData(a), SL).id;
  await ctx.portal.apiAdminRequest(admin, amyReq, 'approve');
  d = await ctx.portal.apiGetData(admin);
  assert.deepEqual(slot(d, SL).people.map((p) => p.status), ['Approved', 'Waitlist']);
  assert.deepEqual(d.admin.instructors.find((i) => i.email === 'amy@x.com').roles, ['Primary Instructor']);
  // Approved drop needs admin; then Ben moves up automatically
  await ctx.portal.apiDrop(a, amyReq, 'Shift conflict');
  assert.equal(reqOf(await ctx.portal.apiGetData(a), SL).status, 'Drop requested');
  assert.ok(ctx.mailer.sent.some((m) => /Drop request: Amy Able/.test(m.subject)));
  await ctx.portal.apiAdminRequest(admin, amyReq, 'approveDrop');
  d = await ctx.portal.apiGetData(b);
  assert.equal(reqOf(d, SL).status, 'Pending');
  assert.ok(ctx.mailer.sent.some((m) => m.to === 'ben@x.com' && /moved up/.test(m.subject)));
});

test('patients are open to any approved account; waitlisted can drop', async () => {
  const ctx = makePortal();
  const admin = await login(ctx, 'admin@resqedu.com');
  const p = await signup(ctx, 'Pat Patient', 'pat@x.com', ['Student / pre-health (patient role)']);
  const SL = 'EMT-2027-01-D04-PM-PAT';
  assert.equal((await ctx.portal.apiRequestSlot(p, SL)).status, 'Pending'); // pending patient volunteers can hold patient slots
  await ctx.portal.apiAdminInstructor(admin, 'pat@x.com', { status: 'Approved' });
  await ctx.portal.apiAdminRequest(admin, reqOf(await ctx.portal.apiGetData(p), SL).id, 'approve');
  assert.equal(reqOf(await ctx.portal.apiGetData(p), SL).status, 'Approved');
  // Fill a 1-opening slot, waitlist, drop from waitlist
  const q = await signup(ctx, 'Quinn Q', 'q@x.com');
  const o = await signup(ctx, 'Oli O', 'o@x.com');
  const W = 'EMT-2027-01-D02-AM-PRI';
  await rejects(ctx.portal.apiRequestSlot(p, W), /not cleared for Primary Instructor/); // patients stay in patient slots
  await ctx.portal.apiRequestSlot(o, W);
  await ctx.portal.apiRequestSlot(q, W);
  const qr = reqOf(await ctx.portal.apiGetData(q), W);
  assert.equal(qr.status, 'Waitlist');
  await ctx.portal.apiDrop(q, qr.id);
  assert.equal(reqOf(await ctx.portal.apiGetData(q), W).status, 'Dropped');
});

test('pay: bulk set by role/block, earnings, mark paid with email toggle', async () => {
  const ctx = makePortal();
  const admin = await login(ctx, 'admin@resqedu.com');
  const n = await ctx.portal.apiAdminBulkPay(admin, 'EMT-2027-01', 'Primary Instructor', 'AM', '400');
  assert.equal(n.updated, 12);
  await ctx.portal.apiAdminBulkPay(admin, 'EMT-2027-01', 'Primary Instructor', 'PM', 350);
  const t = await signup(ctx, 'Lee Lead', 'lee@x.com', ['Paramedic']);
  const payForms = async () => { for (const kind of ['W-9', 'Direct deposit']) await ctx.portal.apiUploadDoc(t, { kind, fileName: 'f.pdf', mime: 'application/pdf', data: 'AAAA' }); };
  await ctx.portal.apiAdminInstructor(admin, 'lee@x.com', { status: 'Approved', roles: ['Primary Instructor'] });
  await ctx.portal.apiAdminAssign(admin, 'EMT-2027-01-D03-AM-PRI', 'lee@x.com');
  await ctx.portal.apiAdminAssign(admin, 'EMT-2027-01-D03-PM-PRI', 'lee@x.com');
  let d = await ctx.portal.apiGetData(t);
  assert.equal(d.earnings.upcoming, 750);
  assert.equal(slot(d, 'EMT-2027-01-D05-PM-PRI').pay, 350);
  const ad0 = await ctx.portal.apiGetData(admin);
  assert.equal(ad0.admin.requests.find((r) => r.slotId === 'EMT-2027-01-D03-AM-PRI').payrollReady, false);
  await rejects(ctx.portal.apiAdminRequest(admin, reqOf(d, 'EMT-2027-01-D03-AM-PRI').id, 'paid', 425), /W-9 and Direct deposit yet/);
  await payForms();
  await ctx.portal.apiAdminSettings(admin, { 'Email instructor: marked paid': false });
  const before = ctx.mailer.sent.length;
  await ctx.portal.apiAdminRequest(admin, reqOf(d, 'EMT-2027-01-D03-AM-PRI').id, 'paid', 425);
  assert.equal(ctx.mailer.sent.length, before); // turned off
  d = await ctx.portal.apiGetData(t);
  assert.equal(d.earnings.paid, 425);
  assert.equal(d.earnings.upcoming, 350);
  const ad = await ctx.portal.apiGetData(admin);
  assert.equal(ad.admin.settings.find((s) => s.key === 'Email instructor: marked paid').value, 'Off');
  await rejects(ctx.portal.apiAdminBulkPay(t, 'EMT-2027-01', 'Patient', 'All', 5), /Admins only/);
});

test('admin builds and copies courses; roles; uploads', async () => {
  const ctx = makePortal();
  const admin = await login(ctx, 'admin@resqedu.com');
  const c = await ctx.portal.apiAdminCopyCourse(admin, 'EMT-2027-01', 'Accelerated EMT — September 2027', '2027-09-13');
  assert.equal(c.sessions, 23);
  let d = await ctx.portal.apiGetData(admin);
  const sep = d.courses.find((x) => x.id === c.id);
  assert.equal(sep.status, 'Hidden');
  assert.equal(sep.sessions[0].date, '2027-09-13');
  assert.equal(sep.sessions.find((s) => s.day === 7).date, '2027-09-20'); // Sunday still skipped
  await ctx.portal.apiAdminSaveCourse(admin, { id: c.id, status: 'Open' });
  const s = await ctx.portal.apiAdminSaveSession(admin, { courseId: c.id, date: '2027-09-25', block: 'AM', start: '800', end: '1200', topic: 'Bonus skills day' });
  const sl = await ctx.portal.apiAdminSaveSlot(admin, { sessionId: s.id, role: 'Guest Lecturer', openings: 1, pay: 150, notes: 'Teach airway' });
  d = await ctx.portal.apiGetData(admin);
  const bonus = d.courses.find((x) => x.id === c.id).sessions.find((x) => x.id === s.id);
  assert.equal(bonus.start, '0800');
  assert.equal(bonus.slots[0].pay, 150);
  await ctx.portal.apiAdminSaveRole(admin, { name: 'Moulage Tech', description: 'Makeup', requirements: 'None' });
  await rejects(ctx.portal.apiAdminSaveRole(admin, { name: 'moulage tech' }), /already exists/);
  // uploads
  const t = await signup(ctx, 'Uma Up', 'uma@x.com');
  await rejects(ctx.portal.apiUploadCert(t, { credential: 'EMT', fileName: 'x.exe', mime: 'application/x-msdownload', data: 'AAAA' }), /PDF or a photo/);
  await ctx.portal.apiUploadCert(t, { credential: 'EMT', expires: '2028-03-31', fileName: 'card.jpg', mime: 'image/jpeg', data: 'data:image/jpeg;base64,AAAA' });
  await ctx.portal.apiUploadCert(t, { credential: 'CPR', fileName: 'cpr.pdf', mime: 'application/pdf', data: 'AAAA' });
  assert.equal(ctx.files.made.filter((m) => m.folder).length, 1); // folder reused
  d = await ctx.portal.apiGetData(admin);
  const uma = d.admin.instructors.find((i) => i.email === 'uma@x.com');
  assert.equal(uma.certs.length, 2);
  assert.match(uma.folder, /folders\/F1/);
  void sl;
});

test('declining an account releases holds; reminders go out once', async () => {
  const ctx = makePortal();
  const admin = await login(ctx, 'admin@resqedu.com');
  const a = await signup(ctx, 'Al A', 'al@x.com');
  const b = await signup(ctx, 'Bo B', 'bo@x.com');
  const SL = 'EMT-2027-01-D06-AM-PRI';
  await ctx.portal.apiRequestSlot(a, SL);
  await ctx.portal.apiRequestSlot(b, SL);
  await ctx.portal.apiAdminInstructor(admin, 'al@x.com', { status: 'Declined' });
  await rejects(ctx.portal.apiGetData(a), /session/);
  assert.equal(reqOf(await ctx.portal.apiGetData(b), SL).status, 'Pending');
  // reminder: move a session to tomorrow
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  const tmr = new Date(Date.parse(today + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  await ctx.portal.apiAdminSaveSession(admin, { id: 'EMT-2027-01-D06-AM', date: tmr });
  await ctx.portal.apiAdminInstructor(admin, 'bo@x.com', { status: 'Approved', roles: ['Primary Instructor'] });
  await ctx.portal.apiAdminRequest(admin, reqOf(await ctx.portal.apiGetData(b), SL).id, 'approve');
  assert.equal((await ctx.portal.runReminders()).sent, 1);
  assert.equal((await ctx.portal.runReminders()).sent, 0);
  assert.ok(ctx.mailer.sent.some((m) => m.to === 'bo@x.com' && /^Reminder/.test(m.subject)));
});

test('application checklist, private pay forms, patient track', async () => {
  const ctx = makePortal();
  const admin = await login(ctx, 'admin@resqedu.com');
  const t = await signup(ctx, 'Ivy Inst', 'ivy@x.com');
  let d = await ctx.portal.apiGetData(t);
  assert.equal(d.me.application.licenses.mnEms, '123456');
  assert.equal(d.me.application.licenses.mnEmsExp, '2028-03-31');
  assert.equal(d.me.application.refs[1].email, 'r2@x.com');
  assert.deepEqual(d.me.checklist.missing, ['Cert card', 'Resume']);
  assert.deepEqual(d.me.checklist.payroll.missing, ['W-9', 'Direct deposit']);
  await ctx.portal.apiUploadDoc(t, { kind: 'Cert card', credential: 'EMT', fileName: 'c.jpg', mime: 'image/jpeg', data: 'AAAA' });
  await rejects(ctx.portal.apiUploadDoc(t, { kind: 'Resume', fileName: 'r.jpg', mime: 'image/jpeg', data: 'AAAA' }), /PDF or Word/);
  await ctx.portal.apiUploadDoc(t, { kind: 'Resume', fileName: 'r.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data: 'AAAA' });
  d = await ctx.portal.apiGetData(t);
  assert.equal(d.me.checklist.complete, true); // payroll forms aren't needed to apply
  assert.equal(d.me.checklist.payroll.complete, false);
  const nBefore = ctx.mailer.sent.length;
  await ctx.portal.apiUploadDoc(t, { kind: 'W-9', fileName: 'w9.pdf', mime: 'application/pdf', data: 'AAAA' });
  const conf = ctx.mailer.sent.slice(nBefore).find((m) => m.to === 'ivy@x.com');
  assert.match(conf.subject, /W-9 form was uploaded/); assert.match(conf.html, /If you didn't/);
  await ctx.portal.apiUploadDoc(t, { kind: 'Direct deposit', fileName: 'dd.pdf', mime: 'application/pdf', data: 'AAAA' });
  // pay forms go to the private folder, never get a link
  const priv = ctx.files.made.filter((m) => m.folderId === 'PRIV');
  assert.equal(priv.length, 2);
  const certRows = ctx.tabs.Certs.slice(1);
  for (const r of certRows.filter((r) => r[7] === 'W-9' || r[7] === 'Direct deposit')) { assert.equal(r[5], ''); assert.equal(r[6], ''); }
  d = await ctx.portal.apiGetData(t);
  assert.equal(d.me.checklist.payroll.complete, true);
  const ad = await ctx.portal.apiGetData(admin);
  const ivy = ad.admin.instructors.find((i) => i.email === 'ivy@x.com');
  assert.equal(ivy.checklist.complete, true);
  assert.ok(ivy.certs.filter((c) => c.kind === 'W-9').every((c) => !c.link && !c.fileName));
  // editing the application keeps one row
  await ctx.portal.apiSaveApplication(t, fullApp('Ivy Inst', 'ignored@x.com', ['EMT', 'Paramedic'], { years: '7' }));
  assert.equal(ctx.tabs.Applications.length, 2);
  d = await ctx.portal.apiGetData(t);
  assert.equal(d.me.application.years, '7');
  assert.deepEqual(d.me.credentials, ['EMT', 'Paramedic']);
  // patient track needs only agreements
  const p = await signup(ctx, 'Pat Patient', 'pat@x.com', ['Student / pre-health (patient role)']);
  d = await ctx.portal.apiGetData(p);
  assert.equal(d.me.checklist.track, 'Patient');
  assert.equal(d.me.checklist.complete, true);
  await rejects(ctx.portal.apiSignup({ track: 'Patient', name: 'No Waiver', email: 'nw@x.com', phone: '1', emergencyName: 'A', emergencyPhone: '2', agreed: [] }), /Read and check/);
});

test('staffing follows enrollment: preview, apply, overstaffing kept', async () => {
  const ctx = makePortal();
  const admin = await login(ctx, 'admin@resqedu.com');
  let r = await ctx.portal.apiAdminStaffing(admin, 'EMT-2027-01', 12, false);
  const find = (id) => r.changes.find((c) => c.slotId === id);
  assert.equal(find('EMT-2027-01-D04-PM-AST').to, 4);
  assert.equal(find('EMT-2027-01-D09-AM-PAT').to, 12);
  assert.equal(find('EMT-2027-01-D01-PM-AST').to, 2); // 4 per ratio minus 2 BLS instructors
  assert.equal(find('EMT-2027-01-D11-PM-EVAL'), undefined); // 6 stays 6
  assert.equal(r.applied, false);
  let d = await ctx.portal.apiGetData(admin);
  assert.equal(slot(d, 'EMT-2027-01-D04-PM-AST').openings, 3); // preview didn't write
  r = await ctx.portal.apiAdminStaffing(admin, 'EMT-2027-01', 13, true);
  d = await ctx.portal.apiGetData(admin);
  assert.equal(slot(d, 'EMT-2027-01-D04-PM-AST').openings, 5);
  assert.equal(slot(d, 'EMT-2027-01-D01-PM-BLS').openings, 3);
  assert.equal(slot(d, 'EMT-2027-01-D01-PM-AST').openings, 2);
  assert.equal(slot(d, 'EMT-2027-01-D10-AM-MED').openings, 6); // fixed
  assert.equal(d.courses.find((c) => c.id === 'EMT-2027-01').students, 13);
  // fill 5 assistants on a block, then drop enrollment: nobody removed, flagged over
  const emails = ['a1', 'a2', 'a3', 'a4', 'a5'];
  for (const e of emails) { const tk = await signup(ctx, 'Asst ' + e.toUpperCase(), e + '@x.com'); await ctx.portal.apiRequestSlot(tk, 'EMT-2027-01-D04-PM-AST'); }
  r = await ctx.portal.apiAdminStaffing(admin, 'EMT-2027-01', 7, true);
  assert.ok(r.over.some((o) => o.slotId === 'EMT-2027-01-D04-PM-AST' && o.held === 5 && o.to === 3));
  d = await ctx.portal.apiGetData(admin);
  const s4 = slot(d, 'EMT-2027-01-D04-PM-AST');
  assert.equal(s4.openings, 3); assert.equal(s4.over, 2); assert.equal(s4.people.length, 5);
  assert.equal(slot(d, 'EMT-2027-01-D11-PM-EVAL').openings, 4); // 8 or fewer -> 4
  // growing again promotes the waitlist
  const w = await signup(ctx, 'Wait Ling', 'w@x.com');
  assert.equal((await ctx.portal.apiRequestSlot(w, 'EMT-2027-01-D05-PM-AST')).status, 'Pending');
  await rejects(ctx.portal.apiAdminStaffing(admin, 'EMT-2027-01', 0, false), /number of students/);
});

test('opening alerts, digests and the manage-settings link', async () => {
  const ctx = makePortal();
  const admin = await login(ctx, 'admin@resqedu.com');
  const a = await signup(ctx, 'Ann Assist', 'ann@x.com'); // wants Assistant Instructor, default alerts: New course
  const p = await signup(ctx, 'Pat Patient', 'pat@x.com', ['Student / pre-health (patient role)']);
  const ad = await ctx.portal.apiGetData(admin);
  assert.deepEqual(ad.admin.instructors.find((i) => i.email === 'ann@x.com').prefs, { alerts: ['New course'], digest: 'Off', reminders: true });
  // every instructor email carries a working manage link
  const mail = ctx.mailer.sent.filter((m) => m.to === 'ann@x.com').pop();
  assert.doesNotMatch(mail.html, /<a /); // no links for Brevo to rewrite
  const link = /\?manage=([^<\s]+)/.exec(mail.html);
  assert.ok(link, 'manage link present');
  const t = decodeURIComponent(link[1]);
  assert.equal((await ctx.portal.apiPrefsGet(t)).email, 'ann@x.com');
  await rejects(ctx.portal.apiPrefsGet(t.slice(0, -2) + 'xx'), /isn't valid/);
  assert.ok(!ctx.mailer.sent.filter((m) => m.to === 'admin@resqedu.com').some((m) => /manage=/.test(m.html)));
  // copy a course (hidden), open it -> New course alert to both, each with only their roles
  const c = await ctx.portal.apiAdminCopyCourse(admin, 'EMT-2027-01', 'Accelerated EMT — Sept 2027', '2027-09-13');
  let before = ctx.mailer.sent.length;
  const res = await ctx.portal.apiAdminSaveCourse(admin, { id: c.id, status: 'Open' });
  assert.equal(res.alerted, 2);
  const newMail = ctx.mailer.sent.slice(before);
  const annMail = newMail.find((m) => m.to === 'ann@x.com'), patMail = newMail.find((m) => m.to === 'pat@x.com');
  assert.match(annMail.subject, /New ResQ course open for sign-up: Accelerated EMT — Sept 2027/);
  assert.match(annMail.html, /Assistant Instructor/); assert.doesNotMatch(annMail.html, /<b>Patient<\/b>/);
  assert.match(patMail.html, /<b>Patient<\/b>/); assert.doesNotMatch(patMail.html, /Assistant Instructor/);
  // Ann opts into openings-added + weekly digest via the link; Pat turns alerts off
  await ctx.portal.apiPrefsSave(t, { alerts: ['Openings added', 'Near-term openings'], digest: 'Weekly', reminders: false });
  const pt = decodeURIComponent(/\?manage=([^<\s]+)/.exec(patMail.html)[1]);
  await ctx.portal.apiPrefsSave(pt, { alerts: [], digest: 'Off' });
  before = ctx.mailer.sent.length;
  await ctx.portal.apiAdminStaffing(admin, 'EMT-2027-01', 13, true);
  let out = ctx.mailer.sent.slice(before);
  assert.equal(out.filter((m) => m.to === 'ann@x.com' && /More openings added/.test(m.subject)).length, 1);
  assert.equal(out.filter((m) => m.to === 'pat@x.com').length, 0);
  // digest goes once, then waits a week
  assert.equal((await ctx.portal.runDigests()).sent, 1);
  assert.equal((await ctx.portal.runDigests()).sent, 0);
  await ctx.portal.apiAdminSettings(admin, { 'Email instructors: open-slot digests': false });
  // near-term: a dropped slot within 14 days alerts others, not the person who dropped
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  const soon = new Date(Date.parse(today + 'T00:00:00Z') + 5 * 86400000).toISOString().slice(0, 10);
  await ctx.portal.apiAdminSaveSession(admin, { id: 'EMT-2027-01-D02-PM', date: soon });
  const b = await signup(ctx, 'Bo Bee', 'bo@x.com');
  await ctx.portal.apiRequestSlot(b, 'EMT-2027-01-D02-PM-AST');
  const bReq = (await ctx.portal.apiGetData(b)).requests.find((r) => r.slotId === 'EMT-2027-01-D02-PM-AST');
  before = ctx.mailer.sent.length;
  await ctx.portal.apiDrop(b, bReq.id);
  out = ctx.mailer.sent.slice(before);
  assert.ok(out.some((m) => m.to === 'ann@x.com' && /Short-notice opening/.test(m.subject)));
  assert.ok(!out.some((m) => m.to === 'bo@x.com' && /Short-notice/.test(m.subject)));
  // logged-in save + personal reminder opt-out respected
  await ctx.portal.apiSaveMyPrefs(a, { alerts: ['New course'], digest: 'Monthly', reminders: true });
  assert.deepEqual((await ctx.portal.apiGetData(a)).me.prefs, { alerts: ['New course'], digest: 'Monthly', reminders: true });
});

test('a patient can apply to instruct, keeps patient access, and gets approved or declined', async () => {
  const ctx = makePortal();
  const admin = await login(ctx, 'admin@resqedu.com');
  const p = await signup(ctx, 'Pat Patient', 'pat@x.com', ['Student / pre-health (patient role)']);
  await ctx.portal.apiAdminInstructor(admin, 'pat@x.com', { status: 'Approved' });
  await rejects(ctx.portal.apiSaveApplication(p, fullApp('Pat Patient', 'pat@x.com')), /Apply to be an instructor/);
  await rejects(ctx.portal.apiApplyInstructor(p, fullApp('Pat Patient', 'pat@x.com', ['EMT'], { refs: [] })), /two professional references/);
  await ctx.portal.apiApplyInstructor(p, fullApp('Pat Patient', 'pat@x.com', ['EMT']));
  assert.ok(ctx.mailer.sent.some((m) => m.to === 'admin@resqedu.com' && /Instructor application from a patient/.test(m.subject)));
  let d = await ctx.portal.apiGetData(p);
  assert.equal(d.me.application.track, 'Instructor');
  assert.equal(d.me.application.upgrade.status, 'Pending');
  // still a patient meanwhile, not an instructor yet
  assert.equal((await ctx.portal.apiRequestSlot(p, 'EMT-2027-01-D04-PM-PAT')).status, 'Pending');
  await rejects(ctx.portal.apiRequestSlot(p, 'EMT-2027-01-D05-PM-AST'), /not cleared/);
  await rejects(ctx.portal.apiAdminInstructor(admin, 'pat@x.com', { roles: [], upgrade: 'Approved' }), /Tick at least one instructor role/);
  await ctx.portal.apiAdminInstructor(admin, 'pat@x.com', { roles: ['Assistant Instructor'], upgrade: 'Approved' });
  assert.ok(ctx.mailer.sent.some((m) => m.to === 'pat@x.com' && /approved to teach/.test(m.subject) && /Assistant Instructor/.test(m.html)));
  assert.equal((await ctx.portal.apiRequestSlot(p, 'EMT-2027-01-D05-PM-AST')).status, 'Pending');
  d = await ctx.portal.apiGetData(admin);
  assert.equal(d.admin.instructors.find((i) => i.email === 'pat@x.com').application.upgrade.status, 'Approved');
  // a pending patient applicant who applies to instruct, then is declined, goes back to the patient track
  const q = await signup(ctx, 'Quin Patient', 'quin@x.com', ['Student / pre-health (patient role)']);
  await ctx.portal.apiApplyInstructor(q, fullApp('Quin Patient', 'quin@x.com', ['EMR']));
  assert.equal((await ctx.portal.apiRequestSlot(q, 'EMT-2027-01-D06-PM-PAT')).status, 'Pending'); // pending, but kept patient access
  await ctx.portal.apiAdminInstructor(admin, 'quin@x.com', { upgrade: 'Declined' });
  d = await ctx.portal.apiGetData(q);
  assert.equal(d.me.application.track, 'Patient');
  assert.equal(d.me.application.upgrade.status, 'Declined');
  assert.ok(ctx.mailer.sent.some((m) => m.to === 'quin@x.com' && /still on our patient list/.test(m.html)));
});
