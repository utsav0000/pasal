import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { q, tx, json, hasFts } from '../db.js';
import { config } from '../config.js';
import { bad, notFound, forbidden, conflict, validate, zId, rateLimit } from '../lib/http.js';
import { cleanText, sha256 } from '../lib/security.js';
import { toMinor, getRate, convertMinor } from '../lib/money.js';
import { getSetting, notify, slugify } from '../lib/services.js';
import { storeImage, decodeDataUrl } from '../providers/storage.js';
import { categoryTree, descendantIds, breadcrumb, attributesFor, invalidateCategories } from './categories.js';
import { publicUser } from './auth.js';
import { sellerStats } from './users.js';

export const CONDITIONS = { new: 'Brand new', like_new: 'Like new', used_good: 'Used · Good', used_fair: 'Used · Fair', for_parts: 'For parts' };

// Words that send a listing to manual review (prohibited-items policy). Matching is on whole words.
const REVIEW_TERMS = ['gun', 'pistol', 'rifle', 'ammunition', 'cartridge', 'explosive', 'ganja', 'charas', 'cocaine', 'heroin', 'mdma', 'weed', 'narcotic', 'ivory', 'rhino horn', 'tiger skin', 'pangolin', 'counterfeit', 'replica', 'first copy', 'fake id', 'aadhaar card', 'passport for sale', 'kidney', 'organ', 'prescription drug', 'tramadol', 'codeine', 'escort', 'hacked account', 'stolen'];
const needsReview = (text) => {
  const t = ` ${String(text).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ')} `;
  return REVIEW_TERMS.some((w) => t.includes(` ${w} `));
};

// ---------------- Cards ----------------
export function listingCards(ids, viewer) {
  if (!ids.length) return [];
  const ph = ids.map(() => '?').join(',');
  const rows = q.all(`SELECT l.id, l.slug, l.title, l.price_minor, l.original_price_minor, l.currency, l.condition, l.negotiable, l.fulfillment, l.status, l.views,
      l.published_at, l.created_at, l.featured_until, l.country_code, l.locality, l.seller_id,
      c.name AS city, rg.name AS region, cat.slug AS category_slug, cat.name AS category_name,
      u.name AS seller_name, u.seller_status, u.avatar_url AS seller_avatar,
      (SELECT thumb_url FROM listing_images i WHERE i.listing_id = l.id ORDER BY sort LIMIT 1) AS thumb,
      (SELECT url FROM listing_images i WHERE i.listing_id = l.id ORDER BY sort LIMIT 1) AS image,
      (SELECT COUNT(*) FROM listing_images i WHERE i.listing_id = l.id) AS image_count,
      d.fee_minor AS delivery_fee_minor
    FROM listings l JOIN users u ON u.id = l.seller_id JOIN categories cat ON cat.id = l.category_id
    LEFT JOIN locations c ON c.id = l.city_id LEFT JOIN locations rg ON rg.id = l.region_id
    LEFT JOIN delivery_options d ON d.listing_id = l.id WHERE l.id IN (${ph})`, ...ids);
  const wished = viewer ? new Set(q.all(`SELECT listing_id FROM wishlists WHERE user_id = ? AND listing_id IN (${ph})`, viewer.id, ...ids).map((r) => r.listing_id)) : new Set();
  const map = new Map(rows.map((r) => [r.id, {
    ...r,
    negotiable: !!r.negotiable,
    featured: !!(r.featured_until && r.featured_until > new Date().toISOString().replace('T', ' ')),
    seller: { id: r.seller_id, name: r.seller_name, verified: r.seller_status === 'verified', avatar_url: r.seller_avatar },
    wished: wished.has(r.id),
  }]));
  return ids.map((id) => map.get(id)).filter(Boolean);
}

// ---------------- Search ----------------
let vocab = null;
function vocabulary() {
  if (vocab && vocab.at > Date.now() - 300_000) return vocab.words;
  const words = new Map();
  const add = (s, w = 1) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).forEach((t) => { if (t.length >= 3) words.set(t, (words.get(t) || 0) + w); });
  for (const r of q.all("SELECT title, brand, model FROM listings WHERE status = 'active'")) { add(r.title); add(r.brand, 3); add(r.model, 2); }
  for (const c of q.all('SELECT name FROM categories')) add(c.name, 5);
  for (const c of q.all("SELECT name FROM locations WHERE type = 'city'")) add(c.name, 2);
  vocab = { at: Date.now(), words };
  return words;
}
export const invalidateVocab = () => (vocab = null);

function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let prev2 = null;
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

/** Correct misspelled tokens against the live vocabulary. Returns null when nothing changed. */
export function correctQuery(text) {
  const words = vocabulary();
  let changed = false;
  const out = text.toLowerCase().split(/\s+/).filter(Boolean).map((tok) => {
    if (tok.length < 3 || words.has(tok)) return tok;
    const max = tok.length > 6 ? 2 : 1;
    let best = null;
    for (const [w, freq] of words) {
      const d = editDistance(tok, w, max);
      if (d <= max && (!best || d < best.d || (d === best.d && freq > best.freq))) best = { w, d, freq };
    }
    if (best) { changed = true; return best.w; }
    return tok;
  });
  return changed ? out.join(' ') : null;
}

const ftsQuery = (text) => {
  const toks = String(text).toLowerCase().replace(/["*^():]/g, ' ').split(/\s+/).filter((t) => t.length >= 3).slice(0, 8);
  return toks.length ? toks.map((t) => `"${t}"`).join(' AND ') : null;
};

export const searchSchema = z.object({
  q: z.string().trim().max(100).optional(),
  country: z.enum(['IN', 'NP', 'all']).optional(),
  category: z.string().max(80).optional(),
  min: z.string().max(20).optional(),
  max: z.string().max(20).optional(),
  display: z.enum(['INR', 'NPR']).optional(),        // currency the min/max are expressed in
  currency: z.enum(['INR', 'NPR']).optional(),       // restrict listing currency
  condition: z.string().max(80).optional(),
  city: zId.optional(),
  radius: z.coerce.number().min(1).max(500).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  delivery: z.enum(['1']).optional(),
  pickup: z.enum(['1']).optional(),
  verified: z.enum(['1']).optional(),
  negotiable: z.enum(['1']).optional(),
  featured: z.enum(['1']).optional(),
  seller: zId.optional(),
  sort: z.enum(['relevance', 'newest', 'price_asc', 'price_desc', 'views', 'trending']).default('relevance'),
  page: z.coerce.number().int().min(1).max(500).default(1),
  limit: z.coerce.number().int().min(1).max(60).default(24),
}).passthrough();

export function searchListings(raw, viewer, { log = false } = {}) {
  const p = validate(searchSchema, raw);
  const where = ["l.status = 'active'"];
  const args = [];
  let join = '';
  let rankExpr = null;
  let corrected = null;

  if (p.country && p.country !== 'all') { where.push('l.country_code = ?'); args.push(p.country); }
  if (p.category) {
    const ids = descendantIds(p.category);
    if (!ids.length) return { items: [], total: 0, page: p.page, pages: 0 };
    where.push(`l.category_id IN (${ids.map(() => '?').join(',')})`); args.push(...ids);
  }
  if (p.seller) { where.push('l.seller_id = ?'); args.push(p.seller); }
  if (p.currency) { where.push('l.currency = ?'); args.push(p.currency); }
  if (p.condition) {
    const cs = p.condition.split(',').filter((c) => CONDITIONS[c]);
    if (cs.length) { where.push(`l.condition IN (${cs.map(() => '?').join(',')})`); args.push(...cs); }
  }
  if (p.delivery) where.push("l.fulfillment IN ('delivery','both')");
  if (p.pickup) where.push("l.fulfillment IN ('pickup','both')");
  if (p.negotiable) where.push('l.negotiable = 1');
  if (p.featured) where.push("l.featured_until > datetime('now')");
  if (p.verified) where.push("u.seller_status = 'verified'");

  // Location: exact city, or radius around a point (equirectangular approximation, fine for < 500 km)
  let lat = p.lat, lng = p.lng;
  if (p.city && (!lat || !lng)) {
    const c = q.get('SELECT lat, lng FROM locations WHERE id = ?', p.city);
    if (c) { lat = c.lat; lng = c.lng; }
  }
  if (p.radius && lat != null && lng != null) {
    const k = Math.cos((lat * Math.PI) / 180);
    where.push('l.lat IS NOT NULL AND ((l.lat - ?) * (l.lat - ?) + ((l.lng - ?) * ?) * ((l.lng - ?) * ?)) <= ?');
    args.push(lat, lat, lng, k, lng, k, (p.radius / 111.32) ** 2);
  } else if (p.city) {
    where.push('(l.city_id = ? OR l.city_id IN (SELECT id FROM locations WHERE parent_id = ?))'); args.push(p.city, p.city);
  }

  // Price range in the display currency, converted per listing currency (decimal-safe)
  const display = p.display || (p.country === 'NP' ? 'NPR' : 'INR');
  const bounds = [];
  for (const cur of ['INR', 'NPR']) {
    const rate = getRate(display, cur);
    if (!rate) continue;
    const lo = p.min ? convertMinor(safeMinor(p.min), rate) : null;
    const hi = p.max ? convertMinor(safeMinor(p.max), rate) : null;
    if (lo == null && hi == null) continue;
    bounds.push({ cur, lo, hi });
  }
  if (bounds.length) {
    where.push('(' + bounds.map((b) => `(l.currency = '${b.cur}'${b.lo != null ? ' AND l.price_minor >= ?' : ''}${b.hi != null ? ' AND l.price_minor <= ?' : ''})`).join(' OR ') + ')');
    for (const b of bounds) { if (b.lo != null) args.push(b.lo); if (b.hi != null) args.push(b.hi); }
  }

  // Category attribute filters: attr_<key>=value
  for (const [k, v] of Object.entries(raw)) {
    if (!k.startsWith('attr_') || !v) continue;
    const key = k.slice(5).replace(/[^a-z0-9_]/g, '');
    where.push(`EXISTS (SELECT 1 FROM listing_attributes la JOIN category_attributes ca ON ca.id = la.attribute_id WHERE la.listing_id = l.id AND ca.key = ? AND la.value = ?)`);
    args.push(key, String(v).slice(0, 60));
  }

  const runQuery = (text) => {
    const w = [...where];
    const a = [...args];
    let j = join;
    let rank = rankExpr;
    if (text) {
      const fq = hasFts ? ftsQuery(text) : null;
      if (fq) {
        j += ' JOIN listings_fts f ON f.rowid = l.id';
        w.push('listings_fts MATCH ?'); a.push(fq);
        rank = 'bm25(listings_fts, 10.0, 1.0, 6.0, 4.0, 3.0, 2.0)';
      } else {
        w.push('(l.title LIKE ? OR l.brand LIKE ? OR l.description LIKE ?)'); a.push(`%${text}%`, `%${text}%`, `%${text}%`);
      }
    }
    const rINR = getRate('INR', display) || 1e6;
    const rNPR = getRate('NPR', display) || 1e6;
    const priceExpr = `(l.price_minor * (CASE l.currency WHEN 'INR' THEN ${rINR} ELSE ${rNPR} END))`;
    const featuredBoost = "(CASE WHEN l.featured_until > datetime('now') THEN 1 ELSE 0 END)";
    const order = {
      relevance: rank ? `${featuredBoost} DESC, ${rank}, l.published_at DESC` : `${featuredBoost} DESC, l.published_at DESC`,
      newest: 'l.published_at DESC',
      price_asc: `${priceExpr} ASC`,
      price_desc: `${priceExpr} DESC`,
      views: 'l.views DESC',
      trending: "(l.views + 5 * (SELECT COUNT(*) FROM wishlists wl WHERE wl.listing_id = l.id)) * 1.0 / (julianday('now') - julianday(l.published_at) + 2) DESC",
    }[p.sort];
    const base = `FROM listings l JOIN users u ON u.id = l.seller_id ${j} WHERE ${w.join(' AND ')}`;
    const total = q.val(`SELECT COUNT(*) ${base}`, ...a);
    const ids = q.all(`SELECT l.id ${base} ORDER BY ${order} LIMIT ? OFFSET ?`, ...a, p.limit, (p.page - 1) * p.limit).map((r) => r.id);
    return { total, ids };
  };

  let res = runQuery(p.q);
  if (p.q && res.total === 0) {
    const c = correctQuery(p.q);
    if (c) { const r2 = runQuery(c); if (r2.total) { res = r2; corrected = c; } }
  }
  if (log && p.q && p.page === 1) q.run('INSERT INTO search_log (term, country_code, results) VALUES (?,?,?)', p.q.toLowerCase().slice(0, 60), p.country || null, res.total);
  return { items: listingCards(res.ids, viewer), total: res.total, page: p.page, pages: Math.ceil(res.total / p.limit), corrected, display };
}

function safeMinor(v) {
  try { return toMinor(v); } catch { throw bad('Enter a valid price.'); }
}

// ---------------- Detail ----------------
export function listingDetail(idOrSlug, viewer) {
  const l = /^\d+$/.test(String(idOrSlug))
    ? q.get('SELECT * FROM listings WHERE id = ?', Number(idOrSlug))
    : q.get('SELECT * FROM listings WHERE slug = ?', idOrSlug);
  if (!l) throw notFound('This listing does not exist.');
  const isOwner = viewer && viewer.id === l.seller_id;
  const isStaff = viewer && viewer.role !== 'user';
  if (!['active', 'sold'].includes(l.status) && !isOwner && !isStaff) throw notFound('This listing is no longer available.');
  const images = q.all('SELECT id, url, thumb_url, width, height FROM listing_images WHERE listing_id = ? ORDER BY sort', l.id);
  const attributes = q.all(`SELECT ca.id, ca.key, ca.label, ca.type, ca.unit, la.value FROM listing_attributes la JOIN category_attributes ca ON ca.id = la.attribute_id WHERE la.listing_id = ? ORDER BY ca.sort, ca.id`, l.id);
  const delivery = q.get('SELECT * FROM delivery_options WHERE listing_id = ?', l.id);
  const pickup = q.get('SELECT * FROM pickup_options WHERE listing_id = ?', l.id);
  const loc = q.get(`SELECT c.name AS city, c.slug AS city_slug, d.name AS district, rg.name AS region FROM listings l LEFT JOIN locations c ON c.id = l.city_id
    LEFT JOIN locations d ON d.id = l.district_id LEFT JOIN locations rg ON rg.id = l.region_id WHERE l.id = ?`, l.id);
  const seller = q.get('SELECT * FROM users WHERE id = ?', l.seller_id);
  const sellerCity = seller.city_id ? q.val('SELECT name FROM locations WHERE id = ?', seller.city_id) : null;
  const similar = q.all(`SELECT id FROM listings WHERE category_id = ? AND id != ? AND status = 'active' AND country_code = ? ORDER BY ABS(price_minor - ?) LIMIT 8`, l.category_id, l.id, l.country_code, l.price_minor).map((r) => r.id);
  const more = q.all("SELECT id FROM listings WHERE seller_id = ? AND id != ? AND status = 'active' ORDER BY published_at DESC LIMIT 8", l.seller_id, l.id).map((r) => r.id);
  const reviews = q.all(`SELECT r.id, r.rating, r.body, r.verified, r.reply, r.created_at, a.name AS author_name, a.avatar_url AS author_avatar
    FROM reviews r JOIN users a ON a.id = r.author_id WHERE r.subject_id = ? AND r.status = 'visible' AND r.direction = 'buyer_to_seller' ORDER BY r.id DESC LIMIT 4`, l.seller_id);
  let viewerState = null;
  if (viewer && !isOwner) {
    const conv = q.get('SELECT id FROM conversations WHERE listing_id = ? AND buyer_id = ?', l.id, viewer.id);
    const offer = q.get("SELECT * FROM offers WHERE listing_id = ? AND buyer_id = ? ORDER BY id DESC LIMIT 1", l.id, viewer.id);
    viewerState = {
      conversation_id: conv?.id || null,
      offer: offer ? { ...offer, expired: offer.expires_at < new Date().toISOString().replace('T', ' ').slice(0, 19) } : null,
      wished: !!q.get('SELECT 1 FROM wishlists WHERE user_id = ? AND listing_id = ?', viewer.id, l.id),
      blocked: !!q.get('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)', viewer.id, l.seller_id, l.seller_id, viewer.id),
    };
  }
  return {
    ...l,
    negotiable: !!l.negotiable, accept_offers: !!l.accept_offers,
    featured: !!(l.featured_until && l.featured_until > new Date().toISOString().replace('T', ' ')),
    condition_label: CONDITIONS[l.condition],
    images, attributes, delivery: delivery ? { ...delivery, supported_locations: json(delivery.supported_locations, []) } : null, pickup,
    location: loc, category: breadcrumb(l.category_id),
    seller: { ...publicUser(seller), city: sellerCity, stats: sellerStats(seller.id), phone_verified: !!seller.phone_verified_at, email_verified: !!seller.email_verified_at },
    reviews, similar: listingCards(similar, viewer), more_from_seller: listingCards(more, viewer),
    wishlist_count: q.val('SELECT COUNT(*) FROM wishlists WHERE listing_id = ?', l.id),
    is_owner: !!isOwner, viewer: viewerState,
  };
}

function recordView(l, ctx) {
  if (ctx.user?.id === l.seller_id) return;
  const key = ctx.user ? `u${ctx.user.id}` : `a${sha256(ctx.ip + (ctx.req.headers['user-agent'] || '')).slice(0, 16)}`;
  const day = new Date().toISOString().slice(0, 10);
  const r = q.run('INSERT OR IGNORE INTO listing_views (listing_id, viewer_key, day) VALUES (?,?,?)', l.id, key, day);
  if (r.changes) q.run('UPDATE listings SET views = views + 1 WHERE id = ?', l.id);
  if (ctx.user) q.run("INSERT INTO recently_viewed (user_id, listing_id) VALUES (?,?) ON CONFLICT(user_id, listing_id) DO UPDATE SET viewed_at = datetime('now')", ctx.user.id, l.id);
}

// ---------------- Create / update ----------------
const imageRef = z.object({ url: z.string().regex(/^\/uploads\/listings\/[\w.-]+\.webp$/), thumb_url: z.string().regex(/^\/uploads\/listings\/[\w.-]+\.webp$/), width: z.number().int().optional().nullable(), height: z.number().int().optional().nullable() });
const listingSchema = z.object({
  country_code: z.enum(['IN', 'NP']),
  category_id: zId,
  title: z.string().trim().max(90).default(''),
  description: z.string().trim().max(5000).default(''),
  brand: z.string().trim().max(60).optional().nullable(),
  model: z.string().trim().max(60).optional().nullable(),
  condition: z.enum(Object.keys(CONDITIONS)).default('used_good'),
  purchase_date: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/).optional().nullable().or(z.literal('')),
  warranty: z.string().trim().max(80).optional().nullable(),
  reason_for_selling: z.string().trim().max(300).optional().nullable(),
  price: z.union([z.string(), z.number()]).optional().nullable(),
  original_price: z.union([z.string(), z.number()]).optional().nullable(),
  currency: z.enum(['INR', 'NPR']),
  negotiable: z.boolean().default(false),
  accept_offers: z.boolean().default(true),
  quantity: z.coerce.number().int().min(1).max(999).default(1),
  city_id: zId.optional().nullable(),
  locality: z.string().trim().max(120).optional().nullable(),
  postal_code: z.string().trim().max(10).optional().nullable(),
  lat: z.number().min(-90).max(90).optional().nullable(),
  lng: z.number().min(-180).max(180).optional().nullable(),
  fulfillment: z.enum(['delivery', 'pickup', 'both']).default('pickup'),
  delivery: z.object({
    fee: z.union([z.string(), z.number()]).default('0'),
    radius_km: z.coerce.number().int().min(1).max(3000).optional().nullable(),
    supported_locations: z.array(z.string().trim().max(60)).max(30).default([]),
    eta_min_days: z.coerce.number().int().min(0).max(60).default(1),
    eta_max_days: z.coerce.number().int().min(0).max(90).default(3),
    method: z.enum(['seller', 'courier']).default('seller'),
  }).optional().nullable(),
  pickup: z.object({
    address: z.string().trim().max(300).default(''),
    instructions: z.string().trim().max(500).optional().nullable(),
    times: z.string().trim().max(200).optional().nullable(),
  }).optional().nullable(),
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  images: z.array(imageRef).max(20).default([]),
  publish: z.boolean().default(false),
});

function money(v, label) {
  if (v === undefined || v === null || v === '') return null;
  try { return toMinor(v); } catch { throw bad(`${label}: enter a valid amount.`); }
}

function saveListing(ctx, existing) {
  const b = validate(listingSchema, ctx.body);
  const user = ctx.user;
  if (user.status !== 'active') throw forbidden('Your account cannot list items right now.');
  const cat = categoryTree().byId.get(b.category_id);
  if (!cat) throw bad('Choose a valid category.');
  if (cat.children.length) throw bad('Choose a subcategory.');
  const settings = { maxImages: getSetting('max_images_per_listing'), expiry: getSetting('listing_expiry_days') };
  if (b.images.length > settings.maxImages) throw bad(`You can add up to ${settings.maxImages} photos.`);
  for (const img of b.images) {
    if (!fs.existsSync(path.join(config.uploadDir, img.url.replace('/uploads/', '')))) throw bad('One of the photos is missing. Please upload it again.');
  }
  const expectedCurrency = b.country_code === 'IN' ? 'INR' : 'NPR';
  if (b.currency !== expectedCurrency && !getSetting('cross_border_enabled')) throw bad(`Listings in ${b.country_code === 'IN' ? 'India' : 'Nepal'} are priced in ${expectedCurrency}.`);
  const price = money(b.price, 'Price');
  const original = money(b.original_price, 'Original price');
  const attrs = attributesFor(b.category_id);
  const allowsDelivery = !!categoryTree().byId.get(cat.parent_id || cat.id)?.allows_delivery && !!cat.allows_delivery;
  let fulfillment = b.fulfillment;
  if (!allowsDelivery) fulfillment = 'pickup';

  // City → district → region
  let region = null, district = null, lat = b.lat ?? null, lng = b.lng ?? null;
  if (b.city_id) {
    const c = q.get('SELECT * FROM locations WHERE id = ?', b.city_id);
    if (!c || c.country_code !== b.country_code) throw bad('Choose a city in the selected country.');
    let p = c.parent_id ? q.get('SELECT * FROM locations WHERE id = ?', c.parent_id) : null;
    while (p) { if (p.type === 'district') district = p.id; if (p.type === 'region') region = p.id; p = p.parent_id ? q.get('SELECT * FROM locations WHERE id = ?', p.parent_id) : null; }
    if (lat == null) { lat = c.lat; lng = c.lng; }
  }
  if (b.postal_code) {
    if (b.country_code === 'IN' && !/^[1-9]\d{5}$/.test(b.postal_code)) throw bad('PIN code must be 6 digits.');
    if (b.country_code === 'NP' && !/^\d{5}$/.test(b.postal_code)) throw bad('Nepal postal codes are 5 digits.');
  }

  // Publishing requires a complete listing
  if (b.publish) {
    const missing = [];
    if (b.title.length < 5) missing.push('a title (5+ characters)');
    if (b.description.length < 20) missing.push('a description (20+ characters)');
    if (!b.images.length) missing.push('at least one photo');
    if (!price || price <= 0) missing.push('a price');
    if (!b.city_id) missing.push('a city');
    for (const a of attrs) if (a.required && (b.attributes[a.key] === undefined || b.attributes[a.key] === '')) missing.push(a.label);
    if (['delivery', 'both'].includes(fulfillment) && !b.delivery) missing.push('delivery details');
    if (['pickup', 'both'].includes(fulfillment) && !(b.pickup?.address?.length >= 5)) missing.push('a pickup address');
    if (b.delivery && b.delivery.eta_max_days < b.delivery.eta_min_days) missing.push('a valid delivery time range');
    if (missing.length) throw bad(`To publish, add ${missing.join(', ')}.`);
    if (!user.email_verified_at && !user.phone_verified_at) throw forbidden('Verify your email or phone number before publishing.');
  }

  const text = `${b.title} ${b.description} ${b.brand || ''} ${b.model || ''}`;
  const reviewNeeded = cat.moderation === 'review' || categoryTree().byId.get(cat.parent_id)?.moderation === 'review' || needsReview(text)
    || (getSetting('require_review_new_sellers') && user.seller_status !== 'verified');

  let status = existing ? existing.status : 'draft';
  if (b.publish) status = reviewNeeded ? 'pending_review' : 'active';
  else if (!existing) status = 'draft';
  else if (existing.status === 'active' && reviewNeeded && needsReview(text)) status = 'pending_review';

  return tx(() => {
    const vals = {
      category_id: b.category_id, country_code: b.country_code, title: cleanText(b.title, 90), description: cleanText(b.description, 5000),
      brand: cleanText(b.brand, 60) || null, model: cleanText(b.model, 60) || null, condition: b.condition, purchase_date: b.purchase_date || null,
      warranty: cleanText(b.warranty, 80) || null, reason_for_selling: cleanText(b.reason_for_selling, 300) || null,
      price_minor: price ?? 0, original_price_minor: original, currency: b.currency, negotiable: b.negotiable ? 1 : 0, accept_offers: b.accept_offers ? 1 : 0,
      quantity: b.quantity, fulfillment, region_id: region, district_id: district, city_id: b.city_id ?? null, locality: cleanText(b.locality, 120) || null,
      postal_code: b.postal_code || null, lat, lng, status,
    };
    let id;
    if (existing) {
      id = existing.id;
      if (existing.price_minor !== vals.price_minor && existing.status === 'active') {
        // Price changes invalidate pending offers above/below — sellers must re-respond.
        q.run("UPDATE offers SET status = 'expired' WHERE listing_id = ? AND status = 'pending' AND made_by != ?", id, user.id);
      }
      const sets = Object.keys(vals).map((k) => `${k} = ?`).join(', ');
      q.run(`UPDATE listings SET ${sets}, updated_at = datetime('now'),
        published_at = CASE WHEN ? = 'active' AND published_at IS NULL THEN datetime('now') ELSE published_at END,
        expires_at = CASE WHEN ? = 'active' AND (expires_at IS NULL OR expires_at < datetime('now')) THEN datetime('now', ?) ELSE expires_at END
        WHERE id = ?`, ...Object.values(vals), status, status, `+${settings.expiry} days`, id);
    } else {
      const slug = `${slugify(vals.title || 'listing')}-${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`;
      const cols = Object.keys(vals);
      ({ id } = q.run(`INSERT INTO listings (${cols.join(', ')}, slug, seller_id, published_at, expires_at) VALUES (${cols.map(() => '?').join(', ')}, ?, ?, CASE WHEN ? = 'active' THEN datetime('now') END, CASE WHEN ? = 'active' THEN datetime('now', ?) END)`,
        ...Object.values(vals), slug, user.id, status, status, `+${settings.expiry} days`));
    }
    // Images
    q.run('DELETE FROM listing_images WHERE listing_id = ?', id);
    b.images.forEach((img, i) => q.run('INSERT INTO listing_images (listing_id, url, thumb_url, width, height, sort) VALUES (?,?,?,?,?,?)', id, img.url, img.thumb_url, img.width ?? null, img.height ?? null, i));
    // Attributes (only those defined for the category; select values must match options)
    q.run('DELETE FROM listing_attributes WHERE listing_id = ?', id);
    for (const a of attrs) {
      let v = b.attributes[a.key];
      if (v === undefined || v === '' || v === null) continue;
      if (a.type === 'number' && !/^-?\d+(\.\d+)?$/.test(String(v))) throw bad(`${a.label} must be a number.`);
      if (a.type === 'select' && a.options && !a.options.includes(String(v))) throw bad(`Choose a valid ${a.label}.`);
      if (a.type === 'boolean') v = v === true || v === 'true' || v === 'yes' ? 'Yes' : 'No';
      q.run('INSERT INTO listing_attributes (listing_id, attribute_id, value) VALUES (?,?,?)', id, a.id, cleanText(String(v), 120));
    }
    // Delivery & pickup
    q.run('DELETE FROM delivery_options WHERE listing_id = ?', id);
    q.run('DELETE FROM pickup_options WHERE listing_id = ?', id);
    if (['delivery', 'both'].includes(fulfillment) && b.delivery) {
      const d = b.delivery;
      q.run('INSERT INTO delivery_options (listing_id, fee_minor, radius_km, supported_locations, eta_min_days, eta_max_days, method) VALUES (?,?,?,?,?,?,?)',
        id, money(d.fee, 'Delivery fee') ?? 0, d.radius_km ?? null, JSON.stringify(d.supported_locations.map((s) => cleanText(s, 60))), d.eta_min_days, d.eta_max_days, d.method);
    }
    if (['pickup', 'both'].includes(fulfillment) && b.pickup) {
      q.run('INSERT INTO pickup_options (listing_id, address, instructions, times) VALUES (?,?,?,?)', id, cleanText(b.pickup.address, 300), cleanText(b.pickup.instructions, 500), cleanText(b.pickup.times, 200));
    }
    indexListing(id);
    invalidateCategories();
    invalidateVocab();
    if (status === 'pending_review' && (!existing || existing.status !== 'pending_review')) {
      notify(user.id, 'listing', 'Your listing is under review', `"${vals.title}" will go live once our team approves it, usually within a few hours.`, `/seller/listings`);
    }
    return q.get('SELECT id, slug, status FROM listings WHERE id = ?', id);
  });
}

export function indexListing(id) {
  const l = q.get(`SELECT l.id, l.title, l.description, l.brand, l.model, c.name AS cat, p.name AS parent, loc.name AS city FROM listings l
    JOIN categories c ON c.id = l.category_id LEFT JOIN categories p ON p.id = c.parent_id LEFT JOIN locations loc ON loc.id = l.city_id WHERE l.id = ?`, id);
  q.run('DELETE FROM listings_fts WHERE rowid = ?', id);
  if (l) q.run('INSERT INTO listings_fts (rowid, title, description, brand, model, category, city) VALUES (?,?,?,?,?,?,?)', id, l.title, l.description, l.brand || '', l.model || '', `${l.cat} ${l.parent || ''}`, l.city || '');
}

function ownListing(ctx) {
  const l = q.get('SELECT * FROM listings WHERE id = ?', Number(ctx.params.id));
  if (!l || l.status === 'removed') throw notFound('Listing not found.');
  if (l.seller_id !== ctx.user.id) throw forbidden();
  return l;
}

export function register(r) {
  r.get('/api/v1/listings', (ctx) => searchListings(ctx.query, ctx.user, { log: true }));

  r.get('/api/v1/search/suggest', (ctx) => {
    const term = String(ctx.query.q || '').trim().toLowerCase().slice(0, 60);
    const country = ctx.query.country === 'NP' ? 'NP' : ctx.query.country === 'IN' ? 'IN' : null;
    if (term.length < 2) return { suggestions: [], categories: [], brands: [] };
    const like = `%${term}%`;
    const titles = q.all(`SELECT title, COUNT(*) OVER () AS n FROM listings WHERE status = 'active' ${country ? 'AND country_code = ?' : ''} AND (title LIKE ? OR brand LIKE ? OR model LIKE ?) GROUP BY lower(title) ORDER BY views DESC LIMIT 6`, ...(country ? [country] : []), like, like, like).map((r) => r.title);
    const categories = q.all('SELECT c.slug, c.name, p.name AS parent FROM categories c LEFT JOIN categories p ON p.id = c.parent_id WHERE c.active = 1 AND c.name LIKE ? ORDER BY c.parent_id IS NOT NULL, length(c.name) LIMIT 4', like);
    const brands = q.all("SELECT brand, COUNT(*) n FROM listings WHERE status = 'active' AND brand LIKE ? GROUP BY lower(brand) ORDER BY n DESC LIMIT 4", `${term}%`).map((r) => r.brand);
    const corrected = titles.length === 0 ? correctQuery(term) : null;
    return { suggestions: titles, categories, brands, corrected };
  });

  r.get('/api/v1/search/trending', (ctx) => {
    const country = ctx.query.country === 'NP' ? 'NP' : 'IN';
    const rows = q.all("SELECT term, COUNT(*) n FROM search_log WHERE created_at > datetime('now', '-14 days') AND results > 0 AND (country_code = ? OR country_code IS NULL) GROUP BY term ORDER BY n DESC LIMIT 8", country);
    return rows.map((r) => r.term);
  });

  r.get('/api/v1/listings/:id', (ctx) => {
    const d = listingDetail(ctx.params.id, ctx.user);
    if (d.status === 'active') recordView(d, ctx);
    return d;
  });

  r.post('/api/v1/media/images', async (ctx) => {
    rateLimit(`upload:${ctx.user.id}`, 120, 3600_000);
    const { data } = validate(z.object({ data: z.string().max(12_000_000) }), ctx.body);
    return storeImage(decodeDataUrl(data), { folder: 'listings' });
  }, { auth: true, bodyLimit: 12_500_000 });

  r.post('/api/v1/listings', (ctx) => {
    rateLimit(`listing:${ctx.user.id}`, 60, 3600_000);
    return saveListing(ctx, null);
  }, { auth: true });

  r.put('/api/v1/listings/:id', (ctx) => {
    const l = ownListing(ctx);
    if (['sold', 'rejected'].includes(l.status) && ctx.body?.publish === false) throw conflict('Sold or rejected listings cannot be edited. Relist it instead.');
    return saveListing(ctx, l);
  }, { auth: true });

  r.get('/api/v1/listings/:id/edit', (ctx) => {
    const l = ownListing(ctx);
    const d = listingDetail(l.id, ctx.user);
    const attrs = {};
    for (const a of d.attributes) attrs[a.key] = a.value;
    return { ...d, attribute_values: attrs };
  }, { auth: true });

  r.post('/api/v1/listings/:id/status', (ctx) => {
    const l = ownListing(ctx);
    const { action } = validate(z.object({ action: z.enum(['pause', 'resume', 'sold', 'renew', 'unsold']) }), ctx.body);
    const expiry = getSetting('listing_expiry_days');
    const t = {
      pause: { from: ['active'], to: 'paused' },
      resume: { from: ['paused'], to: 'active' },
      sold: { from: ['active', 'paused'], to: 'sold' },
      unsold: { from: ['sold'], to: 'active' },
      renew: { from: ['expired', 'active', 'paused'], to: 'active' },
    }[action];
    if (!t.from.includes(l.status)) throw conflict(`You can't ${action} a listing that is ${l.status.replace('_', ' ')}.`);
    if (action === 'unsold' && l.quantity < 1) q.run('UPDATE listings SET quantity = 1 WHERE id = ?', l.id);
    q.run(`UPDATE listings SET status = ?, updated_at = datetime('now')${action === 'renew' ? ", published_at = datetime('now'), expires_at = datetime('now', ?)" : ''} WHERE id = ?`,
      ...(action === 'renew' ? [t.to, `+${expiry} days`, l.id] : [t.to, l.id]));
    if (action === 'sold') q.run("UPDATE offers SET status = 'expired' WHERE listing_id = ? AND status = 'pending'", l.id);
    invalidateCategories();
    return q.get('SELECT id, status, expires_at FROM listings WHERE id = ?', l.id);
  }, { auth: true });

  r.delete('/api/v1/listings/:id', (ctx) => {
    const l = ownListing(ctx);
    const hasOrders = q.val('SELECT COUNT(*) FROM orders WHERE listing_id = ?', l.id);
    const hasConvs = q.val('SELECT COUNT(*) FROM conversations WHERE listing_id = ?', l.id);
    const open = q.val("SELECT COUNT(*) FROM orders WHERE listing_id = ? AND status NOT IN ('completed','cancelled','rejected','refunded')", l.id);
    if (open) throw conflict('This listing has an open order. Resolve it before deleting.');
    tx(() => {
      if (hasOrders || hasConvs) q.run("UPDATE listings SET status = 'removed', updated_at = datetime('now') WHERE id = ?", l.id);
      else q.run('DELETE FROM listings WHERE id = ?', l.id);
      q.run('DELETE FROM listings_fts WHERE rowid = ?', l.id);
    });
    invalidateCategories();
    return { ok: true };
  }, { auth: true });

  r.get('/api/v1/me/listings', (ctx) => {
    const status = String(ctx.query.status || 'all');
    const map = { active: "('active')", drafts: "('draft')", review: "('pending_review','rejected')", paused: "('paused')", sold: "('sold')", expired: "('expired')", all: "('active','draft','pending_review','paused','sold','expired','rejected')" };
    const set = map[status] || map.all;
    const rows = q.all(`SELECT l.id, l.slug, l.title, l.status, l.price_minor, l.currency, l.views, l.moderation_note, l.published_at, l.expires_at, l.updated_at, l.quantity,
      (SELECT thumb_url FROM listing_images WHERE listing_id = l.id ORDER BY sort LIMIT 1) AS thumb,
      (SELECT COUNT(*) FROM conversations WHERE listing_id = l.id) AS inquiries,
      (SELECT COUNT(*) FROM wishlists WHERE listing_id = l.id) AS saves,
      (SELECT COUNT(*) FROM offers WHERE listing_id = l.id AND status = 'pending') AS pending_offers
      FROM listings l WHERE l.seller_id = ? AND l.status IN ${set} ORDER BY l.updated_at DESC`, ctx.user.id);
    const counts = Object.fromEntries(q.all("SELECT status, COUNT(*) n FROM listings WHERE seller_id = ? AND status != 'removed' GROUP BY status", ctx.user.id).map((r) => [r.status, r.n]));
    return { items: rows, counts };
  }, { auth: true });

  r.get('/api/v1/listings/:id/performance', (ctx) => {
    const l = ownListing(ctx);
    const days = q.all("SELECT day, COUNT(*) n FROM listing_views WHERE listing_id = ? AND day >= date('now', '-29 days') GROUP BY day ORDER BY day", l.id);
    return {
      views: l.views,
      daily: days,
      saves: q.val('SELECT COUNT(*) FROM wishlists WHERE listing_id = ?', l.id),
      inquiries: q.val('SELECT COUNT(*) FROM conversations WHERE listing_id = ?', l.id),
      offers: q.val('SELECT COUNT(*) FROM offers WHERE listing_id = ?', l.id),
      orders: q.val('SELECT COUNT(*) FROM orders WHERE listing_id = ?', l.id),
    };
  }, { auth: true });
}
