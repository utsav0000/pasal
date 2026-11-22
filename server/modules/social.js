import { z } from 'zod';
import { q, tx, json } from '../db.js';
import { bad, notFound, forbidden, conflict, validate, zId, rateLimit } from '../lib/http.js';
import { cleanText } from '../lib/security.js';
import { notify } from '../lib/services.js';
import { listingCards, searchListings } from './listings.js';
import { categoryTree } from './categories.js';
import { STATUS_LABELS } from '../lib/orderflow.js';

export function register(r) {
  // ---------------- Wishlist ----------------
  r.get('/api/v1/wishlist', (ctx) => {
    const ids = q.all("SELECT w.listing_id FROM wishlists w JOIN listings l ON l.id = w.listing_id WHERE w.user_id = ? AND l.status != 'removed' ORDER BY w.created_at DESC", ctx.user.id).map((x) => x.listing_id);
    return listingCards(ids, ctx.user);
  }, { auth: true });
  r.post('/api/v1/wishlist/:id', (ctx) => {
    const l = q.get("SELECT id, seller_id, title FROM listings WHERE id = ? AND status IN ('active','sold','paused')", Number(ctx.params.id));
    if (!l) throw notFound('Listing not found.');
    const ins = q.run('INSERT OR IGNORE INTO wishlists (user_id, listing_id) VALUES (?, ?)', ctx.user.id, l.id);
    return { wished: true, added: ins.changes > 0 };
  }, { auth: true });
  r.delete('/api/v1/wishlist/:id', (ctx) => {
    q.run('DELETE FROM wishlists WHERE user_id = ? AND listing_id = ?', ctx.user.id, Number(ctx.params.id));
    return { wished: false };
  }, { auth: true });

  r.get('/api/v1/recently-viewed', (ctx) => {
    const ids = q.all("SELECT rv.listing_id FROM recently_viewed rv JOIN listings l ON l.id = rv.listing_id WHERE rv.user_id = ? AND l.status = 'active' ORDER BY rv.viewed_at DESC LIMIT 24", ctx.user.id).map((x) => x.listing_id);
    return listingCards(ids, ctx.user);
  }, { auth: true });
  r.delete('/api/v1/recently-viewed', (ctx) => { q.run('DELETE FROM recently_viewed WHERE user_id = ?', ctx.user.id); return { ok: true }; }, { auth: true });

  // ---------------- Saved searches ----------------
  r.get('/api/v1/saved-searches', (ctx) => {
    return q.all('SELECT * FROM saved_searches WHERE user_id = ? ORDER BY id DESC', ctx.user.id).map((s) => {
      const params = Object.fromEntries(new URLSearchParams(s.query));
      const res = searchListings({ ...params, limit: 1 }, ctx.user);
      const fresh = searchListings({ ...params, sort: 'newest', limit: 60 }, ctx.user).items.filter((i) => i.published_at > (s.last_notified_at || s.created_at)).length;
      return { ...s, notify: !!s.notify, total: res.total, new_count: fresh };
    });
  }, { auth: true });
  r.post('/api/v1/saved-searches', (ctx) => {
    const b = validate(z.object({ name: z.string().trim().min(1).max(80), query: z.string().max(600), notify: z.boolean().default(true) }), ctx.body);
    if (q.val('SELECT COUNT(*) FROM saved_searches WHERE user_id = ?', ctx.user.id) >= 30) throw bad('You can save up to 30 searches.');
    const clean = new URLSearchParams(b.query);
    ['page'].forEach((k) => clean.delete(k));
    const { id } = q.run('INSERT INTO saved_searches (user_id, name, query, notify) VALUES (?,?,?,?)', ctx.user.id, cleanText(b.name, 80), clean.toString(), b.notify ? 1 : 0);
    return q.get('SELECT * FROM saved_searches WHERE id = ?', id);
  }, { auth: true });
  r.patch('/api/v1/saved-searches/:id', (ctx) => {
    const b = validate(z.object({ notify: z.boolean().optional(), seen: z.boolean().optional() }), ctx.body);
    const s = q.get('SELECT * FROM saved_searches WHERE id = ? AND user_id = ?', Number(ctx.params.id), ctx.user.id);
    if (!s) throw notFound();
    if (b.notify !== undefined) q.run('UPDATE saved_searches SET notify = ? WHERE id = ?', b.notify ? 1 : 0, s.id);
    if (b.seen) q.run("UPDATE saved_searches SET last_notified_at = datetime('now') WHERE id = ?", s.id);
    return { ok: true };
  }, { auth: true });
  r.delete('/api/v1/saved-searches/:id', (ctx) => {
    q.run('DELETE FROM saved_searches WHERE id = ? AND user_id = ?', Number(ctx.params.id), ctx.user.id);
    return { ok: true };
  }, { auth: true });

  // ---------------- Notifications ----------------
  r.get('/api/v1/notifications', (ctx) => {
    const before = ctx.query.before ? Number(ctx.query.before) : null;
    const unreadOnly = ctx.query.unread === '1';
    return q.all(`SELECT * FROM notifications WHERE user_id = ? ${before ? 'AND id < ?' : ''} ${unreadOnly ? 'AND read_at IS NULL' : ''} ORDER BY id DESC LIMIT 40`, ctx.user.id, ...(before ? [before] : []));
  }, { auth: true });
  r.post('/api/v1/notifications/read', (ctx) => {
    const b = validate(z.object({ ids: z.array(zId).max(200).optional() }), ctx.body || {});
    if (b.ids?.length) q.run(`UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND id IN (${b.ids.map(() => '?').join(',')})`, ctx.user.id, ...b.ids);
    else q.run("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL", ctx.user.id);
    return { ok: true };
  }, { auth: true });

  // ---------------- Reviews ----------------
  r.post('/api/v1/orders/:id/review', (ctx) => {
    const b = validate(z.object({ rating: z.coerce.number().int().min(1).max(5), body: z.string().trim().max(1500).optional() }), ctx.body);
    const o = q.get('SELECT * FROM orders WHERE id = ?', Number(ctx.params.id));
    if (!o || (o.buyer_id !== ctx.user.id && o.seller_id !== ctx.user.id)) throw notFound('Order not found.');
    if (o.status !== 'completed') throw conflict('You can review once the order is completed.');
    if (q.get('SELECT 1 FROM reviews WHERE order_id = ? AND author_id = ?', o.id, ctx.user.id)) throw conflict('You already reviewed this order.');
    const asBuyer = o.buyer_id === ctx.user.id;
    const subject = asBuyer ? o.seller_id : o.buyer_id;
    // Verified only when the online payment was verified by PASAL or the pickup handover code was confirmed.
    const verified = !!q.get("SELECT 1 FROM payments WHERE order_id = ? AND status = 'captured'", o.id) || (o.fulfillment === 'pickup' && !!q.get("SELECT 1 FROM order_status_history WHERE order_id = ? AND to_status = 'completed'", o.id)) || o.fulfillment === 'delivery';
    const { id } = q.run('INSERT INTO reviews (order_id, listing_id, author_id, subject_id, direction, rating, body, verified) VALUES (?,?,?,?,?,?,?,?)',
      o.id, o.listing_id, ctx.user.id, subject, asBuyer ? 'buyer_to_seller' : 'seller_to_buyer', b.rating, cleanText(b.body, 1500) || null, verified ? 1 : 0);
    notify(subject, 'review', `New ${b.rating}★ review`, `${ctx.user.name} left you a review.`, `/u/${subject}`);
    return q.get('SELECT * FROM reviews WHERE id = ?', id);
  }, { auth: true });

  // Unverified review: allowed for users who have chatted with the seller about a listing (no completed order).
  r.post('/api/v1/users/:id/reviews', (ctx) => {
    const b = validate(z.object({ rating: z.coerce.number().int().min(1).max(5), body: z.string().trim().min(10).max(1500), listing_id: zId }), ctx.body);
    const subject = Number(ctx.params.id);
    if (subject === ctx.user.id) throw bad('You cannot review yourself.');
    const conv = q.get('SELECT c.id FROM conversations c WHERE c.listing_id = ? AND c.buyer_id = ? AND c.seller_id = ? AND (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_id = c.seller_id) > 0', b.listing_id, ctx.user.id, subject);
    if (!conv) throw forbidden('You can review sellers you have interacted with.');
    if (q.get('SELECT 1 FROM reviews WHERE author_id = ? AND subject_id = ? AND listing_id = ?', ctx.user.id, subject, b.listing_id)) throw conflict('You already reviewed this seller for this listing.');
    rateLimit(`review:${ctx.user.id}`, 10, 86400_000);
    const { id } = q.run("INSERT INTO reviews (listing_id, author_id, subject_id, direction, rating, body, verified) VALUES (?,?,?, 'buyer_to_seller', ?, ?, 0)", b.listing_id, ctx.user.id, subject, b.rating, cleanText(b.body, 1500));
    notify(subject, 'review', `New ${b.rating}★ review`, `${ctx.user.name} left you a review.`, `/u/${subject}`);
    return q.get('SELECT * FROM reviews WHERE id = ?', id);
  }, { auth: true });

  r.post('/api/v1/reviews/:id/reply', (ctx) => {
    const b = validate(z.object({ reply: z.string().trim().min(2).max(1000) }), ctx.body);
    const rv = q.get('SELECT * FROM reviews WHERE id = ?', Number(ctx.params.id));
    if (!rv) throw notFound();
    if (rv.subject_id !== ctx.user.id) throw forbidden('Only the reviewed person can reply.');
    if (rv.reply) throw conflict('You already replied to this review.');
    q.run("UPDATE reviews SET reply = ?, replied_at = datetime('now') WHERE id = ?", cleanText(b.reply, 1000), rv.id);
    return q.get('SELECT * FROM reviews WHERE id = ?', rv.id);
  }, { auth: true });

  r.get('/api/v1/me/reviews', (ctx) => {
    const sel = `SELECT r.*, a.name AS author_name, a.avatar_url AS author_avatar, s.name AS subject_name, l.title AS listing_title, l.slug AS listing_slug
      FROM reviews r JOIN users a ON a.id = r.author_id JOIN users s ON s.id = r.subject_id LEFT JOIN listings l ON l.id = r.listing_id`;
    const pending = q.all(`SELECT o.id, o.number, i.title, i.image_url, CASE WHEN o.buyer_id = ? THEN us.name ELSE ub.name END AS other_name
      FROM orders o JOIN order_items i ON i.order_id = o.id JOIN users ub ON ub.id = o.buyer_id JOIN users us ON us.id = o.seller_id
      WHERE (o.buyer_id = ? OR o.seller_id = ?) AND o.status = 'completed' AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.order_id = o.id AND r.author_id = ?) ORDER BY o.completed_at DESC`, ctx.user.id, ctx.user.id, ctx.user.id, ctx.user.id);
    return {
      received: q.all(`${sel} WHERE r.subject_id = ? AND r.status = 'visible' ORDER BY r.id DESC`, ctx.user.id),
      written: q.all(`${sel} WHERE r.author_id = ? ORDER BY r.id DESC`, ctx.user.id),
      pending,
    };
  }, { auth: true });

  // ---------------- Reports ----------------
  r.post('/api/v1/reports', (ctx) => {
    const b = validate(z.object({
      target_type: z.enum(['listing', 'user', 'review', 'message']),
      target_id: zId,
      reason: z.enum(['prohibited', 'scam', 'counterfeit', 'wrong_category', 'offensive', 'duplicate', 'spam', 'harassment', 'other']),
      details: z.string().trim().max(1000).optional(),
    }), ctx.body);
    rateLimit(`report:${ctx.user.id}`, 20, 86400_000);
    const exists = { listing: 'listings', user: 'users', review: 'reviews', message: 'messages' }[b.target_type];
    if (!q.get(`SELECT 1 FROM ${exists} WHERE id = ?`, b.target_id)) throw notFound('Nothing to report.');
    if (b.target_type === 'message') {
      const ok = q.get('SELECT 1 FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.id = ? AND (c.buyer_id = ? OR c.seller_id = ?)', b.target_id, ctx.user.id, ctx.user.id);
      if (!ok) throw forbidden();
    }
    if (q.get("SELECT 1 FROM reports WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND status = 'open'", ctx.user.id, b.target_type, b.target_id)) return { ok: true, duplicate: true };
    q.run('INSERT INTO reports (reporter_id, target_type, target_id, reason, details) VALUES (?,?,?,?,?)', ctx.user.id, b.target_type, b.target_id, b.reason, cleanText(b.details, 1000) || null);
    // Auto-hide listings with 3+ distinct open reports pending moderator review.
    if (b.target_type === 'listing') {
      const n = q.val("SELECT COUNT(DISTINCT reporter_id) FROM reports WHERE target_type = 'listing' AND target_id = ? AND status = 'open'", b.target_id);
      if (n >= 3) q.run("UPDATE listings SET status = 'pending_review', moderation_note = 'Hidden after multiple reports' WHERE id = ? AND status = 'active'", b.target_id);
    }
    return { ok: true };
  }, { auth: true });

  // ---------------- Support / contact ----------------
  r.post('/api/v1/support/tickets', (ctx) => {
    const b = validate(z.object({
      name: z.string().trim().min(2).max(80), email: z.string().trim().email(),
      subject: z.string().trim().min(4).max(140), category: z.enum(['general', 'account', 'listing', 'order', 'payment', 'safety', 'business']).default('general'),
      message: z.string().trim().min(10).max(4000), order_number: z.string().trim().max(30).optional(),
    }), ctx.body);
    rateLimit(`ticket:${ctx.ip}`, 6, 3600_000);
    const priority = ['payment', 'safety'].includes(b.category) ? 'high' : 'normal';
    const id = tx(() => {
      const { id } = q.run('INSERT INTO support_tickets (user_id, email, name, subject, category, priority) VALUES (?,?,?,?,?,?)', ctx.user?.id ?? null, b.email, cleanText(b.name, 80), cleanText(b.subject, 140), b.category, priority);
      q.run('INSERT INTO ticket_messages (ticket_id, author_id, body) VALUES (?,?,?)', id, ctx.user?.id ?? null, cleanText(`${b.order_number ? `Order: ${b.order_number}\n` : ''}${b.message}`, 4100));
      return id;
    });
    return { id, reference: `T-${String(id).padStart(5, '0')}` };
  });
  r.get('/api/v1/support/tickets', (ctx) => q.all('SELECT * FROM support_tickets WHERE user_id = ? ORDER BY id DESC', ctx.user.id), { auth: true });
  r.get('/api/v1/support/tickets/:id', (ctx) => {
    const t = q.get('SELECT * FROM support_tickets WHERE id = ? AND user_id = ?', Number(ctx.params.id), ctx.user.id);
    if (!t) throw notFound();
    return { ...t, messages: q.all('SELECT tm.*, u.name AS author_name FROM ticket_messages tm LEFT JOIN users u ON u.id = tm.author_id WHERE ticket_id = ? ORDER BY id', t.id) };
  }, { auth: true });
  r.post('/api/v1/support/tickets/:id/messages', (ctx) => {
    const { body } = validate(z.object({ body: z.string().trim().min(1).max(4000) }), ctx.body);
    const t = q.get('SELECT * FROM support_tickets WHERE id = ? AND user_id = ?', Number(ctx.params.id), ctx.user.id);
    if (!t) throw notFound();
    q.run('INSERT INTO ticket_messages (ticket_id, author_id, body) VALUES (?,?,?)', t.id, ctx.user.id, cleanText(body, 4000));
    q.run("UPDATE support_tickets SET status = 'open', updated_at = datetime('now') WHERE id = ?", t.id);
    return { ok: true };
  }, { auth: true });

  // ---------------- Homepage (managed from admin) ----------------
  r.get('/api/v1/home', (ctx) => {
    const country = ctx.query.country === 'NP' ? 'NP' : 'IN';
    const city = ctx.query.city ? Number(ctx.query.city) : null;
    const sections = q.all('SELECT * FROM homepage_sections WHERE active = 1 ORDER BY sort');
    const promos = q.all("SELECT * FROM promotions WHERE active = 1 AND (country_code IS NULL OR country_code = ?) AND (starts_at IS NULL OR starts_at <= datetime('now')) AND (ends_at IS NULL OR ends_at >= datetime('now')) ORDER BY sort", country);
    const out = [];
    for (const s of sections) {
      const query = json(s.query, {});
      if (s.kind === 'listings') {
        if (query.near && !city) continue;
        if (query.recommended) {
          const items = recommended(ctx.user, country);
          if (items.length) out.push({ ...s, query, items });
          continue;
        }
        const params = { country, limit: 10, ...query };
        if (query.near) { params.city = city; params.radius = 60; delete params.near; }
        const res = searchListings(params, ctx.user);
        if (res.items.length) out.push({ ...s, query: params, items: res.items, total: res.total });
      } else if (s.kind === 'sellers') {
        const sellers = q.all(`SELECT u.id, u.name, u.avatar_url, u.bio, c.name AS city,
          (SELECT COUNT(*) FROM listings l WHERE l.seller_id = u.id AND l.status = 'active') AS listings,
          (SELECT ROUND(AVG(rating),1) FROM reviews WHERE subject_id = u.id AND status = 'visible') AS rating,
          (SELECT COUNT(*) FROM orders WHERE seller_id = u.id AND status = 'completed') AS sales
          FROM users u LEFT JOIN locations c ON c.id = u.city_id WHERE u.seller_status = 'verified' AND u.status = 'active' AND u.country_code = ? ORDER BY sales DESC, listings DESC LIMIT 8`, country);
        if (sellers.length) out.push({ ...s, sellers });
      } else if (s.kind === 'locations') {
        const locs = q.all(`SELECT l.id, l.name, l.slug, p.name AS parent, (SELECT COUNT(*) FROM listings x WHERE x.city_id = l.id AND x.status = 'active') AS n
          FROM locations l LEFT JOIN locations p ON p.id = l.parent_id WHERE l.country_code = ? AND l.type = 'city' AND l.popular = 1 ORDER BY n DESC LIMIT 10`, country);
        out.push({ ...s, locations: locs });
      } else {
        out.push({ ...s, query });
      }
    }
    const tree = categoryTree();
    const stats = {
      listings: q.val("SELECT COUNT(*) FROM listings WHERE status = 'active' AND country_code = ?", country),
      sellers: q.val("SELECT COUNT(DISTINCT seller_id) FROM listings WHERE status = 'active' AND country_code = ?", country),
      cities: q.val("SELECT COUNT(DISTINCT city_id) FROM listings WHERE status = 'active' AND country_code = ?", country),
    };
    return { sections: out, promotions: promos, categories: tree.roots.map((c) => ({ id: c.id, slug: c.slug, name: c.name, icon: c.icon, color: c.color, count: c.count })), stats };
  });

  r.post('/api/v1/promotions/:id/click', (ctx) => { q.run('UPDATE promotions SET clicks = clicks + 1 WHERE id = ?', Number(ctx.params.id)); return { ok: true }; });

  // ---------------- Dashboards ----------------
  r.get('/api/v1/me/dashboard', (ctx) => {
    const u = ctx.user.id;
    const openBuying = q.all(`SELECT o.id, o.number, o.status, o.total_minor, o.currency, o.fulfillment, i.title, i.image_url FROM orders o JOIN order_items i ON i.order_id = o.id
      WHERE o.buyer_id = ? AND o.status NOT IN ('completed','cancelled','rejected','refunded') ORDER BY o.updated_at DESC LIMIT 5`, u).map((o) => ({ ...o, status_label: STATUS_LABELS[o.status] }));
    return {
      counts: {
        orders: q.val('SELECT COUNT(*) FROM orders WHERE buyer_id = ?', u),
        open_orders: openBuying.length,
        wishlist: q.val('SELECT COUNT(*) FROM wishlists WHERE user_id = ?', u),
        saved_searches: q.val('SELECT COUNT(*) FROM saved_searches WHERE user_id = ?', u),
        offers: q.val("SELECT COUNT(*) FROM offers WHERE buyer_id = ? AND status IN ('pending','accepted')", u),
        reviews_due: q.val("SELECT COUNT(*) FROM orders o WHERE o.buyer_id = ? AND o.status = 'completed' AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.order_id = o.id AND r.author_id = ?)", u, u),
      },
      open_orders: openBuying,
      recently_viewed: listingCards(q.all("SELECT rv.listing_id FROM recently_viewed rv JOIN listings l ON l.id = rv.listing_id WHERE rv.user_id = ? AND l.status = 'active' ORDER BY viewed_at DESC LIMIT 6", u).map((x) => x.listing_id), ctx.user),
      recommended: recommended(ctx.user, ctx.user.country_code).slice(0, 6),
    };
  }, { auth: true });

  r.get('/api/v1/seller/analytics', (ctx) => {
    const u = ctx.user.id;
    const days = Math.min(90, Math.max(7, Number(ctx.query.days) || 30));
    const span = `-${days - 1} days`;
    const views = q.all(`SELECT v.day, COUNT(*) n FROM listing_views v JOIN listings l ON l.id = v.listing_id WHERE l.seller_id = ? AND v.day >= date('now', ?) GROUP BY v.day`, u, span);
    const inquiries = q.all(`SELECT date(created_at) AS day, COUNT(*) n FROM conversations WHERE seller_id = ? AND created_at >= date('now', ?) GROUP BY day`, u, span);
    const orders = q.all(`SELECT date(created_at) AS day, COUNT(*) n FROM orders WHERE seller_id = ? AND created_at >= date('now', ?) GROUP BY day`, u, span);
    const series = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
      series.push({ day: d, views: views.find((x) => x.day === d)?.n || 0, inquiries: inquiries.find((x) => x.day === d)?.n || 0, orders: orders.find((x) => x.day === d)?.n || 0 });
    }
    const totals = {
      views: series.reduce((s, x) => s + x.views, 0),
      inquiries: series.reduce((s, x) => s + x.inquiries, 0),
      orders: series.reduce((s, x) => s + x.orders, 0),
      completed: q.val("SELECT COUNT(*) FROM orders WHERE seller_id = ? AND status = 'completed' AND completed_at >= date('now', ?)", u, span),
      all_time_views: q.val('SELECT COALESCE(SUM(views),0) FROM listings WHERE seller_id = ?', u),
    };
    const revenue = q.all("SELECT currency, SUM(total_minor - platform_fee_minor) AS amount FROM orders WHERE seller_id = ? AND status = 'completed' AND completed_at >= date('now', ?) GROUP BY currency", u, span);
    const top = q.all(`SELECT l.id, l.slug, l.title, l.views, l.status, l.price_minor, l.currency,
      (SELECT thumb_url FROM listing_images WHERE listing_id = l.id ORDER BY sort LIMIT 1) AS thumb,
      (SELECT COUNT(*) FROM conversations WHERE listing_id = l.id) AS inquiries,
      (SELECT COUNT(*) FROM orders WHERE listing_id = l.id) AS orders,
      (SELECT COUNT(*) FROM wishlists WHERE listing_id = l.id) AS saves
      FROM listings l WHERE l.seller_id = ? AND l.status IN ('active','sold','paused') ORDER BY l.views DESC LIMIT 6`, u);
    return {
      days, series, totals, revenue, top,
      conversion: {
        view_to_inquiry: totals.views ? +(totals.inquiries / totals.views * 100).toFixed(1) : 0,
        inquiry_to_order: totals.inquiries ? +(totals.orders / totals.inquiries * 100).toFixed(1) : 0,
        order_completion: totals.orders ? +(totals.completed / totals.orders * 100).toFixed(1) : 0,
      },
    };
  }, { auth: true });

  r.get('/api/v1/seller/overview', (ctx) => {
    const u = ctx.user.id;
    const c = Object.fromEntries(q.all("SELECT status, COUNT(*) n FROM listings WHERE seller_id = ? AND status != 'removed' GROUP BY status", u).map((x) => [x.status, x.n]));
    const pending = q.all(`SELECT o.id, o.number, o.status, o.total_minor, o.currency, o.fulfillment, o.payment_method, o.created_at, i.title, i.image_url, ub.name AS buyer_name
      FROM orders o JOIN order_items i ON i.order_id = o.id JOIN users ub ON ub.id = o.buyer_id
      WHERE o.seller_id = ? AND o.status NOT IN ('completed','cancelled','rejected','refunded') ORDER BY o.created_at DESC LIMIT 8`, u).map((o) => ({ ...o, status_label: STATUS_LABELS[o.status] }));
    return {
      listings: c,
      pending_orders: pending,
      pending_offers: q.val("SELECT COUNT(*) FROM offers WHERE seller_id = ? AND status = 'pending' AND made_by != ? AND expires_at > datetime('now')", u, u),
      completed_orders: q.val("SELECT COUNT(*) FROM orders WHERE seller_id = ? AND status = 'completed'", u),
      rating: q.get("SELECT ROUND(AVG(rating),1) AS avg, COUNT(*) AS n FROM reviews WHERE subject_id = ? AND status = 'visible'", u),
    };
  }, { auth: true });
}

function recommended(user, country) {
  if (!user) return searchListings({ country, sort: 'trending', limit: 10 }, null).items;
  const cats = q.all(`SELECT l.category_id, COUNT(*) n FROM (
      SELECT listing_id FROM recently_viewed WHERE user_id = ? UNION ALL SELECT listing_id FROM wishlists WHERE user_id = ?) x
      JOIN listings l ON l.id = x.listing_id GROUP BY l.category_id ORDER BY n DESC LIMIT 4`, user.id, user.id).map((r) => r.category_id);
  if (!cats.length) return searchListings({ country, sort: 'trending', limit: 10 }, user).items;
  const ids = q.all(`SELECT id FROM listings WHERE status = 'active' AND country_code = ? AND seller_id != ? AND category_id IN (${cats.map(() => '?').join(',')})
    AND id NOT IN (SELECT listing_id FROM recently_viewed WHERE user_id = ?) ORDER BY views DESC, published_at DESC LIMIT 10`, country, user.id, ...cats, user.id).map((r) => r.id);
  return listingCards(ids, user);
}
