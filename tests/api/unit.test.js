import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.RAZORPAY_KEY_ID = 'rzp_test_abc';
process.env.RAZORPAY_KEY_SECRET = 'rzp_secret_123';
process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_456';
process.env.ESEWA_PRODUCT_CODE = 'EPAYTEST';
process.env.ESEWA_SECRET_KEY = 'esewa_secret';

const { toMinor, toMajorString, applyBps, convertMinor, formatMoney } = await import('../../server/lib/money.js');
const { canTransition, nextActions, timelineSteps } = await import('../../server/lib/orderflow.js');
const { providers } = await import('../../server/providers/payments.js');
const { normalizePhone, cleanText, hashPassword, verifyPassword, can } = await import('../../server/lib/security.js');

test('money: parses user input to integer minor units without float error', () => {
  assert.equal(toMinor('1,25,000.50'), 12500050);
  assert.equal(toMinor('0.1'), 10);
  assert.equal(toMinor(19.99), 1999);
  assert.equal(toMinor('74999'), 7499900);
  assert.throws(() => toMinor('-5'));
  assert.throws(() => toMinor('12.345'));
  assert.throws(() => toMinor('abc'));
  assert.equal(toMajorString(1999), '19.99');
  assert.equal(toMajorString(100000), '1000.00');
});

test('money: basis points and FX conversion round half-up with BigInt', () => {
  assert.equal(applyBps(10001, 250), 250); // 2.5% of 100.01 = 2.500025 → 2.50
  assert.equal(applyBps(999, 50), 5);
  assert.equal(convertMinor(10000, 1_600_000), 16000); // ₹100 → रू160
  assert.equal(convertMinor(16000, 625_000), 10000);
  assert.equal(convertMinor(1, 1_600_000), 2);
  assert.match(formatMoney(12500000, 'INR'), /₹ 1,25,000/);
  assert.match(formatMoney(150, 'NPR'), /रू 1.50/);
});

test('orderflow: only valid actors can perform valid transitions', () => {
  const o = { status: 'pending_seller_confirmation', fulfillment: 'pickup', payment_method: 'cash_on_pickup' };
  assert.ok(canTransition(o, 'accepted', 'seller').ok);
  assert.ok(!canTransition(o, 'accepted', 'buyer').ok);
  assert.ok(!canTransition(o, 'completed', 'seller').ok);
  assert.ok(!canTransition({ ...o, status: 'awaiting_payment' }, 'payment_confirmed', 'buyer').ok, 'buyer cannot confirm payment');
  assert.ok(canTransition({ ...o, status: 'awaiting_payment' }, 'payment_confirmed', 'system').ok);
  assert.ok(!canTransition({ ...o, status: 'accepted', payment_method: 'online' }, 'ready_for_pickup', 'seller').ok, 'cannot skip online payment');
  assert.ok(!canTransition({ ...o, status: 'accepted' }, 'ready_for_dispatch', 'seller').ok, 'pickup order cannot be dispatched');
  assert.ok(!canTransition({ ...o, status: 'cancelled' }, 'accepted', 'seller').ok, 'terminal');
  const old = new Date(Date.now() - 10 * 86400_000).toISOString().replace('T', ' ').slice(0, 19);
  assert.ok(!canTransition({ ...o, status: 'completed', completed_at: old }, 'disputed', 'buyer').ok, '7-day dispute window');
  assert.deepEqual(nextActions({ ...o, status: 'pending_seller_confirmation' }, 'seller').sort(), ['accepted', 'rejected']);
  assert.deepEqual(timelineSteps({ fulfillment: 'delivery', payment_method: 'online' }), ['pending_seller_confirmation', 'accepted', 'awaiting_payment', 'payment_confirmed', 'ready_for_dispatch', 'shipped', 'out_for_delivery', 'completed']);
});

test('razorpay: callback and webhook signatures are verified with HMAC-SHA256', () => {
  const rz = providers.razorpay;
  const payment = { provider_order_id: 'order_ABC' };
  const sig = crypto.createHmac('sha256', 'rzp_secret_123').update('order_ABC|pay_XYZ').digest('hex');
  assert.ok(rz.verifyCallback(payment, { razorpay_order_id: 'order_ABC', razorpay_payment_id: 'pay_XYZ', razorpay_signature: sig }).ok);
  assert.ok(!rz.verifyCallback(payment, { razorpay_order_id: 'order_ABC', razorpay_payment_id: 'pay_XYZ', razorpay_signature: sig.replace(/.$/, '0') }).ok);
  assert.ok(!rz.verifyCallback(payment, { razorpay_order_id: 'order_OTHER', razorpay_payment_id: 'pay_XYZ', razorpay_signature: sig }).ok);
  const body = Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_XYZ', order_id: 'order_ABC' } } } }));
  const wsig = crypto.createHmac('sha256', 'whsec_456').update(body).digest('hex');
  const v = rz.verifyWebhook({ 'x-razorpay-signature': wsig, 'x-razorpay-event-id': 'evt_1' }, body);
  assert.equal(v.ok, true); assert.equal(v.status, 'captured'); assert.equal(v.providerOrderId, 'order_ABC');
  assert.equal(rz.verifyWebhook({ 'x-razorpay-signature': 'bad' }, body).ok, false);
});

test('esewa: request signature uses signed_field_names in order', () => {
  const e = providers.esewa;
  const co = e.checkout({ id: 1, total_minor: 150000, number: 'PSL-1' }, { id: 9, provider_order_id: 'PSL-1-abc' });
  const expected = crypto.createHmac('sha256', 'esewa_secret').update('total_amount=1500.00,transaction_uuid=PSL-1-abc,product_code=EPAYTEST').digest('base64');
  assert.equal(co.fields.signature, expected);
  assert.equal(co.fields.signed_field_names, 'total_amount,transaction_uuid,product_code');
});

test('security: phone normalisation for India (+91) and Nepal (+977)', () => {
  assert.equal(normalizePhone('98765 43210', 'IN'), '+919876543210');
  assert.equal(normalizePhone('+91 9876543210', 'IN'), '+919876543210');
  assert.equal(normalizePhone('09876543210', 'IN'), '+919876543210');
  assert.equal(normalizePhone('1234567890', 'IN'), null);
  assert.equal(normalizePhone('9841234567', 'NP'), '+9779841234567');
  assert.equal(normalizePhone('+977 9761234567', 'NP'), '+9779761234567');
  assert.equal(normalizePhone('9541234567', 'NP'), null);
});

test('security: password hashing, sanitising and permissions', async () => {
  const h = await hashPassword('Secr3t!pass');
  assert.ok(h.startsWith('scrypt$'));
  assert.ok(await verifyPassword('Secr3t!pass', h));
  assert.ok(!(await verifyPassword('wrong', h)));
  assert.equal(cleanText('<script>alert(1)</script>Hello <b>there</b>'), 'alert(1)Hello there');
  assert.ok(can({ role: 'moderator' }, 'listings.moderate'));
  assert.ok(!can({ role: 'moderator' }, 'refunds.manage'));
  assert.ok(!can({ role: 'support' }, 'listings.moderate'));
  assert.ok(can({ role: 'support' }, 'tickets.manage'));
  assert.ok(!can({ role: 'user' }, 'admin.access'));
});
