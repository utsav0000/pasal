import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startServer, client, makeUser, createListing, login, pngDataUrl } from './helpers.js';

let ctx, seller, buyer, admin;
before(async () => {
  ctx = await startServer();
  seller = await makeUser(ctx, { name: 'Sam Seller' });
  buyer = await makeUser(ctx, { name: 'Bina Buyer' });
  admin = await login(ctx, 'admin@t.test');
});
after(async () => ctx.close());

const address = async (c, country = 'IN', city = 'Mumbai') => (await c.post('/me/addresses', { full_name: 'Bina Buyer', phone: country === 'IN' ? '9876543210' : '9841000000', country_code: country, city_id: ctx.ids.cityIds[city].id, line1: 'Flat 12, Sea View', postal_code: country === 'IN' ? '400001' : '44600' })).body;
const key = () => `k_${crypto.randomUUID()}`;
const sig = (o, p) => crypto.createHmac('sha256', 'test-sandbox-secret').update(`${o}|${p}`).digest('hex');

test('chat: product-linked conversation, unread counts, read receipts, blocking', async () => {
  const l = await createListing(ctx, seller.c, { title: 'Chat about this phone 128GB' });
  assert.equal((await seller.c.post('/conversations', { listing_id: l.id, message: 'hi' })).status, 400, 'cannot chat with yourself');
  const conv = (await buyer.c.post('/conversations', { listing_id: l.id, message: 'Is this available?' })).body;
  assert.equal(conv.listing.id, l.id);
  const again = (await buyer.c.post('/conversations', { listing_id: l.id })).body;
  assert.equal(again.id, conv.id, 'one conversation per buyer per listing');
  assert.equal((await seller.c.get('/auth/me')).body.counts.messages, 1);
  const thread = await seller.c.get(`/conversations/${conv.id}`);
  assert.equal(thread.body.messages[0].body, 'Is this available?');
  await seller.c.post(`/conversations/${conv.id}/read`);
  assert.equal((await seller.c.get('/auth/me')).body.counts.messages, 0);
  await seller.c.post(`/conversations/${conv.id}/messages`, { body: 'Yes it is!' });
  const outsider = await makeUser(ctx);
  assert.equal((await outsider.c.get(`/conversations/${conv.id}`)).status, 403);
  assert.ok((await buyer.c.get('/conversations?q=available')).body.length === 1, 'conversation search');
  await seller.c.post(`/users/${buyer.user.id}/block`);
  assert.equal((await buyer.c.post(`/conversations/${conv.id}/messages`, { body: 'hello?' })).status, 403);
  await seller.c.del(`/users/${buyer.user.id}/block`);
  assert.equal((await buyer.c.post(`/conversations/${conv.id}/messages`, { body: 'hello?' })).status, 200);
  const img = await buyer.c.post(`/conversations/${conv.id}/messages`, { image: await pngDataUrl('#ff0000') });
  assert.equal(img.body.kind, 'image');
});

test('offers: validation, counter, accept, expiry and checkout at the agreed price', async () => {
  const l = await createListing(ctx, seller.c, { title: 'Negotiable phone 256GB', price: '20000' });
  assert.equal((await buyer.c.post(`/listings/${l.id}/offers`, { amount: '25000' })).status, 400, 'above asking');
  assert.equal((await buyer.c.post(`/listings/${l.id}/offers`, { amount: '1000' })).status, 400, 'too low');
  const o = (await buyer.c.post(`/listings/${l.id}/offers`, { amount: '17000', message: 'cash today' })).body.offer;
  assert.equal(o.status, 'pending');
  assert.equal((await buyer.c.post(`/listings/${l.id}/offers`, { amount: '17500' })).status, 409, 'one pending offer at a time');
  assert.equal((await buyer.c.post(`/offers/${o.id}/respond`, { action: 'accept' })).status, 403, 'cannot accept your own offer');
  const counter = (await seller.c.post(`/offers/${o.id}/respond`, { action: 'counter', amount: '18500' })).body.offer;
  assert.equal(counter.amount_minor, 1850000);
  assert.equal((await seller.c.post(`/offers/${o.id}/respond`, { action: 'accept' })).status, 409, 'countered offer is closed');
  // Expire the counter and prove it can't be accepted
  ctx.q.run("UPDATE offers SET expires_at = datetime('now', '-1 minute') WHERE id = ?", counter.id);
  assert.equal((await buyer.c.post(`/offers/${counter.id}/respond`, { action: 'accept' })).status, 409);
  ctx.q.run("UPDATE offers SET expires_at = datetime('now', '+1 hour'), status = 'pending' WHERE id = ?", counter.id);
  const acc = (await buyer.c.post(`/offers/${counter.id}/respond`, { action: 'accept' })).body.offer;
  assert.equal(acc.status, 'accepted');
  const co = await buyer.c.get(`/checkout/${l.id}?offer=${counter.id}`);
  assert.equal(co.body.offer.amount_minor, 1850000);
  const order = (await buyer.c.post('/orders', { listing_id: l.id, offer_id: counter.id, fulfillment: 'pickup', payment_method: 'cash_on_pickup', idempotency_key: key() })).body;
  assert.equal(order.subtotal_minor, 1850000);
  assert.equal((await buyer.c.post('/orders', { listing_id: l.id, offer_id: counter.id, fulfillment: 'pickup', payment_method: 'cash_on_pickup', idempotency_key: key() })).status, 409, 'offer is single-use');
});

test('pickup order: accept → ready → handover with QR code → reviews (verified)', async () => {
  const l = await createListing(ctx, seller.c, { title: 'Pickup only lamp', category: 'lighting', attributes: {}, price: '1500' });
  assert.equal((await seller.c.post('/orders', { listing_id: l.id, fulfillment: 'pickup', payment_method: 'cash_on_pickup', idempotency_key: key() })).status, 400, 'cannot buy own listing');
  const k = key();
  const o = (await buyer.c.post('/orders', { listing_id: l.id, fulfillment: 'pickup', payment_method: 'cash_on_pickup', note: 'evening', idempotency_key: k })).body;
  const dupe = (await buyer.c.post('/orders', { listing_id: l.id, fulfillment: 'pickup', payment_method: 'cash_on_pickup', idempotency_key: k })).body;
  assert.equal(dupe.id, o.id, 'idempotent order creation');
  assert.equal(o.status, 'pending_seller_confirmation');
  assert.equal(o.pickup_code, undefined, 'code hidden before acceptance');
  assert.equal((await buyer.c.post(`/orders/${o.id}/transition`, { to: 'accepted' })).status, 409, 'buyer cannot accept');
  assert.equal((await buyer.c.post(`/orders/${o.id}/transition`, { to: 'payment_confirmed' })).status, 403);
  const acc = (await seller.c.post(`/orders/${o.id}/transition`, { to: 'accepted' })).body;
  assert.equal(acc.status, 'accepted');
  assert.equal(ctx.q.val('SELECT status FROM listings WHERE id = ?', l.id), 'sold', 'stock reserved');
  await seller.c.post(`/orders/${o.id}/transition`, { to: 'ready_for_pickup' });
  const bv = (await buyer.c.get(`/orders/${o.id}`)).body;
  assert.match(bv.pickup_code, /^[0-9A-F]{6}$/);
  assert.equal(bv.pickup_qr_payload, `PASAL:${bv.number}:${bv.pickup_code}`);
  assert.equal((await seller.c.get(`/orders/${o.id}`)).body.pickup_code, undefined, 'seller never sees the code');
  assert.equal((await seller.c.post(`/orders/${o.id}/transition`, { to: 'completed', pickup_code: 'WRONG1' })).status, 400);
  assert.equal((await seller.c.post(`/orders/${o.id}/transition`, { to: 'completed', pickup_code: `PASAL:PSL-OTHER:${bv.pickup_code}` })).status, 400);
  const done = (await seller.c.post(`/orders/${o.id}/transition`, { to: 'completed', pickup_code: bv.pickup_qr_payload })).body;
  assert.equal(done.status, 'completed');
  const r = await buyer.c.post(`/orders/${o.id}/review`, { rating: 5, body: 'Lovely lamp' });
  assert.equal(r.body.verified, 1);
  assert.equal((await buyer.c.post(`/orders/${o.id}/review`, { rating: 4 })).status, 409, 'one review per order');
  await seller.c.post(`/orders/${o.id}/review`, { rating: 5 });
  assert.equal((await seller.c.post(`/reviews/${r.body.id}/reply`, { reply: 'Thank you!' })).status, 200);
  const prof = (await client(ctx.base).get(`/users/${seller.user.id}`)).body;
  assert.equal(prof.stats.sales, 1); assert.equal(prof.reviews[0].reply, 'Thank you!');
});

test('delivery order paid online: payment verified server-side, forged signatures rejected, webhooks deduplicated', async () => {
  const l = await createListing(ctx, seller.c, { title: 'Delivered phone 64GB', price: '10000' });
  const a = await address(buyer.c);
  const o = (await buyer.c.post('/orders', { listing_id: l.id, fulfillment: 'delivery', address_id: a.id, payment_method: 'online', idempotency_key: key() })).body;
  assert.equal(o.total_minor, 1000000 + 10000, 'item + ₹100 delivery');
  assert.equal((await buyer.c.post(`/orders/${o.id}/pay`, { provider: 'sandbox' })).status, 409, 'cannot pay before acceptance');
  const acc = (await seller.c.post(`/orders/${o.id}/transition`, { to: 'accepted' })).body;
  assert.equal(acc.status, 'awaiting_payment');
  assert.equal((await seller.c.post(`/orders/${o.id}/transition`, { to: 'ready_for_dispatch' })).status, 409, 'cannot ship unpaid');
  assert.equal((await buyer.c.post(`/orders/${o.id}/pay`, { provider: 'razorpay' })).status, 400, 'unconfigured provider is never offered');
  const pay = (await buyer.c.post(`/orders/${o.id}/pay`, { provider: 'sandbox' })).body;
  assert.equal(pay.checkout.kind, 'sandbox');
  const pay2 = (await buyer.c.post(`/orders/${o.id}/pay`, { provider: 'sandbox' })).body;
  assert.equal(pay2.payment_id, pay.payment_id, 'reuses the open payment intent');
  const ref = decodeURIComponent(pay.checkout.url.split('/').pop());
  // Forged client confirmation is rejected
  const forged = await buyer.c.post('/payments/callback/sandbox', { pid: pay.payment_id, order_id: ref, payment_id: 'sbx_pay_fake', signature: 'deadbeef' });
  assert.equal(forged.status, 400);
  assert.equal((await buyer.c.get(`/orders/${o.id}`)).body.status, 'awaiting_payment');
  assert.equal(ctx.q.val('SELECT status FROM payments WHERE id = ?', pay.payment_id), 'failed');
  // Retry with a new intent and a correctly signed callback
  const pay3 = (await buyer.c.post(`/orders/${o.id}/pay`, { provider: 'sandbox' })).body;
  const ref3 = decodeURIComponent(pay3.checkout.url.split('/').pop());
  const other = await makeUser(ctx);
  assert.equal((await other.c.post('/payments/callback/sandbox', { pid: pay3.payment_id, order_id: ref3, payment_id: 'sbx_pay_1', signature: sig(ref3, 'sbx_pay_1') })).status, 404, 'only the buyer can confirm');
  const ok = await buyer.c.post('/payments/callback/sandbox', { pid: pay3.payment_id, order_id: ref3, payment_id: 'sbx_pay_1', signature: sig(ref3, 'sbx_pay_1') });
  assert.equal(ok.status, 200);
  const after = (await buyer.c.get(`/orders/${o.id}`)).body;
  assert.equal(after.status, 'payment_confirmed'); assert.equal(after.payment_verified, true);
  // Webhook for the same payment: signature required, deduplicated by event id
  const body = JSON.stringify({ id: 'evt_1', event: 'payment.captured', order_id: ref3, payment_id: 'sbx_pay_1' });
  const hook = (s) => fetch(`${ctx.base}/api/v1/payments/webhook/sandbox`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-sandbox-signature': s }, body });
  assert.equal((await hook('bad')).status, 400);
  const good = crypto.createHmac('sha256', 'test-sandbox-secret').update(body).digest('hex');
  assert.equal((await hook(good)).status, 200);
  assert.equal((await (await hook(good)).json()).duplicate, true);
  assert.equal(ctx.q.val("SELECT COUNT(*) FROM order_status_history WHERE order_id = ? AND to_status = 'payment_confirmed'", o.id), 1, 'captured exactly once');
  // Fulfilment
  await seller.c.post(`/orders/${o.id}/transition`, { to: 'ready_for_dispatch' });
  const shipped = (await seller.c.post(`/orders/${o.id}/transition`, { to: 'shipped', carrier: 'Delhivery', tracking_number: 'DL123', eta_date: '2030-01-05' })).body;
  assert.equal(shipped.tracking_number, 'DL123');
  await seller.c.post(`/orders/${o.id}/transition`, { to: 'out_for_delivery' });
  assert.equal((await buyer.c.post(`/orders/${o.id}/transition`, { to: 'completed' })).body.status, 'completed');
  assert.ok((await buyer.c.get(`/orders/${o.id}`)).body.history.length >= 8, 'complete order history kept');
});

test('delivery restrictions: supported cities and cross-border are enforced', async () => {
  const l = await createListing(ctx, seller.c, { title: 'Mumbai-only delivery phone', delivery: { fee: '0', eta_min_days: 1, eta_max_days: 2, method: 'seller', supported_locations: ['Mumbai'], radius_km: null } });
  const pune = await address(buyer.c, 'IN', 'Pune');
  const r = await buyer.c.post('/orders', { listing_id: l.id, fulfillment: 'delivery', address_id: pune.id, payment_method: 'cash_on_delivery', idempotency_key: key() });
  assert.equal(r.status, 400); assert.match(r.body.error, /delivers only to Mumbai/);
  const np = await address(buyer.c, 'NP', 'Kathmandu');
  const r2 = await buyer.c.post('/orders', { listing_id: l.id, fulfillment: 'delivery', address_id: np.id, payment_method: 'cash_on_delivery', idempotency_key: key() });
  assert.equal(r2.status, 400); assert.match(r2.body.error, /only available within India/);
  assert.equal((await buyer.c.post('/orders', { listing_id: l.id, fulfillment: 'delivery', address_id: pune.id, payment_method: 'cash_on_pickup', idempotency_key: key() })).status, 400, 'pay-at-pickup invalid for delivery');
});

test('cancellation restores stock; competing pending orders are rejected when the item sells', async () => {
  const l = await createListing(ctx, seller.c, { title: 'Popular phone 128GB', price: '5000' });
  const b2 = await makeUser(ctx);
  const o1 = (await buyer.c.post('/orders', { listing_id: l.id, fulfillment: 'pickup', payment_method: 'cash_on_pickup', idempotency_key: key() })).body;
  const o2 = (await b2.c.post('/orders', { listing_id: l.id, fulfillment: 'pickup', payment_method: 'direct', idempotency_key: key() })).body;
  await seller.c.post(`/orders/${o1.id}/transition`, { to: 'accepted' });
  assert.equal((await b2.c.get(`/orders/${o2.id}`)).body.status, 'rejected');
  await buyer.c.post(`/orders/${o1.id}/transition`, { to: 'cancelled', note: 'changed my mind' });
  assert.equal(ctx.q.get('SELECT status, quantity FROM listings WHERE id = ?', l.id).status, 'active');
  assert.equal(ctx.q.val('SELECT quantity FROM listings WHERE id = ?', l.id), 1);
});

test('dispute → admin refund of a verified payment', async () => {
  const l = await createListing(ctx, seller.c, { title: 'Disputed phone 64GB', price: '3000' });
  const a = await address(buyer.c);
  const o = (await buyer.c.post('/orders', { listing_id: l.id, fulfillment: 'delivery', address_id: a.id, payment_method: 'online', idempotency_key: key() })).body;
  await seller.c.post(`/orders/${o.id}/transition`, { to: 'accepted' });
  const pay = (await buyer.c.post(`/orders/${o.id}/pay`, { provider: 'sandbox' })).body;
  const ref = decodeURIComponent(pay.checkout.url.split('/').pop());
  await buyer.c.post('/payments/callback/sandbox', { pid: pay.payment_id, order_id: ref, payment_id: 'sbx_pay_d', signature: sig(ref, 'sbx_pay_d') });
  await seller.c.post(`/orders/${o.id}/transition`, { to: 'ready_for_dispatch' });
  await seller.c.post(`/orders/${o.id}/transition`, { to: 'shipped' });
  assert.equal((await buyer.c.post(`/orders/${o.id}/transition`, { to: 'disputed' })).status, 400, 'reason required');
  const d = await buyer.c.post(`/orders/${o.id}/transition`, { to: 'disputed', reason: 'Item not received', note: 'Nothing arrived' });
  assert.equal(d.body.status, 'disputed');
  const list = (await admin.get('/admin/disputes')).body;
  const disp = list.find((x) => x.order_id === o.id);
  assert.ok(disp);
  const res = await admin.post(`/admin/disputes/${disp.id}`, { action: 'refund_buyer', note: 'Courier confirmed loss' });
  assert.equal(res.status, 200);
  const fin = (await buyer.c.get(`/orders/${o.id}`)).body;
  assert.equal(fin.status, 'refunded');
  assert.equal(fin.refunds[0].status, 'processed');
  assert.equal(fin.refunds[0].amount_minor, o.total_minor);
  assert.equal(ctx.q.val('SELECT status FROM payments WHERE id = ?', pay.payment_id), 'refunded');
  assert.ok(ctx.q.val("SELECT COUNT(*) FROM audit_logs WHERE action = 'order.refund'") >= 1);
});

test('notifications are created for key events and can be marked read', async () => {
  const n = (await seller.c.get('/notifications')).body;
  assert.ok(n.some((x) => x.type === 'order'));
  assert.ok(n.some((x) => x.type === 'offer'));
  await seller.c.post('/notifications/read', {});
  assert.equal((await seller.c.get('/auth/me')).body.counts.notifications, 0);
  const prefs = (await seller.c.get('/me/notification-preferences')).body;
  prefs.prefs.order.email = false;
  assert.equal((await seller.c.put('/me/notification-preferences', prefs.prefs)).status, 200);
});
