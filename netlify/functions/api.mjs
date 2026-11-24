// Netlify Function: every portal request goes to /api/<action>.
import { ACTIONS } from '../../lib/core.mjs';
import { build } from '../../lib/wire.mjs';

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

export default async (req, context) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
  const action = context.params && context.params.action;
  if (!ACTIONS.includes(action)) return json({ ok: false, error: 'Unknown action' }, 404);
  let body;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'Bad request' }, 400); }
  const args = Array.isArray(body && body.args) ? body.args.slice(0, 5) : [];
  try {
    const portal = build();
    const data = await portal[action](...args);
    return json({ ok: true, data });
  } catch (e) {
    if (e && e.expected) return json({ ok: false, error: e.message, session: e.session });
    console.error(action, e);
    return json({ ok: false, error: 'Something went wrong on our end. Try again in a minute.' });
  }
};

export const config = { path: '/api/:action' };
