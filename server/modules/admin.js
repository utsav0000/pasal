import { z } from 'zod';
import { q, tx, json } from '../db.js';
import { config } from '../config.js';
import { bad, notFound, forbidden, conflict, validate, zId } from '../lib/http.js';
import { cleanText, ROLE_RANK, PERMISSIONS } from '../lib/security.js';
import { audit, notify, allSettings, setSetting, DEFAULT_SETTINGS, slugify } from '../lib/services.js';
import { STATUS_LABELS } from '../lib/orderflow.js';
import { invalidateCategories, categoryTree } from './categories.js';
import { indexListing, invalidateVocab } from './listings.js';
import { transitionOrder, refundOrder } from './orders.js';
import { providers } from '../providers/payments.js';

const P = (perm) => ({ auth: true, perm });
const page = (ctx) => {
  const p = Math.max(1, Number(ctx.query.page) || 1);
  const limit = Math.min(100, Math.max(5, Number(ctx.query.limit) || 25));
  return { limit, offset: (p - 1) * limit, page: p };
};
const paged = (rows, total, pg) => ({ items: rows, total, page: pg.page, pages: Math.ceil(total / pg.limit) });

export function register(r) {
  // ---------------- Overview ----------------
  r.get('/api/v1/admin/overview', () => {
    const v = (sql, ...a) => q.val(sql, ...a);
    const series = q.all(`WITH RECURSIVE d(day) AS (SELECT date('now','-29 days') UNION ALL SELECT date(day,'+1 day') FROM d WHERE day < date('now'))
      SELECT d.day, (SELECT COUNT(*) FROM users WHERE date(created_at) = d.day) AS users,
        (SELECT COUNT(*) FROM listings WHERE date(published_at) = d.day) AS listings,
        (SELECT COUNT(*) FROM orders WHERE date(created_at) = d.day) AS orders FROM d`);
    return {
      users: v("SELECT COUNT(*) FROM users WHERE status != 'deleted'"),
      buyers: v('SELECT COUNT(DISTINCT buyer_id) FROM orders'),
      sellers: v('SELECT COUNT(DISTINCT seller_id) FROM listings'),
      verified_sellers: v("SELECT COUNT(*) FROM users WHERE seller_status = 'verified'"),
      active_listings: v("SELECT COUNT(*) FROM listings WHERE status = 'active'"),
      total_listings: v("SELECT COUNT(*) FROM listings WHERE status != 'removed'"),
      pending_review: v("SELECT COUNT(*) FROM listings WHERE status = 'pending_review'"),
      orders: v('SELECT COUNT(*) FROM orders'),
      completed: v("SELECT COUNT(*) FROM orders WHERE status = 'completed'"),
      open_reports: v("SELECT COUNT(*) FROM reports WHERE status = 'open'"),
      open_disputes: v("SELECT COUNT(*) FROM disputes WHERE status IN ('open','under_review')"),
      pending_verifications: v("SELECT COUNT(*) FROM seller_verifications WHERE status = 'pending'"),
      open_tickets: v("SELECT COUNT(*) FROM support_tickets WHERE status IN ('open','pending')"),
      gmv: q.all("SELECT currency, SUM(total_minor) AS amount FROM orders WHERE status = 'completed' GROUP BY currency"),
      revenue: q.all("SELECT currency, SUM(platform_fee_minor) AS amount FROM orders WHERE status = 'completed' GROUP BY currency"),
      verified_payments: q.all("SELECT currency, SUM(amount_minor) AS amount, COUNT(*) AS n FROM payments WHERE status = 'captured' GROUP BY currency"),
      by_country: q.all("SELECT country_code, COUNT(*) n FROM listings WHERE status = 'active' GROUP BY country_code"),
      series,
      recent_orders: q.all('SELECT o.id, o.number, o.status, o.total_minor, o.currency, o.created_at, i.title FROM orders o JOIN order_items i ON i.order_id = o.id ORDER BY o.id DESC LIMIT 6').map((o) => ({ ...o, status_label: STATUS_LABELS[o.status] })),
    };
  }, P('admin.access'));

  // ---------------- Users ----------------
  r.get('/api/v1/admin/users', (ctx) => {
    const pg = page(ctx);
    const w = ["u.status != 'deleted'"], a = [];
    if (ctx.query.q) { w.push('(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR u.id = ?)'); const t = `%${ctx.query.q}%`; a.push(t, t, t, Number(ctx.query.q) || 0); }
    if (ctx.query.role) { w.push('u.role = ?'); a.push(ctx.query.role); }
    if (ctx.query.status) { w.push('u.status = ?'); a.push(ctx.query.status); }
    if (ctx.query.seller) { w.push('u.seller_status = ?'); a.push(ctx.query.seller); }
    if (ctx.query.country) { w.push('u.country_code = ?'); a.push(ctx.query.country); }
    const where = w.join(' AND ');
    const rows = q.all(`SELECT u.id, u.name, u.email, u.phone, u.role, u.status, u.seller_status, u.country_code, u.created_at, u.last_seen_at, u.email_verified_at, u.phone_verified_at,
      (SELECT COUNT(*) FROM listings WHERE seller_id = u.id AND status = 'active') AS listings,
      (SELECT COUNT(*) FROM orders WHERE buyer_id = u.id OR seller_id = u.id) AS orders
      FROM users u WHERE ${where} ORDER BY u.id DESC LIMIT ? OFFSET ?`, ...a, pg.limit, pg.offset);
    return paged(rows, q.val(`SELECT COUNT(*) FROM users u WHERE ${where}`, ...a), pg);
  }, P('users.view'));

  r.get('/api/v1/admin/users/:id', (ctx) => {
    const u = q.get('SELECT * FROM users WHERE id = ?', Number(ctx.params.id));
    if (!u) throw notFound();
    delete u.password_hash;
    return {
      user: u,
      listings: q.all('SELECT id, slug, title, status, price_minor, currency, views, created_at FROM listings WHERE seller_id = ? ORDER BY id DESC LIMIT 50', u.id),
      orders: q.all('SELECT o.id, o.number, o.status, o.total_minor, o.currency, o.created_at, CASE WHEN o.buyer_id = ? THEN \'buyer\' ELSE \'seller\' END AS role FROM orders o WHERE o.buyer_id = ? OR o.seller_id = ? ORDER BY o.id DESC LIMIT 50', u.id, u.id, u.id),
      reports: q.all("SELECT * FROM reports WHERE target_type = 'user' AND target_id = ? ORDER BY id DESC", u.id),
      verifications: q.all('SELECT * FROM seller_verifications WHERE user_id = ? ORDER BY id DESC', u.id),
      sessions: q.val("SELECT COUNT(*) FROM sessions WHERE user_id = ? AND expires_at > datetime('now')", u.id),
      audit: q.all("SELECT * FROM audit_logs WHERE entity_type = 'user' AND entity_id = ? ORDER BY id DESC LIMIT 30", String(u.id)),
    };
  }, P('users.view'));

  r.post('/api/v1/admin/users/:id/status', (ctx) => {
    const b = validate(z.object({ action: z.enum(['suspend', 'reactivate']), reason: z.string().trim().max(300).optional() }), ctx.body);
    const u = q.get('SELECT * FROM users WHERE id = ?', Number(ctx.params.id));
    if (!u || u.status === 'deleted') throw notFound();
    if (u.id === ctx.user.id) throw bad('You cannot change your own status.');
    if (ROLE_RANK[u.role] >= ROLE_RANK[ctx.user.role]) throw forbidden('You cannot manage a user with an equal or higher role.');
    if (b.action === 'suspend') {
      if (!b.reason) throw bad('Give a reason for the suspension.');
      tx(() => {
        q.run("UPDATE users SET status = 'suspended', suspended_reason = ? WHERE id = ?", cleanText(b.reason, 300), u.id);
        q.run('DELETE FROM sessions WHERE user_id = ?', u.id);
        q.run("UPDATE listings SET status = 'paused' WHERE seller_id = ? AND status = 'active'", u.id);
      });
    } else {
      q.run("UPDATE users SET status = 'active', suspended_reason = NULL WHERE id = ?", u.id);
      notify(u.id, 'system', 'Your account is active again', 'You can resume your paused listings from your seller dashboard.', '/seller/listings');
    }
    audit(ctx.user.id, `user.${b.action}`, 'user', u.id, { reason: b.reason }, ctx.ip);
    invalidateCategories();
    return { ok: true };
  }, P('users.manage'));

  r.post('/api/v1/admin/users/:id/role', (ctx) => {
    const { role } = validate(z.object({ role: z.enum(['user', 'support', 'moderator', 'admin', 'super_admin']) }), ctx.body);
    const u = q.get('SELECT * FROM users WHERE id = ?', Number(ctx.params.id));
    if (!u) throw notFound();
    if (u.id === ctx.user.id) throw bad('You cannot change your own role.');
    q.run('UPDATE users SET role = ? WHERE id = ?', role, u.id);
    audit(ctx.user.id, 'user.role', 'user', u.id, { from: u.role, to: role }, ctx.ip);
    return { ok: true };
  }, P('users.roles'));

  // ---------------- Seller verification ----------------
  r.get('/api/v1/admin/verifications', (ctx) => {
    const status = ['pending', 'approved', 'rejected'].includes(ctx.query.status) ? ctx.query.status : 'pending';
    return q.all(`SELECT v.*, u.name, u.email, u.phone, u.country_code, u.created_at AS user_created, u.email_verified_at, u.phone_verified_at,
      (SELECT COUNT(*) FROM listings WHERE seller_id = u.id) AS listings,
      (SELECT COUNT(*) FROM orders WHERE seller_id = u.id AND status = 'completed') AS sales,
      (SELECT COUNT(*) FROM reports WHERE target_type = 'user' AND target_id = u.id) AS reports
      FROM seller_verifications v JOIN users u ON u.id = v.user_id WHERE v.status = ? ORDER BY v.id ${status === 'pending' ? 'ASC' : 'DESC'} LIMIT 100`, status);
  }, P('sellers.verify'));

  r.post('/api/v1/admin/verifications/:id', (ctx) => {
    const b = validate(z.object({ decision: z.enum(['approve', 'reject']), notes: z.string().trim().max(500).optional() }), ctx.body);
    const v = q.get('SELECT * FROM seller_verifications WHERE id = ?', Number(ctx.params.id));
    if (!v) throw notFound();
    if (v.status !== 'pending') throw conflict('Already reviewed.');
    if (b.decision === 'reject' && !b.notes) throw bad('Tell the seller why it was rejected.');
    tx(() => {
      q.run("UPDATE seller_verifications SET status = ?, notes = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?", b.decision === 'approve' ? 'approved' : 'rejected', cleanText(b.notes, 500) || null, ctx.user.id, v.id);
      q.run('UPDATE users SET seller_status = ? WHERE id = ?', b.decision === 'approve' ? 'verified' : 'rejected', v.user_id);
    });
    notify(v.user_id, 'system', b.decision === 'approve' ? 'You are now a verified seller' : 'Seller verification not approved', b.decision === 'approve' ? 'Your listings now show the verified badge.' : b.notes, '/settings/verification');
    audit(ctx.user.id, `seller.${b.decision}`, 'user', v.user_id, { verification: v.id, notes: b.notes }, ctx.ip);
    return { ok: true };
  }, P('sellers.verify'));

  // ---------------- Listings moderation ----------------
  r.get('/api/v1/admin/listings', (ctx) => {
    const pg = page(ctx);
    const w = ['1=1'], a = [];
    if (ctx.query.status) { w.push('l.status = ?'); a.push(ctx.query.status); }
    if (ctx.query.q) { w.push('(l.title LIKE ? OR u.name LIKE ? OR l.id = ?)'); a.push(`%${ctx.query.q}%`, `%${ctx.query.q}%`, Number(ctx.query.q) || 0); }
    if (ctx.query.country) { w.push('l.country_code = ?'); a.push(ctx.query.country); }
    if (ctx.query.reported) w.push("EXISTS (SELECT 1 FROM reports rp WHERE rp.target_type = 'listing' AND rp.target_id = l.id AND rp.status = 'open')");
    if (ctx.query.featured) w.push("l.featured_until > datetime('now')");
    const where = w.join(' AND ');
    const rows = q.all(`SELECT l.id, l.slug, l.title, l.status, l.price_minor, l.currency, l.country_code, l.views, l.created_at, l.published_at, l.featured_until, l.moderation_note,
      u.id AS seller_id, u.name AS seller_name, u.seller_status, c.name AS category,
      (SELECT thumb_url FROM listing_images WHERE listing_id = l.id ORDER BY sort LIMIT 1) AS thumb,
      (SELECT COUNT(*) FROM reports rp WHERE rp.target_type = 'listing' AND rp.target_id = l.id AND rp.status = 'open') AS open_reports
      FROM listings l JOIN users u ON u.id = l.seller_id JOIN categories c ON c.id = l.category_id WHERE ${where} ORDER BY l.updated_at DESC LIMIT ? OFFSET ?`, ...a, pg.limit, pg.offset);
    return paged(rows, q.val(`SELECT COUNT(*) FROM listings l JOIN users u ON u.id = l.seller_id WHERE ${where}`, ...a), pg);
  }, P('listings.moderate'));

  r.post('/api/v1/admin/listings/:id/moderate', (ctx) => {
    const b = validate(z.object({ action: z.enum(['approve', 'reject', 'remove', 'restore']), note: z.string().trim().max(500).optional() }), ctx.body);
    const l = q.get('SELECT * FROM listings WHERE id = ?', Number(ctx.params.id));
    if (!l) throw notFound();
    const map = {
      approve: { from: ['pending_review', 'rejected'], to: 'active' },
      reject: { from: ['pending_review', 'active'], to: 'rejected' },
      remove: { from: ['active', 'paused', 'pending_review', 'rejected', 'expired', 'draft'], to: 'removed' },
      restore: { from: ['removed'], to: 'paused' },
    }[b.action];
    if (!map.from.includes(l.status)) throw conflict(`Cannot ${b.action} a listing that is ${l.status}.`);
    if (['reject', 'remove'].includes(b.action) && !b.note) throw bad('Add a note explaining the decision.');
    q.run(`UPDATE listings SET status = ?, moderation_note = ?, updated_at = datetime('now')${b.action === 'approve' ? ", published_at = COALESCE(published_at, datetime('now')), expires_at = COALESCE(expires_at, datetime('now','+60 days'))" : ''} WHERE id = ?`, map.to, cleanText(b.note, 500) || null, l.id);
    if (['reject', 'remove'].includes(b.action)) q.run("UPDATE reports SET status = 'actioned', handled_by = ?, resolution = ? WHERE target_type = 'listing' AND target_id = ? AND status = 'open'", ctx.user.id, b.action, l.id);
    indexListing(l.id); invalidateCategories(); invalidateVocab();
    const msg = { approve: ['Listing approved', `"${l.title}" is now live.`], reject: ['Listing not approved', `"${l.title}": ${b.note}`], remove: ['Listing removed', `"${l.title}" was removed: ${b.note}`], restore: ['Listing restored', `"${l.title}" was restored as paused.`] }[b.action];
    notify(l.seller_id, 'listing', msg[0], msg[1], '/seller/listings');
    audit(ctx.user.id, `listing.${b.action}`, 'listing', l.id, { note: b.note, from: l.status }, ctx.ip);
    return { ok: true, status: map.to };
  }, P('listings.moderate'));

  r.post('/api/v1/admin/listings/:id/feature', (ctx) => {
    const { days } = validate(z.object({ days: z.coerce.number().int().min(0).max(90) }), ctx.body);
    const l = q.get('SELECT * FROM listings WHERE id = ?', Number(ctx.params.id));
    if (!l) throw notFound();
    if (days > 0 && l.status !== 'active') throw conflict('Only active listings can be featured.');
    q.run(`UPDATE listings SET featured_until = ${days ? "datetime('now', ?)" : 'NULL'} WHERE id = ?`, ...(days ? [`+${days} days`, l.id] : [l.id]));
    audit(ctx.user.id, days ? 'listing.feature' : 'listing.unfeature', 'listing', l.id, { days }, ctx.ip);
    return { ok: true };
  }, P('listings.feature'));

  // ---------------- Categories ----------------
  r.get('/api/v1/admin/categories', () => {
    const rows = q.all(`SELECT c.*, (SELECT COUNT(*) FROM listings l WHERE l.category_id = c.id AND l.status = 'active') AS listings,
      (SELECT COUNT(*) FROM category_attributes a WHERE a.category_id = c.id) AS attributes FROM categories c ORDER BY c.sort, c.name`);
    const attrs = q.all('SELECT * FROM category_attributes ORDER BY sort, id').map((a) => ({ ...a, options: json(a.options, null) }));
    return { categories: rows, attributes: attrs };
  }, P('categories.manage'));

  const catSchema = z.object({
    name: z.string().trim().min(2).max(60), slug: z.string().trim().max(70).optional(), parent_id: zId.nullable().optional(),
    icon: z.string().trim().max(30).default('box'), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(), description: z.string().trim().max(300).nullable().optional(),
    seo_title: z.string().trim().max(70).nullable().optional(), seo_description: z.string().trim().max(170).nullable().optional(),
    moderation: z.enum(['auto', 'review']).default('auto'), allows_delivery: z.boolean().default(true), sort: z.coerce.number().int().default(0), active: z.boolean().default(true),
  });
  r.post('/api/v1/admin/categories', (ctx) => {
    const b = validate(catSchema, ctx.body);
    const slug = slugify(b.slug || b.name);
    if (q.get('SELECT 1 FROM categories WHERE slug = ?', slug)) throw conflict('That slug is already used.');
    if (b.parent_id && q.val('SELECT parent_id FROM categories WHERE id = ?', b.parent_id)) throw bad('Categories support two levels: choose a main category as parent.');
    const { id } = q.run('INSERT INTO categories (name, slug, parent_id, icon, color, description, seo_title, seo_description, moderation, allows_delivery, sort, active) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      b.name, slug, b.parent_id ?? null, b.icon, b.color ?? null, b.description ?? null, b.seo_title ?? null, b.seo_description ?? null, b.moderation, b.allows_delivery ? 1 : 0, b.sort, b.active ? 1 : 0);
    invalidateCategories();
    audit(ctx.user.id, 'category.create', 'category', id, b, ctx.ip);
    return q.get('SELECT * FROM categories WHERE id = ?', id);
  }, P('categories.manage'));
  r.put('/api/v1/admin/categories/:id', (ctx) => {
    const b = validate(catSchema, ctx.body);
    const c = q.get('SELECT * FROM categories WHERE id = ?', Number(ctx.params.id));
    if (!c) throw notFound();
    const slug = slugify(b.slug || b.name);
    if (q.get('SELECT 1 FROM categories WHERE slug = ? AND id != ?', slug, c.id)) throw conflict('That slug is already used.');
    if (b.parent_id === c.id) throw bad('A category cannot be its own parent.');
    q.run('UPDATE categories SET name=?, slug=?, parent_id=?, icon=?, color=?, description=?, seo_title=?, seo_description=?, moderation=?, allows_delivery=?, sort=?, active=? WHERE id = ?',
      b.name, slug, b.parent_id ?? null, b.icon, b.color ?? null, b.description ?? null, b.seo_title ?? null, b.seo_description ?? null, b.moderation, b.allows_delivery ? 1 : 0, b.sort, b.active ? 1 : 0, c.id);
    invalidateCategories();
    audit(ctx.user.id, 'category.update', 'category', c.id, b, ctx.ip);
    return q.get('SELECT * FROM categories WHERE id = ?', c.id);
  }, P('categories.manage'));
  r.delete('/api/v1/admin/categories/:id', (ctx) => {
    const id = Number(ctx.params.id);
    const used = q.val('SELECT COUNT(*) FROM listings WHERE category_id IN (SELECT id FROM categories WHERE id = ? OR parent_id = ?)', id, id);
    if (used) throw conflict(`${used} listings use this category. Deactivate it instead, or move them first.`);
    q.run('DELETE FROM categories WHERE id = ?', id);
    invalidateCategories();
    audit(ctx.user.id, 'category.delete', 'category', id, null, ctx.ip);
    return { ok: true };
  }, P('categories.manage'));

  const attrSchema = z.object({
    key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,30}$/, 'lowercase letters, digits, underscores'), label: z.string().trim().min(2).max(40),
    type: z.enum(['text', 'number', 'select', 'boolean']), options: z.array(z.string().trim().min(1).max(40)).max(40).nullable().optional(),
    unit: z.string().trim().max(12).nullable().optional(), required: z.boolean().default(false), filterable: z.boolean().default(false), sort: z.coerce.number().int().default(0),
  });
  r.post('/api/v1/admin/categories/:id/attributes', (ctx) => {
    const b = validate(attrSchema, ctx.body);
    if (b.type === 'select' && !(b.options?.length >= 2)) throw bad('Select attributes need at least two options.');
    const cid = Number(ctx.params.id);
    if (!q.get('SELECT 1 FROM categories WHERE id = ?', cid)) throw notFound();
    if (q.get('SELECT 1 FROM category_attributes WHERE category_id = ? AND key = ?', cid, b.key)) throw conflict('That key exists in this category.');
    const { id } = q.run('INSERT INTO category_attributes (category_id, key, label, type, options, unit, required, filterable, sort) VALUES (?,?,?,?,?,?,?,?,?)', cid, b.key, b.label, b.type, b.options ? JSON.stringify(b.options) : null, b.unit ?? null, b.required ? 1 : 0, b.filterable ? 1 : 0, b.sort);
    audit(ctx.user.id, 'attribute.create', 'category', cid, b, ctx.ip);
    return q.get('SELECT * FROM category_attributes WHERE id = ?', id);
  }, P('categories.manage'));
  r.put('/api/v1/admin/attributes/:id', (ctx) => {
    const b = validate(attrSchema, ctx.body);
    const a = q.get('SELECT * FROM category_attributes WHERE id = ?', Number(ctx.params.id));
    if (!a) throw notFound();
    q.run('UPDATE category_attributes SET key=?, label=?, type=?, options=?, unit=?, required=?, filterable=?, sort=? WHERE id = ?', b.key, b.label, b.type, b.options ? JSON.stringify(b.options) : null, b.unit ?? null, b.required ? 1 : 0, b.filterable ? 1 : 0, b.sort, a.id);
    audit(ctx.user.id, 'attribute.update', 'category', a.category_id, b, ctx.ip);
    return { ok: true };
  }, P('categories.manage'));
  r.delete('/api/v1/admin/attributes/:id', (ctx) => {
    const a = q.get('SELECT * FROM category_attributes WHERE id = ?', Number(ctx.params.id));
    if (!a) throw notFound();
    q.run('DELETE FROM category_attributes WHERE id = ?', a.id);
    audit(ctx.user.id, 'attribute.delete', 'category', a.category_id, { key: a.key }, ctx.ip);
    return { ok: true };
  }, P('categories.manage'));

  // ---------------- Orders, payments, refunds ----------------
  r.get('/api/v1/admin/orders', (ctx) => {
    const pg = page(ctx);
    const w = ['1=1'], a = [];
    if (ctx.query.status) { w.push('o.status = ?'); a.push(ctx.query.status); }
    if (ctx.query.q) { w.push('(o.number LIKE ? OR i.title LIKE ? OR ub.name LIKE ? OR us.name LIKE ?)'); const t = `%${ctx.query.q}%`; a.push(t, t, t, t); }
    if (ctx.query.method) { w.push('o.payment_method = ?'); a.push(ctx.query.method); }
    const where = w.join(' AND ');
    const base = 'FROM orders o JOIN order_items i ON i.order_id = o.id JOIN users ub ON ub.id = o.buyer_id JOIN users us ON us.id = o.seller_id';
    const rows = q.all(`SELECT o.id, o.number, o.status, o.fulfillment, o.payment_method, o.total_minor, o.currency, o.created_at, i.title, ub.name AS buyer_name, us.name AS seller_name,
      (SELECT status FROM payments p WHERE p.order_id = o.id ORDER BY p.id DESC LIMIT 1) AS payment_status
      ${base} WHERE ${where} ORDER BY o.id DESC LIMIT ? OFFSET ?`, ...a, pg.limit, pg.offset).map((o) => ({ ...o, status_label: STATUS_LABELS[o.status] }));
    return paged(rows, q.val(`SELECT COUNT(*) ${base} WHERE ${where}`, ...a), pg);
  }, P('orders.view'));

  r.post('/api/v1/admin/orders/:id/transition', (ctx) => {
    const b = validate(z.object({ to: z.enum(['completed', 'refunded', 'cancelled']), note: z.string().trim().min(3).max(500) }), ctx.body);
    const o = transitionOrder(Number(ctx.params.id), b.to, 'admin', ctx.user.id, { note: b.note });
    audit(ctx.user.id, `order.${b.to}`, 'order', o.id, { note: b.note }, ctx.ip);
    return { ok: true, status: o.status };
  }, P('disputes.manage'));

  r.post('/api/v1/admin/orders/:id/refund', async (ctx) => {
    const b = validate(z.object({ amount: z.union([z.string(), z.number()]).optional(), reason: z.string().trim().min(3).max(300) }), ctx.body);
    let amount = null;
    if (b.amount !== undefined && b.amount !== '') { const { toMinor } = await import('../lib/money.js'); try { amount = toMinor(b.amount); } catch { throw bad('Invalid amount.'); } }
    return refundOrder(Number(ctx.params.id), amount, b.reason, ctx.user.id, ctx.ip);
  }, P('refunds.manage'));

  r.get('/api/v1/admin/payments', (ctx) => {
    const pg = page(ctx);
    const w = ['1=1'], a = [];
    if (ctx.query.status) { w.push('p.status = ?'); a.push(ctx.query.status); }
    if (ctx.query.provider) { w.push('p.provider = ?'); a.push(ctx.query.provider); }
    const where = w.join(' AND ');
    const rows = q.all(`SELECT p.id, p.order_id, p.provider, p.provider_order_id, p.provider_payment_id, p.amount_minor, p.currency, p.status, p.verified_via, p.failure_reason, p.created_at, o.number
      FROM payments p JOIN orders o ON o.id = p.order_id WHERE ${where} ORDER BY p.id DESC LIMIT ? OFFSET ?`, ...a, pg.limit, pg.offset);
    return {
      ...paged(rows, q.val(`SELECT COUNT(*) FROM payments p WHERE ${where}`, ...a), pg),
      refunds: q.all('SELECT r.*, o.number FROM refunds r JOIN orders o ON o.id = r.order_id ORDER BY r.id DESC LIMIT 50'),
      providers: Object.values(providers).map((p) => ({ id: p.id, label: p.label, countries: p.countries, configured: p.isConfigured(), mode: p.mode() })),
      events: q.all('SELECT id, provider, event_id, type, processed_at FROM payment_events ORDER BY id DESC LIMIT 20'),
    };
  }, P('payments.view'));

  // ---------------- Disputes ----------------
  r.get('/api/v1/admin/disputes', (ctx) => {
    const st = ctx.query.status === 'closed' ? "('resolved','closed')" : "('open','under_review')";
    return q.all(`SELECT d.*, o.number, o.total_minor, o.currency, o.payment_method, o.status AS order_status, i.title, ub.name AS buyer_name, us.name AS seller_name, op.name AS opened_by_name,
      CASE WHEN d.opened_by = o.buyer_id THEN 'buyer' ELSE 'seller' END AS opened_by_role
      FROM disputes d JOIN orders o ON o.id = d.order_id JOIN order_items i ON i.order_id = o.id JOIN users ub ON ub.id = o.buyer_id JOIN users us ON us.id = o.seller_id JOIN users op ON op.id = d.opened_by
      WHERE d.status IN ${st} ORDER BY d.id DESC LIMIT 100`);
  }, P('disputes.manage'));

  r.post('/api/v1/admin/disputes/:id', async (ctx) => {
    const b = validate(z.object({ action: z.enum(['review', 'refund_buyer', 'release_seller', 'cancelled']), note: z.string().trim().max(1000).optional() }), ctx.body);
    const d = q.get('SELECT * FROM disputes WHERE id = ?', Number(ctx.params.id));
    if (!d) throw notFound();
    if (!['open', 'under_review'].includes(d.status)) throw conflict('This dispute is closed.');
    const o = q.get('SELECT * FROM orders WHERE id = ?', d.order_id);
    if (b.action === 'review') {
      q.run("UPDATE disputes SET status = 'under_review' WHERE id = ?", d.id);
    } else {
      if (!b.note) throw bad('Add a resolution note for both parties.');
      if (b.action === 'refund_buyer') {
        const paid = q.get("SELECT 1 FROM payments WHERE order_id = ? AND status IN ('captured','partially_refunded')", o.id);
        if (paid) await refundOrder(o.id, null, `Dispute #${d.id}: ${b.note}`, ctx.user.id, ctx.ip);
        else transitionOrder(o.id, 'refunded', 'admin', ctx.user.id, { note: `Dispute resolved for buyer (direct payment — settle outside PASAL): ${b.note}` });
      } else if (b.action === 'release_seller') {
        transitionOrder(o.id, 'completed', 'admin', ctx.user.id, { note: `Dispute resolved for seller: ${b.note}` });
      } else {
        transitionOrder(o.id, 'cancelled', 'admin', ctx.user.id, { note: b.note });
      }
      q.run("UPDATE disputes SET status = 'resolved', outcome = ?, resolution_note = ?, resolved_by = ?, resolved_at = datetime('now') WHERE id = ?", b.action, cleanText(b.note, 1000), ctx.user.id, d.id);
      for (const uid of [o.buyer_id, o.seller_id]) notify(uid, 'order', 'Dispute resolved', cleanText(b.note, 200), `/orders/${o.id}`);
    }
    audit(ctx.user.id, `dispute.${b.action}`, 'dispute', d.id, { note: b.note, order: o.id }, ctx.ip);
    return { ok: true };
  }, P('disputes.manage'));

  // ---------------- Reports ----------------
  r.get('/api/v1/admin/reports', (ctx) => {
    const status = ['open', 'actioned', 'dismissed'].includes(ctx.query.status) ? ctx.query.status : 'open';
    const rows = q.all(`SELECT r.*, u.name AS reporter_name FROM reports r LEFT JOIN users u ON u.id = r.reporter_id WHERE r.status = ? ${ctx.query.type ? 'AND r.target_type = ?' : ''} ORDER BY r.id DESC LIMIT 100`, status, ...(ctx.query.type ? [ctx.query.type] : []));
    return rows.map((r) => {
      let target = null;
      if (r.target_type === 'listing') target = q.get('SELECT id, slug, title, status, seller_id FROM listings WHERE id = ?', r.target_id);
      if (r.target_type === 'user') target = q.get('SELECT id, name, status FROM users WHERE id = ?', r.target_id);
      if (r.target_type === 'review') target = q.get('SELECT id, rating, body, status, author_id FROM reviews WHERE id = ?', r.target_id);
      if (r.target_type === 'message') target = q.get('SELECT id, body, sender_id, conversation_id FROM messages WHERE id = ?', r.target_id);
      return { ...r, target };
    });
  }, P('reports.manage'));

  r.post('/api/v1/admin/reports/:id', (ctx) => {
    const b = validate(z.object({ action: z.enum(['dismiss', 'remove_target', 'hide_review']), note: z.string().trim().max(500).optional() }), ctx.body);
    const rp = q.get('SELECT * FROM reports WHERE id = ?', Number(ctx.params.id));
    if (!rp) throw notFound();
    if (rp.status !== 'open') throw conflict('Report already handled.');
    if (b.action === 'remove_target') {
      if (rp.target_type === 'listing') {
        q.run("UPDATE listings SET status = 'removed', moderation_note = ? WHERE id = ?", cleanText(b.note, 500) || 'Removed after report', rp.target_id);
        q.run('DELETE FROM listings_fts WHERE rowid = ?', rp.target_id);
        const s = q.val('SELECT seller_id FROM listings WHERE id = ?', rp.target_id);
        notify(s, 'listing', 'Listing removed', b.note || 'Your listing was removed for violating the prohibited items policy.', '/prohibited-items');
      } else if (rp.target_type === 'message') {
        q.run("UPDATE messages SET body = '[removed by PASAL moderation]', image_url = NULL WHERE id = ?", rp.target_id);
      } else if (rp.target_type === 'review') {
        q.run("UPDATE reviews SET status = 'hidden' WHERE id = ?", rp.target_id);
      } else {
        throw bad('Suspend users from the user management page.');
      }
    }
    if (b.action === 'hide_review') q.run("UPDATE reviews SET status = 'hidden' WHERE id = ?", rp.target_id);
    q.run("UPDATE reports SET status = ?, handled_by = ?, resolution = ? WHERE target_type = ? AND target_id = ? AND status = 'open'", b.action === 'dismiss' ? 'dismissed' : 'actioned', ctx.user.id, cleanText(b.note, 500) || b.action, rp.target_type, rp.target_id);
    audit(ctx.user.id, `report.${b.action}`, rp.target_type, rp.target_id, { report: rp.id, note: b.note }, ctx.ip);
    invalidateCategories();
    return { ok: true };
  }, P('reports.manage'));

  // ---------------- Promotions & homepage ----------------
  r.get('/api/v1/admin/promotions', () => ({
    promotions: q.all('SELECT * FROM promotions ORDER BY placement, sort, id'),
    sections: q.all('SELECT * FROM homepage_sections ORDER BY sort'),
  }), P('promotions.manage'));
  const promoSchema = z.object({
    placement: z.enum(['hero', 'banner', 'strip', 'ad']), title: z.string().trim().min(2).max(90), subtitle: z.string().trim().max(200).nullable().optional(),
    cta_label: z.string().trim().max(30).nullable().optional(), link: z.string().trim().max(300).regex(/^\/[^\s]*$/, 'Use a site path like /c/smartphones').nullable().optional(),
    theme: z.enum(['violet', 'midnight', 'sunrise', 'mint', 'ocean']).default('violet'), country_code: z.enum(['IN', 'NP']).nullable().optional(),
    starts_at: z.string().max(20).nullable().optional(), ends_at: z.string().max(20).nullable().optional(), active: z.boolean().default(true), sort: z.coerce.number().int().default(0),
  });
  r.post('/api/v1/admin/promotions', (ctx) => {
    const b = validate(promoSchema, ctx.body);
    const { id } = q.run('INSERT INTO promotions (placement, title, subtitle, cta_label, link, theme, country_code, starts_at, ends_at, active, sort) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      b.placement, b.title, b.subtitle ?? null, b.cta_label ?? null, b.link ?? null, b.theme, b.country_code ?? null, b.starts_at || null, b.ends_at || null, b.active ? 1 : 0, b.sort);
    audit(ctx.user.id, 'promotion.create', 'promotion', id, b, ctx.ip);
    return q.get('SELECT * FROM promotions WHERE id = ?', id);
  }, P('promotions.manage'));
  r.put('/api/v1/admin/promotions/:id', (ctx) => {
    const b = validate(promoSchema, ctx.body);
    const n = q.run('UPDATE promotions SET placement=?, title=?, subtitle=?, cta_label=?, link=?, theme=?, country_code=?, starts_at=?, ends_at=?, active=?, sort=? WHERE id = ?',
      b.placement, b.title, b.subtitle ?? null, b.cta_label ?? null, b.link ?? null, b.theme, b.country_code ?? null, b.starts_at || null, b.ends_at || null, b.active ? 1 : 0, b.sort, Number(ctx.params.id));
    if (!n.changes) throw notFound();
    audit(ctx.user.id, 'promotion.update', 'promotion', ctx.params.id, b, ctx.ip);
    return { ok: true };
  }, P('promotions.manage'));
  r.delete('/api/v1/admin/promotions/:id', (ctx) => {
    q.run('DELETE FROM promotions WHERE id = ?', Number(ctx.params.id));
    audit(ctx.user.id, 'promotion.delete', 'promotion', ctx.params.id, null, ctx.ip);
    return { ok: true };
  }, P('promotions.manage'));
  r.put('/api/v1/admin/homepage-sections', (ctx) => {
    const items = validate(z.array(z.object({ id: zId, active: z.boolean(), sort: z.coerce.number().int(), title: z.string().trim().min(2).max(60), subtitle: z.string().trim().max(120).nullable().optional() })).max(40), ctx.body);
    tx(() => { for (const s of items) q.run('UPDATE homepage_sections SET active = ?, sort = ?, title = ?, subtitle = ? WHERE id = ?', s.active ? 1 : 0, s.sort, cleanText(s.title, 60), cleanText(s.subtitle, 120) || null, s.id); });
    audit(ctx.user.id, 'homepage.update', 'homepage', null, { count: items.length }, ctx.ip);
    return { ok: true };
  }, P('promotions.manage'));

  // ---------------- Analytics ----------------
  r.get('/api/v1/admin/analytics', (ctx) => {
    const days = Math.min(180, Math.max(7, Number(ctx.query.days) || 30));
    const span = `-${days - 1} days`;
    const series = q.all(`WITH RECURSIVE d(day) AS (SELECT date('now', ?) UNION ALL SELECT date(day,'+1 day') FROM d WHERE day < date('now'))
      SELECT d.day,
        (SELECT COUNT(*) FROM users WHERE date(created_at) = d.day) AS signups,
        (SELECT COUNT(*) FROM listings WHERE date(published_at) = d.day) AS listings,
        (SELECT COUNT(*) FROM orders WHERE date(created_at) = d.day) AS orders,
        (SELECT COUNT(*) FROM messages WHERE date(created_at) = d.day) AS messages,
        (SELECT COUNT(*) FROM listing_views WHERE day = d.day) AS views FROM d`, span);
    return {
      days, series,
      categories: q.all(`SELECT COALESCE(p.name, c.name) AS name, COUNT(*) AS listings, SUM(l.views) AS views FROM listings l JOIN categories c ON c.id = l.category_id LEFT JOIN categories p ON p.id = c.parent_id
        WHERE l.status IN ('active','sold') GROUP BY COALESCE(p.id, c.id) ORDER BY listings DESC LIMIT 12`),
      cities: q.all(`SELECT loc.name, l.country_code, COUNT(*) AS listings FROM listings l JOIN locations loc ON loc.id = l.city_id WHERE l.status = 'active' GROUP BY loc.id ORDER BY listings DESC LIMIT 10`),
      funnel: {
        views: q.val("SELECT COUNT(*) FROM listing_views WHERE day >= date('now', ?)", span),
        conversations: q.val("SELECT COUNT(*) FROM conversations WHERE created_at >= date('now', ?)", span),
        offers: q.val("SELECT COUNT(*) FROM offers WHERE created_at >= date('now', ?)", span),
        orders: q.val("SELECT COUNT(*) FROM orders WHERE created_at >= date('now', ?)", span),
        completed: q.val("SELECT COUNT(*) FROM orders WHERE status = 'completed' AND completed_at >= date('now', ?)", span),
      },
      payment_mix: q.all("SELECT payment_method, COUNT(*) n FROM orders WHERE created_at >= date('now', ?) GROUP BY payment_method", span),
      fulfillment_mix: q.all("SELECT fulfillment, COUNT(*) n FROM orders WHERE created_at >= date('now', ?) GROUP BY fulfillment", span),
      top_searches: q.all("SELECT term, COUNT(*) n, ROUND(AVG(results)) AS avg_results FROM search_log WHERE created_at >= date('now', ?) GROUP BY term ORDER BY n DESC LIMIT 12", span),
      zero_result_searches: q.all("SELECT term, COUNT(*) n FROM search_log WHERE results = 0 AND created_at >= date('now', ?) GROUP BY term ORDER BY n DESC LIMIT 8", span),
    };
  }, P('analytics.view'));

  // ---------------- Support tickets ----------------
  r.get('/api/v1/admin/tickets', (ctx) => {
    const st = ctx.query.status === 'closed' ? "('resolved','closed')" : "('open','pending')";
    return q.all(`SELECT t.*, a.name AS assignee, (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id) AS messages FROM support_tickets t LEFT JOIN users a ON a.id = t.assigned_to
      WHERE t.status IN ${st} ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.updated_at DESC LIMIT 200`);
  }, P('tickets.manage'));
  r.get('/api/v1/admin/tickets/:id', (ctx) => {
    const t = q.get('SELECT * FROM support_tickets WHERE id = ?', Number(ctx.params.id));
    if (!t) throw notFound();
    return { ...t, messages: q.all('SELECT tm.*, u.name AS author_name FROM ticket_messages tm LEFT JOIN users u ON u.id = tm.author_id WHERE ticket_id = ? ORDER BY id', t.id), staff: q.all("SELECT id, name, role FROM users WHERE role IN ('support','admin','super_admin') AND status = 'active'") };
  }, P('tickets.manage'));
  r.post('/api/v1/admin/tickets/:id', async (ctx) => {
    const b = validate(z.object({ reply: z.string().trim().max(4000).optional(), status: z.enum(['open', 'pending', 'resolved', 'closed']).optional(), priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(), assigned_to: zId.nullable().optional() }), ctx.body);
    const t = q.get('SELECT * FROM support_tickets WHERE id = ?', Number(ctx.params.id));
    if (!t) throw notFound();
    if (b.reply) {
      q.run('INSERT INTO ticket_messages (ticket_id, author_id, staff, body) VALUES (?,?,1,?)', t.id, ctx.user.id, cleanText(b.reply, 4000));
      if (t.user_id) notify(t.user_id, 'system', `Support replied: ${t.subject}`, cleanText(b.reply, 140), `/help?ticket=${t.id}`);
      else { const { sendEmail, emailLayout } = await import('../providers/messaging.js'); sendEmail(t.email, `Re: ${t.subject} [T-${String(t.id).padStart(5, '0')}]`, emailLayout(`Hi ${t.name || ''}`, [b.reply])); }
    }
    q.run("UPDATE support_tickets SET status = COALESCE(?, CASE WHEN ? IS NOT NULL THEN 'pending' ELSE status END), priority = COALESCE(?, priority), assigned_to = CASE WHEN ? THEN ? ELSE assigned_to END, updated_at = datetime('now') WHERE id = ?",
      b.status ?? null, b.reply ?? null, b.priority ?? null, b.assigned_to !== undefined ? 1 : 0, b.assigned_to ?? null, t.id);
    audit(ctx.user.id, 'ticket.update', 'ticket', t.id, { status: b.status, replied: !!b.reply }, ctx.ip);
    return { ok: true };
  }, P('tickets.manage'));

  // ---------------- Settings, countries, currencies ----------------
  r.get('/api/v1/admin/settings', () => ({
    settings: allSettings(),
    countries: q.all('SELECT * FROM countries'),
    rates: q.all('SELECT * FROM fx_rates'),
    providers: Object.values(providers).map((p) => ({ id: p.id, label: p.label, countries: p.countries, configured: p.isConfigured(), mode: p.mode() })),
    integrations: {
      email: config.email.provider === 'resend' && config.email.resendKey ? 'Resend' : 'Dev outbox (not delivered)',
      sms: config.sms.provider === 'twilio' && config.sms.twilioSid ? 'Twilio' : 'Dev outbox (not delivered)',
      google: config.google.clientId ? 'Configured' : 'Not configured',
      storage: 'Local disk',
    },
    roles: PERMISSIONS,
  }), P('admin.access'));

  r.put('/api/v1/admin/settings', (ctx) => {
    const b = validate(z.object({
      listing_expiry_days: z.coerce.number().int().min(7).max(365).optional(),
      offer_expiry_hours: z.coerce.number().int().min(1).max(336).optional(),
      max_images_per_listing: z.coerce.number().int().min(1).max(20).optional(),
      require_review_new_sellers: z.boolean().optional(),
      platform_fee_bps: z.coerce.number().int().min(0).max(2000).optional(),
      payments_test_mode: z.boolean().optional(),
      payment_providers: z.object({ razorpay: z.boolean(), esewa: z.boolean(), sandbox: z.boolean() }).optional(),
      cross_border_enabled: z.boolean().optional(),
      maintenance_banner: z.string().trim().max(200).optional(),
    }), ctx.body);
    for (const [k, v] of Object.entries(b)) if (k in DEFAULT_SETTINGS) setSetting(k, v);
    audit(ctx.user.id, 'settings.update', 'settings', null, b, ctx.ip);
    return allSettings();
  }, P('settings.manage'));

  r.put('/api/v1/admin/countries/:code', (ctx) => {
    const { enabled } = validate(z.object({ enabled: z.boolean() }), ctx.body);
    if (!enabled && q.val('SELECT COUNT(*) FROM countries WHERE enabled = 1') <= 1) throw bad('At least one country must stay enabled.');
    q.run('UPDATE countries SET enabled = ? WHERE code = ?', enabled ? 1 : 0, ctx.params.code);
    audit(ctx.user.id, 'country.update', 'country', ctx.params.code, { enabled }, ctx.ip);
    return { ok: true };
  }, P('settings.manage'));

  r.put('/api/v1/admin/fx', (ctx) => {
    const b = validate(z.object({ base: z.enum(['INR', 'NPR']), quote: z.enum(['INR', 'NPR']), rate: z.coerce.number().positive().max(1000) }), ctx.body);
    if (b.base === b.quote) throw bad('Choose two different currencies.');
    const micros = Math.round(b.rate * 1e6);
    tx(() => {
      q.run("INSERT INTO fx_rates (base, quote, rate_micros, source, updated_at) VALUES (?,?,?,'manual',datetime('now')) ON CONFLICT(base, quote) DO UPDATE SET rate_micros = excluded.rate_micros, source = 'manual', updated_at = datetime('now')", b.base, b.quote, micros);
      q.run("INSERT INTO fx_rates (base, quote, rate_micros, source, updated_at) VALUES (?,?,?,'manual',datetime('now')) ON CONFLICT(base, quote) DO UPDATE SET rate_micros = excluded.rate_micros, source = 'manual', updated_at = datetime('now')", b.quote, b.base, Math.round(1e12 / micros));
    });
    audit(ctx.user.id, 'fx.update', 'fx', `${b.base}/${b.quote}`, { rate: b.rate }, ctx.ip);
    return q.all('SELECT * FROM fx_rates');
  }, P('settings.manage'));

  // ---------------- Audit log ----------------
  r.get('/api/v1/admin/audit', (ctx) => {
    const pg = page(ctx);
    const w = ['1=1'], a = [];
    if (ctx.query.action) { w.push('l.action LIKE ?'); a.push(`${ctx.query.action}%`); }
    if (ctx.query.actor) { w.push('l.actor_id = ?'); a.push(Number(ctx.query.actor)); }
    if (ctx.query.entity) { w.push('l.entity_type = ?'); a.push(ctx.query.entity); }
    const where = w.join(' AND ');
    const rows = q.all(`SELECT l.*, u.name AS actor_name, u.role AS actor_role FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id WHERE ${where} ORDER BY l.id DESC LIMIT ? OFFSET ?`, ...a, pg.limit, pg.offset)
      .map((x) => ({ ...x, data: json(x.data) }));
    return paged(rows, q.val(`SELECT COUNT(*) FROM audit_logs l WHERE ${where}`, ...a), pg);
  }, P('audit.view'));

  void categoryTree;
}
