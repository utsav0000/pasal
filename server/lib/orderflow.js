// Order state machine. Every transition is validated here; nothing else may change orders.status.
export const STATUS_LABELS = {
  pending_seller_confirmation: 'Pending seller confirmation',
  accepted: 'Accepted',
  rejected: 'Rejected',
  awaiting_payment: 'Awaiting payment',
  payment_confirmed: 'Payment confirmed',
  ready_for_dispatch: 'Ready for dispatch',
  shipped: 'Shipped',
  out_for_delivery: 'Out for delivery',
  ready_for_pickup: 'Ready for pickup',
  completed: 'Completed',
  cancelled: 'Cancelled',
  disputed: 'Disputed',
  refunded: 'Refunded',
};

export const TERMINAL = new Set(['rejected', 'cancelled', 'refunded']);
export const OPEN_FOR_DISPUTE = new Set(['payment_confirmed', 'ready_for_dispatch', 'shipped', 'out_for_delivery', 'ready_for_pickup', 'completed']);

/**
 * Allowed transitions: from -> { to: [actors] }. Actors: buyer, seller, system, admin.
 * 'system' transitions happen only through verified server events (e.g. payment signature verified).
 */
const T = {
  pending_seller_confirmation: { accepted: ['seller'], rejected: ['seller'], cancelled: ['buyer', 'admin'] },
  accepted: { awaiting_payment: ['system'], ready_for_dispatch: ['seller'], ready_for_pickup: ['seller'], cancelled: ['buyer', 'seller', 'admin'] },
  awaiting_payment: { payment_confirmed: ['system'], cancelled: ['buyer', 'seller', 'admin', 'system'] },
  payment_confirmed: { ready_for_dispatch: ['seller'], ready_for_pickup: ['seller'], refunded: ['admin', 'system'], disputed: ['buyer', 'seller'] },
  ready_for_dispatch: { shipped: ['seller'], cancelled: ['seller', 'admin'], disputed: ['buyer', 'seller'] },
  shipped: { out_for_delivery: ['seller'], completed: ['buyer'], disputed: ['buyer', 'seller'] },
  out_for_delivery: { completed: ['buyer', 'seller'], disputed: ['buyer', 'seller'] },
  ready_for_pickup: { completed: ['seller'], cancelled: ['buyer', 'seller', 'admin'], disputed: ['buyer', 'seller'] },
  completed: { disputed: ['buyer', 'seller'] },
  disputed: { completed: ['admin'], refunded: ['admin'], cancelled: ['admin'] },
  rejected: {},
  cancelled: {},
  refunded: {},
};

export function canTransition(order, to, actor) {
  const allowed = T[order.status]?.[to];
  if (!allowed || !allowed.includes(actor)) return { ok: false, reason: `An order that is "${STATUS_LABELS[order.status]}" cannot become "${STATUS_LABELS[to] || to}".` };
  // Business guards
  if (to === 'ready_for_dispatch' && order.fulfillment !== 'delivery') return { ok: false, reason: 'This is a pickup order.' };
  if ((to === 'ready_for_pickup') && order.fulfillment !== 'pickup') return { ok: false, reason: 'This is a delivery order.' };
  if (order.status === 'accepted' && order.payment_method === 'online' && ['ready_for_dispatch', 'ready_for_pickup'].includes(to)) return { ok: false, reason: 'Waiting for the buyer to pay online.' };
  if (to === 'completed' && order.status === 'completed') return { ok: false, reason: 'Already completed.' };
  if (to === 'disputed' && order.status === 'completed' && order.completed_at) {
    const ageDays = (Date.now() - Date.parse(order.completed_at.replace(' ', 'T') + 'Z')) / 86400_000;
    if (ageDays > 7) return { ok: false, reason: 'Disputes can be opened up to 7 days after completion.' };
  }
  return { ok: true };
}

/** What each party can do next, for UI buttons. */
export function nextActions(order, actor) {
  return Object.entries(T[order.status] || {})
    .filter(([to, actors]) => actors.includes(actor) && canTransition(order, to, actor).ok)
    .map(([to]) => to);
}

/** Status that follows "accepted" automatically, if any. */
export function afterAccept(order) {
  return order.payment_method === 'online' ? 'awaiting_payment' : null;
}

/** Step list for the buyer-facing timeline. */
export function timelineSteps(order) {
  const pay = order.payment_method === 'online' ? ['awaiting_payment', 'payment_confirmed'] : [];
  return order.fulfillment === 'delivery'
    ? ['pending_seller_confirmation', 'accepted', ...pay, 'ready_for_dispatch', 'shipped', 'out_for_delivery', 'completed']
    : ['pending_seller_confirmation', 'accepted', ...pay, 'ready_for_pickup', 'completed'];
}
