import { z } from 'zod';
import { q, tx } from '../db.js';
import { bad, notFound, forbidden, conflict, validate, zId, rateLimit } from '../lib/http.js';
import { cleanText } from '../lib/security.js';
import { emitTo, onClientEvent, isOnline } from '../lib/realtime.js';
import { notify, getSetting } from '../lib/services.js';
import { formatMoney, toMinor } from '../lib/money.js';
import { storeImage, decodeDataUrl } from '../providers/storage.js';

const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const isBlocked = (a, b) => !!q.get('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)', a, b, b, a);

export function conversationFor(convId, userId) {
  const c = q.get('SELECT * FROM conversations WHERE id = ?', convId);
  if (!c) throw notFound('Conversation not found.');
  if (c.buyer_id !== userId && c.seller_id !== userId) throw forbidden();
  return c;
}

export function openConversation(listingId, buyerId) {
  const l = q.get('SELECT id, seller_id, status, title FROM listings WHERE id = ?', listingId);
  if (!l) throw notFound('Listing not found.');
  if (l.seller_id === buyerId) throw bad('This is your own listing.');
  if (isBlocked(buyerId, l.seller_id)) throw forbidden('You cannot message this user.');
  let c = q.get('SELECT * FROM conversations WHERE listing_id = ? AND buyer_id = ?', listingId, buyerId);
  if (!c) {
    if (!['active', 'paused'].includes(l.status)) throw conflict('This listing is no longer available.');
    const { id } = q.run('INSERT INTO conversations (listing_id, buyer_id, seller_id) VALUES (?,?,?)', listingId, buyerId, l.seller_id);
    c = q.get('SELECT * FROM conversations WHERE id = ?', id);
  }
  return c;
}

export function postMessage(conv, senderId, { kind = 'text', body = null, image_url = null, offer_id = null }) {
  const other = conv.buyer_id === senderId ? conv.seller_id : conv.buyer_id;
  if (kind !== 'system' && isBlocked(senderId, other)) throw forbidden('You cannot message this user.');
  const ts = now();
  const msg = tx(() => {
    const { id } = q.run('INSERT INTO messages (conversation_id, sender_id, kind, body, image_url, offer_id, created_at) VALUES (?,?,?,?,?,?,?)', conv.id, senderId, kind, body, image_url, offer_id, ts);
    const readCol = conv.buyer_id === senderId ? 'buyer_read_at' : 'seller_read_at';
    q.run(`UPDATE conversations SET last_message_at = ?, ${readCol} = ? WHERE id = ?`, ts, ts, conv.id);
    return q.get('SELECT * FROM messages WHERE id = ?', id);
  });
  const full = hydrateMessages([msg])[0];
  emitTo(other, 'message', { conversation_id: conv.id, message: full });
  emitTo(senderId, 'message', { conversation_id: conv.id, message: full });
  if (kind === 'text' || kind === 'image') {
    const sender = q.get('SELECT name FROM users WHERE id = ?', senderId);
    const title = q.val('SELECT title FROM listings WHERE id = ?', conv.listing_id);
    notify(other, 'message', `${sender.name} sent you a message`, kind === 'image' ? 'Sent a photo' : `${String(body).slice(0, 80)} · ${title}`, `/messages/${conv.id}`);
  }
  return full;
}

function hydrateMessages(rows) {
  const offerIds = rows.filter((m) => m.offer_id).map((m) => m.offer_id);
  const offers = offerIds.length ? Object.fromEntries(q.all(`SELECT * FROM offers WHERE id IN (${offerIds.map(() => '?').join(',')})`, ...offerIds).map((o) => [o.id, o])) : {};
  return rows.map((m) => ({ ...m, offer: m.offer_id ? withExpiry(offers[m.offer_id]) : null }));
}

export const withExpiry = (o) => (o ? { ...o, expired: o.status === 'pending' && o.expires_at < now() } : null);

/** Mark pending offers past their expiry as expired. */
export function expireOffers() {
  q.run("UPDATE offers SET status = 'expired' WHERE status = 'pending' AND expires_at < datetime('now')");
}

function summary(c, userId) {
  const me = c.buyer_id === userId ? 'buyer' : 'seller';
  const otherId = me === 'buyer' ? c.seller_id : c.buyer_id;
  const other = q.get('SELECT id, name, avatar_url, seller_status, last_seen_at, status FROM users WHERE id = ?', otherId);
  const l = q.get(`SELECT l.id, l.slug, l.title, l.price_minor, l.currency, l.status, l.seller_id, l.accept_offers, l.negotiable,
    (SELECT thumb_url FROM listing_images WHERE listing_id = l.id ORDER BY sort LIMIT 1) AS thumb FROM listings l WHERE l.id = ?`, c.listing_id);
  const last = q.get('SELECT kind, body, sender_id, created_at FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1', c.id);
  const readAt = me === 'buyer' ? c.buyer_read_at : c.seller_read_at;
  const unread = q.val('SELECT COUNT(*) FROM messages WHERE conversation_id = ? AND sender_id != ? AND (? IS NULL OR created_at > ?)', c.id, userId, readAt, readAt);
  const otherRead = me === 'buyer' ? c.seller_read_at : c.buyer_read_at;
  return {
    id: c.id, role: me, listing: { ...l, accept_offers: !!l.accept_offers }, other: { ...other, online: isOnline(other.id), verified: other.seller_status === 'verified' },
    last_message: last, unread, other_read_at: otherRead, last_message_at: c.last_message_at,
    blocked: isBlocked(userId, otherId), blocked_by_me: !!q.get('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?', userId, otherId),
  };
}

const offerSchema = z.object({ amount: z.union([z.string(), z.number()]), message: z.string().trim().max(300).optional() });

export function register(r) {
  onClientEvent('typing', (userId, { conversation_id, typing }) => {
    const c = q.get('SELECT * FROM conversations WHERE id = ?', Number(conversation_id));
    if (!c || (c.buyer_id !== userId && c.seller_id !== userId)) return;
    emitTo(c.buyer_id === userId ? c.seller_id : c.buyer_id, 'typing', { conversation_id: c.id, user_id: userId, typing: !!typing });
  });
  onClientEvent('presence', (userId, online) => {
    const peers = q.all('SELECT DISTINCT CASE WHEN buyer_id = ? THEN seller_id ELSE buyer_id END AS id FROM conversations WHERE buyer_id = ? OR seller_id = ? ORDER BY last_message_at DESC LIMIT 200', userId, userId, userId);
    for (const p of peers) emitTo(p.id, 'presence', { user_id: userId, online });
  });

  r.get('/api/v1/conversations', (ctx) => {
    const u = ctx.user.id;
    const term = ctx.query.q ? `%${String(ctx.query.q).slice(0, 60)}%` : null;
    const filter = ctx.query.role === 'buying' ? 'c.buyer_id = ?' : ctx.query.role === 'selling' ? 'c.seller_id = ?' : '(c.buyer_id = ? OR c.seller_id = ?)';
    const fa = ctx.query.role ? [u] : [u, u];
    const rows = q.all(`SELECT c.* FROM conversations c JOIN listings l ON l.id = c.listing_id
      JOIN users ob ON ob.id = CASE WHEN c.buyer_id = ? THEN c.seller_id ELSE c.buyer_id END
      WHERE ${filter} AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)
      ${term ? 'AND (l.title LIKE ? OR ob.name LIKE ? OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.body LIKE ?))' : ''}
      ORDER BY c.last_message_at DESC LIMIT 100`, u, ...fa, ...(term ? [term, term, term] : []));
    return rows.map((c) => summary(c, u));
  }, { auth: true });

  r.post('/api/v1/conversations', (ctx) => {
    const b = validate(z.object({ listing_id: zId, message: z.string().trim().min(1).max(2000).optional() }), ctx.body);
    rateLimit(`conv:${ctx.user.id}`, 60, 3600_000);
    const c = openConversation(b.listing_id, ctx.user.id);
    if (b.message) postMessage(c, ctx.user.id, { body: cleanText(b.message, 2000) });
    return summary(q.get('SELECT * FROM conversations WHERE id = ?', c.id), ctx.user.id);
  }, { auth: true });

  r.get('/api/v1/conversations/:id', (ctx) => {
    expireOffers();
    const c = conversationFor(Number(ctx.params.id), ctx.user.id);
    const before = ctx.query.before ? Number(ctx.query.before) : null;
    const rows = q.all(`SELECT * FROM messages WHERE conversation_id = ? ${before ? 'AND id < ?' : ''} ORDER BY id DESC LIMIT 50`, c.id, ...(before ? [before] : [])).reverse();
    return { conversation: summary(c, ctx.user.id), messages: hydrateMessages(rows), has_more: rows.length === 50 };
  }, { auth: true });

  r.post('/api/v1/conversations/:id/messages', async (ctx) => {
    const c = conversationFor(Number(ctx.params.id), ctx.user.id);
    rateLimit(`msg:${ctx.user.id}`, 40, 60_000);
    const b = validate(z.object({ body: z.string().trim().max(2000).optional(), image: z.string().max(8_000_000).optional() }), ctx.body);
    if (b.image) {
      const img = await storeImage(decodeDataUrl(b.image), { folder: 'chat', maxSize: 1280, thumbSize: 320 });
      return postMessage(c, ctx.user.id, { kind: 'image', image_url: img.url, body: b.body ? cleanText(b.body, 2000) : null });
    }
    if (!b.body) throw bad('Write a message.');
    return postMessage(c, ctx.user.id, { body: cleanText(b.body, 2000) });
  }, { auth: true, bodyLimit: 9_000_000 });

  r.post('/api/v1/conversations/:id/read', (ctx) => {
    const c = conversationFor(Number(ctx.params.id), ctx.user.id);
    const col = c.buyer_id === ctx.user.id ? 'buyer_read_at' : 'seller_read_at';
    const ts = now();
    q.run(`UPDATE conversations SET ${col} = ? WHERE id = ?`, ts, c.id);
    emitTo(c.buyer_id === ctx.user.id ? c.seller_id : c.buyer_id, 'read', { conversation_id: c.id, read_at: ts });
    return { read_at: ts };
  }, { auth: true });

  // ---------------- Offers ----------------
  r.post('/api/v1/listings/:id/offers', (ctx) => {
    const b = validate(offerSchema, ctx.body);
    rateLimit(`offer:${ctx.user.id}`, 30, 3600_000);
    const l = q.get('SELECT * FROM listings WHERE id = ?', Number(ctx.params.id));
    if (!l || l.status !== 'active') throw conflict('This listing is not accepting offers right now.');
    if (!l.accept_offers) throw conflict('The seller is not accepting offers on this item.');
    if (l.seller_id === ctx.user.id) throw bad('You cannot make an offer on your own listing.');
    let amount;
    try { amount = toMinor(b.amount); } catch { throw bad('Enter a valid offer amount.'); }
    if (amount <= 0) throw bad('Enter a valid offer amount.');
    if (amount > l.price_minor) throw bad('Your offer is above the asking price — just use Buy Now.');
    if (amount < Math.floor(l.price_minor * 0.3)) throw bad('That offer is too low. Offers must be at least 30% of the asking price.');
    const c = openConversation(l.id, ctx.user.id);
    expireOffers();
    if (q.get("SELECT 1 FROM offers WHERE conversation_id = ? AND status = 'pending'", c.id)) throw conflict('There is already a pending offer in this conversation.');
    const hours = getSetting('offer_expiry_hours');
    const offer = tx(() => {
      const { id } = q.run("INSERT INTO offers (listing_id, conversation_id, buyer_id, seller_id, made_by, amount_minor, currency, message, expires_at) VALUES (?,?,?,?,?,?,?,?, datetime('now', ?))",
        l.id, c.id, ctx.user.id, l.seller_id, ctx.user.id, amount, l.currency, cleanText(b.message, 300) || null, `+${hours} hours`);
      return q.get('SELECT * FROM offers WHERE id = ?', id);
    });
    postMessage(c, ctx.user.id, { kind: 'offer', offer_id: offer.id, body: b.message ? cleanText(b.message, 300) : null });
    notify(l.seller_id, 'offer', `New offer: ${formatMoney(amount, l.currency)}`, `${ctx.user.name} made an offer on "${l.title}".`, `/messages/${c.id}`);
    return { offer: withExpiry(offer), conversation_id: c.id };
  }, { auth: true });

  r.post('/api/v1/offers/:id/respond', (ctx) => {
    const b = validate(z.object({ action: z.enum(['accept', 'reject', 'counter', 'withdraw']), amount: z.union([z.string(), z.number()]).optional(), message: z.string().trim().max(300).optional() }), ctx.body);
    expireOffers();
    const o = q.get('SELECT * FROM offers WHERE id = ?', Number(ctx.params.id));
    if (!o) throw notFound('Offer not found.');
    const uid = ctx.user.id;
    if (o.buyer_id !== uid && o.seller_id !== uid) throw forbidden();
    if (o.status === 'expired' || o.expires_at < now()) throw conflict('This offer has expired.');
    if (o.status !== 'pending') throw conflict(`This offer was already ${o.status}.`);
    const l = q.get('SELECT * FROM listings WHERE id = ?', o.listing_id);
    const c = q.get('SELECT * FROM conversations WHERE id = ?', o.conversation_id);
    if (b.action === 'withdraw') {
      if (o.made_by !== uid) throw forbidden('Only the person who made the offer can withdraw it.');
      q.run("UPDATE offers SET status = 'withdrawn', responded_at = datetime('now') WHERE id = ?", o.id);
      postMessage(c, uid, { kind: 'system', body: `Offer of ${formatMoney(o.amount_minor, o.currency)} was withdrawn.` });
      return { offer: withExpiry(q.get('SELECT * FROM offers WHERE id = ?', o.id)) };
    }
    if (o.made_by === uid) throw forbidden('You cannot respond to your own offer.');
    if (b.action === 'accept' && l.status !== 'active') throw conflict('This listing is no longer available.');
    const other = o.made_by;
    if (b.action === 'accept') {
      q.run("UPDATE offers SET status = 'accepted', responded_at = datetime('now'), expires_at = datetime('now', '+48 hours') WHERE id = ?", o.id);
      postMessage(c, uid, { kind: 'system', body: `Offer of ${formatMoney(o.amount_minor, o.currency)} accepted. The buyer can now check out at this price within 48 hours.` });
      notify(other, 'offer', 'Offer accepted', `Your offer of ${formatMoney(o.amount_minor, o.currency)} for "${l.title}" was accepted.`, o.buyer_id === other ? `/checkout/${l.id}?offer=${o.id}` : `/messages/${c.id}`);
    } else if (b.action === 'reject') {
      q.run("UPDATE offers SET status = 'rejected', responded_at = datetime('now') WHERE id = ?", o.id);
      postMessage(c, uid, { kind: 'system', body: `Offer of ${formatMoney(o.amount_minor, o.currency)} declined.` });
      notify(other, 'offer', 'Offer declined', `Your offer on "${l.title}" was declined.`, `/messages/${c.id}`);
    } else {
      let amount;
      try { amount = toMinor(b.amount); } catch { throw bad('Enter a valid counter-offer amount.'); }
      if (amount <= 0 || amount > l.price_minor) throw bad('Counter-offers must be between 1 and the asking price.');
      if (amount === o.amount_minor) throw bad('Counter-offer is the same as the current offer — accept it instead.');
      const hours = getSetting('offer_expiry_hours');
      const counter = tx(() => {
        q.run("UPDATE offers SET status = 'countered', responded_at = datetime('now') WHERE id = ?", o.id);
        const { id } = q.run("INSERT INTO offers (listing_id, conversation_id, buyer_id, seller_id, made_by, parent_id, amount_minor, currency, message, expires_at) VALUES (?,?,?,?,?,?,?,?,?, datetime('now', ?))",
          o.listing_id, o.conversation_id, o.buyer_id, o.seller_id, uid, o.id, amount, o.currency, cleanText(b.message, 300) || null, `+${hours} hours`);
        return q.get('SELECT * FROM offers WHERE id = ?', id);
      });
      postMessage(c, uid, { kind: 'offer', offer_id: counter.id, body: b.message ? cleanText(b.message, 300) : null });
      notify(other, 'offer', `Counter-offer: ${formatMoney(amount, o.currency)}`, `New counter-offer on "${l.title}".`, `/messages/${c.id}`);
      return { offer: withExpiry(counter) };
    }
    const updated = withExpiry(q.get('SELECT * FROM offers WHERE id = ?', o.id));
    emitTo(o.buyer_id, 'offer', updated);
    emitTo(o.seller_id, 'offer', updated);
    return { offer: updated };
  }, { auth: true });

  r.get('/api/v1/offers', (ctx) => {
    expireOffers();
    const role = ctx.query.role === 'selling' ? 'seller_id' : 'buyer_id';
    const rows = q.all(`SELECT o.*, l.title, l.slug, l.price_minor AS listing_price, l.status AS listing_status,
      (SELECT thumb_url FROM listing_images WHERE listing_id = l.id ORDER BY sort LIMIT 1) AS thumb,
      ub.name AS buyer_name, us.name AS seller_name
      FROM offers o JOIN listings l ON l.id = o.listing_id JOIN users ub ON ub.id = o.buyer_id JOIN users us ON us.id = o.seller_id
      WHERE o.${role} = ? AND o.status != 'countered' ORDER BY o.id DESC LIMIT 100`, ctx.user.id);
    return rows.map(withExpiry);
  }, { auth: true });
}
