import React, { useEffect, useRef, useState } from 'react';
import { Link, navigate, useApi, useApp, useTitle, useIsMobile, api, toast, invalidate } from '../lib/core.jsx';
import { money, ago, date, CONDITIONS, plural, untilText } from '../lib/format.js';
import { Button, IconButton, Badge, Avatar, Stars, Verified, Modal, Field, Textarea, Select, MoneyInput, ErrorState, PageLoader, Empty, StarsInput, Reveal } from '../components/ui.jsx';
import { Rail, Price, ListingGrid } from '../components/listing.jsx';
import { SectionHead } from '../components/layout.jsx';
import * as I from '../components/icons.jsx';

function Gallery({ images, title }) {
  const [i, setI] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const ref = useRef(null);
  const n = images.length;
  const go = (d) => setI((x) => (x + d + n) % n);
  useEffect(() => {
    if (!lightbox) return;
    const k = (e) => { if (e.key === 'Escape') setLightbox(false); if (e.key === 'ArrowRight') go(1); if (e.key === 'ArrowLeft') go(-1); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [lightbox]); // eslint-disable-line react-hooks/exhaustive-deps
  const touch = useRef(0);
  if (!n) return <div className="gallery-main" />;
  return (
    <div className="gallery">
      <div className={`gallery-main ${zoom ? 'zooming' : ''}`} ref={ref}
        onMouseMove={(e) => { if (!zoom) return; const r = ref.current.getBoundingClientRect(); ref.current.querySelector('img').style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`; }}
        onMouseEnter={() => matchMedia('(hover: hover)').matches && setZoom(true)} onMouseLeave={() => setZoom(false)}
        onClick={() => setLightbox(true)}
        onTouchStart={(e) => (touch.current = e.touches[0].clientX)} onTouchEnd={(e) => { const d = e.changedTouches[0].clientX - touch.current; if (Math.abs(d) > 40) go(d < 0 ? 1 : -1); }}
        role="button" tabIndex={0} aria-label="Open full-screen gallery" onKeyDown={(e) => e.key === 'Enter' && setLightbox(true)}>
        <img key={images[i].url} src={images[i].url} alt={`${title} — photo ${i + 1} of ${n}`} style={{ animation: 'fadeIn .35s' }} />
        {n > 1 && <>
          <IconButton icon={I.ChevronLeft} label="Previous photo" className="nav prev badge-glass" onClick={(e) => { e.stopPropagation(); go(-1); }} />
          <IconButton icon={I.ChevronRight} label="Next photo" className="nav next badge-glass" onClick={(e) => { e.stopPropagation(); go(1); }} />
          <span className="counter badge badge-dark">{i + 1} / {n}</span>
        </>}
      </div>
      {n > 1 && (
        <div className="gallery-thumbs" role="tablist" aria-label="Photos">
          {images.map((im, k) => <button key={im.id || k} aria-current={k === i} aria-label={`Photo ${k + 1}`} onClick={() => setI(k)}><img src={im.thumb_url} alt="" loading="lazy" /></button>)}
        </div>
      )}
      {lightbox && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label="Photo viewer" onClick={() => setLightbox(false)}>
          <img src={images[i].url} alt={`${title} — photo ${i + 1}`} onClick={(e) => e.stopPropagation()} />
          <IconButton icon={I.X} label="Close" style={{ top: 20, right: 20 }} onClick={() => setLightbox(false)} />
          {n > 1 && <>
            <IconButton icon={I.ChevronLeft} label="Previous" style={{ left: 20, top: '50%' }} onClick={(e) => { e.stopPropagation(); go(-1); }} />
            <IconButton icon={I.ChevronRight} label="Next" style={{ right: 20, top: '50%' }} onClick={(e) => { e.stopPropagation(); go(1); }} />
          </>}
        </div>
      )}
    </div>
  );
}

export function OfferModal({ open, onClose, listing, onDone }) {
  const [amount, setAmount] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const price = listing.price_minor / 100;
  const quick = [0.95, 0.9, 0.85].map((f) => Math.round((price * f) / 100) * 100);
  useEffect(() => { if (open) { setAmount(String(quick[1])); setMsg(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/listings/${listing.id}/offers`, { amount, message: msg || undefined });
      toast.success('Offer sent! The seller has 48 hours to respond.', { link: `/messages/${r.conversation_id}`, linkLabel: 'Open chat' });
      onDone?.(r); onClose();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Make an offer" subtitle={`Asking price ${money(listing.price_minor, listing.currency)}. Offers expire in 48 hours.`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button icon={I.Send} loading={busy} onClick={submit} disabled={!amount}>Send offer</Button></>}>
      <div className="stack" style={{ '--gap': '16px' }}>
        <div className="chips">{quick.map((q) => <button key={q} className={`chip ${Number(amount) === q ? 'active' : ''}`} onClick={() => setAmount(String(q))}>{money(q * 100, listing.currency)}</button>)}</div>
        <Field label="Your offer"><MoneyInput currency={listing.currency} value={amount} onChange={setAmount} autoFocus /></Field>
        <Field label="Message (optional)"><Textarea rows={2} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="I can pick it up this weekend." maxLength={300} /></Field>
      </div>
    </Modal>
  );
}

export function ReportModal({ open, onClose, type, id }) {
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const reasons = [['prohibited', 'Prohibited or illegal item'], ['scam', 'Looks like a scam or fraud'], ['counterfeit', 'Counterfeit or replica'], ['wrong_category', 'Wrong category'], ['offensive', 'Offensive content'], ['duplicate', 'Duplicate listing'], ['spam', 'Spam'], ['harassment', 'Harassment'], ['other', 'Something else']];
  const submit = async () => {
    setBusy(true);
    try { await api.post('/reports', { target_type: type, target_id: id, reason, details: details || undefined }); toast.success('Thanks — our moderation team will review this.'); onClose(); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={`Report this ${type}`} subtitle="Reports are anonymous. We review every one."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" loading={busy} disabled={!reason} onClick={submit}>Submit report</Button></>}>
      <div className="stack">
        <div className="stack" style={{ '--gap': '8px' }} role="radiogroup">{reasons.map(([k, v]) => <label key={k} className="check"><input type="radio" name="reason" checked={reason === k} onChange={() => setReason(k)} />{v}</label>)}</div>
        <Field label="Details (optional)"><Textarea rows={3} value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} /></Field>
      </div>
    </Modal>
  );
}

function ShareModal({ open, onClose, listing }) {
  const url = `${location.origin}/l/${listing.slug}`;
  const text = `${listing.title} — ${money(listing.price_minor, listing.currency)} on PASAL`;
  const [copied, setCopied] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title="Share this listing" width={460}>
      <div className="stack" style={{ '--gap': '14px' }}>
        <div className="input-group"><input className="input" readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Listing link" /><Button variant="primary" size="sm" style={{ margin: 4 }} icon={copied ? I.Check : I.Copy} onClick={async () => { await navigator.clipboard?.writeText(url).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? 'Copied' : 'Copy'}</Button></div>
        <div className="row">
          <Button variant="secondary" icon={I.Chat} onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`, '_blank', 'noopener')}>WhatsApp</Button>
          <Button variant="secondary" icon={I.Share} onClick={() => window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, '_blank', 'noopener')}>Facebook</Button>
          <Button variant="secondary" icon={I.Share} onClick={() => window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, '_blank', 'noopener')}>X</Button>
          {navigator.share && <Button variant="secondary" icon={I.Share} onClick={() => navigator.share({ title: listing.title, text, url }).catch(() => {})}>More</Button>}
        </div>
      </div>
    </Modal>
  );
}

function ChatModal({ open, onClose, listing }) {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const quick = ['Is this still available?', 'Is the price negotiable?', 'Can I see it in person?', 'Do you deliver?'];
  useEffect(() => { if (open) setMsg(quick[0]); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = async () => {
    setBusy(true);
    try { const c = await api.post('/conversations', { listing_id: listing.id, message: msg }); navigate(`/messages/${c.id}`); }
    catch (e) { toast.error(e.message); setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={`Message ${listing.seller.name}`} subtitle="Chat safely on PASAL — never share OTPs or pay in advance outside the platform."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button icon={I.Send} loading={busy} disabled={!msg.trim()} onClick={send}>Send message</Button></>}>
      <div className="stack">
        <div className="chips">{quick.map((q) => <button key={q} className={`chip sm ${msg === q ? 'active' : ''}`} onClick={() => setMsg(q)}>{q}</button>)}</div>
        <Textarea rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={2000} aria-label="Message" />
      </div>
    </Modal>
  );
}

export function ListingPage({ params }) {
  const app = useApp();
  const isMobile = useIsMobile();
  const { data: l, error, loading, reload } = useApi(`/listings/${encodeURIComponent(params.slug)}`);
  const [modal, setModal] = useState(null);
  useTitle(l?.title);
  if (loading && !l) return <PageLoader />;
  if (error) return <div className="container page"><ErrorState error={error} retry={reload} /></div>;
  const need = (fn) => () => (app.user ? fn() : navigate(`/login?next=${encodeURIComponent(location.pathname)}`));
  const v = l.viewer;
  const off = v?.offer;
  const canBuy = l.status === 'active' && !l.is_owner && l.quantity > 0;
  const acceptedOffer = off && off.status === 'accepted' && !off.expired ? off : null;
  const buy = need(() => navigate(`/checkout/${l.id}${acceptedOffer ? `?offer=${acceptedOffer.id}` : ''}`));
  const chat = need(() => (v?.conversation_id ? navigate(`/messages/${v.conversation_id}`) : setModal('chat')));
  const wished = app.wishlist.has(l.id);
  const fulfil = { delivery: l.fulfillment !== 'pickup', pickup: l.fulfillment !== 'delivery' };
  const loc = [l.locality, l.location?.city, l.location?.district, l.location?.region].filter(Boolean);
  const actions = (
    <>
      {l.is_owner ? (
        <div className="stack">
          <div className="callout accent"><I.Info size={18} /><span>This is your listing ({l.status.replace('_', ' ')}). {plural(l.views, 'view')} so far.</span></div>
          <Button block icon={I.Pencil} to={`/sell/${l.id}`}>Edit listing</Button>
          <Button block variant="secondary" icon={I.BarChart} to="/seller/listings">Manage in seller dashboard</Button>
        </div>
      ) : (
        <div className="stack">
          {acceptedOffer && <div className="callout success"><I.Handshake size={18} /><span>Your offer of <b>{money(acceptedOffer.amount_minor, l.currency)}</b> was accepted · {untilText(acceptedOffer.expires_at)}</span></div>}
          {off && off.status === 'pending' && !off.expired && <div className="callout info"><I.Clock size={18} /><span>Offer of <b>{money(off.amount_minor, l.currency)}</b> pending · {untilText(off.expires_at)}</span></div>}
          <Button block size="lg" variant="gradient" icon={I.Bag} onClick={buy} disabled={!canBuy}>{l.status === 'sold' ? 'Sold' : acceptedOffer ? `Buy at ${money(acceptedOffer.amount_minor, l.currency)}` : 'Buy now'}</Button>
          <div className="row nowrap">
            <Button className="grow" variant="secondary" icon={I.Chat} onClick={chat} disabled={v?.blocked}>{v?.conversation_id ? 'Open chat' : 'Chat with seller'}</Button>
            {l.accept_offers && <Button className="grow" variant="soft" icon={I.Handshake} onClick={need(() => setModal('offer'))} disabled={!canBuy || (off?.status === 'pending' && !off.expired)}>Make an offer</Button>}
          </div>
        </div>
      )}
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <Button variant="ghost" size="sm" icon={I.Heart} onClick={() => app.toggleWish(l.id)} style={wished ? { color: '#F0445F' } : undefined} aria-pressed={wished}>{wished ? 'Saved' : 'Save'}</Button>
        <Button variant="ghost" size="sm" icon={I.Share} onClick={() => setModal('share')}>Share</Button>
        {!l.is_owner && <Button variant="ghost" size="sm" icon={I.Flag} onClick={need(() => setModal('report'))}>Report</Button>}
      </div>
    </>
  );
  return (
    <div className="container page" style={isMobile && !l.is_owner ? { paddingBottom: 200 } : undefined}>
      <nav className="breadcrumb" aria-label="Breadcrumb"><Link to="/">Home</Link>{l.category.map((c) => <React.Fragment key={c.slug}><I.ChevronRight size={13} /><Link to={`/c/${c.slug}`}>{c.name}</Link></React.Fragment>)}</nav>
      <div className="lp">
        <div className="stack" style={{ '--gap': '28px', minWidth: 0 }}>
          <Gallery images={l.images} title={l.title} />
          {isMobile && <TitleBlock l={l} loc={loc} />}
          {isMobile && <div className="card card-pad stack">{actions}</div>}
          <section className="card card-pad-lg">
            <h2 className="mb-4" style={{ fontSize: 19 }}>Details</h2>
            <dl className="spec">
              <div><dt>Condition</dt><dd>{CONDITIONS[l.condition]}</dd></div>
              {l.brand && <div><dt>Brand</dt><dd>{l.brand}</dd></div>}
              {l.model && <div><dt>Model</dt><dd>{l.model}</dd></div>}
              {l.attributes.map((a) => <div key={a.key}><dt>{a.label}</dt><dd>{a.value}{a.unit ? ` ${a.unit}` : ''}</dd></div>)}
              {l.purchase_date && <div><dt>Purchased</dt><dd>{date(l.purchase_date + (l.purchase_date.length === 7 ? '-01' : ''), { month: 'short', year: 'numeric' })}</dd></div>}
              {l.warranty && <div><dt>Warranty</dt><dd>{l.warranty}</dd></div>}
              {l.original_price_minor && <div><dt>Original price</dt><dd>{money(l.original_price_minor, l.currency)}</dd></div>}
              {l.quantity > 1 && <div><dt>Available</dt><dd>{l.quantity} units</dd></div>}
            </dl>
            <h3 className="mt-6 mb-2">Description</h3>
            <p className="pre text-2" style={{ lineHeight: 1.7 }}>{l.description}</p>
            {l.reason_for_selling && <><h3 className="mt-5 mb-2">Why it’s being sold</h3><p className="text-2">{l.reason_for_selling}</p></>}
            <div className="row tiny muted mt-5" style={{ '--gap': '16px' }}><span>Listing ID #{l.id}</span><span>Posted {ago(l.published_at || l.created_at)}</span><span><I.Eye size={12} style={{ display: 'inline', verticalAlign: '-1px' }} /> {plural(l.views, 'view')}</span><span><I.Heart size={12} style={{ display: 'inline', verticalAlign: '-1px' }} /> {l.wishlist_count} saved</span></div>
          </section>
          <section className="card card-pad-lg">
            <h2 className="mb-4" style={{ fontSize: 19 }}>Delivery &amp; pickup</h2>
            <div className="info-list">
              {fulfil.delivery && l.delivery && (
                <div className="info-row"><span className="ic"><I.Truck size={18} /></span><div><b>Home delivery · {l.delivery.fee_minor ? money(l.delivery.fee_minor, l.currency) : 'Free'}</b><span>Arrives in {l.delivery.eta_min_days}–{l.delivery.eta_max_days} days · {l.delivery.method === 'courier' ? 'by courier' : 'by the seller'}{l.delivery.supported_locations.length ? ` · ${l.delivery.supported_locations.join(', ')}` : l.delivery.radius_km ? ` · within ${l.delivery.radius_km} km` : ''}</span></div></div>
              )}
              {fulfil.pickup && (
                <div className="info-row"><span className="ic"><I.Store size={18} /></span><div><b>Self pickup{l.pickup?.address ? ` · ${l.pickup.address}` : ''}</b><span>{l.pickup?.times || 'Arrange a time with the seller'}{l.pickup?.instructions ? ` · ${l.pickup.instructions}` : ''}</span></div></div>
              )}
              <div className="info-row"><span className="ic"><I.ShieldCheck size={18} /></span><div><b>Pay safely</b><span>Pay online through PASAL for protected, verified payments — or pay the seller in person at handover. Never send money before seeing the item.</span></div></div>
            </div>
          </section>
          {l.reviews.length > 0 && (
            <section className="card card-pad-lg">
              <div className="spread mb-2"><h2 style={{ fontSize: 19 }}>Reviews for {l.seller.name}</h2><Link to={`/u/${l.seller.id}`} className="section-link">All reviews<I.ArrowRight size={15} /></Link></div>
              {l.reviews.map((r) => <ReviewItem key={r.id} r={r} />)}
            </section>
          )}
        </div>
        <aside className="lp-side">
          {!isMobile && <div className="card card-pad-lg stack" style={{ '--gap': '18px' }}><TitleBlock l={l} loc={loc} />{actions}</div>}
          <SellerCard seller={l.seller} />
          <div className="callout"><I.ShieldCheck size={18} style={{ color: 'var(--accent-text)' }} /><span className="small">Meet in a public place, inspect the item, and use PASAL’s pickup code at handover. <Link to="/help#safety" className="link">Safety tips</Link></span></div>
        </aside>
      </div>
      {l.similar.length > 0 && <section className="section"><SectionHead title="Similar listings" to={`/c/${l.category[l.category.length - 1].slug}`} /><Rail items={l.similar} /></section>}
      {l.more_from_seller.length > 0 && <section className="section"><SectionHead title={`More from ${l.seller.name}`} to={`/u/${l.seller.id}`} /><Rail items={l.more_from_seller} /></section>}
      {isMobile && !l.is_owner && (
        <div className="lp-mobile-bar">
          <Button variant="secondary" icon={I.Chat} onClick={chat}>Chat</Button>
          {l.accept_offers && <Button variant="soft" icon={I.Handshake} onClick={need(() => setModal('offer'))} disabled={!canBuy}>Offer</Button>}
          <Button variant="gradient" icon={I.Bag} onClick={buy} disabled={!canBuy}>Buy</Button>
        </div>
      )}
      <OfferModal open={modal === 'offer'} onClose={() => setModal(null)} listing={l} onDone={() => { invalidate(`/listings/${params.slug}`); reload(); }} />
      <ReportModal open={modal === 'report'} onClose={() => setModal(null)} type="listing" id={l.id} />
      <ShareModal open={modal === 'share'} onClose={() => setModal(null)} listing={l} />
      <ChatModal open={modal === 'chat'} onClose={() => setModal(null)} listing={l} />
    </div>
  );
}

function TitleBlock({ l, loc }) {
  return (
    <div className="stack" style={{ '--gap': '10px' }}>
      <div className="row">
        {l.featured && <Badge tone="grad" icon={I.Sparkles}>Featured</Badge>}
        <Badge>{CONDITIONS[l.condition]}</Badge>
        {l.negotiable && <Badge tone="success">Negotiable</Badge>}
        {l.status === 'sold' && <Badge tone="danger">Sold</Badge>}
      </div>
      <h1 style={{ fontSize: 'clamp(22px, 2.4vw, 28px)' }}>{l.title}</h1>
      <div className="pcard-price" style={{ gap: 10 }}><Price minor={l.price_minor} currency={l.currency} original={l.original_price_minor} className="price-big" /></div>
      <div className="row small muted" style={{ '--gap': '6px' }}><I.MapPin size={14} />{loc.join(', ')}<span>·</span>{ago(l.published_at || l.created_at)}</div>
    </div>
  );
}

function SellerCard({ seller }) {
  const app = useApp();
  const s = seller.stats;
  return (
    <div className="card card-pad stack" style={{ '--gap': '14px' }}>
      <Link to={`/u/${seller.id}`} className="row nowrap" style={{ '--gap': '14px' }}>
        <Avatar name={seller.name} src={seller.avatar_url} size={52} online={seller.online || app.isOnline(seller.id)} />
        <div className="grow">
          <b className="row" style={{ '--gap': '5px' }}>{seller.name}{seller.seller_status === 'verified' && <Verified />}</b>
          <div className="small muted">{seller.city ? `${seller.city} · ` : ''}Member since {date(seller.created_at, { month: 'short', year: 'numeric' })}</div>
        </div>
        <I.ChevronRight size={18} className="muted" />
      </Link>
      <div className="row" style={{ '--gap': '6px' }}>
        {s.rating ? <><Stars value={s.rating} /><b className="small">{s.rating}</b><span className="small muted">({s.review_count})</span></> : <span className="small muted">No reviews yet</span>}
      </div>
      <div className="row tiny">
        {seller.seller_status === 'verified' && <Badge tone="accent" icon={I.BadgeCheck}>ID verified</Badge>}
        {seller.phone_verified && <Badge tone="success" icon={I.Phone}>Phone verified</Badge>}
        {seller.email_verified && <Badge tone="success" icon={I.Mail}>Email verified</Badge>}
      </div>
      <div className="row small muted" style={{ '--gap': '16px' }}><span><b className="text-2">{s.active_listings}</b> listings</span><span><b className="text-2">{s.sales}</b> sales</span>{s.response_rate != null && <span><b className="text-2">{s.response_rate}%</b> response rate</span>}</div>
    </div>
  );
}

function ReviewItem({ r }) {
  return (
    <div className="review">
      <div className="row nowrap" style={{ '--gap': '12px' }}>
        <Avatar name={r.author_name} src={r.author_avatar} size={36} />
        <div className="grow"><b className="small">{r.author_name}</b><div className="row tiny muted" style={{ '--gap': '6px' }}><Stars value={r.rating} size={12} />{ago(r.created_at)}{r.verified ? <Badge tone="success" icon={I.CheckCircle}>Verified purchase</Badge> : null}</div></div>
      </div>
      {r.listing_title && <div className="tiny muted mt-2">For: {r.listing_title}</div>}
      {r.body && <p className="mt-2 text-2" style={{ fontSize: 14.5 }}>{r.body}</p>}
      {r.reply && <div className="reply"><b className="small">Seller replied</b><p className="small text-2 mt-1">{r.reply}</p></div>}
    </div>
  );
}
export { ReviewItem };

export function SellerProfile({ params }) {
  const app = useApp();
  const { data, error, loading, reload } = useApi(`/users/${params.id}`);
  const [report, setReport] = useState(false);
  const [review, setReview] = useState(false);
  useTitle(data?.user.name);
  if (loading && !data) return <PageLoader />;
  if (error) return <div className="container page"><ErrorState error={error} retry={reload} /></div>;
  const u = data.user, s = data.stats;
  const total = data.distribution.reduce((a, b) => a + b.n, 0);
  const block = async () => {
    try { await (data.blocked ? api.del(`/users/${u.id}/block`) : api.post(`/users/${u.id}/block`)); toast.success(data.blocked ? 'Unblocked' : `${u.name} is blocked. They can no longer message you.`); reload(); }
    catch (e) { toast.error(e.message); }
  };
  const me = app.user?.id === u.id;
  return (
    <div className="container page">
      <div className="card card-pad-lg" style={{ position: 'relative', overflow: 'hidden' }}>
        <div className="hero-mesh" aria-hidden="true" style={{ opacity: 0.4 }}><span /><span /></div>
        <div className="row" style={{ '--gap': '22px', alignItems: 'flex-start' }}>
          <Avatar name={u.name} src={u.avatar_url} size={96} online={u.online} />
          <div className="grow stack" style={{ '--gap': '8px' }}>
            <h1 className="row" style={{ '--gap': '8px' }}>{u.name}{u.seller_status === 'verified' && <Verified size={24} />}</h1>
            <div className="row small muted" style={{ '--gap': '12px' }}>{u.city && <span className="row" style={{ '--gap': '4px' }}><I.MapPin size={14} />{u.city.name}, {u.city.parent}</span>}<span>Member since {date(u.created_at, { month: 'long', year: 'numeric' })}</span><span>{u.online ? <span className="row" style={{ '--gap': '6px' }}><span className="dot online" />Online now</span> : `Active ${ago(u.last_seen_at)}`}</span></div>
            {u.bio && <p className="text-2" style={{ maxWidth: 640 }}>{u.bio}</p>}
            {u.suspended && <div className="callout danger"><I.Ban size={18} />This account is currently suspended.</div>}
            <div className="row mt-2">
              {s.rating && <span className="row" style={{ '--gap': '6px' }}><Stars value={s.rating} /><b>{s.rating}</b><span className="muted small">({s.review_count} reviews)</span></span>}
              <Badge>{s.active_listings} active listings</Badge><Badge>{s.sales} completed sales</Badge>{s.response_rate != null && <Badge tone="success">{s.response_rate}% response rate</Badge>}
            </div>
          </div>
          {!me && app.user && (
            <div className="row">
              <Button variant="secondary" size="sm" icon={I.Star} onClick={() => setReview(true)}>Write a review</Button>
              <Button variant="ghost" size="sm" icon={I.Ban} onClick={block}>{data.blocked ? 'Unblock' : 'Block'}</Button>
              <Button variant="ghost" size="sm" icon={I.Flag} onClick={() => setReport(true)}>Report</Button>
            </div>
          )}
        </div>
      </div>
      <section className="section"><SectionHead title={`Listings by ${u.name}`} /><ListingGrid items={data.listings} empty={<Empty icon={I.Tag} title="No active listings">Check back soon.</Empty>} /></section>
      <section className="section">
        <SectionHead title="Ratings & reviews" />
        <div className="lp" style={{ gridTemplateColumns: '300px 1fr' }}>
          <div className="card card-pad stack">
            <div className="row"><span className="price-big">{s.rating || '—'}</span><div><Stars value={s.rating || 0} size={16} /><div className="small muted">{plural(total, 'review')}</div></div></div>
            <div className="rating-bars">{[5, 4, 3, 2, 1].map((n) => { const c = data.distribution.find((d) => d.rating === n)?.n || 0; return <div key={n} className="rb"><span>{n}★</span><span className="bar"><i style={{ width: `${total ? (c / total) * 100 : 0}%` }} /></span><span>{c}</span></div>; })}</div>
          </div>
          <Reveal className="card card-pad">{data.reviews.length ? data.reviews.map((r) => <ReviewItem key={r.id} r={r} />) : <Empty icon={I.Star} title="No reviews yet" />}</Reveal>
        </div>
      </section>
      <ReportModal open={report} onClose={() => setReport(false)} type="user" id={u.id} />
      <WriteReview open={review} onClose={() => setReview(false)} seller={u} listings={data.listings} onDone={reload} />
    </div>
  );
}

function WriteReview({ open, onClose, seller, listings, onDone }) {
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [listing, setListing] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await api.post(`/users/${seller.id}/reviews`, { rating, body, listing_id: Number(listing) }); toast.success('Review posted'); onClose(); onDone(); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={`Review ${seller.name}`} subtitle="Reviews from chats without a PASAL order are shown without the “Verified purchase” badge."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!rating || body.length < 10 || !listing} onClick={submit}>Post review</Button></>}>
      <div className="stack" style={{ '--gap': '16px' }}>
        <StarsInput value={rating} onChange={setRating} />
        <Field label="Which listing did you chat about?"><Select value={listing} onChange={(e) => setListing(e.target.value)} placeholder="Choose a listing" options={listings.map((l) => ({ value: l.id, label: l.title }))} /></Field>
        <Field label="Your review" help="At least 10 characters"><Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} maxLength={1500} /></Field>
      </div>
    </Modal>
  );
}
