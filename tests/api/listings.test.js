import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, makeUser, createListing, pngDataUrl } from './helpers.js';

let ctx, seller, sellerNP;
before(async () => {
  ctx = await startServer();
  seller = await makeUser(ctx, { name: 'Seller IN' });
  sellerNP = await makeUser(ctx, { name: 'Seller NP', country: 'NP' });
});
after(async () => ctx.close());

test('image upload validates the real file type and strips metadata', async () => {
  const ok = await seller.c.post('/media/images', { data: await pngDataUrl() });
  assert.equal(ok.status, 200);
  assert.match(ok.body.url, /^\/uploads\/listings\/.+\.webp$/);
  const fake = await seller.c.post('/media/images', { data: `data:image/png;base64,${Buffer.from('<?php echo 1; ?>').toString('base64')}` });
  assert.equal(fake.status, 400);
  const anon = await client(ctx.base).post('/media/images', { data: await pngDataUrl() });
  assert.equal(anon.status, 401);
  const served = await fetch(ctx.base + ok.body.url);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'image/webp');
});

test('draft → publish validation → publish', async () => {
  const draft = await seller.c.post('/listings', { country_code: 'IN', category_id: ctx.ids.catIds.smartphones, currency: 'INR', title: 'Half done', publish: false });
  assert.equal(draft.status, 200); assert.equal(draft.body.status, 'draft');
  const fail = await seller.c.put(`/listings/${draft.body.id}`, { country_code: 'IN', category_id: ctx.ids.catIds.smartphones, currency: 'INR', title: 'Half done', publish: true });
  assert.equal(fail.status, 400);
  assert.match(fail.body.error, /photo/); assert.match(fail.body.error, /price/); assert.match(fail.body.error, /Storage/, 'required category attribute');
  const parent = await seller.c.post('/listings', { country_code: 'IN', category_id: ctx.ids.catIds.electronics, currency: 'INR', publish: false });
  assert.equal(parent.status, 400, 'must pick a subcategory');
  const l = await createListing(ctx, seller.c);
  assert.equal(l.status, 'active');
  const d = await client(ctx.base).get(`/listings/${l.slug}`);
  assert.equal(d.status, 200);
  assert.equal(d.body.price_minor, 2000000);
  assert.equal(d.body.attributes.find((a) => a.key === 'storage').value, '128 GB');
  assert.equal(d.body.delivery.fee_minor, 10000);
  assert.equal(d.body.pickup.address, 'Near the main market');
});

test('currency must match the listing country unless cross-border is enabled', async () => {
  const r = await createListing(ctx, seller.c, { currency: 'NPR' }).catch((e) => e);
  assert.match(String(r.message), /priced in INR/);
});

test('unverified users cannot publish', async () => {
  const u = await makeUser(ctx, { verify: false });
  const r = await createListing(ctx, u.c).catch((e) => e);
  assert.match(String(r.message), /Verify your email or phone/);
});

test('user text is sanitised (no stored HTML)', async () => {
  const l = await createListing(ctx, seller.c, { title: '<img src=x onerror=alert(1)>Clean title here', description: 'Nice <script>steal()</script> phone with box and charger.' });
  const d = (await client(ctx.base).get(`/listings/${l.id}`)).body;
  assert.ok(!d.title.includes('<')); assert.ok(!d.description.includes('<script>'));
});

test('prohibited keywords and review categories are held for moderation', async () => {
  const l = await createListing(ctx, seller.c, { title: 'Replica designer watch first copy', category: 'watches', attributes: {} });
  assert.equal(l.status, 'pending_review');
  assert.equal((await client(ctx.base).get(`/listings/${l.slug}`)).status, 404, 'hidden from public');
  assert.equal((await seller.c.get(`/listings/${l.slug}`)).status, 200, 'owner can still view');
  const pet = await createListing(ctx, seller.c, { title: 'Dog crate large size foldable', category: 'pet-accessories', attributes: {} });
  assert.equal(pet.status, 'pending_review');
});

test('manage: pause, resume, sold, relist, renew, delete; only the owner', async () => {
  const l = await createListing(ctx, seller.c, { title: 'Manage me phone 64GB' });
  const other = await makeUser(ctx);
  assert.equal((await other.c.post(`/listings/${l.id}/status`, { action: 'pause' })).status, 403);
  assert.equal((await seller.c.post(`/listings/${l.id}/status`, { action: 'resume' })).status, 409);
  assert.equal((await seller.c.post(`/listings/${l.id}/status`, { action: 'pause' })).body.status, 'paused');
  assert.equal((await client(ctx.base).get(`/listings/${l.slug}`)).status, 404);
  assert.equal((await seller.c.post(`/listings/${l.id}/status`, { action: 'resume' })).body.status, 'active');
  assert.equal((await seller.c.post(`/listings/${l.id}/status`, { action: 'sold' })).body.status, 'sold');
  assert.equal((await seller.c.post(`/listings/${l.id}/status`, { action: 'unsold' })).body.status, 'active');
  assert.equal((await seller.c.post(`/listings/${l.id}/status`, { action: 'renew' })).body.status, 'active');
  const mine = await seller.c.get('/me/listings?status=all');
  assert.ok(mine.body.items.some((x) => x.id === l.id));
  assert.equal((await other.c.del(`/listings/${l.id}`)).status, 403);
  assert.equal((await seller.c.del(`/listings/${l.id}`)).status, 200);
  assert.equal((await client(ctx.base).get(`/listings/${l.id}`)).status, 404);
});

test('search: full text, typo tolerance, filters, sorting and cross-currency price ranges', async () => {
  await createListing(ctx, seller.c, { title: 'Royal Enfield Classic 350 bike', category: 'motorcycles', price: '150000', attributes: { year: 2021, km_driven: 9000 }, fulfillment: 'pickup', delivery: null });
  await createListing(ctx, sellerNP.c, { title: 'Yamaha FZ motorcycle Kathmandu', category: 'motorcycles', price: '200000', attributes: { year: 2020, km_driven: 21000 }, country_code: 'NP', fulfillment: 'pickup', delivery: null });
  await createListing(ctx, seller.c, { title: 'Samsung Galaxy S23 Ultra', price: '68000', condition: 'used_good', city: 'Pune' });
  const c = client(ctx.base);
  const s1 = await c.get('/listings?q=enfield&country=IN');
  assert.equal(s1.body.total, 1);
  const typo = await c.get('/listings?q=royl%20enfeild&country=IN');
  assert.equal(typo.body.corrected, 'royal enfield'); assert.equal(typo.body.total, 1);
  const both = await c.get('/listings?category=motorcycles&country=all&sort=price_asc&display=INR');
  assert.equal(both.body.total, 2);
  // रू200,000 ≈ ₹125,000 should sort below ₹150,000
  assert.equal(both.body.items[0].currency, 'NPR');
  const range = await c.get('/listings?category=motorcycles&country=all&display=INR&min=120000&max=130000');
  assert.equal(range.body.total, 1); assert.equal(range.body.items[0].currency, 'NPR');
  const cond = await c.get('/listings?country=IN&condition=used_good');
  assert.ok(cond.body.items.every((i) => i.condition === 'used_good'));
  const del = await c.get('/listings?country=IN&delivery=1');
  assert.ok(del.body.items.every((i) => i.fulfillment !== 'pickup'));
  const near = await c.get(`/listings?country=IN&city=${ctx.ids.cityIds.Mumbai.id}&radius=50`);
  assert.ok(near.body.items.length > 0 && near.body.items.every((i) => i.city !== 'Pune'), 'Pune is ~120 km from Mumbai');
  const attr = await c.get('/listings?category=smartphones&country=IN&attr_storage=128%20GB');
  assert.ok(attr.body.total >= 1);
  const sug = await c.get('/search/suggest?q=sams&country=IN');
  assert.ok(sug.body.suggestions.some((s) => s.includes('Samsung')));
  assert.ok((await c.get('/search/trending?country=IN')).body.includes('enfield'));
  assert.equal((await c.get('/listings?min=abc')).status, 400);
});

test('views are counted once per viewer per day; owners are not counted', async () => {
  const l = await createListing(ctx, seller.c, { title: 'View counter phone 256GB' });
  const v = await makeUser(ctx);
  await v.c.get(`/listings/${l.slug}`); await v.c.get(`/listings/${l.slug}`); await seller.c.get(`/listings/${l.slug}`);
  assert.equal(ctx.q.val('SELECT views FROM listings WHERE id = ?', l.id), 1);
  assert.equal((await v.c.get('/recently-viewed')).body[0].id, l.id);
});

test('categories expose tree, attributes and counts; wishlist & saved searches', async () => {
  const c = client(ctx.base);
  const tree = await c.get('/categories');
  assert.ok(tree.body.length >= 13);
  const cars = await c.get('/categories/cars');
  assert.ok(cars.body.attributes.some((a) => a.key === 'fuel' && a.required));
  const u = await makeUser(ctx);
  const l = await createListing(ctx, seller.c, { title: 'Wishlist phone 512GB' });
  await u.c.post(`/wishlist/${l.id}`);
  assert.deepEqual((await u.c.get('/auth/me')).body.wishlist, [l.id]);
  await u.c.del(`/wishlist/${l.id}`);
  assert.equal((await u.c.get('/wishlist')).body.length, 0);
  const ss = await u.c.post('/saved-searches', { name: 'phones', query: 'q=phone&country=IN' });
  assert.equal(ss.status, 200);
  assert.ok((await u.c.get('/saved-searches')).body[0].total > 0);
});

test('SEO: listing pages get server-rendered meta, JSON-LD and sitemap entries', async () => {
  const l = await createListing(ctx, seller.c, { title: 'SEO friendly phone 128GB' });
  const html = await (await fetch(`${ctx.base}/l/${l.slug}`)).text();
  assert.match(html, /<title>SEO friendly phone 128GB · ₹ 20,000 in Mumbai \| PASAL<\/title>/);
  assert.match(html, /"@type":"Product"/);
  assert.match(html, /"priceCurrency":"INR"/);
  assert.match(html, /rel="canonical" href="http:\/\/localhost\/l\//);
  const sm = await (await fetch(`${ctx.base}/sitemap.xml`)).text();
  assert.ok(sm.includes(`/l/${l.slug}`));
  assert.match(await (await fetch(`${ctx.base}/robots.txt`)).text(), /Disallow: \/admin/);
  const priv = await (await fetch(`${ctx.base}/dashboard`)).text();
  assert.match(priv, /noindex/);
});
