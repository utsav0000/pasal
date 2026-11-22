export const SYMBOL = { INR: '₹', NPR: 'रू' };

export function money(minor, currency = 'INR', { compact = false } = {}) {
  if (minor == null) return '—';
  const major = minor / 100;
  const sym = SYMBOL[currency] || currency;
  if (compact && major >= 100000) {
    if (major >= 10000000) return `${sym} ${(major / 10000000).toFixed(major >= 100000000 ? 0 : 2).replace(/\.?0+$/, '')} Cr`;
    return `${sym} ${(major / 100000).toFixed(2).replace(/\.?0+$/, '')} L`;
  }
  const digits = minor % 100 === 0 ? 0 : 2;
  return `${sym} ${major.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** Approximate conversion for display only. Never replaces the seller's original price. */
export function approx(minor, from, to, rate) {
  if (!rate || from === to) return null;
  return `≈ ${money(Math.round(minor * rate), to, { compact: true })}`;
}

export function majorInput(minor) { return minor == null ? '' : String(minor / 100); }

const UNITS = [[60, 'second'], [60, 'minute'], [24, 'hour'], [7, 'day'], [4.345, 'week'], [12, 'month'], [Infinity, 'year']];
export function ago(ts) {
  if (!ts) return '';
  const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
  let diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 45) return 'just now';
  for (const [n, unit] of UNITS) {
    if (Math.abs(diff) < n) { const v = Math.round(diff); return `${v} ${unit}${v === 1 ? '' : 's'} ago`; }
    diff /= n;
  }
  return '';
}
export const toDate = (ts) => (ts ? new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z') : null);
export const date = (ts, opts = { day: 'numeric', month: 'short', year: 'numeric' }) => (ts ? toDate(ts).toLocaleDateString('en-IN', opts) : '—');
export const dateTime = (ts) => (ts ? toDate(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
export const time = (ts) => (ts ? toDate(ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '');
export function untilText(ts) {
  const ms = toDate(ts) - Date.now();
  if (ms <= 0) return 'expired';
  const h = Math.floor(ms / 3600000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h left`;
  const m = Math.floor((ms % 3600000) / 60000);
  return h ? `${h}h ${m}m left` : `${m}m left`;
}

export const CONDITIONS = { new: 'Brand new', like_new: 'Like new', used_good: 'Used · Good', used_fair: 'Used · Fair', for_parts: 'For parts' };
export const CONDITION_HELP = { new: 'Unused, sealed or with tags', like_new: 'Used briefly, no visible wear', used_good: 'Normal signs of use, works perfectly', used_fair: 'Visible wear or minor faults', for_parts: 'Not working; for repair or parts' };

export const ORDER_TONE = {
  pending_seller_confirmation: 'warn', accepted: 'info', awaiting_payment: 'warn', payment_confirmed: 'accent', ready_for_dispatch: 'info',
  shipped: 'info', out_for_delivery: 'info', ready_for_pickup: 'accent', completed: 'success', rejected: 'danger', cancelled: 'danger', disputed: 'danger', refunded: 'warn',
};
export const ORDER_LABEL = {
  pending_seller_confirmation: 'Pending seller confirmation', accepted: 'Accepted', rejected: 'Rejected', awaiting_payment: 'Awaiting payment', payment_confirmed: 'Payment confirmed',
  ready_for_dispatch: 'Ready for dispatch', shipped: 'Shipped', out_for_delivery: 'Out for delivery', ready_for_pickup: 'Ready for pickup', completed: 'Completed',
  cancelled: 'Cancelled', disputed: 'Disputed', refunded: 'Refunded',
};
export const LISTING_TONE = { active: 'success', draft: '', pending_review: 'warn', paused: 'info', sold: 'accent', rejected: 'danger', removed: 'danger', expired: 'warn' };
export const LISTING_LABEL = { active: 'Active', draft: 'Draft', pending_review: 'In review', paused: 'Paused', sold: 'Sold', rejected: 'Rejected', removed: 'Removed', expired: 'Expired' };
export const PAY_METHOD = { online: 'Paid online via PASAL', cash_on_pickup: 'Pay at pickup', cash_on_delivery: 'Cash on delivery', direct: 'Direct with seller' };
export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase() || '?';
export const plural = (n, w, p) => `${n.toLocaleString('en-IN')} ${n === 1 ? w : p || `${w}s`}`;
export const discount = (price, orig) => (orig && orig > price ? Math.round((1 - price / orig) * 100) : 0);
