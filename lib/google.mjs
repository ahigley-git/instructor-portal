// Google Sheets and Google Drive access with a service account (no Google libraries needed).
import crypto from 'node:crypto';

let cached = { token: null, exp: 0 };
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive';

export function readServiceAccount(env) {
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    let raw = String(env.GOOGLE_SERVICE_ACCOUNT_JSON).trim();
    // Also accepts the key file as base64, for hosts that reject special characters.
    if (!raw.startsWith('{')) raw = Buffer.from(raw.replace(/\s+/g, ''), 'base64').toString('utf8');
    const j = JSON.parse(raw);
    return { email: j.client_email, key: j.private_key };
  }
  return { email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL, key: String(env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n') };
}

async function accessToken(sa) {
  if (cached.token && cached.exp > Date.now() + 60000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = enc({ alg: 'RS256', typ: 'JWT' }) + '.' + enc({ iss: sa.email, scope: SCOPES, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + sig })
  });
  const j = await res.json();
  if (!res.ok) throw new Error('Google sign-in failed: ' + (j.error_description || j.error || res.status));
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return cached.token;
}

const colLetter = (n) => { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const q = (tab) => "'" + tab.replace(/'/g, "''") + "'";
const DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{4}( \d{1,2}:\d{2})?$/;
// Written with USER_ENTERED so dates become real dates; all other text is forced
// to plain text so nothing a person types can be read as a formula.
const cellValue = (v) => (typeof v === 'string' && v !== '' && !DATE_RE.test(v) ? "'" + v : v);

export function createSheetStore({ sheetId, serviceAccount }) {
  const base = 'https://sheets.googleapis.com/v4/spreadsheets/' + sheetId;
  const headerCache = new Map();

  async function call(path, opts = {}) {
    const token = await accessToken(serviceAccount);
    const res = await fetch(base + path, { ...opts, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('Google Sheets error ' + res.status + ': ' + ((j.error && j.error.message) || ''));
    return j;
  }

  async function readTabs(names) {
    const params = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' });
    for (const n of names) params.append('ranges', q(n));
    const j = await call('/values:batchGet?' + params.toString());
    const out = {};
    (j.valueRanges || []).forEach((vr, i) => {
      out[names[i]] = vr.values || [];
      if (vr.values && vr.values[0]) headerCache.set(names[i], vr.values[0].map((h) => String(h).trim()));
    });
    return out;
  }

  async function headers(tab) {
    if (!headerCache.has(tab)) {
      const j = await call('/values/' + encodeURIComponent(q(tab) + '!1:1'));
      headerCache.set(tab, ((j.values && j.values[0]) || []).map((h) => String(h).trim()));
    }
    return headerCache.get(tab);
  }

  // updates: [{ row, values: { header: value } }] — one API call
  async function updateRows(tab, updates) {
    const head = await headers(tab);
    const data = [];
    for (const u of updates) for (const [k, v] of Object.entries(u.values)) {
      const c = head.indexOf(k);
      if (c < 0) throw new Error('Column "' + k + '" is missing on the ' + tab + ' tab.');
      data.push({ range: q(tab) + '!' + colLetter(c) + u.row, values: [[cellValue(v)]] });
    }
    if (data.length) await call('/values:batchUpdate', { method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }) });
  }

  async function appendRows(tab, objs) {
    const head = await headers(tab);
    const values = objs.map((o) => head.map((h) => (o[h] === undefined ? '' : cellValue(o[h]))));
    await call('/values/' + encodeURIComponent(q(tab) + '!A1') + ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS',
      { method: 'POST', body: JSON.stringify({ values }) });
  }

  return { readTabs, updateRows, appendRows, url: 'https://docs.google.com/spreadsheets/d/' + sheetId };
}

// Cert uploads go to a Google Drive folder (shared drives supported).
export function createDriveFiles({ serviceAccount }) {
  const API = 'https://www.googleapis.com/drive/v3/files';
  async function call(url, opts = {}) {
    const token = await accessToken(serviceAccount);
    const res = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('Google Drive error ' + res.status + ': ' + ((j.error && j.error.message) || ''));
    return j;
  }
  return {
    async ensureFolder(parentId, name) {
      const qs = "'" + parentId + "' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false and name='" + name.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
      const found = await call(API + '?' + new URLSearchParams({ q: qs, fields: 'files(id)', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' }));
      let id = found.files && found.files[0] && found.files[0].id;
      if (!id) {
        const made = await call(API + '?supportsAllDrives=true&fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }) });
        id = made.id;
      }
      return { id, url: 'https://drive.google.com/drive/folders/' + id };
    },
    async upload({ folderId, name, mime, base64 }) {
      const boundary = 'resq' + crypto.randomBytes(8).toString('hex');
      const meta = JSON.stringify({ name, parents: [folderId] });
      const body = Buffer.concat([
        Buffer.from('--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta + '\r\n--' + boundary + '\r\nContent-Type: ' + mime + '\r\n\r\n'),
        Buffer.from(base64, 'base64'),
        Buffer.from('\r\n--' + boundary + '--')
      ]);
      const j = await call('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink',
        { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body });
      return { id: j.id, url: j.webViewLink || 'https://drive.google.com/file/d/' + j.id + '/view' };
    }
  };
}
