import { z } from 'zod';
import { q, tx } from '../db.js';
import { bad, notFound, validate, zId, rateLimit } from '../lib/http.js';
import { cleanText, normalizePhone } from '../lib/security.js';
import { getRate } from '../lib/money.js';
import { prefsFor, NOTIFICATION_TYPES, audit } from '../lib/services.js';
import { publicUser, selfUser } from './auth.js';
import { storeImage, decodeDataUrl } from '../providers/storage.js';
import { listingCards } from './listings.js';

export function sellerStats(userId) {
  const r = q.get(`SELECT
      (SELECT COUNT(*) FROM listings WHERE seller_id = ? AND status = 'active') AS active_listings,
      (SELECT COUNT(*) FROM orders WHERE seller_id = ? AND status = 'completed') AS sales,
      (SELECT ROUND(AVG(rating), 2) FROM reviews WHERE subject_id = ? AND status = 'visible') AS rating,
      (SELECT COUNT(*) FROM reviews WHERE subject_id = ? AND status = 'visible') AS review_count`, userId, userId, userId, userId);
  const resp = q.get(`SELECT COUNT(*) AS total, SUM(CASE WHEN EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.sender_id = c.seller_id) THEN 1 ELSE 0 END) AS replied
      FROM conversations c WHERE c.seller_id = ?`, userId);
  return { ...r, rating: r.rating || null, response_rate: resp.total ? Math.round((resp.replied / resp.total) * 100) : null };
}

const addressSchema = z.object({
  label: z.string().trim().max(30).default('Home'),
  full_name: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(7).max(20),
  country_code: z.enum(['IN', 'NP']),
  region_id: zId.nullable().optional(),
  district_id: zId.nullable().optional(),
  city_id: zId,
  locality: z.string().trim().max(120).optional().nullable(),
  line1: z.string().trim().min(3).max(200),
  line2: z.string().trim().max(200).optional().nullable(),
  postal_code: z.string().trim().max(10).optional().nullable(),
  is_default: z.boolean().default(false),
});

function checkPostal(country, code) {
  if (!code) return;
  if (country === 'IN' && !/^[1-9]\d{5}$/.test(code)) throw bad('PIN code must be 6 digits.');
  if (country === 'NP' && !/^\d{5}$/.test(code)) throw bad('Nepal postal codes are 5 digits.');
}

export function register(r) {
  // ---- Countries, currencies, locations ----
  r.get('/api/v1/countries', () => {
    const countries = q.all('SELECT c.*, cur.symbol, cur.name AS currency_name FROM countries c JOIN currencies cur ON cur.code = c.currency WHERE c.enabled = 1 ORDER BY c.code');
    const rates = q.all('SELECT * FROM fx_rates');
    return { countries, rates };
  });

  r.get('/api/v1/fx', (ctx) => {
    const from = String(ctx.query.from || 'INR');
    const to = String(ctx.query.to || 'NPR');
    const rate = getRate(from, to);
    const row = q.get('SELECT updated_at, source FROM fx_rates WHERE (base = ? AND quote = ?) OR (base = ? AND quote = ?)', from, to, to, from);
    return { from, to, rate_micros: rate, rate: rate ? rate / 1e6 : null, updated_at: row?.updated_at, source: row?.source, estimated: true };
  });

  r.get('/api/v1/locations', (ctx) => {
    const country = ctx.query.country === 'NP' ? 'NP' : 'IN';
    if (ctx.query.q) {
      const term = `%${String(ctx.query.q).slice(0, 40)}%`;
      return q.all(`SELECT l.id, l.name, l.type, l.slug, l.postal_code, p.name AS parent_name, l.lat, l.lng FROM locations l LEFT JOIN locations p ON p.id = l.parent_id
        WHERE l.country_code = ? AND l.type IN ('city','locality') AND l.name LIKE ? ORDER BY l.popular DESC, length(l.name) LIMIT 12`, country, term);
    }
    if (ctx.query.popular) {
      return q.all(`SELECT l.id, l.name, l.slug, l.lat, l.lng, p.name AS parent_name,
        (SELECT COUNT(*) FROM listings x WHERE x.city_id = l.id AND x.status = 'active') AS listing_count
        FROM locations l LEFT JOIN locations p ON p.id = l.parent_id WHERE l.country_code = ? AND l.type = 'city' AND l.popular = 1 ORDER BY listing_count DESC, l.name`, country);
    }
    const parent = ctx.query.parent ? Number(ctx.query.parent) : null;
    return parent
      ? q.all('SELECT id, name, type, slug, postal_code, lat, lng FROM locations WHERE parent_id = ? ORDER BY name', parent)
      : q.all("SELECT id, name, type, slug FROM locations WHERE country_code = ? AND type = 'region' ORDER BY name", country);
  });

  r.get('/api/v1/locations/:slug', (ctx) => {
    const l = q.get("SELECT l.*, p.name AS parent_name FROM locations l LEFT JOIN locations p ON p.id = l.parent_id WHERE l.slug = ? AND l.type = 'city'", ctx.params.slug);
    if (!l) throw notFound('Location not found.');
    return l;
  });

  // ---- Profiles ----
  r.get('/api/v1/users/:id', (ctx) => {
    const u = q.get("SELECT * FROM users WHERE id = ? AND status != 'deleted'", Number(ctx.params.id));
    if (!u) throw notFound('Seller not found.');
    const city = u.city_id ? q.get('SELECT l.name, p.name AS parent FROM locations l LEFT JOIN locations p ON p.id = l.parent_id WHERE l.id = ?', u.city_id) : null;
    const reviews = q.all(`SELECT r.id, r.rating, r.body, r.verified, r.reply, r.replied_at, r.created_at, r.direction, a.id AS author_id, a.name AS author_name, a.avatar_url AS author_avatar, l.title AS listing_title
      FROM reviews r JOIN users a ON a.id = r.author_id LEFT JOIN listings l ON l.id = r.listing_id WHERE r.subject_id = ? AND r.status = 'visible' ORDER BY r.id DESC LIMIT 20`, u.id);
    const dist = q.all("SELECT rating, COUNT(*) AS n FROM reviews WHERE subject_id = ? AND status = 'visible' GROUP BY rating", u.id);
    const listings = listingCards(q.all("SELECT id FROM listings WHERE seller_id = ? AND status = 'active' ORDER BY published_at DESC LIMIT 48", u.id).map((x) => x.id), ctx.user);
    const sold = q.val("SELECT COUNT(*) FROM listings WHERE seller_id = ? AND status = 'sold'", u.id);
    const blocked = ctx.user ? !!q.get('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?', ctx.user.id, u.id) : false;
    return { user: { ...publicUser(u), city, suspended: u.status === 'suspended' }, stats: { ...sellerStats(u.id), sold }, reviews, distribution: dist, listings, blocked };
  });

  r.patch('/api/v1/me', async (ctx) => {
    const b = validate(z.object({
      name: z.string().trim().min(2).max(60).optional(),
      bio: z.string().trim().max(400).optional().nullable(),
      country_code: z.enum(['IN', 'NP']).optional(),
      city_id: zId.nullable().optional(),
      avatar: z.string().max(4_000_000).optional(),
    }), ctx.body);
    const u = ctx.user;
    let avatar = u.avatar_url;
    if (b.avatar) avatar = (await storeImage(decodeDataUrl(b.avatar), { folder: 'avatars', maxSize: 400, thumbSize: 120 })).url;
    if (b.city_id) {
      const c = q.get("SELECT country_code FROM locations WHERE id = ? AND type IN ('city','locality')", b.city_id);
      if (!c) throw bad('Unknown city.');
    }
    q.run(`UPDATE users SET name = COALESCE(?, name), bio = ?, country_code = COALESCE(?, country_code), city_id = ?, avatar_url = ?, updated_at = datetime('now') WHERE id = ?`,
      b.name ? cleanText(b.name, 60) : null, b.bio === undefined ? u.bio : cleanText(b.bio, 400), b.country_code, b.city_id === undefined ? u.city_id : b.city_id, avatar, u.id);
    return { user: selfUser(q.get('SELECT * FROM users WHERE id = ?', u.id)) };
  }, { auth: true });

  r.post('/api/v1/me/email', async (ctx) => {
    const { email } = validate(z.object({ email: z.string().trim().email() }), ctx.body);
    rateLimit(`chmail:${ctx.user.id}`, 5, 3600_000);
    if (q.get('SELECT 1 FROM users WHERE email = ? AND id != ?', email, ctx.user.id)) throw bad('That email is already in use.');
    q.run('UPDATE users SET email = ?, email_verified_at = NULL WHERE id = ?', email.toLowerCase(), ctx.user.id);
    return { ok: true };
  }, { auth: true });

  // ---- Notification preferences ----
  r.get('/api/v1/me/notification-preferences', (ctx) => ({ types: NOTIFICATION_TYPES, prefs: prefsFor(ctx.user) }), { auth: true });
  r.put('/api/v1/me/notification-preferences', (ctx) => {
    const ch = z.object({ inapp: z.boolean(), email: z.boolean(), push: z.boolean() });
    const prefs = validate(z.record(z.enum(Object.keys(NOTIFICATION_TYPES)), ch), ctx.body);
    q.run('UPDATE users SET notif_prefs = ? WHERE id = ?', JSON.stringify(prefs), ctx.user.id);
    return { prefs: prefsFor({ notif_prefs: JSON.stringify(prefs) }) };
  }, { auth: true });

  // ---- Addresses ----
  const withNames = `SELECT a.*, c.name AS city_name, d.name AS district_name, rg.name AS region_name FROM addresses a
    LEFT JOIN locations c ON c.id = a.city_id LEFT JOIN locations d ON d.id = a.district_id LEFT JOIN locations rg ON rg.id = a.region_id`;
  r.get('/api/v1/me/addresses', (ctx) => q.all(`${withNames} WHERE a.user_id = ? ORDER BY a.is_default DESC, a.id DESC`, ctx.user.id), { auth: true });

  const saveAddress = (ctx, id) => {
    const b = validate(addressSchema, ctx.body);
    const phone = normalizePhone(b.phone, b.country_code);
    if (!phone) throw bad(`Enter a valid ${b.country_code === 'IN' ? '+91' : '+977'} mobile number.`);
    checkPostal(b.country_code, b.postal_code);
    const city = q.get('SELECT id, country_code FROM locations WHERE id = ?', b.city_id);
    if (!city || city.country_code !== b.country_code) throw bad('Choose a city in the selected country.');
    return tx(() => {
      const count = q.val('SELECT COUNT(*) FROM addresses WHERE user_id = ?', ctx.user.id);
      const isDefault = b.is_default || count === 0 || (id && q.val('SELECT is_default FROM addresses WHERE id = ?', id));
      if (isDefault) q.run('UPDATE addresses SET is_default = 0 WHERE user_id = ?', ctx.user.id);
      const vals = [cleanText(b.label, 30), cleanText(b.full_name, 80), phone, b.country_code, b.region_id ?? null, b.district_id ?? null, b.city_id, cleanText(b.locality, 120), cleanText(b.line1, 200), cleanText(b.line2, 200), b.postal_code || null, isDefault ? 1 : 0];
      if (id) {
        const n = q.run('UPDATE addresses SET label=?, full_name=?, phone=?, country_code=?, region_id=?, district_id=?, city_id=?, locality=?, line1=?, line2=?, postal_code=?, is_default=? WHERE id = ? AND user_id = ?', ...vals, id, ctx.user.id);
        if (!n.changes) throw notFound('Address not found.');
        return q.get(`${withNames} WHERE a.id = ?`, id);
      }
      const { id: nid } = q.run('INSERT INTO addresses (label, full_name, phone, country_code, region_id, district_id, city_id, locality, line1, line2, postal_code, is_default, user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', ...vals, ctx.user.id);
      return q.get(`${withNames} WHERE a.id = ?`, nid);
    });
  };
  r.post('/api/v1/me/addresses', (ctx) => saveAddress(ctx), { auth: true });
  r.put('/api/v1/me/addresses/:id', (ctx) => saveAddress(ctx, Number(ctx.params.id)), { auth: true });
  r.delete('/api/v1/me/addresses/:id', (ctx) => {
    const a = q.get('SELECT * FROM addresses WHERE id = ? AND user_id = ?', Number(ctx.params.id), ctx.user.id);
    if (!a) throw notFound('Address not found.');
    tx(() => {
      q.run('DELETE FROM addresses WHERE id = ?', a.id);
      if (a.is_default) q.run('UPDATE addresses SET is_default = 1 WHERE id = (SELECT id FROM addresses WHERE user_id = ? ORDER BY id DESC LIMIT 1)', ctx.user.id);
    });
    return { ok: true };
  }, { auth: true });

  // ---- Seller verification request ----
  r.get('/api/v1/me/verification', (ctx) => q.get('SELECT id, doc_type, doc_last4, full_name, status, notes, created_at, reviewed_at FROM seller_verifications WHERE user_id = ? ORDER BY id DESC LIMIT 1', ctx.user.id) || null, { auth: true });
  r.post('/api/v1/me/verification', (ctx) => {
    const b = validate(z.object({
      doc_type: z.enum(['aadhaar', 'pan', 'passport', 'driving_licence', 'citizenship', 'voter_id']),
      doc_number: z.string().trim().min(6).max(24).regex(/^[A-Za-z0-9 -]+$/, 'Letters and numbers only'),
      full_name: z.string().trim().min(2).max(80),
    }), ctx.body);
    if (!ctx.user.email_verified_at && !ctx.user.phone_verified_at) throw bad('Verify your email or phone number first.');
    if (ctx.user.seller_status === 'verified') throw bad('You are already a verified seller.');
    if (ctx.user.seller_status === 'pending') throw bad('Your verification is already under review.');
    const last4 = b.doc_number.replace(/[^A-Za-z0-9]/g, '').slice(-4); // only the last 4 characters are kept
    tx(() => {
      q.run('INSERT INTO seller_verifications (user_id, doc_type, doc_last4, full_name) VALUES (?,?,?,?)', ctx.user.id, b.doc_type, last4, cleanText(b.full_name, 80));
      q.run("UPDATE users SET seller_status = 'pending' WHERE id = ?", ctx.user.id);
    });
    audit(ctx.user.id, 'seller.verification_requested', 'user', ctx.user.id, { doc_type: b.doc_type }, ctx.ip);
    return { ok: true };
  }, { auth: true });

  // ---- Blocking ----
  r.post('/api/v1/users/:id/block', (ctx) => {
    const id = Number(ctx.params.id);
    if (id === ctx.user.id) throw bad('You cannot block yourself.');
    q.run('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)', ctx.user.id, id);
    return { blocked: true };
  }, { auth: true });
  r.delete('/api/v1/users/:id/block', (ctx) => {
    q.run('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?', ctx.user.id, Number(ctx.params.id));
    return { blocked: false };
  }, { auth: true });
  r.get('/api/v1/me/blocks', (ctx) => q.all('SELECT u.id, u.name, u.avatar_url, b.created_at FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ?', ctx.user.id), { auth: true });
}
