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
async function signup(ctx, name, email, creds = ['EMT']) {
  clearRl(ctx);
  await ctx.portal.apiSignup({ name, email, phone: '651-555-0100', credentials: creds });
  return (await ctx.portal.apiVerifyCode(email, lastCode(ctx.mailer, email))).token;
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
  await rejects(ctx.portal.apiSignup({ name: 'Jo', email: 'jo@x.com', phone: '1', credentials: ['EMT'] }), /first and last/);
  await rejects(ctx.portal.apiSignup({ name: 'Jo Smith', email: 'jo@x.com', phone: '1', credentials: [] }), /certification/);
  const t = await signup(ctx, 'Jo Smith', 'Jo@X.com');
  assert.ok(ctx.mailer.sent.some((m) => m.to === 'admin@resqedu.com' && /New instructor signup/.test(m.subject)));
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
  const a = await signup(ctx, 'Amy Able', 'amy@x.com');
  const b = await signup(ctx, 'Ben Baker', 'ben@x.com');
  const SL = 'EMT-2027-01-D01-AM-PRI'; // 1 opening
  // Pending account can hold a slot
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
  // Approval needs approved account + role
  const amyReq = reqOf(await ctx.portal.apiGetData(a), SL).id;
  await rejects(ctx.portal.apiAdminRequest(admin, amyReq, 'approve'), /account first/);
  await ctx.portal.apiAdminInstructor(admin, 'amy@x.com', { status: 'Approved', roles: [] });
  assert.ok(ctx.mailer.sent.some((m) => m.to === 'amy@x.com' && /approved to teach/.test(m.subject)));
  await rejects(ctx.portal.apiAdminRequest(admin, amyReq, 'approve'), /qualified/);
  await ctx.portal.apiAdminInstructor(admin, 'amy@x.com', { roles: ['Primary Instructor', 'Not a role'] });
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
  await ctx.portal.apiRequestSlot(p, SL);
  await ctx.portal.apiAdminInstructor(admin, 'pat@x.com', { status: 'Approved' });
  await ctx.portal.apiAdminRequest(admin, reqOf(await ctx.portal.apiGetData(p), SL).id, 'approve');
  assert.equal(reqOf(await ctx.portal.apiGetData(p), SL).status, 'Approved');
  // Fill a 1-opening slot, waitlist, drop from waitlist
  const q = await signup(ctx, 'Quinn Q', 'q@x.com');
  const W = 'EMT-2027-01-D02-AM-PRI';
  await ctx.portal.apiRequestSlot(p, W);
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
  await ctx.portal.apiAdminInstructor(admin, 'lee@x.com', { status: 'Approved', roles: ['Primary Instructor'] });
  await ctx.portal.apiAdminAssign(admin, 'EMT-2027-01-D03-AM-PRI', 'lee@x.com');
  await ctx.portal.apiAdminAssign(admin, 'EMT-2027-01-D03-PM-PRI', 'lee@x.com');
  let d = await ctx.portal.apiGetData(t);
  assert.equal(d.earnings.upcoming, 750);
  assert.equal(slot(d, 'EMT-2027-01-D05-PM-PRI').pay, 350);
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
