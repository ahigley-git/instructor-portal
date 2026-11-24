import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

test('function handler routes, validates and hides internal errors', async () => {
  mock.module('@netlify/blobs', { namedExports: { getStore: () => ({ get: async () => null, setJSON: async () => {}, delete: async () => {} }) } });
  const { default: handler, config } = await import('../netlify/functions/api.mjs');
  assert.equal(config.path, '/api/:action');
  const post = (action, body) => handler(new Request('https://x/api/' + action, { method: 'POST', body: JSON.stringify(body) }), { params: { action } });
  let r = await handler(new Request('https://x/api/apiGetData'), { params: { action: 'apiGetData' } });
  assert.equal(r.status, 405);
  r = await post('runReminders', { args: [] });
  assert.equal(r.status, 404); // scheduled-only action is not public
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const origErr = console.error; console.error = () => {};
  r = await post('apiRequestCode', { args: ['a@b.com'] });
  console.error = origErr;
  const j = await r.json();
  assert.equal(j.ok, false);
  assert.match(j.error, /Something went wrong/);
  const rem = await import('../netlify/functions/reminders.mjs');
  assert.match(rem.config.schedule, /\* \* \*$/);
});
