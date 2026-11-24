// Sends email through Brevo's transactional API.
export function createBrevoMailer({ apiKey, senderEmail, senderName, replyTo }) {
  return {
    async send({ to, subject, html }) {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          sender: { email: senderEmail, name: senderName },
          to: [{ email: to }],
          replyTo: replyTo ? { email: replyTo } : undefined,
          subject,
          htmlContent: html
        })
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        let msg = t;
        try { const j = JSON.parse(t); msg = j.message || j.code || t; } catch {}
        const err = new Error('Brevo email failed (' + res.status + '): ' + String(msg).slice(0, 200));
        err.brevo = { status: res.status, message: String(msg).slice(0, 120) };
        throw err;
      }
    }
  };
}
