import { z } from 'zod';
import { q, tx } from '../db.js';
import { config } from '../config.js';
import { bad, unauthorized, conflict, validate, rateLimit, cookie, HttpError } from '../lib/http.js';
import { hashPassword, verifyPassword, randomToken, sha256, otp, normalizePhone, permissionsFor, cleanText } from '../lib/security.js';
import { sendEmail, sendSms, emailLayout } from '../providers/messaging.js';
import { audit, notify } from '../lib/services.js';
import { isOnline } from '../lib/realtime.js';

const SID = 'pasal_sid';
const addMinutes = (m) => new Date(Date.now() + m * 60_000).toISOString().replace('T', ' ').slice(0, 19);
const nowSql = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

export function resolveSession(token) {
  if (!token) return null;
  const row = q.get(
    `SELECT u.*, s.id AS session_id FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > datetime('now') AND u.status = 'active'`, sha256(token));
  return row || null;
}

export function touchSession(user) {
  q.run("UPDATE sessions SET last_used_at = datetime('now') WHERE id = ?", user.session_id);
  q.run("UPDATE users SET last_seen_at = datetime('now') WHERE id = ?", user.id);
}

function startSession(ctx, userId) {
  const token = randomToken(32);
  const expires = new Date(Date.now() + config.sessionDays * 86400_000).toISOString().replace('T', ' ').slice(0, 19);
  q.run('INSERT INTO sessions (id, user_id, ip, user_agent, expires_at) VALUES (?,?,?,?,?)',
    sha256(token), userId, ctx.ip, String(ctx.req.headers['user-agent'] || '').slice(0, 300), expires);
  ctx.setCookie(cookie(SID, token, { maxAge: config.sessionDays * 86400, secure: config.cookieSecure }));
}

export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, name: u.name, avatar_url: u.avatar_url, bio: u.bio,
    seller_status: u.seller_status, country_code: u.country_code, city_id: u.city_id,
    created_at: u.created_at, last_seen_at: u.last_seen_at, online: isOnline(u.id),
  };
}

export function selfUser(u) {
  const city = u.city_id ? q.get('SELECT id, name FROM locations WHERE id = ?', u.city_id) : null;
  return {
    ...publicUser(u), email: u.email, phone: u.phone, role: u.role, city,
    email_verified: !!u.email_verified_at, phone_verified: !!u.phone_verified_at,
    has_password: !!u.password_hash, google_linked: !!u.google_sub,
    permissions: permissionsFor(u.role),
  };
}

async function sendVerification(user) {
  const token = randomToken(24);
  q.run('INSERT INTO auth_tokens (user_id, type, target, token_hash, expires_at) VALUES (?,?,?,?,?)', user.id, 'email_verify', user.email, sha256(token), addMinutes(60 * 24));
  const url = `${config.publicUrl}/verify-email?token=${token}`;
  await sendEmail(user.email, 'Verify your PASAL email', emailLayout(`Hi ${user.name}, confirm your email`, ['Tap the link below to verify your email address. It expires in 24 hours.'], { label: 'Verify email', url }));
}

const pw = z.string().min(8, 'Use at least 8 characters').max(128).refine((s) => /[A-Za-z]/.test(s) && /\d/.test(s), 'Include at least one letter and one number');
const country = z.enum(['IN', 'NP']);

export function register(r) {
  r.get('/api/v1/auth/providers', () => ({ google: !!(config.google.clientId && config.google.clientSecret), email: true, phone: true }));

  r.post('/api/v1/auth/register', async (ctx) => {
    rateLimit(`reg:${ctx.ip}`, 10, 3600_000);
    const b = validate(z.object({ name: z.string().trim().min(2).max(60), email: z.string().trim().email().max(160), password: pw, country: country.default('IN') }), ctx.body);
    if (q.get('SELECT id FROM users WHERE email = ?', b.email)) throw conflict('An account with this email already exists. Try signing in.');
    const hash = await hashPassword(b.password);
    const { id } = q.run('INSERT INTO users (name, email, password_hash, country_code) VALUES (?,?,?,?)', cleanText(b.name, 60), b.email.toLowerCase(), hash, b.country);
    const user = q.get('SELECT * FROM users WHERE id = ?', id);
    await sendVerification(user);
    startSession(ctx, id);
    notify(id, 'system', 'Welcome to PASAL', 'Your account is ready. Verify your email to start selling.', '/settings');
    return { user: selfUser(user) };
  });

  r.post('/api/v1/auth/login', async (ctx) => {
    const b = validate(z.object({ email: z.string().trim().email(), password: z.string().min(1).max(200) }), ctx.body);
    rateLimit(`login:${ctx.ip}`, 20, 15 * 60_000);
    rateLimit(`login:${b.email.toLowerCase()}`, 8, 15 * 60_000);
    const user = q.get('SELECT * FROM users WHERE email = ?', b.email);
    const ok = user && (await verifyPassword(b.password, user.password_hash));
    if (!ok) throw new HttpError(401, 'Email or password is incorrect.');
    if (user.status === 'suspended') throw new HttpError(403, `This account is suspended${user.suspended_reason ? `: ${user.suspended_reason}` : ''}. Contact support.`);
    if (user.status !== 'active') throw new HttpError(401, 'Email or password is incorrect.');
    startSession(ctx, user.id);
    return { user: selfUser(user) };
  });

  r.post('/api/v1/auth/logout', (ctx) => {
    if (ctx.user) q.run('DELETE FROM sessions WHERE id = ?', ctx.user.session_id);
    ctx.setCookie(cookie(SID, '', { maxAge: 0, secure: config.cookieSecure }));
    return { ok: true };
  });

  r.get('/api/v1/auth/me', (ctx) => {
    if (!ctx.user) return { user: null };
    const u = ctx.user;
    const unreadNotifications = q.val('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL', u.id);
    const unreadMessages = q.val(
      `SELECT COUNT(*) FROM conversations c WHERE (c.buyer_id = ? AND (c.buyer_read_at IS NULL OR c.buyer_read_at < c.last_message_at)
        AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.sender_id != ?))
        OR (c.seller_id = ? AND (c.seller_read_at IS NULL OR c.seller_read_at < c.last_message_at)
        AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.sender_id != ?))`, u.id, u.id, u.id, u.id);
    const wishlist = q.all('SELECT listing_id FROM wishlists WHERE user_id = ?', u.id).map((x) => x.listing_id);
    return { user: selfUser(u), counts: { notifications: unreadNotifications, messages: unreadMessages }, wishlist };
  });

  r.post('/api/v1/auth/verify-email', (ctx) => {
    const { token } = validate(z.object({ token: z.string().min(10).max(200) }), ctx.body);
    const t = q.get("SELECT * FROM auth_tokens WHERE type = 'email_verify' AND token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')", sha256(token));
    if (!t) throw bad('This verification link is invalid or has expired.');
    tx(() => {
      q.run("UPDATE auth_tokens SET used_at = datetime('now') WHERE id = ?", t.id);
      q.run("UPDATE users SET email_verified_at = datetime('now') WHERE id = ? AND email = ?", t.user_id, t.target);
    });
    return { ok: true };
  });

  r.post('/api/v1/auth/resend-verification', async (ctx) => {
    rateLimit(`resend:${ctx.user.id}`, 3, 3600_000);
    if (ctx.user.email_verified_at) return { ok: true, already: true };
    if (!ctx.user.email) throw bad('Add an email address first.');
    await sendVerification(ctx.user);
    return { ok: true };
  }, { auth: true });

  r.post('/api/v1/auth/forgot', async (ctx) => {
    const { email } = validate(z.object({ email: z.string().trim().email() }), ctx.body);
    rateLimit(`forgot:${ctx.ip}`, 5, 3600_000);
    const user = q.get("SELECT * FROM users WHERE email = ? AND status = 'active'", email);
    if (user) {
      const token = randomToken(24);
      q.run('INSERT INTO auth_tokens (user_id, type, target, token_hash, expires_at) VALUES (?,?,?,?,?)', user.id, 'password_reset', user.email, sha256(token), addMinutes(60));
      await sendEmail(user.email, 'Reset your PASAL password', emailLayout('Password reset', ['Someone asked to reset your password. If that was you, use the link below within 1 hour. Otherwise, ignore this email.'], { label: 'Reset password', url: `${config.publicUrl}/reset-password?token=${token}` }));
    }
    return { ok: true }; // same response either way (no account enumeration)
  });

  r.post('/api/v1/auth/reset', async (ctx) => {
    const b = validate(z.object({ token: z.string().min(10).max(200), password: pw }), ctx.body);
    const t = q.get("SELECT * FROM auth_tokens WHERE type = 'password_reset' AND token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')", sha256(b.token));
    if (!t) throw bad('This reset link is invalid or has expired.');
    const hash = await hashPassword(b.password);
    tx(() => {
      q.run("UPDATE auth_tokens SET used_at = datetime('now') WHERE id = ?", t.id);
      q.run("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?", hash, t.user_id);
      q.run('DELETE FROM sessions WHERE user_id = ?', t.user_id);
    });
    notify(t.user_id, 'system', 'Your password was changed', 'If this was not you, contact support immediately.');
    return { ok: true };
  });

  // ---- Phone OTP (+91 India / +977 Nepal) ----
  r.post('/api/v1/auth/otp/request', async (ctx) => {
    const b = validate(z.object({ phone: z.string().min(7).max(20), country }), ctx.body);
    const phone = normalizePhone(b.phone, b.country);
    if (!phone) throw bad(b.country === 'IN' ? 'Enter a valid 10-digit Indian mobile number.' : 'Enter a valid 10-digit Nepali mobile number (98/97/96…).');
    rateLimit(`otp:${ctx.ip}`, 10, 3600_000);
    rateLimit(`otp:${phone}`, 3, 10 * 60_000);
    const code = otp();
    q.run("UPDATE auth_tokens SET used_at = datetime('now') WHERE type = 'phone_otp' AND target = ? AND used_at IS NULL", phone);
    q.run('INSERT INTO auth_tokens (user_id, type, target, token_hash, expires_at) VALUES (NULL, ?, ?, ?, ?)', 'phone_otp', phone, sha256(`${phone}:${code}`), addMinutes(5));
    await sendSms(phone, `${code} is your PASAL verification code. It expires in 5 minutes. Never share it.`);
    return { ok: true, phone, expiresIn: 300 };
  });

  r.post('/api/v1/auth/otp/verify', async (ctx) => {
    const b = validate(z.object({ phone: z.string(), country, code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'), name: z.string().trim().min(2).max(60).optional() }), ctx.body);
    const phone = normalizePhone(b.phone, b.country);
    if (!phone) throw bad('Invalid phone number.');
    const t = q.get("SELECT * FROM auth_tokens WHERE type = 'phone_otp' AND target = ? AND used_at IS NULL AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1", phone);
    if (!t) throw bad('This code has expired. Request a new one.');
    if (t.attempts >= 5) throw new HttpError(429, 'Too many attempts. Request a new code.');
    if (t.token_hash !== sha256(`${phone}:${b.code}`)) {
      q.run('UPDATE auth_tokens SET attempts = attempts + 1 WHERE id = ?', t.id);
      throw bad('That code is incorrect.');
    }
    q.run("UPDATE auth_tokens SET used_at = datetime('now') WHERE id = ?", t.id);
    // Linking to a signed-in account
    if (ctx.user) {
      const other = q.get('SELECT id FROM users WHERE phone = ? AND id != ?', phone, ctx.user.id);
      if (other) throw conflict('This number is already linked to another account.');
      q.run("UPDATE users SET phone = ?, phone_verified_at = datetime('now') WHERE id = ?", phone, ctx.user.id);
      return { user: selfUser(q.get('SELECT * FROM users WHERE id = ?', ctx.user.id)), linked: true };
    }
    let user = q.get('SELECT * FROM users WHERE phone = ?', phone);
    if (user && user.status !== 'active') throw new HttpError(403, 'This account is not active.');
    if (!user) {
      if (!b.name) return { needsName: true };
      const { id } = q.run("INSERT INTO users (name, phone, phone_verified_at, country_code) VALUES (?,?,datetime('now'),?)", cleanText(b.name, 60), phone, b.country);
      user = q.get('SELECT * FROM users WHERE id = ?', id);
    } else if (!user.phone_verified_at) {
      q.run("UPDATE users SET phone_verified_at = datetime('now') WHERE id = ?", user.id);
    }
    startSession(ctx, user.id);
    return { user: selfUser(user) };
  });

  // ---- Google OAuth 2.0 (authorization code flow) ----
  r.get('/api/v1/auth/google/start', (ctx) => {
    if (!config.google.clientId) throw new HttpError(503, 'Google sign-in is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
    const state = randomToken(16);
    ctx.setCookie(cookie('pasal_oauth', state, { maxAge: 600, secure: config.cookieSecure }));
    const p = new URLSearchParams({
      client_id: config.google.clientId, redirect_uri: `${config.publicUrl}/api/v1/auth/google/callback`,
      response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account',
    });
    return ctx.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${p}`);
  });

  r.get('/api/v1/auth/google/callback', async (ctx) => {
    const { code, state } = ctx.query;
    if (!code || !state || state !== ctx.cookies.pasal_oauth) return ctx.redirect('/login?error=oauth_state');
    const tok = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: config.google.clientId, client_secret: config.google.clientSecret, redirect_uri: `${config.publicUrl}/api/v1/auth/google/callback`, grant_type: 'authorization_code' }),
    }).then((r) => r.json());
    if (!tok.access_token) return ctx.redirect('/login?error=oauth_token');
    const info = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tok.access_token}` } }).then((r) => r.json());
    if (!info.sub || !info.email_verified) return ctx.redirect('/login?error=oauth_email');
    let user = q.get('SELECT * FROM users WHERE google_sub = ?', info.sub) || q.get('SELECT * FROM users WHERE email = ?', info.email);
    if (user && user.status !== 'active') return ctx.redirect('/login?error=suspended');
    if (!user) {
      const { id } = q.run("INSERT INTO users (name, email, google_sub, email_verified_at, avatar_url) VALUES (?,?,?,datetime('now'),?)", cleanText(info.name || info.email.split('@')[0], 60), info.email.toLowerCase(), info.sub, info.picture || null);
      user = { id };
    } else {
      q.run("UPDATE users SET google_sub = ?, email_verified_at = COALESCE(email_verified_at, datetime('now')) WHERE id = ?", info.sub, user.id);
    }
    startSession(ctx, user.id);
    return ctx.redirect('/');
  });

  // ---- Sessions & security ----
  r.get('/api/v1/auth/sessions', (ctx) => {
    const rows = q.all('SELECT id, ip, user_agent, created_at, last_used_at FROM sessions WHERE user_id = ? AND expires_at > datetime(\'now\') ORDER BY last_used_at DESC', ctx.user.id);
    return rows.map((s) => ({ ...s, id: s.id.slice(0, 16), current: s.id === ctx.user.session_id }));
  }, { auth: true });

  r.delete('/api/v1/auth/sessions/:id', (ctx) => {
    const n = q.run('DELETE FROM sessions WHERE user_id = ? AND substr(id, 1, 16) = ? AND id != ?', ctx.user.id, ctx.params.id, ctx.user.session_id);
    return { ok: n.changes > 0 };
  }, { auth: true });

  r.post('/api/v1/auth/sessions/revoke-others', (ctx) => {
    const n = q.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', ctx.user.id, ctx.user.session_id);
    return { revoked: n.changes };
  }, { auth: true });

  r.post('/api/v1/auth/change-password', async (ctx) => {
    const b = validate(z.object({ current: z.string().optional(), password: pw }), ctx.body);
    rateLimit(`chpw:${ctx.user.id}`, 5, 3600_000);
    if (ctx.user.password_hash && !(await verifyPassword(b.current || '', ctx.user.password_hash))) throw bad('Current password is incorrect.');
    q.run("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?", await hashPassword(b.password), ctx.user.id);
    q.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', ctx.user.id, ctx.user.session_id);
    notify(ctx.user.id, 'system', 'Password updated', 'Other devices were signed out.');
    return { ok: true };
  }, { auth: true });

  r.post('/api/v1/auth/delete-account', async (ctx) => {
    const b = validate(z.object({ password: z.string().optional(), confirm: z.literal('DELETE') }), ctx.body);
    const u = ctx.user;
    if (u.password_hash && !(await verifyPassword(b.password || '', u.password_hash))) throw bad('Password is incorrect.');
    const open = q.val("SELECT COUNT(*) FROM orders WHERE (buyer_id = ? OR seller_id = ?) AND status NOT IN ('completed','cancelled','rejected','refunded')", u.id, u.id);
    if (open > 0) throw conflict('You have open orders. Complete or cancel them before deleting your account.');
    tx(() => {
      q.run("UPDATE listings SET status = 'removed', updated_at = datetime('now') WHERE seller_id = ? AND status IN ('active','paused','draft','pending_review')", u.id);
      q.run("UPDATE users SET status = 'deleted', email = NULL, phone = NULL, google_sub = NULL, password_hash = NULL, name = 'Deleted user', avatar_url = NULL, bio = NULL, updated_at = datetime('now') WHERE id = ?", u.id);
      q.run('DELETE FROM sessions WHERE user_id = ?', u.id);
      q.run('DELETE FROM addresses WHERE user_id = ?', u.id);
      q.run('DELETE FROM saved_searches WHERE user_id = ?', u.id);
    });
    audit(u.id, 'account.delete', 'user', u.id, null, ctx.ip);
    ctx.setCookie(cookie(SID, '', { maxAge: 0, secure: config.cookieSecure }));
    return { ok: true };
  }, { auth: true });

  void nowSql;
}
