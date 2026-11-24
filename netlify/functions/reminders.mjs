// Scheduled Function: sends session reminders once a day (8:15 a.m. Central in winter, 9:15 in summer).
import { build } from '../../lib/wire.mjs';

export default async () => {
  try {
    const r = await build().runReminders();
    console.log('reminders sent:', r.sent);
  } catch (e) { console.error('reminders failed', e); }
};

export const config = { schedule: '15 14 * * *' };
