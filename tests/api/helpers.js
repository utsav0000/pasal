// Spins up a real PASAL server on a random port with a fresh temporary database.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

export async function startServer(extraEnv = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pasal-test-'));
  Object.assign(process.env, {
    NODE_ENV: 'test', DATABASE_PATH: path.join(dir, 'test.db'), UPLOAD_DIR: path.join(dir, 'uploads'), ENABLE_DEV_TOOLS: '1',
    PUBLIC_URL: 'http://localhost', SANDBOX_PAYMENT_SECRET: 'test-sandbox-secret', ...extraEnv,
  });
  const { createApp } = await import('../../server/app.js');
  const { q } = await import('../../server/db.js');
  const { hashPassword } = await import('../../server/lib/security.js');
  const { resetRateLimits } = await import('../../server/lib/http.js');
  const server = createApp();
  await server.ready; // reference data is created automatically on first boot
  const ids = {
    cityIds: Object.fromEntries(q.all("SELECT id, name, lat, lng, postal_code AS pin, country_code AS country FROM locations WHERE type = 'city'").map((c) => [c.name, c])),
    catIds: Object.fromEntries(q.all('SELECT id, slug FROM categories').map((c) => [c.slug, c.id])),
  };
  const pw = await hashPassword('Staff@12345');
  for (const [name, email, role] of [['Super Admin', 'super@t.test', 'super_admin'], ['Admin', 'admin@t.test', 'admin'], ['Mod', 'mod@t.test', 'moderator'], ['Support', 'support@t.test', 'support']]) {
    q.run("INSERT INTO users (name, email, password_hash, role, email_verified_at) VALUES (?,?,?,?,datetime('now'))", name, email, pw, role);
  }
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base, q, ids, resetRateLimits,
    async close() {
      await new Promise((r) => server.close(r));
      server.closeAllConnections?.();
      const { closeDb } = await import('../../server/db.js');
      closeDb();
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    },
  };
}

/** Minimal cookie-aware HTTP client. */
export function client(base) {
  let cookie = '';
  const req = async (method, p, body, headers = {}) => {
    const res = await fetch(base + (p.startsWith('/api') ? p : `/api/v1${p}`), {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'X-Pasal-CSRF': '1' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body),
      redirect: 'manual',
    });
    const set = res.headers.getSetCookie?.() || [];
    for (const c of set) { const [kv] = c.split(';'); const [k, v] = kv.split('='); if (k === 'pasal_sid') cookie = v ? `pasal_sid=${v}` : ''; }
    let data = null;
    const text = await res.text();
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, body: data, headers: res.headers };
  };
  return {
    get: (p, h) => req('GET', p, undefined, h), post: (p, b = {}, h) => req('POST', p, b, h), put: (p, b, h) => req('PUT', p, b, h),
    patch: (p, b, h) => req('PATCH', p, b, h), del: (p, h) => req('DELETE', p, undefined, h), raw: req,
    get cookie() { return cookie; },
  };
}

let n = 0;
/** Register a user and mark them verified. Returns { c, user }. */
export async function makeUser(ctx, { country = 'IN', name, verify = true } = {}) {
  const c = client(ctx.base);
  const email = `u${Date.now().toString(36)}${++n}@t.test`;
  const r = await c.post('/auth/register', { name: name || `User ${n}`, email, password: 'Passw0rd!', country });
  if (r.status !== 200) throw new Error(`register failed: ${JSON.stringify(r.body)}`);
  if (verify) ctx.q.run("UPDATE users SET email_verified_at = datetime('now') WHERE id = ?", r.body.user.id);
  return { c, user: r.body.user, email };
}
export async function login(ctx, email, password = 'Staff@12345') {
  const c = client(ctx.base);
  const r = await c.post('/auth/login', { email, password });
  if (r.status !== 200) throw new Error(`login failed ${email}: ${JSON.stringify(r.body)}`);
  return c;
}

let png;
export async function pngDataUrl(color = '#6A4DFF') {
  png ??= {};
  png[color] ??= (await sharp({ create: { width: 64, height: 48, channels: 3, background: color } }).png().toBuffer()).toString('base64');
  return `data:image/png;base64,${png[color]}`;
}

/** Create and publish a listing; returns {id, slug, status}. */
export async function createListing(ctx, c, overrides = {}) {
  const img = (await c.post('/media/images', { data: await pngDataUrl() })).body;
  const country = overrides.country_code || 'IN';
  const city = ctx.ids.cityIds[overrides.city || (country === 'IN' ? 'Mumbai' : 'Kathmandu')];
  const body = {
    country_code: country, category_id: ctx.ids.catIds[overrides.category || 'smartphones'] ?? ctx.q.val('SELECT id FROM categories WHERE slug = ?', overrides.category), title: 'Test phone 128GB great condition', description: 'Works perfectly, no scratches, box and charger included.',
    brand: 'Testbrand', model: 'T1', condition: 'like_new', price: '20000', currency: country === 'IN' ? 'INR' : 'NPR', negotiable: true, accept_offers: true, quantity: 1,
    city_id: city.id, fulfillment: 'both', delivery: { fee: '100', eta_min_days: 1, eta_max_days: 3, method: 'seller', radius_km: null, supported_locations: [] },
    pickup: { address: 'Near the main market', times: 'Evenings' }, attributes: { storage: '128 GB' }, images: [{ url: img.url, thumb_url: img.thumbUrl, width: img.width, height: img.height }], publish: true,
    ...overrides,
  };
  delete body.city; delete body.category;
  const r = await c.post('/listings', body);
  if (r.status !== 200) throw new Error(`listing failed: ${JSON.stringify(r.body)}`);
  return r.body;
}
