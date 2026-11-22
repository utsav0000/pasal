// Seeds a fresh PASAL database with locations, categories, users and a living marketplace.
//   npm run seed            (wipes data/pasal.db and public/seed)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as Pi from 'react-icons/pi';
import { config, ROOT } from '../server/config.js';
import { openDb, q } from '../server/db.js';
import { hashPassword } from '../server/lib/security.js';
import { slugify } from '../server/lib/services.js';
import { CATEGORIES, NO_DELIVERY } from '../server/seed/categories.js';
import { seedBase, seedHomepage } from '../server/seed/base.js';
import { SELLERS, LISTINGS } from '../server/seed/listings.js';

const dbFile = config.dbPath;
for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) fs.rmSync(f, { force: true });
const SEED_DIR = path.join(ROOT, 'public', 'seed');
fs.rmSync(SEED_DIR, { recursive: true, force: true });
fs.mkdirSync(SEED_DIR, { recursive: true });
openDb(dbFile);
const t0 = Date.now();
let rng = 42;
const rand = () => ((rng = (rng * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rand() * a.length)];
const daysAgo = (d, h = 0) => new Date(Date.now() - d * 86400_000 - h * 3600_000).toISOString().replace('T', ' ').slice(0, 19);

const { cityIds, catIds, catIcon, catColor } = seedBase();
seedHomepage();

// ---------------- Users ----------------
const users = {};
async function user(key, name, email, country, city, { role = 'user', verified = false, bio = null, pw = 'Seller@12345', phone = null, created = 200 } = {}) {
  const { id } = q.run(`INSERT INTO users (name, email, password_hash, role, country_code, city_id, seller_status, email_verified_at, phone, phone_verified_at, bio, created_at, last_seen_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, name, email, await hashPassword(pw), role, country, cityIds[city]?.id ?? null, verified ? 'verified' : 'none', daysAgo(created), phone, phone ? daysAgo(created) : null, bio, daysAgo(created), daysAgo(0, Math.floor(rand() * 48)));
  users[key] = { id, name, country, city };
  return id;
}
await user('admin', 'Asha Sharma', 'admin@pasal.example', 'IN', 'Mumbai', { role: 'super_admin', pw: 'Admin@12345', created: 400 });
await user('ops', 'Karan Malhotra', 'ops@pasal.example', 'IN', 'Bengaluru', { role: 'admin', pw: 'Staff@12345', created: 380 });
await user('mod', 'Pooja Bhandari', 'moderator@pasal.example', 'NP', 'Kathmandu', { role: 'moderator', pw: 'Staff@12345', created: 360 });
await user('support', 'Imran Qureshi', 'support@pasal.example', 'IN', 'Hyderabad', { role: 'support', pw: 'Staff@12345', created: 350 });
let phoneN = 0;
for (const [key, [name, email, country, city, verified, bio]] of Object.entries(SELLERS)) {
  const phone = country === 'IN' ? `+9198${String(20000000 + ++phoneN * 1337).slice(0, 8)}` : `+97798${String(41000000 + ++phoneN * 911).slice(0, 8)}`;
  await user(key, name, email, country, city, { verified, bio, phone, created: 60 + Math.floor(rand() * 300) });
}
await user('buyer', 'Rahul Verma', 'buyer@pasal.example', 'IN', 'Mumbai', { pw: 'Buyer@12345', phone: '+919876500011', created: 90 });
await user('buyernp', 'Sabina Tamang', 'buyer.np@pasal.example', 'NP', 'Kathmandu', { pw: 'Buyer@12345', phone: '+9779841000022', created: 75 });
await user('newbie', 'Tenzin Lama', 'tenzin@pasal.example', 'NP', 'Pokhara', { pw: 'Buyer@12345', created: 3 });
q.run("UPDATE users SET email_verified_at = NULL WHERE email = 'tenzin@pasal.example'");
q.run("INSERT INTO seller_verifications (user_id, doc_type, doc_last4, full_name, status, created_at) VALUES (?, 'pan', '4F2K', 'Kabir Singh', 'pending', ?)", users.kabir.id, daysAgo(1));
q.run("UPDATE users SET seller_status = 'pending' WHERE id = ?", users.kabir.id);
q.run("INSERT INTO seller_verifications (user_id, doc_type, doc_last4, full_name, status, created_at) VALUES (?, 'citizenship', '7731', 'Bibek Thapa', 'pending', ?)", users.bibek.id, daysAgo(2));
q.run("UPDATE users SET seller_status = 'pending' WHERE id = ?", users.bibek.id);
for (const k of Object.keys(SELLERS).filter((k) => SELLERS[k][4])) q.run("INSERT INTO seller_verifications (user_id, doc_type, doc_last4, full_name, status, reviewed_by, reviewed_at, created_at) VALUES (?, ?, ?, ?, 'approved', ?, ?, ?)", users[k].id, SELLERS[k][2] === 'IN' ? 'aadhaar' : 'citizenship', String(1000 + Math.floor(rand() * 8999)), SELLERS[k][0], users.mod.id, daysAgo(40), daysAgo(41));

// ---------------- Product imagery (generated illustrations) ----------------
const PALETTES = {
  '#6A4DFF': [['#EDE9FF', '#C9BEFF', '#6A4DFF'], ['#E3ECFF', '#B8CCFF', '#3B5BDB'], ['#F1E8FF', '#D8C2FF', '#7C3AED']],
  '#2F7BFF': [['#E2EEFF', '#B5D0FF', '#1D5FD6'], ['#E8F4FF', '#BEE3FF', '#0B6BCB'], ['#EAEFF7', '#C6D2E6', '#334E7A']],
  '#0EA5A4': [['#E0F7F5', '#A8E6DF', '#0E8C8B'], ['#E9F6EE', '#BFE6CC', '#1B7F4C'], ['#EEF3F2', '#CADCD8', '#2F5D5A']],
  '#E5487D': [['#FFE8F0', '#FFC0D5', '#D6336C'], ['#FFF0E8', '#FFD1BA', '#E8590C'], ['#F7EAF6', '#E7C4E4', '#A61E8C']],
  '#F59E0B': [['#FFF4DE', '#FFDDA0', '#D97706'], ['#F7EFE6', '#E8D2B8', '#9A5B13'], ['#FFF1E6', '#FFD2B0', '#C2410C']],
  '#10B981': [['#E3F8EF', '#ADE9CF', '#0F9F6E'], ['#EAF5FF', '#C2DEFA', '#2563EB'], ['#F0F6E6', '#D3E6B5', '#4D7C0F']],
  '#EF6C35': [['#FFEDE4', '#FFC6AA', '#E4572E'], ['#FFF6DD', '#FFE29A', '#C68A00'], ['#EAF2FF', '#C1D6FF', '#2B59C3']],
  '#8B5CF6': [['#F0EAFF', '#D3C2FF', '#7C3AED'], ['#FBF3E6', '#EBD6B3', '#8A5A1E'], ['#E8F1FF', '#BFD6FF', '#3F5FD0']],
  '#D946EF': [['#FBE8FF', '#F0B8FF', '#B620C9'], ['#E6E9FF', '#BCC4FF', '#4338CA'], ['#E3FBF6', '#A7F0DF', '#0F9F8A']],
  '#FB7185': [['#FFEAEE', '#FFC2CC', '#E11D48'], ['#FFF6E0', '#FFE3A3', '#CA8A04'], ['#E6F6FF', '#B9E5FF', '#0284C7']],
  '#14B8A6': [['#E1F8F4', '#A9EADF', '#0D9488'], ['#FFF3E3', '#FFD9A8', '#C2410C'], ['#EEF2FF', '#C7D2FE', '#4F46E5']],
  '#64748B': [['#EEF1F5', '#CED6E0', '#475569'], ['#FFF5E5', '#FFDDA8', '#B45309'], ['#E8F0FF', '#C1D3FF', '#1E40AF']],
  '#A855F7': [['#F5EBFF', '#DFC2FF', '#9333EA'], ['#FFEFE6', '#FFCDB0', '#C2410C'], ['#E6FAF3', '#AEEBD4', '#047857']],
};
const iconSvg = (name, color, size) => renderToStaticMarkup(React.createElement(Pi[`Pi${name}Duotone`] || Pi[`Pi${name}`] || Pi.PiPackageDuotone, { size, color }));

async function productImages(slug, subSlug, rootSlug, n) {
  const icon = catIcon[subSlug] || catIcon[rootSlug];
  const pals = PALETTES[catColor[rootSlug]] || PALETTES['#6A4DFF'];
  const out = [];
  for (let i = 0; i < n; i++) {
    const [bg1, bg2, ink] = pals[(slug.length + i) % pals.length];
    const W = 1200, H = 900;
    const scale = [1, 1.25, 0.82][i % 3];
    const rot = [-8, 6, 0][i % 3];
    const s = 430 * scale;
    const x = W / 2 - s / 2 + [0, 60, -40][i % 3], y = H / 2 - s / 2 - 30 + [0, -10, 20][i % 3];
    const glyph = iconSvg(icon, ink, s).replace(/^<svg([^>]*)>/, (m, a) => `<svg${a.replace(/\s(width|height|style)="[^"]*"/g, '')} x="${x}" y="${y}" width="${s}" height="${s}">`);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient>
      <radialGradient id="r" cx="30%" cy="20%" r="70%"><stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
      <radialGradient id="sh" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${ink}" stop-opacity=".28"/><stop offset="1" stop-color="${ink}" stop-opacity="0"/></radialGradient>
      <filter id="d" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="24" stdDeviation="22" flood-color="${ink}" flood-opacity=".28"/></filter></defs>
      <rect width="${W}" height="${H}" fill="url(#g)"/><rect width="${W}" height="${H}" fill="url(#r)"/>
      <circle cx="${W - 160}" cy="140" r="${90 + i * 20}" fill="#fff" fill-opacity=".35"/><circle cx="170" cy="${H - 120}" r="60" fill="${ink}" fill-opacity=".07"/>
      <ellipse cx="${W / 2 + [0, 60, -40][i % 3]}" cy="${y + s + 40}" rx="${s * 0.5}" ry="38" fill="url(#sh)"/>
      <g filter="url(#d)" transform="rotate(${rot} ${W / 2} ${H / 2})">${glyph}</g></svg>`;
    const base = `${slug}-${i + 1}`;
    const buf = Buffer.from(svg);
    await sharp(buf).webp({ quality: 80 }).toFile(path.join(SEED_DIR, `${base}.webp`));
    await sharp(buf).resize(480, 480, { fit: 'cover' }).webp({ quality: 72 }).toFile(path.join(SEED_DIR, `${base}-t.webp`));
    out.push({ url: `/seed/${base}.webp`, thumb: `/seed/${base}-t.webp` });
  }
  return out;
}

// ---------------- Listings ----------------
const parentOf = {};
for (const [root, , , , , children] of CATEGORIES) for (const [c] of children) parentOf[c] = root;
const attrByKey = (catId, key) => q.get('SELECT id FROM category_attributes WHERE category_id = ? AND key = ?', catId, key);
const listingIds = [];
const pickupTimes = ['Weekdays after 6 pm', 'Weekends 10 am – 6 pm', 'Any day, call before coming', 'Evenings 5–8 pm'];
let n = 0;
for (const [seller, sub, title, brandName, model, condition, price, orig, city, locality, fulfillment, attrs, desc] of LISTINGS) {
  const u = users[seller];
  const c = cityIds[city];
  const country = c.country;
  const currency = country === 'IN' ? 'INR' : 'NPR';
  const root = parentOf[sub];
  const age = Math.floor(rand() * 40) + (n % 7 === 0 ? 0 : 1);
  const published = daysAgo(age, Math.floor(rand() * 20));
  const slug = `${slugify(title)}-${(++n).toString(36)}${crypto.randomBytes(2).toString('hex')}`;
  const negotiable = !['professional-services', 'tutoring', 'photography'].includes(sub) && rand() > 0.35;
  const services = root === 'jobs-services' || root === 'property';
  const fulfil = NO_DELIVERY.has(root) ? 'pickup' : fulfillment;
  const district = q.val('SELECT parent_id FROM locations WHERE id = ?', c.id);
  const region = q.val('SELECT parent_id FROM locations WHERE id = ?', district);
  const lat = c.lat + (rand() - 0.5) * 0.08, lng = c.lng + (rand() - 0.5) * 0.08;
  const { id } = q.run(`INSERT INTO listings (slug, seller_id, category_id, country_code, title, description, brand, model, condition, price_minor, original_price_minor, currency, negotiable, accept_offers, quantity, fulfillment,
      region_id, district_id, city_id, locality, postal_code, lat, lng, status, views, published_at, expires_at, created_at, updated_at, reason_for_selling, warranty)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?,?,?,?,?)`,
    slug, u.id, catIds[sub], country, title, desc, brandName, model, condition, price * 100, orig ? orig * 100 : null, currency, negotiable ? 1 : 0, services ? 0 : 1,
    sub === 'chairs' ? 3 : 1, fulfil, region, district, c.id, locality, c.pin, lat, lng, Math.floor(rand() * 400) + 12, published, daysAgo(age - 60), published, published,
    services ? null : pick(['Upgrading to a newer model', 'Moving to another city', 'No longer needed', 'Got it as a gift, already have one', 'Making space at home']),
    condition === 'new' || condition === 'like_new' ? pick(['Manufacturer warranty — 6 months left', 'No warranty', 'Store warranty until next year']) : null);
  listingIds.push({ id, seller, sub, root, price, currency, country, title, city });
  const imgs = await productImages(slug, sub, root, services ? 1 : 3);
  imgs.forEach((img, i) => q.run('INSERT INTO listing_images (listing_id, url, thumb_url, width, height, sort) VALUES (?,?,?,?,?,?)', id, img.url, img.thumb, 1200, 900, i));
  for (const [k, v] of Object.entries(attrs)) {
    const a = attrByKey(catIds[sub], k);
    if (a) q.run('INSERT INTO listing_attributes (listing_id, attribute_id, value) VALUES (?,?,?)', id, a.id, String(v));
  }
  if (fulfil !== 'pickup') {
    const fee = country === 'IN' ? pick([0, 49, 99, 149, 199]) : pick([0, 100, 150, 250]);
    const method = pick(['seller', 'courier']);
    q.run('INSERT INTO delivery_options (listing_id, fee_minor, radius_km, supported_locations, eta_min_days, eta_max_days, method) VALUES (?,?,?,?,?,?,?)', id, fee * 100, method === 'courier' ? null : pick([15, 25, 50]), '[]', 1, pick([2, 3, 5]), method);
  }
  if (fulfil !== 'delivery') q.run('INSERT INTO pickup_options (listing_id, address, instructions, times) VALUES (?,?,?,?)', id, `${locality ? `${locality}, ` : ''}${city}`, 'Exact address shared after the order is accepted. Bring the PASAL pickup code.', pick(pickupTimes));
  const cat = q.get('SELECT c.name, p.name AS parent FROM categories c LEFT JOIN categories p ON p.id = c.parent_id WHERE c.id = ?', catIds[sub]);
  q.run('INSERT INTO listings_fts (rowid, title, description, brand, model, category, city) VALUES (?,?,?,?,?,?,?)', id, title, desc, brandName || '', model || '', `${cat.name} ${cat.parent || ''}`, city);
}
// Featured
for (const l of listingIds.filter((_, i) => i % 6 === 0)) q.run("UPDATE listings SET featured_until = datetime('now', '+10 days') WHERE id = ?", l.id);
// A draft, a paused and a pending-review listing for the demo seller
const neha = users.neha.id;
q.run(`INSERT INTO listings (slug, seller_id, category_id, country_code, title, description, condition, price_minor, currency, status, city_id, fulfillment, created_at, updated_at)
  VALUES ('draft-canon-lens', ?, ?, 'IN', 'Canon 50mm f/1.8 STM lens', 'Draft — add photos before publishing.', 'like_new', 650000, 'INR', 'draft', ?, 'both', datetime('now','-1 day'), datetime('now','-1 day'))`, neha, catIds.cameras, cityIds.Mumbai.id);
q.run("UPDATE listings SET status = 'paused' WHERE id = (SELECT id FROM listings WHERE seller_id = ? AND title LIKE 'Sony WH%')", neha);

// ---------------- Views history (for analytics charts) ----------------
q.run('BEGIN');
for (const l of listingIds) {
  const total = q.val('SELECT views FROM listings WHERE id = ?', l.id);
  for (let i = 0; i < Math.min(total, 60); i++) q.run('INSERT OR IGNORE INTO listing_views (listing_id, viewer_key, day) VALUES (?,?,?)', l.id, `s${i}`, daysAgo(Math.floor(rand() * 30)).slice(0, 10));
}
q.run('COMMIT');

// ---------------- Conversations, offers, orders ----------------
const L = (titlePrefix) => listingIds.find((l) => l.title.startsWith(titlePrefix));
function conv(listing, buyerKey, msgs, ageDays = 2) {
  const sellerId = users[listing.seller].id, buyerId = users[buyerKey].id;
  const { id } = q.run('INSERT INTO conversations (listing_id, buyer_id, seller_id, created_at, last_message_at) VALUES (?,?,?,?,?)', listing.id, buyerId, sellerId, daysAgo(ageDays), daysAgo(ageDays));
  let t = ageDays * 24;
  for (const [who, body] of msgs) {
    t -= 0.4 + rand();
    const ts = daysAgo(0, Math.max(0, t));
    q.run('INSERT INTO messages (conversation_id, sender_id, kind, body, created_at) VALUES (?,?,?,?,?)', id, who === 'b' ? buyerId : sellerId, 'text', body, ts);
    q.run('UPDATE conversations SET last_message_at = ? WHERE id = ?', ts, id);
  }
  q.run('UPDATE conversations SET seller_read_at = last_message_at WHERE id = ?', id);
  return { id, buyerId, sellerId };
}
function offer(c, listing, madeBy, amount, status, hoursLeft = 30) {
  const { id } = q.run(`INSERT INTO offers (listing_id, conversation_id, buyer_id, seller_id, made_by, amount_minor, currency, status, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?, datetime('now', ?), datetime('now','-3 hours'))`,
    listing.id, c.id, c.buyerId, c.sellerId, madeBy, amount * 100, listing.currency, status, `${hoursLeft >= 0 ? '+' : ''}${hoursLeft} hours`);
  q.run("INSERT INTO messages (conversation_id, sender_id, kind, offer_id, created_at) VALUES (?,?,?,?, datetime('now','-3 hours'))", c.id, madeBy, 'offer', id);
  q.run("UPDATE conversations SET last_message_at = datetime('now','-3 hours') WHERE id = ?", c.id);
  return id;
}

const iphone = L('iPhone 14 Pro');
const c1 = conv(iphone, 'buyer', [['b', 'Hi! Is the iPhone still available?'], ['s', 'Yes, it is. Battery is at 91%, no scratches at all.'], ['b', 'Great. Would you consider ₹70,000? I can pick it up this weekend.'], ['s', 'Let me think — send it as an offer on PASAL.']], 1);
offer(c1, iphone, c1.buyerId, 70000, 'pending', 40);
q.run('UPDATE conversations SET buyer_read_at = last_message_at, seller_read_at = NULL WHERE id = ?', c1.id);

const macbook = L('MacBook Air M2');
const c2 = conv(macbook, 'buyer', [['b', 'Hello, what is the battery cycle count?'], ['s', '48 cycles. It is basically new.'], ['b', 'Can you do ₹88,000?']], 2);
const o2 = offer(c2, macbook, c2.buyerId, 88000, 'countered', 20);
const { id: o2c } = q.run(`INSERT INTO offers (listing_id, conversation_id, buyer_id, seller_id, made_by, parent_id, amount_minor, currency, status, expires_at, created_at, message) VALUES (?,?,?,?,?,?,?,?, 'accepted', datetime('now','+40 hours'), datetime('now','-2 hours'), 'Meet me in the middle?')`,
  macbook.id, c2.id, c2.buyerId, c2.sellerId, c2.sellerId, o2, 9000000, 'INR');
q.run("INSERT INTO messages (conversation_id, sender_id, kind, offer_id, created_at) VALUES (?,?,'offer',?, datetime('now','-2 hours'))", c2.id, c2.sellerId, o2c);
q.run("INSERT INTO messages (conversation_id, sender_id, kind, body, created_at) VALUES (?,?,'system','Offer of ₹ 90,000 accepted. The buyer can now check out at this price within 48 hours.', datetime('now','-1 hours'))", c2.id, c2.buyerId);
q.run("UPDATE conversations SET last_message_at = datetime('now','-1 hours'), seller_read_at = datetime('now','-1 hours') WHERE id = ?", c2.id);

const enfield = L('Royal Enfield');
const c3 = conv(enfield, 'buyernp', [['b', 'Namaste dai, is the bike still available?'], ['s', 'Yes! You can come see it in Jhamsikhel tomorrow evening.'], ['b', 'Perfect. Is the price negotiable?'], ['s', 'A little — make an offer.']], 1);
offer(c3, enfield, c3.buyerId, 460000, 'pending', 44);

// Orders in different states
let orderN = 0;
function order(listing, buyerKey, { status, fulfillment, method, ageDays = 3, history, delivery = 0, pay }) {
  const buyerId = users[buyerKey].id, sellerId = users[listing.seller].id;
  const subtotal = listing.price * 100;
  const total = subtotal + delivery * 100;
  const number = `PSL-${daysAgo(ageDays).slice(2, 10).replace(/-/g, '')}-${(0xA1B2C3 + ++orderN * 7919).toString(16).toUpperCase().slice(-6)}`;
  const code = crypto.randomBytes(3).toString('hex').toUpperCase();
  const addr = fulfillment === 'delivery' ? JSON.stringify({ full_name: users[buyerKey].name, phone: buyerKey === 'buyer' ? '+919876500011' : '+9779841000022', line1: buyerKey === 'buyer' ? 'Flat 1203, Sunshine Heights, Link Road' : 'House 22, Tokha Road', locality: buyerKey === 'buyer' ? 'Andheri' : 'Budhanilkantha', city: users[buyerKey].city, postal_code: buyerKey === 'buyer' ? '400053' : '44600', country_code: users[buyerKey].country }) : null;
  const pickup = fulfillment === 'pickup' ? JSON.stringify(q.get('SELECT * FROM pickup_options WHERE listing_id = ?', listing.id) || { address: listing.city }) : null;
  const { id } = q.run(`INSERT INTO orders (number, buyer_id, seller_id, listing_id, status, fulfillment, payment_method, currency, subtotal_minor, delivery_fee_minor, total_minor, address_json, pickup_json, pickup_code, created_at, updated_at, completed_at, carrier, tracking_number, eta_date)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, number, buyerId, sellerId, listing.id, status, fulfillment, method, listing.currency, subtotal, delivery * 100, total, addr, pickup, code, daysAgo(ageDays), daysAgo(0, 5),
    status === 'completed' ? daysAgo(Math.max(0, ageDays - 2)) : null, ['shipped', 'out_for_delivery', 'completed'].includes(status) && fulfillment === 'delivery' ? 'Delhivery' : null, ['shipped', 'out_for_delivery', 'completed'].includes(status) && fulfillment === 'delivery' ? `DL${100000000 + orderN * 7331}` : null,
    fulfillment === 'delivery' ? new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10) : null);
  const img = q.val('SELECT thumb_url FROM listing_images WHERE listing_id = ? ORDER BY sort LIMIT 1', listing.id);
  q.run('INSERT INTO order_items (order_id, listing_id, title, image_url, unit_price_minor, quantity) VALUES (?,?,?,?,?,1)', id, listing.id, listing.title, img, subtotal);
  let prev = null;
  history.forEach((s, i) => {
    q.run('INSERT INTO order_status_history (order_id, from_status, to_status, actor_id, note, created_at) VALUES (?,?,?,?,?,?)', id, prev, s, s === 'payment_confirmed' ? null : i === 0 ? buyerId : sellerId, i === 0 ? 'Order placed' : null, daysAgo(ageDays - i * (ageDays / history.length)));
    prev = s;
  });
  if (pay) q.run("INSERT INTO payments (order_id, provider, provider_order_id, provider_payment_id, amount_minor, currency, status, verified_via, created_at) VALUES (?, 'sandbox', ?, ?, ?, ?, 'captured', 'webhook', ?)", id, `sbx_order_seed${id}`, `sbx_pay_seed${id}`, total, listing.currency, daysAgo(ageDays - 0.5));
  if (!['pending_seller_confirmation', 'rejected', 'cancelled'].includes(status)) q.run("UPDATE listings SET quantity = quantity - 1, status = CASE WHEN quantity - 1 <= 0 THEN 'sold' ELSE status END WHERE id = ?", listing.id);
  return { id, buyerId, sellerId };
}
const ps5 = L('PlayStation 5');
const oA = order(ps5, 'buyer', { status: 'completed', fulfillment: 'delivery', method: 'online', ageDays: 12, delivery: 99, pay: true, history: ['pending_seller_confirmation', 'accepted', 'awaiting_payment', 'payment_confirmed', 'ready_for_dispatch', 'shipped', 'out_for_delivery', 'completed'] });
q.run("INSERT INTO reviews (order_id, listing_id, author_id, subject_id, direction, rating, body, verified, reply, replied_at, created_at) VALUES (?,?,?,?, 'buyer_to_seller', 5, 'Exactly as described, packed really well and shipped the same day. Controllers have zero drift. Would buy from Aarav again!', 1, 'Thanks Rahul, enjoy the games!', datetime('now','-8 days'), datetime('now','-9 days'))", oA.id, ps5.id, oA.buyerId, oA.sellerId);
q.run("INSERT INTO reviews (order_id, listing_id, author_id, subject_id, direction, rating, body, verified, created_at) VALUES (?,?,?,?, 'seller_to_buyer', 5, 'Quick payment and great communication.', 1, datetime('now','-9 days'))", oA.id, ps5.id, oA.sellerId, oA.buyerId);
const xm5 = L('Sony WH-1000XM5');
order(L('Philips air fryer'), 'buyer', { status: 'shipped', fulfillment: 'delivery', method: 'online', ageDays: 3, delivery: 49, pay: true, history: ['pending_seller_confirmation', 'accepted', 'awaiting_payment', 'payment_confirmed', 'ready_for_dispatch', 'shipped'] });
order(L('Casio G-Shock'), 'buyer', { status: 'ready_for_pickup', fulfillment: 'pickup', method: 'cash_on_pickup', ageDays: 1, history: ['pending_seller_confirmation', 'accepted', 'ready_for_pickup'] });
order(L('Samsung Galaxy S23'), 'buyer', { status: 'pending_seller_confirmation', fulfillment: 'pickup', method: 'cash_on_pickup', ageDays: 0.2, history: ['pending_seller_confirmation'] });
const kurta = L('Handblock printed');
order(kurta, 'buyer', { status: 'awaiting_payment', fulfillment: 'delivery', method: 'online', ageDays: 0.5, delivery: 99, history: ['pending_seller_confirmation', 'accepted', 'awaiting_payment'] });
order(L('AirPods Pro 2'), 'buyernp', { status: 'completed', fulfillment: 'pickup', method: 'cash_on_pickup', ageDays: 9, history: ['pending_seller_confirmation', 'accepted', 'ready_for_pickup', 'completed'] });
const tent = L('North Face');
const oD = order(tent, 'buyernp', { status: 'disputed', fulfillment: 'delivery', method: 'online', ageDays: 6, delivery: 250, pay: true, history: ['pending_seller_confirmation', 'accepted', 'awaiting_payment', 'payment_confirmed', 'ready_for_dispatch', 'shipped', 'disputed'] });
q.run("INSERT INTO disputes (order_id, opened_by, reason, details, previous_status, created_at) VALUES (?,?, 'Item not as described', 'One of the sleeping bags has a broken zip that was not mentioned in the listing.', 'shipped', datetime('now','-1 day'))", oD.id, oD.buyerId);
order(L('Harry Potter'), 'buyer', { status: 'completed', fulfillment: 'delivery', method: 'direct', ageDays: 20, delivery: 49, history: ['pending_seller_confirmation', 'accepted', 'ready_for_dispatch', 'shipped', 'completed'] });
order(L('Yamaha F310'), 'buyernp', { status: 'payment_confirmed', fulfillment: 'pickup', method: 'online', ageDays: 1, pay: true, history: ['pending_seller_confirmation', 'accepted', 'awaiting_payment', 'payment_confirmed'] });
// Seller (Neha) incoming orders
const nehaListing = L('MacBook Air M2');
void nehaListing; void xm5;

// Extra historical reviews for verified sellers
const reviewLines = [
  [5, 'Smooth deal, item was exactly like the photos.'], [5, 'Very honest seller, replied quickly and was on time for pickup.'], [4, 'Good condition, a couple of small marks not in the photos but fair price.'],
  [5, 'Packed perfectly and delivered in 2 days.'], [4, 'Nice experience overall. Would recommend.'], [5, 'Super friendly and helpful. Thank you!'], [3, 'Item fine, but pickup was delayed by an hour.'],
];
for (const k of ['aarav', 'priya', 'ananya', 'vikram', 'sujan', 'anisha', 'dipesh', 'siddharth', 'neha']) {
  for (let i = 0; i < 3 + Math.floor(rand() * 4); i++) {
    const [rating, body] = pick(reviewLines);
    const author = pick(['buyer', 'buyernp', 'kabir', 'meera', 'ishita', 'bibek', 'sita', 'zoya']);
    if (author === k) continue;
    const lst = listingIds.find((l) => l.seller === k);
    q.run("INSERT INTO reviews (listing_id, author_id, subject_id, direction, rating, body, verified, created_at) VALUES (?,?,?, 'buyer_to_seller', ?, ?, ?, ?)", lst.id, users[author].id, users[k].id, rating, body, rand() > 0.3 ? 1 : 0, daysAgo(10 + Math.floor(rand() * 120)));
  }
}

// Saved addresses for the demo buyers
const addr = (k, label, line1, locality, city, pin, phone, def) => {
  const c = cityIds[city];
  const district = q.val('SELECT parent_id FROM locations WHERE id = ?', c.id);
  q.run('INSERT INTO addresses (user_id, label, full_name, phone, country_code, region_id, district_id, city_id, locality, line1, postal_code, is_default) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    users[k].id, label, users[k].name, phone, c.country, q.val('SELECT parent_id FROM locations WHERE id = ?', district), district, c.id, locality, line1, pin, def ? 1 : 0);
};
addr('buyer', 'Home', 'Flat 1203, Sunshine Heights, Link Road', 'Andheri', 'Mumbai', '400053', '+919876500011', true);
addr('buyer', 'Work', '5th floor, Tower B, Powai Business Park', 'Powai', 'Mumbai', '400076', '+919876500011', false);
addr('buyernp', 'Home', 'House 22, Tokha Road', 'Budhanilkantha', 'Kathmandu', '44600', '+9779841000022', true);

// Wishlist, recently viewed, saved searches
for (const t of ['iPhone 14 Pro', 'Sony A7 III', 'Hyundai Creta', 'Royal Enfield', '3-seater fabric sofa', 'Apple Watch']) q.run('INSERT OR IGNORE INTO wishlists (user_id, listing_id) VALUES (?, ?)', users.buyer.id, L(t).id);
for (const t of ['Royal Enfield', 'iPad Air', 'Giant Talon']) q.run('INSERT OR IGNORE INTO wishlists (user_id, listing_id) VALUES (?, ?)', users.buyernp.id, L(t).id);
for (const t of ['MacBook Air M2', 'Dell XPS 13', 'Sony A7 III', 'Samsung Galaxy S23', 'LG UltraGear', 'Lenovo Legion']) q.run("INSERT OR IGNORE INTO recently_viewed (user_id, listing_id, viewed_at) VALUES (?, ?, datetime('now', ?))", users.buyer.id, L(t).id, `-${Math.floor(rand() * 48)} hours`);
q.run("INSERT INTO saved_searches (user_id, name, query, notify, created_at) VALUES (?, 'iPhones under ₹80k in Mumbai', 'q=iphone&country=IN&max=80000&city=' || ?, 1, datetime('now','-10 days'))", users.buyer.id, cityIds.Mumbai.id);
q.run("INSERT INTO saved_searches (user_id, name, query, notify, created_at) VALUES (?, 'Laptops with delivery', 'category=laptops&country=IN&delivery=1', 1, datetime('now','-4 days'))", users.buyer.id);

// Notifications
const note = (k, type, title, body, link, hrs) => q.run("INSERT INTO notifications (user_id, type, title, body, link, created_at, read_at) VALUES (?,?,?,?,?, datetime('now', ?), ?)", users[k].id, type, title, body, link, `-${hrs} hours`, hrs > 30 ? daysAgo(0, hrs - 1) : null);
note('buyer', 'offer', 'Counter-offer: ₹ 90,000', 'Neha countered your offer on "MacBook Air M2".', `/messages/${c2.id}`, 2);
note('buyer', 'order', 'Order shipped', '"Philips air fryer HD9252" is on its way.', '/orders', 6);
note('buyer', 'order', 'Ready for pickup', '"Casio G-Shock" is ready. Show your pickup code to the seller.', '/orders', 20);
note('buyer', 'saved_search', '2 new matches for “Laptops with delivery”', 'Dell XPS 13 · HP Pavilion 14', '/search?category=laptops&country=IN&delivery=1', 40);
note('neha', 'offer', 'New offer: ₹ 88,000', 'Rahul made an offer on "MacBook Air M2".', `/messages/${c2.id}`, 3);
note('aarav', 'offer', 'New offer: ₹ 70,000', 'Rahul made an offer on "iPhone 14 Pro".', `/messages/${c1.id}`, 1);

// Reports, tickets, promotions, sections, searches
q.run("INSERT INTO reports (reporter_id, target_type, target_id, reason, details, created_at) VALUES (?, 'listing', ?, 'counterfeit', 'Price seems too low for a genuine item — may be a replica.', datetime('now','-5 hours'))", users.buyer.id, L('Casio G-Shock').id);
q.run("INSERT INTO reports (reporter_id, target_type, target_id, reason, details, created_at) VALUES (?, 'listing', ?, 'wrong_category', 'This is a service, not a product.', datetime('now','-2 days'))", users.buyernp.id, L('Phone & laptop repair').id);
// A listing held for review by the keyword filter
q.run(`INSERT INTO listings (slug, seller_id, category_id, country_code, title, description, condition, price_minor, currency, status, city_id, fulfillment, moderation_note, created_at, updated_at, published_at)
  VALUES ('first-copy-designer-handbag', ?, ?, 'IN', 'First copy designer handbag', 'Premium first copy, looks exactly like the original.', 'new', 350000, 'INR', 'pending_review', ?, 'delivery', 'Held by automatic review: possible counterfeit', datetime('now','-3 hours'), datetime('now','-3 hours'), NULL)`, users.meera.id, catIds.bags, cityIds.Jaipur.id);
const ticket = (k, email, name, subject, cat, prio, body, hrs) => {
  const { id } = q.run("INSERT INTO support_tickets (user_id, email, name, subject, category, priority, created_at, updated_at) VALUES (?,?,?,?,?,?, datetime('now', ?), datetime('now', ?))", k ? users[k].id : null, email, name, subject, cat, prio, `-${hrs} hours`, `-${hrs} hours`);
  q.run("INSERT INTO ticket_messages (ticket_id, author_id, body, created_at) VALUES (?,?,?, datetime('now', ?))", id, k ? users[k].id : null, body, `-${hrs} hours`);
};
ticket('buyer', 'buyer@pasal.example', 'Rahul Verma', 'Refund timeline for cancelled order', 'payment', 'high', 'Hi, how long do refunds take to reach my UPI account?', 5);
ticket(null, 'store@example.com', 'Lakshmi Traders', 'Bulk listing for my shop', 'business', 'normal', 'We have 300+ items. Is there a way to upload them in bulk?', 30);

const promos = [
  ['hero', 'Upgrade season is here', 'Pre-loved iPhones, Pixels and Galaxies from verified sellers.', 'Shop phones', '/c/smartphones', 'violet', null, 0],
  ['banner', 'Dashain deals on bikes', 'Royal Enfields, FZs and scooters across Kathmandu valley.', 'Explore bikes', '/c/motorcycles?country=NP', 'sunrise', 'NP', 1],
  ['banner', 'Moving out? Sell your furniture in minutes', 'List for free. Buyers near you are already looking.', 'Start selling', '/sell', 'midnight', null, 2],
  ['banner', 'Rooms & PGs near tech parks', 'Bengaluru, Pune and Hyderabad — move in this month.', 'Find a room', '/c/pg-accommodation', 'mint', 'IN', 3],
];
for (const p of promos) q.run('INSERT INTO promotions (placement, title, subtitle, cta_label, link, theme, country_code, sort) VALUES (?,?,?,?,?,?,?,?)', ...p);

for (const [term, nTimes, country] of [['iphone', 34, 'IN'], ['royal enfield', 22, 'NP'], ['macbook', 19, 'IN'], ['pg', 15, 'IN'], ['sofa', 14, 'IN'], ['ps5', 12, 'IN'], ['scooter', 11, 'NP'], ['laptop', 18, 'NP'], ['camera', 10, 'IN'], ['flat for rent', 9, 'NP'], ['cycle', 8, 'IN'], ['drone', 6, 'NP']]) {
  for (let i = 0; i < nTimes; i++) q.run("INSERT INTO search_log (term, country_code, results, created_at) VALUES (?,?,?, datetime('now', ?))", term, country, 1 + Math.floor(rand() * 9), `-${Math.floor(rand() * 13 * 24)} hours`);
}
q.run("INSERT INTO search_log (term, country_code, results) VALUES ('sitar', 'NP', 0), ('3d printer', 'IN', 0), ('3d printer', 'IN', 0)");
// Some signups/orders spread across the month for admin charts
q.run("INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, data, created_at) VALUES (?, 'seller.approve', 'user', ?, '{\"notes\":\"Documents verified\"}', datetime('now','-40 days'))", users.mod.id, users.aarav.id);
q.run("INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, data, created_at) VALUES (?, 'listing.feature', 'listing', ?, '{\"days\":10}', datetime('now','-2 days'))", users.ops.id, iphone.id);

console.log(`Seeded ${listingIds.length + 2} listings, ${Object.keys(users).length} users, ${q.val('SELECT COUNT(*) FROM locations')} locations, ${q.val('SELECT COUNT(*) FROM categories')} categories in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log('Accounts: admin@pasal.example / Admin@12345 · seller@pasal.example / Seller@12345 · buyer@pasal.example / Buyer@12345 · buyer.np@pasal.example / Buyer@12345');
