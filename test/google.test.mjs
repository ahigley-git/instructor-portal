import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createSheetStore, createDriveFiles } from '../lib/google.mjs';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const sa = { email: 'svc@x.iam.gserviceaccount.com', key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };

function mockFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    if (String(url).includes('oauth2')) return new Response(JSON.stringify({ access_token: 'T', expires_in: 3600 }));
    return new Response(JSON.stringify(handler(String(url), opts)), { status: 200 });
  };
  return calls;
}

test('sheet store: batch reads, row updates and appends', async () => {
  const calls = mockFetch((url) => {
    if (url.includes('batchGet')) return { valueRanges: [{ values: [['Request ID', 'Status', 'Note']] }] };
    if (url.includes('!1%3A1')) return { values: [['Request ID', 'Status', 'Note']] };
    return {};
  });
  const s = createSheetStore({ sheetId: 'SID', serviceAccount: sa });
  const t = await s.readTabs(['Requests']);
  assert.equal(t.Requests[0][1], 'Status');
  await s.updateRows('Requests', [{ row: 5, values: { 'Status': 'Approved', 'Note': '=HACK()' } }, { row: 6, values: { 'Status': 'Dropped' } }]);
  const up = calls.find((c) => c.url.endsWith('/values:batchUpdate'));
  const body = JSON.parse(up.opts.body);
  assert.deepEqual(body.data.map((d) => d.range), ["'Requests'!B5", "'Requests'!C5", "'Requests'!B6"]);
  assert.equal(body.data[1].values[0][0], "'=HACK()"); // never a formula
  await s.appendRows('Requests', [{ 'Request ID': 'R1', 'Status': 'Pending' }, { 'Request ID': 'R2' }]);
  const ap = calls.find((c) => c.url.includes(':append'));
  assert.deepEqual(JSON.parse(ap.opts.body).values, [["'R1", "'Pending", ''], ["'R2", '', '']]);
  await assert.rejects(s.updateRows('Requests', [{ row: 2, values: { 'Nope': 1 } }]), /missing/);
});

test('drive: reuses an existing folder, uploads multipart to shared drives', async () => {
  const calls = mockFetch((url) => {
    if (url.includes('/drive/v3/files?') && url.includes('q=')) return { files: [{ id: 'EXIST' }] };
    if (url.includes('upload/drive')) return { id: 'FILE1', webViewLink: 'https://drive.google.com/file/d/FILE1/view' };
    return { id: 'NEW' };
  });
  const d = createDriveFiles({ serviceAccount: sa });
  const f = await d.ensureFolder('ROOT', "Pat O'Neil (pat@x.com)");
  assert.equal(f.id, 'EXIST');
  assert.match(decodeURIComponent(calls[calls.length - 1].url.replace(/\+/g, ' ')), /name='Pat O\\'Neil/);
  const up = await d.upload({ folderId: 'EXIST', name: 'EMT.pdf', mime: 'application/pdf', base64: Buffer.from('%PDF-1.4').toString('base64') });
  assert.equal(up.id, 'FILE1');
  const c = calls.find((x) => x.url.includes('upload/drive'));
  assert.match(c.url, /supportsAllDrives=true/);
  assert.ok(c.opts.body.toString().includes('%PDF-1.4'));
  assert.match(c.opts.headers['Content-Type'], /multipart\/related; boundary=/);
});
