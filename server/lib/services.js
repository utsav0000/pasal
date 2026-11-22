import { q, json } from '../db.js';
import { emitTo } from './realtime.js';
import { sendEmail, emailLayout } from '../providers/messaging.js';
import { config } from '../config.js';

// ---- Notifications ----
export const NOTIFICATION_TYPES = {
  message: 'New messages',
  offer: 'Offers',
  order: 'Order updates',
  payment: 'Payments',
  listing: 'Listing moderation',
  review: 'Reviews',
  saved_search: 'Saved-search matches',
  system: 'Account & security',
};
const DEFAULT_PREFS = Object.fromEntries(Object.keys(NOTIFICATION_TYPES).map((k) => [k, { inapp: true, email: k !== 'message', push: true }]));

export function prefsFor(user) {
  const p = json(user?.notif_prefs, {});
  const out = {};
  for (const k of Object.keys(DEFAULT_PREFS)) out[k] = { ...DEFAULT_PREFS[k], ...(p[k] || {}) };
  return out;
}

export function notify(userId, type, title, body = '', link = null) {
  const user = q.get('SELECT id, email, name, notif_prefs, status FROM users WHERE id = ?', userId);
  if (!user || user.status === 'deleted') return;
  const prefs = prefsFor(user)[type] || { inapp: true, email: false };
  if (prefs.inapp || type === 'system') {
    const { id } = q.run('INSERT INTO notifications (user_id, type, title, body, link) VALUES (?,?,?,?,?)', userId, type, title, body, link);
    emitTo(userId, 'notification', { id, type, title, body, link, created_at: new Date().toISOString() });
  }
  if (prefs.email && user.email) {
    sendEmail(user.email, title, emailLayout(title, [body], link ? { label: 'Open in PASAL', url: config.publicUrl + link } : null)).catch(() => {});
  }
}

// ---- Audit log ----
export function audit(actorId, action, entityType, entityId, data = null, ip = null) {
  q.run('INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, data, ip) VALUES (?,?,?,?,?,?)',
    actorId ?? null, action, entityType, entityId == null ? null : String(entityId), data ? JSON.stringify(data) : null, ip);
}

// ---- Platform settings (key/value JSON) ----
export const DEFAULT_SETTINGS = {
  listing_expiry_days: 60,
  offer_expiry_hours: 48,
  max_images_per_listing: 12,
  require_review_new_sellers: false,
  platform_fee_bps: config.platformFeeBps,
  payments_test_mode: config.devTools,
  payment_providers: { razorpay: true, esewa: true, sandbox: true },
  cross_border_enabled: false,
  maintenance_banner: '',
};

export function getSetting(key) {
  const row = q.get('SELECT value FROM settings WHERE key = ?', key);
  return row ? json(row.value, DEFAULT_SETTINGS[key]) : DEFAULT_SETTINGS[key];
}
export function allSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const r of q.all('SELECT key, value FROM settings')) out[r.key] = json(r.value, out[r.key]);
  return out;
}
export function setSetting(key, value) {
  q.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}

export const slugify = (s) =>
  String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'item';
