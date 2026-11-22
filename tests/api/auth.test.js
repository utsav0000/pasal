import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client } from './helpers.js';

let ctx;
before(async () => { ctx = await startServer(); });
after(async () => ctx.close());

const tokenFrom = (to, pattern) => {
  const m = ctx.q.get("SELECT body FROM outbox WHERE recipient = ? AND body LIKE '%token=%' ORDER BY id DESC LIMIT 1", to);
  return m?.body.match(pattern)?.[1];
};

test('register → verify email → login → me → logout', async () => {
  const c = client(ctx.base);
  const r = await c.post('/auth/register', { name: 'Asha Rai', email: 'asha@t.test', password: 'Passw0rd!', country: 'NP' });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.email_verified, false);
  assert.match(c.cookie, /pasal_sid=/);
  assert.match(r.headers.get('set-cookie'), /HttpOnly/);
  const dup = await client(ctx.base).post('/auth/register', { name: 'Asha', email: 'ASHA@t.test', password: 'Passw0rd!' });
  assert.equal(dup.status, 409);
  const token = tokenFrom('asha@t.test', /token=([\w-]+)/);
  assert.ok(token, 'verification email queued');
  assert.equal((await c.post('/auth/verify-email', { token })).status, 200);
  assert.equal((await c.post('/auth/verify-email', { token })).status, 400, 'token is single use');
  const me = await c.get('/auth/me');
  assert.equal(me.body.user.email_verified, true);
  assert.equal(me.body.user.country_code, 'NP');
  assert.equal(me.body.user.password_hash, undefined, 'never leaks hashes');
  await c.post('/auth/logout');
  assert.equal((await c.get('/auth/me')).body.user, null);
  const bad = await client(ctx.base).post('/auth/login', { email: 'asha@t.test', password: 'wrong' });
  assert.equal(bad.status, 401);
  const ok = await client(ctx.base).post('/auth/login', { email: 'asha@t.test', password: 'Passw0rd!' });
  assert.equal(ok.status, 200);
});

test('weak passwords and malformed input are rejected', async () => {
  const c = client(ctx.base);
  assert.equal((await c.post('/auth/register', { name: 'X Y', email: 'weak@t.test', password: 'short' })).status, 400);
  assert.equal((await c.post('/auth/register', { name: 'X Y', email: 'not-an-email', password: 'Passw0rd!' })).status, 400);
  assert.equal((await c.raw('POST', '/auth/login', '{bad json', { 'Content-Type': 'application/json' })).status, 400);
});

test('CSRF: state-changing requests without the custom header are refused', async () => {
  const r = await fetch(`${ctx.base}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'a@b.c', password: 'x' }) });
  assert.equal(r.status, 403);
});

test('password reset flow revokes sessions; no account enumeration', async () => {
  const c = client(ctx.base);
  await c.post('/auth/register', { name: 'Ravi K', email: 'ravi@t.test', password: 'Passw0rd!' });
  const unknown = await client(ctx.base).post('/auth/forgot', { email: 'nobody@t.test' });
  assert.equal(unknown.status, 200);
  assert.equal((await client(ctx.base).post('/auth/forgot', { email: 'ravi@t.test' })).status, 200);
  const token = tokenFrom('ravi@t.test', /reset-password\?token=([\w-]+)/);
  assert.ok(token);
  assert.equal((await client(ctx.base).post('/auth/reset', { token, password: 'NewPassw0rd' })).status, 200);
  assert.equal((await c.get('/auth/me')).body.user, null, 'old session revoked');
  assert.equal((await client(ctx.base).post('/auth/login', { email: 'ravi@t.test', password: 'NewPassw0rd' })).status, 200);
});

test('phone OTP sign-up for India (+91) and Nepal (+977)', async () => {
  for (const [country, phone, e164] of [['IN', '9876501234', '+919876501234'], ['NP', '9841098765', '+9779841098765']]) {
    const c = client(ctx.base);
    assert.equal((await c.post('/auth/otp/request', { phone: '12345', country })).status, 400);
    const r = await c.post('/auth/otp/request', { phone, country });
    assert.equal(r.status, 200); assert.equal(r.body.phone, e164);
    const code = ctx.q.get('SELECT body FROM outbox WHERE recipient = ? ORDER BY id DESC LIMIT 1', e164).body.slice(0, 6);
    assert.equal((await c.post('/auth/otp/verify', { phone, country, code: code === '000000' ? '111111' : '000000' })).status, 400);
    const v = await c.post('/auth/otp/verify', { phone, country, code });
    assert.equal(v.body.needsName, true);
    const v2 = await c.post('/auth/otp/verify', { phone, country, code, name: 'Phone User' });
    assert.equal(v2.status, 400, 'code is consumed after first successful check');
    // Request a fresh code to finish sign-up
    const c2 = client(ctx.base);
    await c2.post('/auth/otp/request', { phone, country });
    const code2 = ctx.q.get('SELECT body FROM outbox WHERE recipient = ? ORDER BY id DESC LIMIT 1', e164).body.slice(0, 6);
    const done = await c2.post('/auth/otp/verify', { phone, country, code: code2, name: 'Phone User' });
    assert.equal(done.status, 200); assert.equal(done.body.user.phone, e164); assert.equal(done.body.user.phone_verified, true);
  }
});

test('OTP brute force is capped at 5 attempts', async () => {
  const c = client(ctx.base);
  await c.post('/auth/otp/request', { phone: '9812345678', country: 'NP' });
  let last;
  for (let i = 0; i < 6; i++) last = await c.post('/auth/otp/verify', { phone: '9812345678', country: 'NP', code: String(100000 + i) });
  assert.equal(last.status, 429);
});

test('login is rate limited per account', async () => {
  ctx.resetRateLimits();
  let last;
  for (let i = 0; i < 10; i++) last = await client(ctx.base).post('/auth/login', { email: 'asha@t.test', password: 'nope' });
  assert.equal(last.status, 429);
  assert.ok(last.headers.get('retry-after'));
  ctx.resetRateLimits();
});

test('sessions can be listed and revoked; account deletion anonymises', async () => {
  const a = client(ctx.base), b = client(ctx.base);
  await a.post('/auth/register', { name: 'Del Me', email: 'del@t.test', password: 'Passw0rd!' });
  await b.post('/auth/login', { email: 'del@t.test', password: 'Passw0rd!' });
  const s = await a.get('/auth/sessions');
  assert.equal(s.body.length, 2);
  await a.post('/auth/sessions/revoke-others');
  assert.equal((await b.get('/auth/me')).body.user, null);
  assert.equal((await a.post('/auth/delete-account', { password: 'Passw0rd!', confirm: 'nope' })).status, 400);
  assert.equal((await a.post('/auth/delete-account', { password: 'Passw0rd!', confirm: 'DELETE' })).status, 200);
  const row = ctx.q.get("SELECT * FROM users WHERE name = 'Deleted user' ORDER BY id DESC LIMIT 1");
  assert.equal(row.email, null); assert.equal(row.status, 'deleted');
  assert.equal((await client(ctx.base).post('/auth/login', { email: 'del@t.test', password: 'Passw0rd!' })).status, 401);
});

test('Google sign-in is reported as unavailable without credentials', async () => {
  const c = client(ctx.base);
  assert.equal((await c.get('/auth/providers')).body.google, false);
  assert.equal((await c.get('/auth/google/start')).status, 503);
});

test('security headers are present', async () => {
  const r = await fetch(`${ctx.base}/`);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  const html = await r.text();
  const nonce = r.headers.get('content-security-policy').match(/nonce-([^']+)/)[1];
  assert.ok(html.includes(`nonce="${nonce}"`), 'inline scripts carry the CSP nonce');
});
