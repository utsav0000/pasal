// Periodic maintenance. In multi-instance deployments run these from a single worker (or a Redis lock).
import { q } from './db.js';
import { notify } from './lib/services.js';
import { transitionOrder } from './modules/orders.js';
import { searchListings } from './modules/listings.js';
import { invalidateCategories } from './modules/categories.js';

export function runJobs() {
  // Expire listings
  for (const l of q.all("SELECT id, seller_id, title FROM listings WHERE status = 'active' AND expires_at < datetime('now') LIMIT 500")) {
    q.run("UPDATE listings SET status = 'expired' WHERE id = ?", l.id);
    notify(l.seller_id, 'listing', 'Listing expired', `"${l.title}" expired. Renew it in one tap to put it back on PASAL.`, '/seller/listings?status=expired');
  }
  // Expire offers
  q.run("UPDATE offers SET status = 'expired' WHERE status IN ('pending','accepted') AND expires_at < datetime('now')");
  // Cancel unpaid orders after 48h
  for (const o of q.all("SELECT id FROM orders WHERE status = 'awaiting_payment' AND updated_at < datetime('now', '-48 hours') LIMIT 200")) {
    try { transitionOrder(o.id, 'cancelled', 'system', null, { note: 'Payment not received within 48 hours' }); } catch { /* already moved */ }
  }
  // Saved-search alerts
  for (const s of q.all("SELECT * FROM saved_searches WHERE notify = 1 AND (last_notified_at IS NULL OR last_notified_at < datetime('now', '-6 hours')) LIMIT 200")) {
    const params = Object.fromEntries(new URLSearchParams(s.query));
    const since = s.last_notified_at || s.created_at;
    const fresh = searchListings({ ...params, sort: 'newest', limit: 30 }, null).items.filter((i) => i.published_at > since && i.seller_id !== s.user_id);
    if (fresh.length) notify(s.user_id, 'saved_search', `${fresh.length} new match${fresh.length > 1 ? 'es' : ''} for “${s.name}”`, fresh.slice(0, 2).map((i) => i.title).join(' · '), `/search?${s.query}`);
    q.run("UPDATE saved_searches SET last_notified_at = datetime('now') WHERE id = ?", s.id);
  }
  // Housekeeping
  q.run("DELETE FROM sessions WHERE expires_at < datetime('now')");
  q.run("DELETE FROM auth_tokens WHERE expires_at < datetime('now', '-7 days')");
  invalidateCategories();
}

export function startJobs() {
  const iv = setInterval(() => { try { runJobs(); } catch (e) { console.error('[jobs]', e.message); } }, 10 * 60_000);
  iv.unref();
  return iv;
}
