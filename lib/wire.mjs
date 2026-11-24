// Wires the portal to Google, Brevo and Netlify Blobs using the site's environment variables.
import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { createPortal } from './core.mjs';
import { createSheetStore, createDriveFiles, readServiceAccount } from './google.mjs';
import { createBrevoMailer } from './brevo.mjs';

const env = (k, d = '') => (process.env[k] ?? d);
export const DEFAULT_ADMINS = 'admin@resqedu.com,ryan.kelly@resqedu.com,matt.shen@resqedu.com';

function blobKv() {
  const s = getStore({ name: 'instructor-auth', consistency: 'strong' });
  return { get: (k) => s.get(k, { type: 'json' }), set: (k, v) => s.setJSON(k, v), del: (k) => s.delete(k) };
}

export function build() {
  const sa = readServiceAccount(process.env);
  if (!sa.email || !sa.key) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_JSON setting in Netlify.');
    if (!env('BREVO_API_KEY')) throw new Error('Missing BREVO_API_KEY setting in Netlify.');
  const replyTo = env('REPLY_TO', 'admin@resqedu.com');
  return createPortal({
    store: createSheetStore({ sheetId: env('SHEET_ID', '1oSNkwgYKb9A8tBCXjGNsA2rtxwn9MUYCRBxpL7kTB0Q'), serviceAccount: sa }),
    files: createDriveFiles({ serviceAccount: sa }),
    mailer: createBrevoMailer({ apiKey: env('BREVO_API_KEY'), senderEmail: env('SENDER_EMAIL', 'marketing@resqedu.com'), senderName: 'ResQ Education', replyTo }),
    kv: blobKv(),
    cfg: {
      secret: env('SESSION_SECRET') || crypto.createHash('sha256').update('resq-instructors|' + sa.key).digest('hex'),
      adminEmails: env('ADMIN_EMAILS', DEFAULT_ADMINS).split(',').map((s) => s.trim()).filter(Boolean),
      replyTo,
      certFolderId: env('CERT_FOLDER_ID', '1lYNMidP9jEl7OOlBN_YmMBCOQ5TjDsfD'),
      privateFolderId: env('PRIVATE_FOLDER_ID', '1GfTzg3PZqvkokyNnk1Jp8ZC8axkaWri-'),
      siteUrl: env('SITE_URL', 'https://instructors.resqedu.com')
    }
  });
}
