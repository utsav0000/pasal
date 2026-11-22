import React, { useEffect, useState } from 'react';
import { Link, navigate, useApi, useApp, useLocation, useRequireAuth, useTitle, api, toast, invalidate } from '../lib/core.jsx';
import { money, ago, date, dateTime, ORDER_TONE, untilText, plural } from '../lib/format.js';
import { Button, Field, Input, Textarea, Select, Toggle, Seg, Avatar, Badge, Status, Empty, PageLoader, Tabs, Modal, StarsInput, Stars, confirmDialog, Skel } from '../components/ui.jsx';
import { ListingGrid, Rail } from '../components/listing.jsx';
import { DashLayout, Stat, PageHead } from '../components/dash.jsx';
import { ReviewItem } from './Listing.jsx';
import * as I from '../components/icons.jsx';

// ---------------- Overview ----------------
function Overview() {
  const app = useApp();
  const { data } = useApi('/me/dashboard');
  useTitle('Dashboard');
  const u = app.user;
  return (
    <>
      <PageHead title={`Namaste, ${u.name.split(' ')[0]} 👋`} subtitle="Here’s what’s happening with your buying on PASAL." actions={<Button variant="gradient" icon={I.Plus} to="/sell">Sell something</Button>} />
      {!u.email_verified && u.email && <div className="callout warn mb-4"><I.Mail size={18} /><span className="grow">Verify your email to publish listings and place orders.</span><Button size="sm" variant="secondary" onClick={async () => { try { await api.post('/auth/resend-verification'); toast.success('Verification email sent.'); } catch (e) { toast.error(e.message); } }}>Resend link</Button></div>}
      <div className="stat-grid stagger">
        <Stat label="Open orders" value={data?.counts.open_orders ?? '–'} icon={I.Package} sub={<Link to="/orders" className="link">View orders</Link>} />
        <Stat label="Wishlist" value={data?.counts.wishlist ?? '–'} icon={I.Heart} tone="danger" sub={<Link to="/wishlist" className="link">Saved items</Link>} />
        <Stat label="Active offers" value={data?.counts.offers ?? '–'} icon={I.Handshake} tone="success" sub={<Link to="/offers" className="link">Track offers</Link>} />
        <Stat label="Saved searches" value={data?.counts.saved_searches ?? '–'} icon={I.Bookmark} tone="info" sub={<Link to="/saved-searches" className="link">Alerts</Link>} />
      </div>
      {data?.counts.reviews_due > 0 && <div className="callout accent mt-5"><I.Star size={18} /><span className="grow">You have {plural(data.counts.reviews_due, 'completed order')} to review.</span><Button size="sm" to="/reviews">Leave a review</Button></div>}
      <section className="section" style={{ marginTop: 32 }}>
        <div className="section-head"><h2>Orders in progress</h2><Link to="/orders" className="section-link">All orders<I.ArrowRight size={15} /></Link></div>
        <div className="card">{data?.open_orders.length ? <div className="list-rows">{data.open_orders.map((o) => (
          <Link key={o.id} to={`/orders/${o.id}`} className="list-row"><img className="thumb-sm" src={o.image_url} alt="" /><div className="grow" style={{ minWidth: 0 }}><b className="ellipsis" style={{ display: 'block' }}>{o.title}</b><span className="small muted">{o.number} · {o.fulfillment === 'pickup' ? 'Pickup' : 'Delivery'}</span></div><span className="semibold hide-mobile">{money(o.total_minor, o.currency)}</span><Status tone={ORDER_TONE[o.status]}>{o.status_label}</Status></Link>
        ))}</div> : <Empty icon={I.Package} title="No orders in progress" action={<Button to="/browse" variant="secondary">Start browsing</Button>} />}</div>
      </section>
      {data?.recently_viewed.length > 0 && <section className="section" style={{ marginTop: 32 }}><div className="section-head"><h2>Recently viewed</h2><Link to="/recently-viewed" className="section-link">See all<I.ArrowRight size={15} /></Link></div><Rail items={data.recently_viewed} /></section>}
      {data?.recommended.length > 0 && <section className="section" style={{ marginTop: 32 }}><div className="section-head"><div><h2>Recommended for you</h2><p>Based on what you browse and save</p></div></div><Rail items={data.recommended} /></section>}
    </>
  );
}

function Wishlist() {
  useTitle('Wishlist');
  const { data, loading } = useApi('/wishlist');
  const app = useApp();
  const items = (data || []).filter((i) => app.wishlist.has(i.id));
  return (<><PageHead title="Wishlist" subtitle="Items you’ve saved. We’ll keep them here until they sell." /><ListingGrid items={items} loading={loading} empty={<Empty icon={I.Heart} title="Your wishlist is empty" action={<Button to="/browse">Discover listings</Button>}>Tap the heart on any listing to save it for later.</Empty>} /></>);
}

function RecentlyViewed() {
  useTitle('Recently viewed');
  const { data, loading, reload } = useApi('/recently-viewed');
  return (<><PageHead title="Recently viewed" actions={data?.length > 0 && <Button variant="ghost" icon={I.Trash} onClick={async () => { await api.del('/recently-viewed'); reload(); }}>Clear history</Button>} /><ListingGrid items={data} loading={loading} empty={<Empty icon={I.History} title="Nothing viewed yet" />} /></>);
}

function SavedSearches() {
  useTitle('Saved searches');
  const { data, loading, reload } = useApi('/saved-searches');
  const toggle = async (s, notify) => { await api.patch(`/saved-searches/${s.id}`, { notify }); reload(); };
  const remove = async (s) => { if (await confirmDialog({ title: 'Delete saved search?', message: s.name, confirm: 'Delete', danger: true })) { await api.del(`/saved-searches/${s.id}`); reload(); } };
  return (
    <>
      <PageHead title="Saved searches" subtitle="We check for new matches and notify you." actions={<Button variant="secondary" icon={I.Search} to="/browse">New search</Button>} />
      {loading && !data ? <Skel h={200} r={20} /> : data?.length ? (
        <div className="card"><div className="list-rows">{data.map((s) => (
          <div key={s.id} className="list-row">
            <span className="ctile-icon" style={{ width: 42, height: 42 }}><I.Bookmark size={19} /></span>
            <div className="grow" style={{ minWidth: 0 }}><b className="ellipsis" style={{ display: 'block' }}>{s.name}</b><span className="small muted">{plural(s.total, 'listing')} now{s.new_count ? <> · <b style={{ color: 'var(--success-text)' }}>{s.new_count} new</b></> : ''} · saved {ago(s.created_at)}</span></div>
            <Toggle label={<span className="hide-mobile small">Alerts</span>} checked={s.notify} onChange={(v) => toggle(s, v)} />
            <Button size="sm" variant="secondary" onClick={async () => { await api.patch(`/saved-searches/${s.id}`, { seen: true }); navigate(`/search?${s.query}`); }}>View</Button>
            <Button size="sm" variant="ghost" icon={I.Trash} aria-label="Delete" onClick={() => remove(s)} />
          </div>
        ))}</div></div>
      ) : <Empty icon={I.Bookmark} title="No saved searches" action={<Button to="/browse">Browse and save a search</Button>}>Save a search from any results page to get alerts for new matches.</Empty>}
    </>
  );
}

function Notifications() {
  useTitle('Notifications');
  const app = useApp();
  const [filter, setFilter] = useState('all');
  const { data, loading, reload } = useApi(`/notifications${filter === 'unread' ? '?unread=1' : ''}`);
  const readAll = async () => { await api.post('/notifications/read', {}); app.setCounts((c) => ({ ...c, notifications: 0 })); reload(); };
  useEffect(() => app.on('notification', reload), []); // eslint-disable-line react-hooks/exhaustive-deps
  const icon = { message: I.Chat, offer: I.Handshake, order: I.Package, payment: I.Wallet, listing: I.Tag, review: I.Star, saved_search: I.Bookmark, system: I.ShieldCheck };
  const open = async (n) => { if (!n.read_at) { await api.post('/notifications/read', { ids: [n.id] }); app.setCounts((c) => ({ ...c, notifications: Math.max(0, c.notifications - 1) })); } if (n.link) navigate(n.link); else reload(); };
  return (
    <>
      <PageHead title="Notifications" actions={<><Seg value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'unread', label: 'Unread' }]} label="Filter" /><Button variant="secondary" icon={I.CheckCheck} onClick={readAll}>Mark all read</Button></>} />
      <div className="card">{loading && !data ? <div className="card-body"><Skel h={60} /></div> : data?.length ? <div className="list-rows">{data.map((n) => {
        const Ic = icon[n.type] || I.Bell;
        return (
          <button key={n.id} className="list-row" style={{ border: 0, borderBottom: '1px solid var(--border)', background: n.read_at ? 'none' : 'color-mix(in srgb, var(--accent-soft) 45%, transparent)', textAlign: 'left', cursor: 'pointer', width: '100%' }} onClick={() => open(n)}>
            <span className="ctile-icon" style={{ width: 40, height: 40 }}><Ic size={18} /></span>
            <div className="grow" style={{ minWidth: 0 }}><b style={{ display: 'block' }}>{n.title}</b>{n.body && <span className="small text-2 clamp-2">{n.body}</span>}</div>
            <span className="tiny muted nowrap">{ago(n.created_at)}</span>{!n.read_at && <span className="dot" style={{ background: 'var(--accent)' }} />}
          </button>
        );
      })}</div> : <Empty icon={I.Bell} title="You’re all caught up" />}</div>
      <p className="small muted mt-4">Choose which notifications you get by email in <Link to="/settings/notifications" className="link">notification settings</Link>.</p>
    </>
  );
}

function Offers() {
  useTitle('Offers');
  const [role, setRole] = useState('buying');
  const { data, loading, reload } = useApi(`/offers?role=${role}`);
  const respond = async (o, action) => {
    try {
      let amount;
      if (action === 'counter') { amount = await confirmDialog({ title: 'Counter-offer', message: `Current offer ${money(o.amount_minor, o.currency)} · asking ${money(o.listing_price, o.currency)}`, input: { label: `Your counter (${o.currency})`, required: true }, confirm: 'Send counter' }); if (!amount) return; }
      await api.post(`/offers/${o.id}/respond`, { action, amount }); toast.success(`Offer ${action === 'counter' ? 'countered' : action + 'ed'}`); reload();
    } catch (e) { toast.error(e.message); }
  };
  const tone = { pending: 'warn', accepted: 'success', rejected: 'danger', expired: '', withdrawn: '', used: 'accent' };
  return (
    <>
      <PageHead title="Offers" subtitle="Negotiations in progress. Offers expire after 48 hours." actions={<Seg value={role} onChange={setRole} options={[{ value: 'buying', label: 'Offers I made' }, { value: 'selling', label: 'Offers received' }]} label="Role" />} />
      {loading && !data ? <Skel h={200} r={20} /> : data?.length ? (
        <div className="card"><div className="list-rows">{data.map((o) => {
          const status = o.expired ? 'expired' : o.status;
          const mine = (role === 'buying') === (o.made_by === o.buyer_id);
          return (
            <div key={o.id} className="list-row">
              <img className="thumb-sm" src={o.thumb} alt="" />
              <div className="grow" style={{ minWidth: 0 }}>
                <Link to={`/l/${o.slug}`} className="semibold ellipsis" style={{ display: 'block' }}>{o.title}</Link>
                <span className="small muted">{mine ? 'You offered' : `${role === 'buying' ? o.seller_name : o.buyer_name} offered`} <b className="text-2">{money(o.amount_minor, o.currency)}</b> · asking {money(o.listing_price, o.currency)} · {status === 'pending' || status === 'accepted' ? untilText(o.expires_at) : ago(o.created_at)}</span>
              </div>
              <Status tone={tone[status]}>{status === 'used' ? 'Ordered' : status}</Status>
              {status === 'pending' && !mine && <div className="row"><Button size="sm" variant="success" onClick={() => respond(o, 'accept')}>Accept</Button><Button size="sm" variant="secondary" onClick={() => respond(o, 'counter')}>Counter</Button><Button size="sm" variant="ghost" onClick={() => respond(o, 'reject')}>Decline</Button></div>}
              {status === 'pending' && mine && <Button size="sm" variant="ghost" onClick={() => respond(o, 'withdraw')}>Withdraw</Button>}
              {status === 'accepted' && role === 'buying' && <Button size="sm" variant="gradient" to={`/checkout/${o.listing_id}?offer=${o.id}`}>Buy now</Button>}
              <Button size="sm" variant="ghost" icon={I.Chat} to={`/messages/${o.conversation_id}`} aria-label="Open chat" />
            </div>
          );
        })}</div></div>
      ) : <Empty icon={I.Handshake} title="No offers yet">{role === 'buying' ? 'Make an offer on any listing that accepts them.' : 'Offers from buyers will appear here.'}</Empty>}
    </>
  );
}

// ---------------- Reviews ----------------
function Reviews() {
  useTitle('Reviews');
  const [tab, setTab] = useState('received');
  const { data, reload } = useApi('/me/reviews');
  const [writing, setWriting] = useState(null);
  const [replying, setReplying] = useState(null);
  return (
    <>
      <PageHead title="Reviews" subtitle="Ratings build trust. Reviews tied to PASAL orders carry a “Verified purchase” badge." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'received', label: 'About you', count: data?.received.length }, { value: 'written', label: 'Written by you', count: data?.written.length }, { value: 'pending', label: 'To write', count: data?.pending.length }]} />
      <div className="card card-pad mt-4">
        {tab === 'received' && (data?.received.length ? data.received.map((r) => <div key={r.id}><ReviewItem r={r} />{!r.reply && r.direction === 'buyer_to_seller' && <Button size="sm" variant="ghost" icon={I.Chat} onClick={() => setReplying(r)} style={{ marginTop: -6, marginBottom: 8 }}>Reply publicly</Button>}</div>) : <Empty icon={I.Star} title="No reviews yet">Complete orders to start building your reputation.</Empty>)}
        {tab === 'written' && (data?.written.length ? data.written.map((r) => <div key={r.id}><div className="small muted mt-3">About <b>{r.subject_name}</b></div><ReviewItem r={{ ...r, author_name: 'You' }} /></div>) : <Empty icon={I.Star} title="You haven’t written any reviews" />)}
        {tab === 'pending' && (data?.pending.length ? <div className="list-rows">{data.pending.map((o) => <div key={o.id} className="list-row"><img className="thumb-sm" src={o.image_url} alt="" /><div className="grow"><b>{o.title}</b><div className="small muted">{o.number} · with {o.other_name}</div></div><Button size="sm" icon={I.Star} onClick={() => setWriting(o)}>Write review</Button></div>)}</div> : <Empty icon={I.CheckCircle} title="All caught up" />)}
      </div>
      <ReviewModal order={writing} onClose={() => setWriting(null)} onDone={reload} />
      <ReplyModal review={replying} onClose={() => setReplying(null)} onDone={reload} />
    </>
  );
}
export function ReviewModal({ order, onClose, onDone }) {
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setRating(0); setBody(''); }, [order]);
  const submit = async () => { setBusy(true); try { await api.post(`/orders/${order.id}/review`, { rating, body: body || undefined }); toast.success('Thanks for your review!'); onClose(); onDone?.(); } catch (e) { toast.error(e.message); } finally { setBusy(false); } };
  return (
    <Modal open={!!order} onClose={onClose} title="How did it go?" subtitle={order?.title} footer={<><Button variant="secondary" onClick={onClose}>Later</Button><Button loading={busy} disabled={!rating} onClick={submit}>Post review</Button></>}>
      <div className="stack" style={{ '--gap': '16px', alignItems: 'center' }}><StarsInput value={rating} onChange={setRating} /><Textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Was the item as described? How was communication and handover?" maxLength={1500} /></div>
    </Modal>
  );
}
function ReplyModal({ review, onClose, onDone }) {
  const [reply, setReply] = useState('');
  const submit = async () => { try { await api.post(`/reviews/${review.id}/reply`, { reply }); toast.success('Reply posted'); setReply(''); onClose(); onDone(); } catch (e) { toast.error(e.message); } };
  return <Modal open={!!review} onClose={onClose} title="Reply to review" subtitle="Your reply is public and can’t be edited." footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={reply.trim().length < 2} onClick={submit}>Post reply</Button></>}><Textarea rows={4} value={reply} onChange={(e) => setReply(e.target.value)} maxLength={1000} /></Modal>;
}

// ---------------- Settings ----------------
function Profile() {
  const app = useApp();
  const u = app.user;
  const [f, setF] = useState({ name: u.name, bio: u.bio || '', country_code: u.country_code, city_id: u.city?.id || '' });
  const [email, setEmail] = useState(u.email || '');
  const [busy, setBusy] = useState(false);
  const cities = useApi(`/locations?country=${f.country_code}&popular=1`);
  const save = async (extra = {}) => { setBusy(true); try { await api.patch('/me', { ...f, city_id: f.city_id ? Number(f.city_id) : null, ...extra }); await app.refreshMe(); toast.success('Profile updated'); } catch (e) { toast.error(e.message); } finally { setBusy(false); } };
  const avatar = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const img = new Image(); img.onload = () => { const c = document.createElement('canvas'); const s = Math.min(img.width, img.height); c.width = c.height = 400; c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 400, 400); save({ avatar: c.toDataURL('image/jpeg', 0.88) }); };
    img.src = URL.createObjectURL(file);
  };
  return (
    <div className="card card-pad-lg">
      <div className="row mb-5" style={{ '--gap': '18px' }}><Avatar name={u.name} src={u.avatar_url} size={80} /><div><label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}><I.Camera size={15} />Change photo<input type="file" accept="image/*" hidden onChange={avatar} /></label><p className="tiny muted mt-2">Square images work best.</p></div></div>
      <div className="form-grid">
        <Field label="Full name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Marketplace country"><Seg full value={f.country_code} onChange={(v) => setF({ ...f, country_code: v, city_id: '' })} options={[{ value: 'IN', label: '🇮🇳 India' }, { value: 'NP', label: '🇳🇵 Nepal' }]} label="Country" /></Field>
        <Field label="City"><Select value={f.city_id} onChange={(e) => setF({ ...f, city_id: e.target.value })} placeholder="Select city" options={(cities.data || []).map((c) => ({ value: c.id, label: c.name }))} /></Field>
        <Field label="About you" className="span-2" help="Shown on your public seller profile."><Textarea rows={3} value={f.bio} maxLength={400} onChange={(e) => setF({ ...f, bio: e.target.value })} /></Field>
      </div>
      <div className="row mt-5"><Button loading={busy} onClick={() => save()}>Save changes</Button><Button variant="ghost" to={`/u/${u.id}`} icon={I.External}>View public profile</Button></div>
      <hr className="divider" style={{ margin: '28px 0' }} />
      <h3 className="mb-3">Contact details</h3>
      <div className="form-grid">
        <Field label={<span className="row" style={{ '--gap': '6px' }}>Email {u.email && (u.email_verified ? <Badge tone="success" icon={I.Check}>Verified</Badge> : <Badge tone="warn">Unverified</Badge>)}</span>}>
          <div className="row nowrap"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /><Button variant="secondary" disabled={email === u.email} onClick={async () => { try { await api.post('/me/email', { email }); await api.post('/auth/resend-verification'); await app.refreshMe(); toast.success('Email updated. Check your inbox to verify it.'); } catch (e) { toast.error(e.message); } }}>Update</Button></div>
          {u.email && !u.email_verified && <button className="link small mt-1" onClick={async () => { try { await api.post('/auth/resend-verification'); toast.success('Verification email sent.'); } catch (e) { toast.error(e.message); } }}>Resend verification email</button>}
        </Field>
        <PhoneLink />
      </div>
    </div>
  );
}
function PhoneLink() {
  const app = useApp();
  const u = app.user;
  const [country, setCountry] = useState(u.country_code);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState('idle');
  const send = async () => { try { await api.post('/auth/otp/request', { phone, country }); setStage('code'); toast.success('Code sent'); } catch (e) { toast.error(e.message); } };
  const verify = async () => { try { await api.post('/auth/otp/verify', { phone, country, code }); await app.refreshMe(); setStage('idle'); toast.success('Phone number verified'); } catch (e) { toast.error(e.message); } };
  return (
    <Field label={<span className="row" style={{ '--gap': '6px' }}>Mobile {u.phone && <Badge tone="success" icon={I.Check}>Verified</Badge>}</span>} help={stage === 'idle' ? (u.phone ? 'Shared with the other party only after an order is accepted.' : 'Add a +91 or +977 number to sign in with OTP.') : window.__PASAL__?.devTools ? 'Dev mode: read the code at /dev/mailbox' : undefined}>
      {stage === 'idle' ? (
        <div className="row nowrap"><Input value={u.phone || 'Not added'} readOnly /><Button variant="secondary" onClick={() => setStage('phone')}>{u.phone ? 'Change' : 'Add'}</Button></div>
      ) : stage === 'phone' ? (
        <div className="row nowrap"><Select style={{ width: 110 }} value={country} onChange={(e) => setCountry(e.target.value)} options={[{ value: 'IN', label: '+91' }, { value: 'NP', label: '+977' }]} /><Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Mobile number" /><Button onClick={send}>Send code</Button></div>
      ) : (
        <div className="row nowrap"><Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="6-digit code" /><Button onClick={verify} disabled={code.length !== 6}>Verify</Button></div>
      )}
    </Field>
  );
}

function Addresses() {
  const { data, reload } = useApi('/me/addresses');
  const [edit, setEdit] = useState(null);
  return (
    <>
      <div className="spread mb-4"><p className="muted">Saved delivery addresses for faster checkout.</p><Button icon={I.Plus} onClick={() => setEdit({})}>Add address</Button></div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {(data || []).map((a) => (
          <div key={a.id} className="card card-pad stack" style={{ '--gap': '6px' }}>
            <div className="spread"><b className="row" style={{ '--gap': '6px' }}><I.MapPin size={16} />{a.label}</b>{a.is_default ? <Badge tone="accent">Default</Badge> : null}</div>
            <span className="semibold">{a.full_name} · {a.phone}</span>
            <span className="small text-2">{[a.line1, a.line2, a.locality, a.city_name, a.district_name, a.region_name, a.postal_code].filter(Boolean).join(', ')}</span>
            <div className="row mt-2"><Button size="sm" variant="secondary" icon={I.Pencil} onClick={() => setEdit(a)}>Edit</Button><Button size="sm" variant="ghost" icon={I.Trash} onClick={async () => { if (await confirmDialog({ title: 'Delete this address?', confirm: 'Delete', danger: true })) { await api.del(`/me/addresses/${a.id}`); reload(); } }}>Delete</Button></div>
          </div>
        ))}
      </div>
      {data?.length === 0 && <Empty icon={I.MapPin} title="No saved addresses" />}
      <AddressModal value={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />
    </>
  );
}
export function AddressModal({ value, onClose, onSaved }) {
  const app = useApp();
  const [f, setF] = useState({});
  useEffect(() => { if (value) setF({ label: 'Home', full_name: app.user?.name || '', phone: app.user?.phone?.replace(/^\+(91|977)/, '') || '', country_code: app.country, region_id: '', district_id: '', city_id: '', locality: '', line1: '', line2: '', postal_code: '', is_default: false, ...value, phone: (value.phone || app.user?.phone || '').replace(/^\+(91|977)/, '') }); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const regions = useApi(value ? `/locations?country=${f.country_code || 'IN'}` : null);
  const districts = useApi(f.region_id ? `/locations?parent=${f.region_id}` : null);
  const cities = useApi(f.district_id ? `/locations?parent=${f.district_id}` : null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try {
      const body = { ...f, region_id: f.region_id ? Number(f.region_id) : null, district_id: f.district_id ? Number(f.district_id) : null, city_id: Number(f.city_id), is_default: !!f.is_default };
      for (const k of ['id', 'user_id', 'created_at', 'city_name', 'district_name', 'region_name']) delete body[k];
      const r = value.id ? await api.put(`/me/addresses/${value.id}`, body) : await api.post('/me/addresses', body);
      toast.success('Address saved'); onSaved(r);
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const IN = f.country_code === 'IN';
  return (
    <Modal open={!!value} onClose={onClose} title={value?.id ? 'Edit address' : 'Add an address'} width={640} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save} disabled={!f.city_id || !f.line1 || !f.full_name || !f.phone}>Save address</Button></>}>
      <div className="form-grid">
        <Field label="Country" className="span-2"><Seg full value={f.country_code} onChange={(v) => setF({ ...f, country_code: v, region_id: '', district_id: '', city_id: '' })} options={[{ value: 'IN', label: '🇮🇳 India' }, { value: 'NP', label: '🇳🇵 Nepal' }]} label="Country" /></Field>
        <Field label="Full name" required><Input value={f.full_name || ''} onChange={set('full_name')} /></Field>
        <Field label="Mobile" required><div className="input-group"><span className="addon">{IN ? '+91' : '+977'}</span><input className="input" inputMode="tel" value={f.phone || ''} onChange={set('phone')} /></div></Field>
        <Field label="House / flat, street" required className="span-2"><Input value={f.line1 || ''} onChange={set('line1')} /></Field>
        <Field label="Landmark (optional)" className="span-2"><Input value={f.line2 || ''} onChange={set('line2')} /></Field>
        <Field label={IN ? 'State' : 'Province'}><Select value={f.region_id || ''} onChange={(e) => setF({ ...f, region_id: e.target.value, district_id: '', city_id: '' })} placeholder="Select" options={(regions.data || []).map((r) => ({ value: r.id, label: r.name }))} /></Field>
        <Field label="District"><Select value={f.district_id || ''} disabled={!f.region_id} onChange={(e) => setF({ ...f, district_id: e.target.value, city_id: '' })} placeholder="Select" options={(districts.data || []).map((r) => ({ value: r.id, label: r.name }))} /></Field>
        <Field label="City" required><Select value={f.city_id || ''} disabled={!f.district_id && !f.city_id} onChange={(e) => { const c = cities.data?.find((x) => x.id === Number(e.target.value)); setF({ ...f, city_id: e.target.value, postal_code: f.postal_code || c?.postal_code || '' }); }} placeholder={f.city_name || 'Select'} options={(cities.data || []).map((r) => ({ value: r.id, label: r.name }))} /></Field>
        <Field label="Locality"><Input value={f.locality || ''} onChange={set('locality')} /></Field>
        <Field label={IN ? 'PIN code' : 'Postal code'}><Input inputMode="numeric" maxLength={IN ? 6 : 5} value={f.postal_code || ''} onChange={(e) => setF({ ...f, postal_code: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="Label"><Seg value={f.label} onChange={(v) => setF({ ...f, label: v })} options={['Home', 'Work', 'Other'].map((x) => ({ value: x, label: x }))} label="Label" /></Field>
        <div className="span-2"><Toggle label="Make this my default address" checked={!!f.is_default} onChange={(v) => setF({ ...f, is_default: v })} /></div>
      </div>
    </Modal>
  );
}

function Security() {
  const app = useApp();
  const sessions = useApi('/auth/sessions');
  const blocks = useApi('/me/blocks');
  const [pw, setPw] = useState({ current: '', password: '' });
  const [del, setDel] = useState(false);
  const change = async () => { try { await api.post('/auth/change-password', pw); toast.success('Password updated. Other devices were signed out.'); setPw({ current: '', password: '' }); sessions.reload(); } catch (e) { toast.error(e.message); } };
  return (
    <div className="stack" style={{ '--gap': '20px' }}>
      <div className="card card-pad-lg">
        <h3 className="mb-4">{app.user.has_password ? 'Change password' : 'Set a password'}</h3>
        <div className="form-grid">
          {app.user.has_password && <Field label="Current password"><Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>}
          <Field label="New password" help="At least 8 characters with a letter and a number."><Input type="password" autoComplete="new-password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} /></Field>
        </div>
        <Button className="mt-4" onClick={change} disabled={pw.password.length < 8}>Update password</Button>
      </div>
      <div className="card">
        <div className="card-head"><h3>Active sessions</h3><Button size="sm" variant="secondary" onClick={async () => { const r = await api.post('/auth/sessions/revoke-others'); toast.success(`Signed out ${r.revoked} other session(s)`); sessions.reload(); }}>Sign out other devices</Button></div>
        <div className="list-rows">{(sessions.data || []).map((s) => (
          <div key={s.id} className="list-row"><span className="ctile-icon" style={{ width: 40, height: 40 }}><I.Monitor size={18} /></span><div className="grow" style={{ minWidth: 0 }}><b className="ellipsis small" style={{ display: 'block' }}>{s.user_agent?.match(/(Chrome|Firefox|Safari|Edg)[^ ]*/)?.[0] || 'Browser'} · {s.ip}</b><span className="tiny muted">Signed in {date(s.created_at)} · active {ago(s.last_used_at)}</span></div>{s.current ? <Badge tone="success">This device</Badge> : <Button size="sm" variant="ghost" onClick={async () => { await api.del(`/auth/sessions/${s.id}`); sessions.reload(); }}>Sign out</Button>}</div>
        ))}</div>
      </div>
      <div className="card">
        <div className="card-head"><h3>Blocked users</h3></div>
        {blocks.data?.length ? <div className="list-rows">{blocks.data.map((b) => <div key={b.id} className="list-row"><Avatar name={b.name} src={b.avatar_url} size={36} /><b className="grow">{b.name}</b><Button size="sm" variant="secondary" onClick={async () => { await api.del(`/users/${b.id}/block`); blocks.reload(); }}>Unblock</Button></div>)}</div> : <div className="card-body small muted">You haven’t blocked anyone.</div>}
      </div>
      <div className="card card-pad-lg" style={{ borderColor: 'var(--danger-soft)' }}>
        <h3 style={{ color: 'var(--danger-text)' }}>Delete account</h3>
        <p className="small muted mt-2 mb-4">Permanently removes your profile, listings and personal data. Order records are kept anonymised as required by law.</p>
        <Button variant="danger-soft" icon={I.Trash} onClick={() => setDel(true)}>Delete my account</Button>
      </div>
      <DeleteAccount open={del} onClose={() => setDel(false)} />
    </div>
  );
}
function DeleteAccount({ open, onClose }) {
  const app = useApp();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const go = async () => { try { await api.post('/auth/delete-account', { password: pw || undefined, confirm }); toast.success('Your account has been deleted.'); await app.refreshMe(); navigate('/'); } catch (e) { toast.error(e.message); } };
  return (
    <Modal open={open} onClose={onClose} title="Delete your account?" subtitle="This cannot be undone." footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" disabled={confirm !== 'DELETE'} onClick={go}>Delete forever</Button></>}>
      <div className="stack">
        {app.user?.has_password && <Field label="Password"><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>}
        <Field label="Type DELETE to confirm"><Input value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function NotificationPrefs() {
  const { data, mutate } = useApi('/me/notification-preferences');
  if (!data) return <Skel h={300} r={20} />;
  const save = async (prefs) => { mutate({ ...data, prefs }); try { await api.put('/me/notification-preferences', prefs); toast.success('Preferences saved'); } catch (e) { toast.error(e.message); } };
  const set = (k, ch, v) => save({ ...data.prefs, [k]: { ...data.prefs[k], [ch]: v } });
  return (
    <div className="table-wrap">
      <table className="table"><thead><tr><th>Notify me about</th><th>In-app</th><th>Email</th><th>Push</th></tr></thead>
        <tbody>{Object.entries(data.types).map(([k, label]) => <tr key={k}><td className="semibold">{label}</td>{['inapp', 'email', 'push'].map((ch) => <td key={ch}><Toggle checked={data.prefs[k][ch]} onChange={(v) => set(k, ch, v)} aria-label={`${label} ${ch}`} disabled={k === 'system' && ch === 'inapp'} /></td>)}</tr>)}</tbody>
      </table>
      <p className="small muted" style={{ padding: '12px 16px' }}>Push notifications are delivered when PASAL is installed as an app on supported devices. Account &amp; security alerts are always shown in-app.</p>
    </div>
  );
}

function Verification() {
  const app = useApp();
  const v = useApi('/me/verification');
  const [f, setF] = useState({ doc_type: app.user.country_code === 'NP' ? 'citizenship' : 'aadhaar', doc_number: '', full_name: app.user.name });
  const submit = async () => { try { await api.post('/me/verification', f); toast.success('Submitted! We’ll review it shortly.'); await app.refreshMe(); v.reload(); } catch (e) { toast.error(e.message); } };
  const st = app.user.seller_status;
  return (
    <div className="card card-pad-lg">
      <div className="row mb-4" style={{ '--gap': '14px' }}><span className="ctile-icon"><I.BadgeCheck size={26} /></span><div><h3>Seller verification</h3><p className="small muted">Verified sellers get a badge on every listing and rank higher in search.</p></div></div>
      {st === 'verified' && <div className="callout success"><I.BadgeCheck size={18} />You’re a verified seller.</div>}
      {st === 'pending' && <div className="callout info"><I.Clock size={18} />Your documents are under review (submitted {ago(v.data?.created_at)}).</div>}
      {(st === 'none' || st === 'rejected') && (
        <>
          {st === 'rejected' && <div className="callout danger mb-4"><I.Alert size={18} />Previous request was not approved: {v.data?.notes}</div>}
          <div className="form-grid">
            <Field label="Document type"><Select value={f.doc_type} onChange={(e) => setF({ ...f, doc_type: e.target.value })} options={[{ value: 'aadhaar', label: 'Aadhaar (India)' }, { value: 'pan', label: 'PAN card (India)' }, { value: 'voter_id', label: 'Voter ID' }, { value: 'driving_licence', label: 'Driving licence' }, { value: 'passport', label: 'Passport' }, { value: 'citizenship', label: 'Citizenship certificate (Nepal)' }]} /></Field>
            <Field label="Document number" help="We only keep the last 4 characters."><Input value={f.doc_number} onChange={(e) => setF({ ...f, doc_number: e.target.value })} autoComplete="off" /></Field>
            <Field label="Name on document" className="span-2"><Input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
          </div>
          <Button className="mt-4" icon={I.ShieldCheck} onClick={submit} disabled={f.doc_number.length < 6}>Submit for verification</Button>
        </>
      )}
    </div>
  );
}

function Settings({ tab }) {
  useTitle('Settings');
  const t = tab || 'profile';
  return (
    <>
      <PageHead title="Account settings" />
      <Tabs value={t} onChange={(v) => navigate(v === 'profile' ? '/settings' : `/settings/${v}`, { replace: true })} tabs={[
        { value: 'profile', label: 'Profile', icon: I.User }, { value: 'addresses', label: 'Addresses', icon: I.MapPin }, { value: 'security', label: 'Security', icon: I.Lock },
        { value: 'notifications', label: 'Notifications', icon: I.Bell }, { value: 'verification', label: 'Seller verification', icon: I.BadgeCheck },
      ]} />
      <div className="mt-5" key={t} style={{ animation: 'fadeUp .3s var(--ease)' }}>
        {t === 'profile' && <Profile />}
        {t === 'addresses' && <Addresses />}
        {t === 'security' && <Security />}
        {t === 'notifications' && <NotificationPrefs />}
        {t === 'verification' && <Verification />}
      </div>
    </>
  );
}

export default function Account({ params }) {
  const user = useRequireAuth();
  const { pathname } = useLocation();
  if (!user) return <PageLoader />;
  const page = {
    '/dashboard': <Overview />, '/wishlist': <Wishlist />, '/saved-searches': <SavedSearches />, '/notifications': <Notifications />,
    '/reviews': <Reviews />, '/recently-viewed': <RecentlyViewed />, '/offers': <Offers />,
  }[pathname] || (pathname.startsWith('/settings') ? <Settings tab={params.tab} /> : null);
  return <DashLayout>{page}</DashLayout>;
}
