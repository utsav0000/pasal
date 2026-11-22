import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, makeUser, createListing, login } from './helpers.js';

let ctx, sup, adm, mod, support, seller;
before(async () => {
  ctx = await startServer();
  sup = await login(ctx, 'super@t.test');
  adm = await login(ctx, 'admin@t.test');
  mod = await login(ctx, 'mod@t.test');
  support = await login(ctx, 'support@t.test');
  seller = await makeUser(ctx, { name: 'Shop Owner' });
});
after(async () => ctx.close());

test('role-based permissions on admin endpoints', async () => {
  const user = await makeUser(ctx);
  assert.equal((await user.c.get('/admin/overview')).status, 403);
  assert.equal((await client(ctx.base).get('/admin/overview')).status, 401);
  assert.equal((await mod.get('/admin/listings')).status, 200);
  assert.equal((await mod.get('/admin/payments')).status, 403);
  assert.equal((await mod.put('/admin/settings', { offer_expiry_hours: 24 })).status, 403);
  assert.equal((await support.get('/admin/orders')).status, 200);
  assert.equal((await support.get('/admin/listings')).status, 403);
  assert.equal((await support.get('/admin/tickets')).status, 200);
  assert.equal((await adm.get('/admin/payments')).status, 200);
  assert.equal((await adm.post(`/admin/users/${user.user.id}/role`, { role: 'admin' })).status, 403, 'only super admins change roles');
  assert.equal((await sup.post(`/admin/users/${user.user.id}/role`, { role: 'moderator' })).status, 200);
  assert.equal((await user.c.get('/admin/listings')).status, 200, 'new moderator can moderate');
});

test('admins cannot act on equal or higher roles', async () => {
  const supId = ctx.q.val("SELECT id FROM users WHERE email = 'super@t.test'");
  assert.equal((await adm.post(`/admin/users/${supId}/status`, { action: 'suspend', reason: 'x' })).status, 403);
});

test('suspension signs the user out and pauses their listings; reactivation restores access', async () => {
  const u = await makeUser(ctx);
  const l = await createListing(ctx, u.c);
  assert.equal((await adm.post(`/admin/users/${u.user.id}/status`, { action: 'suspend' })).status, 400, 'reason required');
  assert.equal((await adm.post(`/admin/users/${u.user.id}/status`, { action: 'suspend', reason: 'Spam' })).status, 200);
  assert.equal((await u.c.get('/auth/me')).body.user, null);
  assert.equal(ctx.q.val('SELECT status FROM listings WHERE id = ?', l.id), 'paused');
  const relog = await client(ctx.base).post('/auth/login', { email: u.email, password: 'Passw0rd!' });
  assert.equal(relog.status, 403); assert.match(relog.body.error, /suspended/);
  await adm.post(`/admin/users/${u.user.id}/status`, { action: 'reactivate' });
  assert.equal((await client(ctx.base).post('/auth/login', { email: u.email, password: 'Passw0rd!' })).status, 200);
  const audit = (await adm.get('/admin/audit?action=user.')).body.items;
  assert.ok(audit.some((a) => a.action === 'user.suspend' && a.data.reason === 'Spam'));
});

test('seller verification: request → moderator approves → badge', async () => {
  const u = await makeUser(ctx);
  assert.equal((await u.c.post('/me/verification', { doc_type: 'pan', doc_number: 'ABCDE1234F', full_name: 'Test User' })).status, 200);
  assert.equal(ctx.q.val('SELECT doc_last4 FROM seller_verifications WHERE user_id = ?', u.user.id), '234F', 'only last 4 stored');
  const v = (await mod.get('/admin/verifications')).body.find((x) => x.user_id === u.user.id);
  assert.equal((await mod.post(`/admin/verifications/${v.id}`, { decision: 'reject' })).status, 400, 'rejection needs a note');
  assert.equal((await mod.post(`/admin/verifications/${v.id}`, { decision: 'approve' })).status, 200);
  assert.equal((await u.c.get('/auth/me')).body.user.seller_status, 'verified');
});

test('moderation: approve held listing, remove with note, feature; reports auto-hide after 3', async () => {
  const held = await createListing(ctx, seller.c, { title: 'Counterfeit looking replica sneakers', category: 'shoes', attributes: {} });
  assert.equal(held.status, 'pending_review');
  assert.equal((await mod.post(`/admin/listings/${held.id}/moderate`, { action: 'approve' })).body.status, 'active');
  assert.equal((await mod.post(`/admin/listings/${held.id}/moderate`, { action: 'remove' })).status, 400);
  assert.equal((await mod.post(`/admin/listings/${held.id}/moderate`, { action: 'remove', note: 'Counterfeit' })).body.status, 'removed');
  const l = await createListing(ctx, seller.c, { title: 'Perfectly fine phone 128GB' });
  assert.equal((await mod.post(`/admin/listings/${l.id}/feature`, { days: 7 })).status, 403, 'moderators cannot feature');
  assert.equal((await adm.post(`/admin/listings/${l.id}/feature`, { days: 7 })).status, 200);
  assert.equal((await client(ctx.base).get('/listings?featured=1&country=IN')).body.items[0].id, l.id);
  for (let i = 0; i < 3; i++) { const r = await makeUser(ctx); await r.c.post('/reports', { target_type: 'listing', target_id: l.id, reason: 'scam' }); }
  assert.equal(ctx.q.val('SELECT status FROM listings WHERE id = ?', l.id), 'pending_review');
  const reports = (await mod.get('/admin/reports')).body.filter((r) => r.target_id === l.id);
  assert.equal(reports.length, 3);
  await mod.post(`/admin/reports/${reports[0].id}`, { action: 'dismiss' });
  assert.equal((await mod.get('/admin/reports')).body.filter((r) => r.target_id === l.id).length, 0, 'all reports on the target resolved together');
});

test('categories & attributes are managed dynamically', async () => {
  const c = (await adm.post('/admin/categories', { name: 'Drones', parent_id: ctx.ids.catIds.electronics, icon: 'Camera' })).body;
  assert.equal(c.slug, 'drones');
  assert.equal((await adm.post(`/admin/categories/${c.id}/attributes`, { key: 'flight_time', label: 'Flight time', type: 'number', unit: 'min', required: true })).status, 200);
  assert.equal((await adm.post(`/admin/categories/${c.id}/attributes`, { key: 'cam', label: 'Camera', type: 'select', options: ['4K'] })).status, 400, 'select needs 2+ options');
  const detail = (await client(ctx.base).get('/categories/drones')).body;
  assert.ok(detail.attributes.some((a) => a.key === 'flight_time'));
  const fail = await createListing(ctx, seller.c, { category: 'drones', attributes: {} }).catch((e) => e);
  assert.match(String(fail.message), /Flight time/);
  await createListing(ctx, seller.c, { category: 'drones', attributes: { flight_time: 30 }, title: 'Mini drone with camera' });
  assert.equal((await adm.del(`/admin/categories/${c.id}`)).status, 409, 'in-use categories cannot be deleted');
});

test('settings, FX and homepage are configurable and audited', async () => {
  const s = (await adm.put('/admin/settings', { offer_expiry_hours: 24, platform_fee_bps: 150 })).body;
  assert.equal(s.offer_expiry_hours, 24); assert.equal(s.platform_fee_bps, 150);
  const fx = (await adm.put('/admin/fx', { base: 'INR', quote: 'NPR', rate: 1.6015 })).body;
  assert.equal(fx.find((r) => r.base === 'INR').rate_micros, 1601500);
  assert.equal(fx.find((r) => r.base === 'NPR').rate_micros, Math.round(1e12 / 1601500));
  const promo = (await adm.post('/admin/promotions', { placement: 'banner', title: 'Big sale', link: '/c/sofas', theme: 'mint' })).body;
  assert.equal((await adm.post('/admin/promotions', { placement: 'banner', title: 'Evil', link: 'https://evil.example' })).status, 400, 'only on-site links');
  const home = (await client(ctx.base).get('/home?country=IN')).body;
  assert.ok(home.promotions.some((p) => p.id === promo.id));
  const secs = (await adm.get('/admin/promotions')).body.sections;
  await adm.put('/admin/homepage-sections', secs.map((x, i) => ({ id: x.id, active: x.key !== 'deals', sort: i, title: x.title })));
  assert.ok(!(await client(ctx.base).get('/home?country=IN')).body.sections.some((x) => x.key === 'deals'));
  const audit = (await adm.get('/admin/audit')).body.items.map((a) => a.action);
  for (const a of ['settings.update', 'fx.update', 'promotion.create', 'homepage.update']) assert.ok(audit.includes(a), a);
  await adm.put('/admin/settings', { offer_expiry_hours: 48, platform_fee_bps: 0 });
});

test('support tickets: public contact form → staff reply', async () => {
  const t = (await client(ctx.base).post('/support/tickets', { name: 'Guest', email: 'g@t.test', subject: 'Payment help', category: 'payment', message: 'My payment is stuck somewhere.' })).body;
  assert.match(t.reference, /^T-\d{5}$/);
  const list = (await support.get('/admin/tickets')).body;
  const tk = list.find((x) => x.id === t.id);
  assert.equal(tk.priority, 'high', 'payment tickets are prioritised');
  assert.equal((await support.post(`/admin/tickets/${t.id}`, { reply: 'We are on it.' })).status, 200);
  assert.equal(ctx.q.val('SELECT status FROM support_tickets WHERE id = ?', t.id), 'pending');
  assert.ok(ctx.q.get("SELECT 1 FROM outbox WHERE recipient = 'g@t.test'"), 'guest notified by email');
});

test('overview and analytics return real aggregates', async () => {
  const o = (await adm.get('/admin/overview')).body;
  assert.ok(o.users >= 5); assert.equal(o.series.length, 30);
  const a = (await adm.get('/admin/analytics?days=7')).body;
  assert.equal(a.series.length, 7); assert.ok('funnel' in a);
  assert.ok((await adm.get('/api/v1/openapi.json')).body.paths['/api/v1/orders/{id}/transition']);
});
