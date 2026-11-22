// Email + SMS provider adapters. "outbox" stores messages in the database (visible at /dev/mailbox
// when ENABLE_DEV_TOOLS is on). Real providers are called over HTTPS with credentials from env.
import { config, brand } from '../config.js';
import { q } from '../db.js';

async function viaOutbox(channel, recipient, subject, body, provider = 'outbox', status = 'queued', error = null) {
  q.run('INSERT INTO outbox (channel, recipient, subject, body, provider, status, error) VALUES (?,?,?,?,?,?,?)',
    channel, recipient, subject, body, provider, status, error);
}

export async function sendEmail(to, subject, text, html) {
  if (config.email.provider === 'resend' && config.email.resendKey) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.email.resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: config.email.from, to, subject, text, html: html || undefined }),
      });
      await viaOutbox('email', to, subject, text, 'resend', r.ok ? 'sent' : 'failed', r.ok ? null : await r.text());
      return r.ok;
    } catch (e) {
      await viaOutbox('email', to, subject, text, 'resend', 'failed', e.message);
      return false;
    }
  }
  await viaOutbox('email', to, subject, text);
  return true;
}

export async function sendSms(to, text) {
  const s = config.sms;
  if (s.provider === 'twilio' && s.twilioSid && s.twilioToken) {
    try {
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${s.twilioSid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${s.twilioSid}:${s.twilioToken}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: to, From: s.twilioFrom, Body: text }),
      });
      await viaOutbox('sms', to, null, text, 'twilio', r.ok ? 'sent' : 'failed', r.ok ? null : await r.text());
      return r.ok;
    } catch (e) {
      await viaOutbox('sms', to, null, text, 'twilio', 'failed', e.message);
      return false;
    }
  }
  await viaOutbox('sms', to, null, text);
  return true;
}

export const emailLayout = (heading, lines, cta) =>
  [`${brand.name} — ${brand.tagline}`, '', heading, '', ...lines, cta ? `\n${cta.label}: ${cta.url}` : '', '', `— Team ${brand.name}`].join('\n');
