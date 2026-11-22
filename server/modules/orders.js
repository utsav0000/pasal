import crypto from 'node:crypto';
import { z } from 'zod';
import { q, tx, json } from '../db.js';
import { config } from '../config.js';
import { bad, notFound, forbidden, conflict, validate, zId, rateLimit, HttpError } from '../lib/http.js';
import { cleanText, safeEqual, hmacHex } from '../lib/security.js';
import { applyBps, formatMoney } from '../lib/money.js';
import { notify, audit, getSetting } from '../lib/services.js';
import { emitTo } from '../lib/realtime.js';
import { canTransition, nextActions, afterAccept, timelineSteps, STATUS_LABELS, OPEN_FOR_DISPUTE } from '../lib/orderflow.js';
import { providers, getProvider } from '../providers/payments.js';
import { postMessage, openConversation } from './messaging.js';

const nowSql = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

// ---------------- Payment availability ----------------
export function paymentProvidersFor(currency, country) {
  const enabled = getSetting('payment_providers') || {};
  const testMode = getSetting('payments_test_mode');
  return Object.values(providers)
    .filter((p) => enabled[p.id] !== false && p.currencies.includes(currency) && p.countries.includes(country) && p.isConfigured())
    .filter((p) => p.id !== 'sandbox' || testMode)
    .map((p) => ({ id: p.id, label: p.label, mode: p.mode() }));
}

export function paymentMethodsFor(listing, fulfillment) {
  const online = paymentProvidersFor(listing.currency, listing.country_code);
  const methods = [];
  if (online.length) methods.push({ id: 'online', label: 'Pay online through PASAL', verified: true, providers: online });
  if (fulfillment === 'pickup') methods.push({ id: 'cash_on_pickup', label: 'Pay the seller at pickup', verified: false });
  if (fulfillment === 'delivery') methods.push({ id: 'cash_on_delivery', label: 'Cash on delivery (to the seller)', verified: false });
  methods.push({ id: 'direct', label: 'Arrange payment directly with the seller', verified: false });
  return methods;
}

function deliveryCheck(listing, delivery, address) {
  if (!delivery) return { ok: false, reason: 'This seller does not deliver.' };
  if (!address) return { ok: true };
  if (address.country_code !== listing.country_code && !getSetting('cross_border_enabled')) return { ok: false, reason: `Delivery is only available within ${listing.country_code === 'IN' ? 'India' : 'Nepal'}.` };
  const supported = json(delivery.supported_locations, []);
  const city = q.get('SELECT name, lat, lng FROM locations WHERE id = ?', address.city_id);
  if (supported.length && !supported.some((s) => s.toLowerCase() === city?.name?.toLowerCase())) return { ok: false, reason: `The seller delivers only to ${supported.join(', ')}.` };
  if (!supported.length && delivery.radius_km && listing.lat != null && city?.lat != null) {
    const R = 6371, toR = (d) => (d * Math.PI) / 180;
    const dLat = toR(city.lat - listing.lat), dLng = toR(city.lng - listing.lng);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(listing.lat)) * Math.cos(toR(city.lat)) * Math.sin(dLng / 2) ** 2;
    const km = 2 * R * Math.asin(Math.sqrt(a));
    if (km > delivery.radius_km) return { ok: false, reason: `This address is about ${Math.round(km)} km away; the seller delivers within ${delivery.radius_km} km.` };
  }
  return { ok: true };
}

function usableOffer(offerId, listing, buyerId) {
  if (!offerId) return null;
  const o = q.get('SELECT * FROM offers WHERE id = ?', offerId);
  if (!o || o.listing_id !== listing.id || o.buyer_id !== buyerId) throw bad('That offer does not apply to this listing.');
  if (o.status !== 'accepted') throw conflict(o.status === 'used' ? 'This offer was already used for an order.' : 'Only accepted offers can be used at checkout.');
  if (o.expires_at < nowSql()) throw conflict('This accepted offer has expired. Ask the seller for a new one.');
  return o;
}

function quote(listing, { quantity = 1, fulfillment, offer, address }) {
  const delivery = q.get('SELECT * FROM delivery_options WHERE listing_id = ?', listing.id);
  const unit = offer ? offer.amount_minor : listing.price_minor;
  const qty = offer ? 1 : quantity;
  const subtotal = unit * qty;
  const deliveryFee = fulfillment === 'delivery' ? delivery?.fee_minor || 0 : 0;
  return { unit_price_minor: unit, quantity: qty, subtotal_minor: subtotal, delivery_fee_minor: deliveryFee, delivery, check: fulfillment === 'delivery' ? deliveryCheck(listing, delivery, address) : { ok: true } };
}

// ---------------- Transitions ----------------
export function transitionOrder(orderId, to, actor, actorId, extra = {}) {
  return tx(() => {
    const order = q.get('SELECT * FROM orders WHERE id = ?', orderId);
    if (!order) throw notFound('Order not found.');
    const check = canTransition(order, to, actor);
    if (!check.ok) throw conflict(check.reason);
    const from = order.status;
    const sets = { status: to };

    if (to === 'accepted') {
      const l = q.get('SELECT * FROM listings WHERE id = ?', order.listing_id);
      const qty = q.val('SELECT quantity FROM order_items WHERE order_id = ?', order.id);
      if (!['active', 'paused'].includes(l.status) || l.quantity < qty) throw conflict('This item is no longer available in that quantity.');
      const left = l.quantity - qty;
      q.run(`UPDATE listings SET quantity = ?, status = CASE WHEN ? = 0 THEN 'sold' ELSE status END, updated_at = datetime('now') WHERE id = ?`, left, left, l.id);
      if (left === 0) {
        // Other pending orders for the same single item can no longer be fulfilled.
        for (const o of q.all("SELECT id FROM orders WHERE listing_id = ? AND id != ? AND status = 'pending_seller_confirmation'", l.id, order.id)) {
          q.run("UPDATE orders SET status = 'rejected', updated_at = datetime('now') WHERE id = ?", o.id);
          q.run('INSERT INTO order_status_history (order_id, from_status, to_status, actor_id, note) VALUES (?,?,?,?,?)', o.id, 'pending_seller_confirmation', 'rejected', null, 'Item sold to another buyer.');
          const b = q.val('SELECT buyer_id FROM orders WHERE id = ?', o.id);
          notify(b, 'order', 'Order not accepted', 'The item was sold to another buyer.', `/orders/${o.id}`);
        }
        q.run("UPDATE offers SET status = 'expired' WHERE listing_id = ? AND status = 'pending'", l.id);
      }
    }
    if (['cancelled', 'rejected', 'refunded'].includes(to) && !['pending_seller_confirmation'].includes(from)) {
      // Stock was taken at acceptance: put it back.
      const qty = q.val('SELECT quantity FROM order_items WHERE order_id = ?', order.id);
      q.run("UPDATE listings SET quantity = quantity + ?, status = CASE WHEN status = 'sold' THEN 'active' ELSE status END, updated_at = datetime('now') WHERE id = ?", qty, order.listing_id);
    }
    if (to === 'cancelled' && order.offer_id) q.run("UPDATE offers SET status = 'accepted' WHERE id = ? AND status = 'used' AND expires_at > datetime('now')", order.offer_id);
    if (to === 'shipped') {
      if (extra.carrier) sets.carrier = cleanText(extra.carrier, 60);
      if (extra.tracking_number) sets.tracking_number = cleanText(extra.tracking_number, 60);
      if (extra.eta_date) sets.eta_date = extra.eta_date;
    }
    if (to === 'completed') {
      if (order.fulfillment === 'pickup' && actor === 'seller') {
        if (!extra.pickup_code || !safeEqual(String(extra.pickup_code).trim().toUpperCase(), order.pickup_code)) throw bad('Handover code does not match. Ask the buyer to show their PASAL pickup code or QR.');
      }
      sets.completed_at = nowSql();
    }
    const cols = Object.keys(sets);
    q.run(`UPDATE orders SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`, ...Object.values(sets), order.id);
    q.run('INSERT INTO order_status_history (order_id, from_status, to_status, actor_id, note) VALUES (?,?,?,?,?)', order.id, from, to, actorId ?? null, extra.note ? cleanText(extra.note, 500) : null);

    if (to === 'disputed') {
      if (!extra.reason) throw bad('Tell us what went wrong.');
      q.run('INSERT INTO disputes (order_id, opened_by, reason, details, previous_status) VALUES (?,?,?,?,?)', order.id, actorId, cleanText(extra.reason, 120), cleanText(extra.note, 2000), from);
    }

    // Auto-follow-up (e.g. accepted -> awaiting_payment for online orders)
    let final = to;
    if (to === 'accepted') {
      const next = afterAccept(order);
      if (next) {
        q.run("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?", next, order.id);
        q.run('INSERT INTO order_status_history (order_id, from_status, to_status, actor_id, note) VALUES (?,?,?,?,?)', order.id, 'accepted', next, null, 'Waiting for online payment');
        final = next;
      }
    }
    afterTransition(order, from, final, actor);
    return q.get('SELECT * FROM orders WHERE id = ?', order.id);
  });
}

function afterTransition(order, from, to, actor) {
  const title = q.val('SELECT title FROM order_items WHERE order_id = ?', order.id);
  const link = `/orders/${order.id}`;
  const msgs = {
    accepted: [order.buyer_id, 'Order accepted', `The seller accepted your order for "${title}".`],
    awaiting_payment: [order.buyer_id, 'Order accepted — complete payment', `Pay ${formatMoney(order.total_minor, order.currency)} to confirm "${title}".`],
    rejected: [order.buyer_id, 'Order declined', `The seller could not accept your order for "${title}".`],
    payment_confirmed: [order.seller_id, 'Payment confirmed', `${formatMoney(order.total_minor, order.currency)} received for "${title}". Prepare the item.`],
    ready_for_dispatch: [order.buyer_id, 'Getting your order ready', `"${title}" is being packed for dispatch.`],
    shipped: [order.buyer_id, 'Order shipped', `"${title}" is on its way.`],
    out_for_delivery: [order.buyer_id, 'Out for delivery', `"${title}" will reach you soon.`],
    ready_for_pickup: [order.buyer_id, 'Ready for pickup', `"${title}" is ready. Show your pickup code to the seller at handover.`],
    completed: [actor === 'buyer' ? order.seller_id : order.buyer_id, 'Order completed', `"${title}" is complete. Leave a review to help others.`],
    cancelled: [actor === 'buyer' ? order.seller_id : order.buyer_id, 'Order cancelled', `The order for "${title}" was cancelled.`],
    disputed: [actor === 'buyer' ? order.seller_id : order.buyer_id, 'A dispute was opened', `PASAL support is reviewing the order for "${title}".`],
    refunded: [order.buyer_id, 'Refund issued', `Your payment for "${title}" has been refunded.`],
  };
  const m = msgs[to];
  if (m) notify(m[0], to.includes('payment') ? 'payment' : 'order', m[1], m[2], link);
  if (to === 'completed') notify(actor === 'buyer' ? order.buyer_id : order.seller_id, 'order', 'Rate your experience', `How did the deal for "${title}" go?`, link);
  if (to === 'payment_confirmed') notify(order.buyer_id, 'payment', 'Payment successful', `We received ${formatMoney(order.total_minor, order.currency)} for "${title}".`, link);
  emitTo(order.buyer_id, 'order', { id: order.id, status: to });
  emitTo(order.seller_id, 'order', { id: order.id, status: to });
}

// ---------------- Payments ----------------
export function capturePayment(paymentId, providerPaymentId, via, raw) {
  return tx(() => {
    const p = q.get('SELECT * FROM payments WHERE id = ?', paymentId);
    if (!p) throw notFound('Payment not found.');
    if (p.status === 'captured') return { already: true, payment: p }; // idempotent
    const dup = providerPaymentId ? q.get('SELECT id FROM payments WHERE provider_payment_id = ? AND id != ?', providerPaymentId, p.id) : null;
    if (dup) throw conflict('Duplicate transaction.');
    q.run("UPDATE payments SET status = 'captured', provider_payment_id = ?, verified_via = ?, raw = ?, updated_at = datetime('now') WHERE id = ?", providerPaymentId, via, raw ? JSON.stringify(raw).slice(0, 4000) : null, p.id);
    const order = q.get('SELECT * FROM orders WHERE id = ?', p.order_id);
    if (order.status === 'awaiting_payment') {
      transitionOrder(order.id, 'payment_confirmed', 'system', null, { note: `Verified via ${p.provider} ${via}` });
    } else {
      // Paid after the order moved on (e.g. cancelled): flag for refund.
      q.run("INSERT INTO refunds (payment_id, order_id, amount_minor, currency, status, reason) VALUES (?,?,?,?, 'pending', ?)", p.id, order.id, p.amount_minor, p.currency, `Payment arrived while order was ${order.status}`);
      audit(null, 'payment.late_capture', 'order', order.id, { payment: p.id });
    }
    return { payment: q.get('SELECT * FROM payments WHERE id = ?', p.id) };
  });
}

function failPayment(paymentId, reason) {
  q.run("UPDATE payments SET status = 'failed', failure_reason = ?, updated_at = datetime('now') WHERE id = ? AND status = 'created'", String(reason).slice(0, 200), paymentId);
}

export async function refundOrder(orderId, amountMinor, reason, actorId, ip) {
  const order = q.get('SELECT * FROM orders WHERE id = ?', orderId);
  if (!order) throw notFound('Order not found.');
  const p = q.get("SELECT * FROM payments WHERE order_id = ? AND status IN ('captured','partially_refunded') ORDER BY id DESC LIMIT 1", order.id);
  if (!p) throw conflict('There is no verified online payment to refund. Direct payments must be settled between buyer and seller.');
  const already = q.val("SELECT COALESCE(SUM(amount_minor), 0) FROM refunds WHERE payment_id = ? AND status IN ('processed','manual')", p.id);
  const amount = amountMinor ?? p.amount_minor - already;
  if (amount <= 0 || amount + already > p.amount_minor) throw bad('Refund amount exceeds what was paid.');
  const res = await getProvider(p.provider).refund(p, amount);
  const status = res.ok ? 'processed' : res.manual ? 'manual' : 'failed';
  q.run('INSERT INTO refunds (payment_id, order_id, amount_minor, currency, status, provider_refund_id, reason, created_by) VALUES (?,?,?,?,?,?,?,?)', p.id, order.id, amount, p.currency, status, res.providerRefundId || null, cleanText(reason, 300), actorId);
  if (status === 'failed') throw new HttpError(502, `Refund failed: ${res.reason}`);
  const full = amount + already >= p.amount_minor;
  q.run("UPDATE payments SET status = ?, updated_at = datetime('now') WHERE id = ?", full ? 'refunded' : 'partially_refunded', p.id);
  if (full && ['payment_confirmed', 'disputed'].includes(order.status)) transitionOrder(order.id, 'refunded', 'admin', actorId, { note: reason });
  audit(actorId, 'order.refund', 'order', order.id, { amount, status, provider: p.provider }, ip);
  return { status, amount, manual: !!res.manual, note: res.manual ? res.reason : null };
}

// ---------------- Views ----------------
function orderView(order, viewer) {
  const role = viewer.id === order.buyer_id ? 'buyer' : viewer.id === order.seller_id ? 'seller' : 'admin';
  const items = q.all('SELECT * FROM order_items WHERE order_id = ?', order.id);
  const history = q.all('SELECT h.*, u.name AS actor_name FROM order_status_history h LEFT JOIN users u ON u.id = h.actor_id WHERE order_id = ? ORDER BY h.id', order.id);
  const payments = q.all('SELECT id, provider, provider_order_id, provider_payment_id, amount_minor, currency, status, verified_via, failure_reason, created_at FROM payments WHERE order_id = ? ORDER BY id DESC', order.id);
  const refunds = q.all('SELECT * FROM refunds WHERE order_id = ? ORDER BY id DESC', order.id);
  const buyer = q.get('SELECT id, name, avatar_url, phone FROM users WHERE id = ?', order.buyer_id);
  const seller = q.get('SELECT id, name, avatar_url, phone, seller_status FROM users WHERE id = ?', order.seller_id);
  const dispute = q.get('SELECT * FROM disputes WHERE order_id = ? ORDER BY id DESC LIMIT 1', order.id);
  const myReview = q.get('SELECT * FROM reviews WHERE order_id = ? AND author_id = ?', order.id, viewer.id);
  const listing = q.get('SELECT id, slug, title, status FROM listings WHERE id = ?', order.listing_id);
  const conv = q.get('SELECT id FROM conversations WHERE listing_id = ? AND buyer_id = ?', order.listing_id, order.buyer_id);
  const showPhone = !['pending_seller_confirmation', 'rejected', 'cancelled'].includes(order.status);
  const actions = role === 'admin' ? nextActions(order, 'admin') : nextActions(order, role);
  const pickupVisible = role === 'buyer' && order.fulfillment === 'pickup' && ['ready_for_pickup', 'payment_confirmed', 'accepted'].includes(order.status);
  return {
    ...order,
    status_label: STATUS_LABELS[order.status],
    role, items, history, payments, refunds, dispute, listing, conversation_id: conv?.id || null,
    address: json(order.address_json), pickup: json(order.pickup_json),
    pickup_code: pickupVisible ? order.pickup_code : undefined,
    pickup_qr_payload: pickupVisible ? `PASAL:${order.number}:${order.pickup_code}` : undefined,
    buyer: { ...buyer, phone: showPhone && role !== 'buyer' ? buyer.phone : undefined },
    seller: { ...seller, verified: seller.seller_status === 'verified', phone: showPhone && role !== 'seller' ? seller.phone : undefined },
    actions, timeline: timelineSteps(order), can_review: order.status === 'completed' && !myReview && role !== 'admin', my_review: myReview || null,
    can_dispute: role !== 'admin' && OPEN_FOR_DISPUTE.has(order.status) && actions.includes('disputed'),
    can_pay: role === 'buyer' && order.status === 'awaiting_payment',
    payment_verified: payments.some((p) => p.status === 'captured' || p.status === 'refunded' || p.status === 'partially_refunded'),
    providers: order.status === 'awaiting_payment' ? paymentProvidersFor(order.currency, q.val('SELECT country_code FROM listings WHERE id = ?', order.listing_id)) : [],
  };
}

const orderSchema = z.object({
  listing_id: zId,
  offer_id: zId.optional().nullable(),
  quantity: z.coerce.number().int().min(1).max(99).default(1),
  fulfillment: z.enum(['delivery', 'pickup']),
  address_id: zId.optional().nullable(),
  payment_method: z.enum(['online', 'cash_on_pickup', 'cash_on_delivery', 'direct']),
  note: z.string().trim().max(500).optional(),
  idempotency_key: z.string().min(8).max(80),
});

export function register(r) {
  r.get('/api/v1/checkout/:listingId', (ctx) => {
    const l = q.get('SELECT * FROM listings WHERE id = ?', Number(ctx.params.listingId));
    if (!l) throw notFound('Listing not found.');
    if (l.status !== 'active') throw conflict('This item is no longer available.');
    if (l.seller_id === ctx.user.id) throw bad('You cannot buy your own listing.');
    const offer = ctx.query.offer ? usableOffer(Number(ctx.query.offer), l, ctx.user.id) : null;
    const addresses = q.all(`SELECT a.*, c.name AS city_name FROM addresses a LEFT JOIN locations c ON c.id = a.city_id WHERE a.user_id = ? ORDER BY a.is_default DESC, a.id DESC`, ctx.user.id);
    const pickup = q.get('SELECT * FROM pickup_options WHERE listing_id = ?', l.id);
    const options = ['delivery', 'both'].includes(l.fulfillment) ? ['delivery'] : [];
    if (['pickup', 'both'].includes(l.fulfillment)) options.unshift('pickup');
    const seller = q.get('SELECT id, name, avatar_url, seller_status FROM users WHERE id = ?', l.seller_id);
    const image = q.val('SELECT thumb_url FROM listing_images WHERE listing_id = ? ORDER BY sort LIMIT 1', l.id);
    const city = q.get('SELECT name FROM locations WHERE id = ?', l.city_id);
    const delivery = q.get('SELECT * FROM delivery_options WHERE listing_id = ?', l.id);
    const deliverability = Object.fromEntries(addresses.map((a) => [a.id, deliveryCheck(l, delivery, a)]));
    return {
      listing: { id: l.id, slug: l.slug, title: l.title, price_minor: l.price_minor, currency: l.currency, quantity: l.quantity, country_code: l.country_code, condition: l.condition, image, city: city?.name },
      seller: { ...seller, verified: seller.seller_status === 'verified' },
      offer, fulfillment_options: options,
      delivery: delivery ? { ...delivery, supported_locations: json(delivery.supported_locations, []) } : null,
      pickup, addresses, deliverability,
      payment_methods: { pickup: paymentMethodsFor(l, 'pickup'), delivery: paymentMethodsFor(l, 'delivery') },
      platform_fee_bps: getSetting('platform_fee_bps'),
    };
  }, { auth: true });

  r.post('/api/v1/orders', (ctx) => {
    const b = validate(orderSchema, ctx.body);
    rateLimit(`order:${ctx.user.id}`, 20, 3600_000);
    const existing = q.get('SELECT id, buyer_id FROM orders WHERE idempotency_key = ?', b.idempotency_key);
    if (existing) {
      if (existing.buyer_id !== ctx.user.id) throw conflict('Duplicate request.');
      return orderView(q.get('SELECT * FROM orders WHERE id = ?', existing.id), ctx.user);
    }
    if (!ctx.user.email_verified_at && !ctx.user.phone_verified_at) throw forbidden('Verify your email or phone number before placing an order.');
    const order = tx(() => {
      const l = q.get('SELECT * FROM listings WHERE id = ?', b.listing_id);
      if (!l || l.status !== 'active') throw conflict('This item is no longer available.');
      if (l.seller_id === ctx.user.id) throw bad('You cannot buy your own listing.');
      if (b.quantity > l.quantity) throw bad(`Only ${l.quantity} available.`);
      const allowed = l.fulfillment === 'both' ? ['delivery', 'pickup'] : [l.fulfillment];
      if (!allowed.includes(b.fulfillment)) throw bad(`This item is available for ${allowed.join(' or ')} only.`);
      const offer = usableOffer(b.offer_id, l, ctx.user.id);
      let address = null;
      if (b.fulfillment === 'delivery') {
        if (!b.address_id) throw bad('Choose a delivery address.');
        address = q.get('SELECT a.*, c.name AS city_name FROM addresses a LEFT JOIN locations c ON c.id = a.city_id WHERE a.id = ? AND a.user_id = ?', b.address_id, ctx.user.id);
        if (!address) throw bad('Choose a delivery address.');
      }
      const qt = quote(l, { quantity: b.quantity, fulfillment: b.fulfillment, offer, address });
      if (!qt.check.ok) throw bad(qt.check.reason);
      const methods = paymentMethodsFor(l, b.fulfillment).map((m) => m.id);
      if (!methods.includes(b.payment_method)) throw bad('That payment method is not available for this order.');
      const fee = b.payment_method === 'online' ? applyBps(qt.subtotal_minor, getSetting('platform_fee_bps') || 0) : 0;
      const total = qt.subtotal_minor + qt.delivery_fee_minor + fee;
      const pickup = b.fulfillment === 'pickup' ? q.get('SELECT * FROM pickup_options WHERE listing_id = ?', l.id) : null;
      const number = `PSL-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const code = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
      const { id } = q.run(`INSERT INTO orders (number, buyer_id, seller_id, listing_id, offer_id, status, fulfillment, payment_method, currency, subtotal_minor, delivery_fee_minor, platform_fee_minor, total_minor, address_json, pickup_json, pickup_code, buyer_note, idempotency_key, eta_date)
        VALUES (?,?,?,?,?, 'pending_seller_confirmation', ?,?,?,?,?,?,?,?,?,?,?,?, ?)`,
        number, ctx.user.id, l.seller_id, l.id, offer?.id || null, b.fulfillment, b.payment_method, l.currency, qt.subtotal_minor, qt.delivery_fee_minor, fee, total,
        address ? JSON.stringify({ full_name: address.full_name, phone: address.phone, line1: address.line1, line2: address.line2, locality: address.locality, city: address.city_name, postal_code: address.postal_code, country_code: address.country_code }) : null,
        pickup ? JSON.stringify(pickup) : null, code, cleanText(b.note, 500) || null, b.idempotency_key,
        b.fulfillment === 'delivery' && qt.delivery ? new Date(Date.now() + (qt.delivery.eta_max_days + 1) * 86400_000).toISOString().slice(0, 10) : null);
      const image = q.val('SELECT thumb_url FROM listing_images WHERE listing_id = ? ORDER BY sort LIMIT 1', l.id);
      q.run('INSERT INTO order_items (order_id, listing_id, title, image_url, unit_price_minor, quantity) VALUES (?,?,?,?,?,?)', id, l.id, l.title, image, qt.unit_price_minor, qt.quantity);
      q.run("INSERT INTO order_status_history (order_id, from_status, to_status, actor_id, note) VALUES (?, NULL, 'pending_seller_confirmation', ?, 'Order placed')", id, ctx.user.id);
      if (offer) q.run("UPDATE offers SET status = 'used' WHERE id = ?", offer.id);
      const conv = openConversation(l.id, ctx.user.id);
      postMessage(conv, ctx.user.id, { kind: 'system', body: `Order ${number} placed · ${formatMoney(total, l.currency)} · ${b.fulfillment === 'pickup' ? 'Self pickup' : 'Home delivery'}` });
      notify(l.seller_id, 'order', 'New order received', `${ctx.user.name} ordered "${l.title}". Accept it to continue.`, `/orders/${id}`);
      return q.get('SELECT * FROM orders WHERE id = ?', id);
    });
    emitTo(order.seller_id, 'order', { id: order.id, status: order.status });
    return orderView(order, ctx.user);
  }, { auth: true });

  r.get('/api/v1/orders', (ctx) => {
    const col = ctx.query.role === 'selling' ? 'seller_id' : 'buyer_id';
    const groups = {
      open: "status NOT IN ('completed','cancelled','rejected','refunded')",
      pending: "status = 'pending_seller_confirmation'",
      completed: "status = 'completed'",
      closed: "status IN ('cancelled','rejected','refunded')",
    };
    const filter = groups[ctx.query.status] ? `AND ${groups[ctx.query.status]}` : '';
    const rows = q.all(`SELECT o.id, o.number, o.status, o.fulfillment, o.payment_method, o.currency, o.total_minor, o.created_at, o.updated_at,
      i.title, i.image_url, ub.name AS buyer_name, us.name AS seller_name
      FROM orders o JOIN order_items i ON i.order_id = o.id JOIN users ub ON ub.id = o.buyer_id JOIN users us ON us.id = o.seller_id
      WHERE o.${col} = ? ${filter} ORDER BY o.updated_at DESC LIMIT 200`, ctx.user.id);
    return rows.map((o) => ({ ...o, status_label: STATUS_LABELS[o.status] }));
  }, { auth: true });

  r.get('/api/v1/orders/:id', (ctx) => {
    const o = q.get('SELECT * FROM orders WHERE id = ?', Number(ctx.params.id));
    if (!o) throw notFound('Order not found.');
    const staff = ['support', 'admin', 'super_admin'].includes(ctx.user.role);
    if (o.buyer_id !== ctx.user.id && o.seller_id !== ctx.user.id && !staff) throw notFound('Order not found.');
    return orderView(o, ctx.user);
  }, { auth: true });

  r.post('/api/v1/orders/:id/transition', (ctx) => {
    const b = validate(z.object({
      to: z.enum(Object.keys(STATUS_LABELS)),
      note: z.string().trim().max(2000).optional(),
      reason: z.string().trim().max(120).optional(),
      carrier: z.string().trim().max(60).optional(),
      tracking_number: z.string().trim().max(60).optional(),
      eta_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      pickup_code: z.string().trim().max(80).optional(),
    }), ctx.body);
    const o = q.get('SELECT * FROM orders WHERE id = ?', Number(ctx.params.id));
    if (!o) throw notFound('Order not found.');
    const actor = o.buyer_id === ctx.user.id ? 'buyer' : o.seller_id === ctx.user.id ? 'seller' : null;
    if (!actor) throw forbidden();
    if (b.to === 'payment_confirmed' || b.to === 'awaiting_payment') throw forbidden('Payment status is set only after the payment is verified.');
    // QR payload "PASAL:<number>:<code>" or raw code
    let code = b.pickup_code;
    if (code?.startsWith('PASAL:')) {
      const [, num, c] = code.split(':');
      if (num !== o.number) throw bad('This QR code belongs to a different order.');
      code = c;
    }
    const updated = transitionOrder(o.id, b.to, actor, ctx.user.id, { ...b, pickup_code: code });
    return orderView(updated, ctx.user);
  }, { auth: true });

  // ---------------- Payments ----------------
  r.post('/api/v1/orders/:id/pay', async (ctx) => {
    const { provider } = validate(z.object({ provider: z.string() }), ctx.body);
    const o = q.get('SELECT * FROM orders WHERE id = ?', Number(ctx.params.id));
    if (!o || o.buyer_id !== ctx.user.id) throw notFound('Order not found.');
    if (o.status !== 'awaiting_payment') throw conflict('This order is not waiting for payment.');
    const country = q.val('SELECT country_code FROM listings WHERE id = ?', o.listing_id);
    if (!paymentProvidersFor(o.currency, country).some((p) => p.id === provider)) throw bad('That payment method is not available.');
    rateLimit(`pay:${ctx.user.id}`, 20, 600_000);
    const adapter = getProvider(provider);
    let p = q.get("SELECT * FROM payments WHERE order_id = ? AND provider = ? AND status = 'created' AND amount_minor = ?", o.id, provider, o.total_minor);
    if (!p) {
      let providerOrderId;
      try { providerOrderId = await adapter.createProviderOrder(o); } catch (e) { throw new HttpError(502, e.message); }
      const { id } = q.run('INSERT INTO payments (order_id, provider, provider_order_id, amount_minor, currency) VALUES (?,?,?,?,?)', o.id, provider, providerOrderId, o.total_minor, o.currency);
      p = q.get('SELECT * FROM payments WHERE id = ?', id);
    }
    return { payment_id: p.id, provider, checkout: adapter.checkout(o, p) };
  }, { auth: true });

  r.post('/api/v1/payments/callback/:provider', async (ctx) => {
    const adapter = getProvider(ctx.params.provider);
    if (!adapter) throw notFound();
    // `pid` is PASAL's payment id; every other field is the gateway's own response, verified by its adapter.
    const b = validate(z.object({ pid: zId }).passthrough(), ctx.body);
    const p = q.get('SELECT p.*, o.buyer_id FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.id = ? AND p.provider = ?', b.pid, adapter.id);
    if (!p || p.buyer_id !== ctx.user.id) throw notFound('Payment not found.');
    const v = await adapter.verifyCallback(p, b);
    if (!v.ok) {
      failPayment(p.id, v.reason);
      audit(ctx.user.id, 'payment.verify_failed', 'payment', p.id, { reason: v.reason }, ctx.ip);
      throw bad(`Payment could not be verified: ${v.reason}.`);
    }
    capturePayment(p.id, v.providerPaymentId, 'callback', { provider: adapter.id });
    return { ok: true, order_id: p.order_id };
  }, { auth: true });

  r.post('/api/v1/payments/:id/failed', (ctx) => {
    const p = q.get('SELECT p.*, o.buyer_id FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.id = ?', Number(ctx.params.id));
    if (!p || p.buyer_id !== ctx.user.id) throw notFound();
    failPayment(p.id, cleanText(ctx.body?.reason, 200) || 'Cancelled by buyer');
    return { ok: true };
  }, { auth: true });

  r.get('/api/v1/payments/return/esewa', async (ctx) => {
    const p = q.get("SELECT * FROM payments WHERE id = ? AND provider = 'esewa'", Number(ctx.query.pid));
    if (!p) return ctx.redirect('/orders?payment=unknown');
    const v = await getProvider('esewa').verifyCallback(p, { data: ctx.query.data });
    if (!v.ok) { failPayment(p.id, v.reason); return ctx.redirect(`/orders/${p.order_id}?payment=failed`); }
    capturePayment(p.id, v.providerPaymentId, 'callback', { provider: 'esewa' });
    return ctx.redirect(`/orders/${p.order_id}?payment=success`);
  });

  r.post('/api/v1/payments/webhook/:provider', (ctx) => handleWebhook(ctx.params.provider, ctx.req.headers, ctx.rawBody), { raw: true, csrf: false });

  // Built-in test gateway (only when test mode is on)
  r.get('/api/v1/payments/test/:ref', (ctx) => {
    if (!getSetting('payments_test_mode')) throw notFound();
    const p = q.get(`SELECT p.*, o.number, o.buyer_id, i.title FROM payments p JOIN orders o ON o.id = p.order_id JOIN order_items i ON i.order_id = o.id WHERE p.provider_order_id = ? AND p.provider = 'sandbox'`, ctx.params.ref);
    if (!p || p.buyer_id !== ctx.user.id) throw notFound('Payment not found.');
    return { id: p.id, order_id: p.order_id, number: p.number, title: p.title, amount_minor: p.amount_minor, currency: p.currency, status: p.status, provider_order_id: p.provider_order_id };
  }, { auth: true });

  r.post('/api/v1/payments/test/:ref/complete', (ctx) => {
    if (!getSetting('payments_test_mode')) throw notFound();
    const { outcome } = validate(z.object({ outcome: z.enum(['success', 'failure']) }), ctx.body);
    const p = q.get(`SELECT p.*, o.buyer_id FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.provider_order_id = ? AND p.provider = 'sandbox'`, ctx.params.ref);
    if (!p || p.buyer_id !== ctx.user.id) throw notFound('Payment not found.');
    const result = providers.sandbox.simulate(p, outcome);
    if (!result.failed) {
      // Like a real gateway, also deliver a signed server-to-server webhook shortly after.
      const body = Buffer.from(JSON.stringify({ id: `evt_${result.payment_id}`, event: 'payment.captured', order_id: result.order_id, payment_id: result.payment_id }));
      setTimeout(() => { try { handleWebhook('sandbox', { 'x-sandbox-signature': hmacHex(config.sandboxPaymentSecret, body) }, body); } catch { /* logged via audit */ } }, 800).unref();
    }
    return { pid: p.id, ...result };
  }, { auth: true });
}

export function handleWebhook(providerId, headers, raw) {
  const adapter = getProvider(providerId);
  if (!adapter) throw notFound();
  const v = adapter.verifyWebhook(headers, raw || Buffer.alloc(0));
  if (!v.ok) { audit(null, 'payment.webhook_rejected', 'provider', providerId, { reason: v.reason }); throw new HttpError(400, 'Invalid webhook signature.'); }
  const ins = q.run('INSERT OR IGNORE INTO payment_events (provider, event_id, type, payload) VALUES (?,?,?,?)', providerId, String(v.eventId), v.type, raw.toString().slice(0, 8000));
  if (!ins.changes) return { ok: true, duplicate: true };
  const p = q.get('SELECT * FROM payments WHERE provider = ? AND provider_order_id = ?', providerId, v.providerOrderId);
  if (!p) return { ok: true, ignored: 'unknown order' };
  if (v.status === 'captured') capturePayment(p.id, v.providerPaymentId, 'webhook', { event: v.type });
  else if (v.status === 'failed') failPayment(p.id, 'Gateway reported failure');
  return { ok: true };
}
