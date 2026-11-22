// Provider-independent payment adapters. Each adapter implements:
//   isConfigured(), createCheckout(order, payment), verifyCallback(payment, body),
//   verifyWebhook(headers, rawBody), refund(payment, amountMinor)
// The frontend is never trusted: an order is only marked paid after server-side signature verification.
import { config } from '../config.js';
import { hmacHex, hmacB64, safeEqual, randomToken } from '../lib/security.js';
import { toMajorString } from '../lib/money.js';

const razorpay = {
  id: 'razorpay',
  label: 'Razorpay (UPI, cards, netbanking)',
  countries: ['IN'],
  currencies: ['INR'],
  mode: () => (config.razorpay.keyId.startsWith('rzp_live') ? 'live' : 'test'),
  isConfigured: () => !!(config.razorpay.keyId && config.razorpay.keySecret),
  async createProviderOrder(order) {
    const auth = Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString('base64');
    const r = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: order.total_minor, currency: order.currency, receipt: order.number, notes: { order_id: String(order.id) } }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.id) throw new Error(j?.error?.description || 'Could not reach Razorpay.');
    return j.id;
  },
  checkout(order, payment) {
    return {
      kind: 'razorpay',
      script: 'https://checkout.razorpay.com/v1/checkout.js',
      options: { key: config.razorpay.keyId, order_id: payment.provider_order_id, amount: order.total_minor, currency: order.currency, name: 'PASAL', description: `Order ${order.number}` },
    };
  },
  verifyCallback(payment, body) {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body || {};
    if (razorpay_order_id !== payment.provider_order_id || !razorpay_payment_id) return { ok: false, reason: 'Mismatched order' };
    const expected = hmacHex(config.razorpay.keySecret, `${razorpay_order_id}|${razorpay_payment_id}`);
    return safeEqual(expected, razorpay_signature) ? { ok: true, providerPaymentId: razorpay_payment_id } : { ok: false, reason: 'Invalid signature' };
  },
  verifyWebhook(headers, raw) {
    if (!config.razorpay.webhookSecret) return { ok: false, reason: 'Webhook secret not configured' };
    const expected = hmacHex(config.razorpay.webhookSecret, raw);
    if (!safeEqual(expected, headers['x-razorpay-signature'])) return { ok: false, reason: 'Invalid signature' };
    const body = JSON.parse(raw.toString());
    const p = body?.payload?.payment?.entity || {};
    return {
      ok: true,
      eventId: headers['x-razorpay-event-id'] || `${body.event}:${p.id}`,
      type: body.event,
      providerOrderId: p.order_id,
      providerPaymentId: p.id,
      status: body.event === 'payment.captured' || body.event === 'order.paid' ? 'captured' : body.event === 'payment.failed' ? 'failed' : 'ignored',
    };
  },
  async refund(payment, amountMinor) {
    const auth = Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString('base64');
    const r = await fetch(`https://api.razorpay.com/v1/payments/${payment.provider_payment_id}/refund`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: amountMinor }),
    });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, providerRefundId: j.id } : { ok: false, reason: j?.error?.description || 'Refund failed' };
  },
};

const esewa = {
  id: 'esewa',
  label: 'eSewa',
  countries: ['NP'],
  currencies: ['NPR'],
  mode: () => (config.esewa.formUrl.includes('rc-epay') ? 'test' : 'live'),
  isConfigured: () => !!(config.esewa.productCode && config.esewa.secretKey),
  async createProviderOrder(order) {
    return `${order.number}-${randomToken(6)}`; // transaction_uuid
  },
  sign(fields, names) {
    const msg = names.split(',').map((n) => `${n}=${fields[n]}`).join(',');
    return hmacB64(config.esewa.secretKey, msg);
  },
  checkout(order, payment) {
    const total = toMajorString(order.total_minor);
    const fields = {
      amount: total, tax_amount: '0', total_amount: total,
      transaction_uuid: payment.provider_order_id, product_code: config.esewa.productCode,
      product_service_charge: '0', product_delivery_charge: '0',
      success_url: `${config.publicUrl}/api/v1/payments/return/esewa?pid=${payment.id}`,
      failure_url: `${config.publicUrl}/orders/${order.id}?payment=failed`,
      signed_field_names: 'total_amount,transaction_uuid,product_code',
    };
    fields.signature = this.sign(fields, fields.signed_field_names);
    return { kind: 'form', action: config.esewa.formUrl, fields };
  },
  async verifyCallback(payment, body) {
    let data;
    try { data = JSON.parse(Buffer.from(String(body.data || ''), 'base64').toString('utf8')); } catch { return { ok: false, reason: 'Malformed response' }; }
    if (!data.signed_field_names || !data.signature) return { ok: false, reason: 'Unsigned response' };
    if (!safeEqual(this.sign(data, data.signed_field_names), data.signature)) return { ok: false, reason: 'Invalid signature' };
    if (data.transaction_uuid !== payment.provider_order_id) return { ok: false, reason: 'Mismatched transaction' };
    const paid = Math.round(Number(String(data.total_amount).replace(/,/g, '')) * 100);
    if (paid !== payment.amount_minor || data.status !== 'COMPLETE') return { ok: false, reason: 'Amount or status mismatch' };
    // Double-check with eSewa's status API (server-to-server).
    try {
      const u = `${config.esewa.statusUrl}?product_code=${encodeURIComponent(config.esewa.productCode)}&total_amount=${toMajorString(payment.amount_minor)}&transaction_uuid=${encodeURIComponent(payment.provider_order_id)}`;
      const s = await (await fetch(u)).json();
      if (s.status !== 'COMPLETE') return { ok: false, reason: `Status check: ${s.status}` };
    } catch {
      return { ok: false, reason: 'Could not confirm with eSewa' };
    }
    return { ok: true, providerPaymentId: data.transaction_code };
  },
  verifyWebhook() { return { ok: false, reason: 'eSewa does not send webhooks; use status API.' }; },
  async refund() { return { ok: false, manual: true, reason: 'eSewa refunds are processed manually from the merchant portal.' }; },
};

// Built-in test gateway: behaves like a real hosted gateway (signed callback + signed webhook),
// but no money moves. Only offered when ENABLE_DEV_TOOLS is on or the admin enables test mode.
const sandbox = {
  id: 'sandbox',
  label: 'Test payment (no real money)',
  countries: ['IN', 'NP'],
  currencies: ['INR', 'NPR'],
  mode: () => 'test',
  isConfigured: () => true,
  async createProviderOrder() { return `sbx_order_${randomToken(10)}`; },
  checkout(order, payment) {
    return { kind: 'sandbox', url: `/pay/test/${encodeURIComponent(payment.provider_order_id)}` };
  },
  /** Called by the simulated gateway page: produces what a gateway would hand back to the browser. */
  simulate(payment, outcome) {
    if (outcome !== 'success') return { failed: true };
    const pid = `sbx_pay_${randomToken(10)}`;
    return { order_id: payment.provider_order_id, payment_id: pid, signature: hmacHex(config.sandboxPaymentSecret, `${payment.provider_order_id}|${pid}`) };
  },
  verifyCallback(payment, body) {
    const { order_id, payment_id, signature } = body || {};
    if (order_id !== payment.provider_order_id || !payment_id) return { ok: false, reason: 'Mismatched order' };
    return safeEqual(hmacHex(config.sandboxPaymentSecret, `${order_id}|${payment_id}`), signature)
      ? { ok: true, providerPaymentId: payment_id }
      : { ok: false, reason: 'Invalid signature' };
  },
  verifyWebhook(headers, raw) {
    if (!safeEqual(hmacHex(config.sandboxPaymentSecret, raw), headers['x-sandbox-signature'])) return { ok: false, reason: 'Invalid signature' };
    const b = JSON.parse(raw.toString());
    return { ok: true, eventId: b.id, type: b.event, providerOrderId: b.order_id, providerPaymentId: b.payment_id, status: b.event === 'payment.captured' ? 'captured' : 'failed' };
  },
  async refund() { return { ok: true, providerRefundId: `sbx_rfnd_${randomToken(8)}` }; },
};

export const providers = { razorpay, esewa, sandbox };
export const getProvider = (id) => providers[id];
