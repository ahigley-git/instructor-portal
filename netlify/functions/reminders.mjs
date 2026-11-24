// Scheduled Function: sends session reminders and open-slot digests once a day (8:15 a.m. Central in winter, 9:15 in summer).
import { build } from '../../lib/wire.mjs';

export default async () => {
  try {
    const portal = build();
    const r = await portal.runReminders();
    const d = await portal.runDigests();
    console.log('reminders sent:', r.sent, 'digests sent:', d.sent);
  } catch (e) { console.error('reminders failed', e); }
};

export const config = { schedule: '15 14 * * *' };
