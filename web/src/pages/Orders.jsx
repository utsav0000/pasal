import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, navigate, useApi, useApp, useLocation, useRequireAuth, useTitle, api, toast, invalidate } from '../lib/core.jsx';
import { money, date, dateTime, ago, ORDER_TONE, ORDER_LABEL, PAY_METHOD, CONDITIONS } from '../lib/format.js';
import { qrSvg } from '../lib/qr.js';
import { Button, Field, Input, Textarea, Select, Badge, Status, Empty, PageLoader, ErrorState, Modal, Avatar, Verified, Seg, SuccessBurst, Confetti, Logo, confirmDialog, Spinner } from '../components/ui.jsx';
import { DashLayout, PageHead } from '../components/dash.jsx';
import { OrderTable } from './Seller.jsx';
import { ReviewModal, AddressModal } from './Account.jsx';
import * as I from '../components/icons.jsx';

// ================= Orders list =================
function OrdersList() {
  useTitle('My orders');
  const [status, setStatus] = useState('all');
  const { data, loading } = useApi(`/orders?role=buying&status=${status}`);
  return (
    <DashLayout>
      <PageHead title="My orders" subtitle="Track deliveries, pickups and payments." actions={<Seg value={status} onChange={setStatus} options={[{ value: 'all', label: 'All' }, { value: 'open', label: 'Open' }, { value: 'completed', label: 'Completed' }, { value: 'closed', label: 'Cancelled' }]} label="Filter" />} />
      <OrderTable rows={data} loading={loading} role="buying" />
    </DashLayout>
  );
}

// ================= Payments (client side of each provider) =================
async function startPayment(order, provider) {
  const r = await api.post(`/orders/${order.id}/pay`, { provider });
  const co = r.checkout;
  if (co.kind === 'sandbox') { navigate(co.url); return; }
  if (co.kind === 'form') {
    const form = document.createElement('form');
    form.method = 'POST'; form.action = co.action;
    for (const [k, v] of Object.entries(co.fields)) { const i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = v; form.appendChild(i); }
    document.body.appendChild(form); form.submit(); return;
  }
  if (co.kind === 'razorpay') {
    await new Promise((res, rej) => { if (window.Razorpay) return res(); const s = document.createElement('script'); s.src = co.script; s.onload = res; s.onerror = () => rej(new Error('Could not load Razorpay.')); document.head.appendChild(s); });
    await new Promise((resolve, reject) => {
      const rz = new window.Razorpay({
        ...co.options,
        theme: { color: '#6A4DFF' },
        handler: async (resp) => { try { await api.post('/payments/callback/razorpay', { pid: r.payment_id, ...resp }); resolve(); } catch (e) { reject(e); } },
        modal: { ondismiss: () => { api.post(`/payments/${r.payment_id}/failed`, { reason: 'Checkout closed' }).catch(() => {}); reject(new Error('Payment cancelled.')); } },
      });
      rz.open();
    });
    toast.success('Payment verified!');
  }
}

// ================= Checkout =================
const Section = ({ n, title, children }) => <section className="card card-pad-lg"><h3 className="row mb-4" style={{ '--gap': '10px' }}><span className="step" style={{ padding: 0 }}><span className="n" style={{ background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }}>{n}</span></span>{title}</h3>{children}</section>;
function Checkout({ id }) {
  useTitle('Checkout');
  const app = useApp();
  const { query } = useLocation();
  const { data, error, loading, reload } = useApi(`/checkout/${id}${query.offer ? `?offer=${query.offer}` : ''}`);
  const [fulfillment, setFulfillment] = useState(null);
  const [address, setAddress] = useState(null);
  const [method, setMethod] = useState(null);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const key = useMemo(() => `ck_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`, []);
  useEffect(() => {
    if (!data) return;
    setFulfillment((f) => f || data.fulfillment_options[0]);
    setAddress((a) => a || data.addresses.find((x) => x.is_default)?.id || data.addresses[0]?.id || null);
  }, [data]);
  const methods = data && fulfillment ? data.payment_methods[fulfillment] : [];
  useEffect(() => { if (methods.length && !methods.some((m) => m.id === method)) setMethod(methods[0].id); }, [fulfillment, data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading && !data) return <PageLoader />;
  if (error) return <div className="container page"><ErrorState error={error} retry={reload} /></div>;
  const l = data.listing;
  const unit = data.offer ? data.offer.amount_minor : l.price_minor;
  const q = data.offer ? 1 : qty;
  const subtotal = unit * q;
  const deliveryFee = fulfillment === 'delivery' ? data.delivery?.fee_minor || 0 : 0;
  const fee = method === 'online' ? Math.round((subtotal * (data.platform_fee_bps || 0)) / 10000) : 0;
  const total = subtotal + deliveryFee + fee;
  const deliverable = fulfillment !== 'delivery' || (address && data.deliverability[address]?.ok);
  const place = async () => {
    if (!app.user.email_verified && !app.user.phone_verified) { toast.error('Verify your email or phone before ordering.'); navigate('/settings'); return; }
    setBusy(true);
    try {
      const o = await api.post('/orders', { listing_id: l.id, offer_id: data.offer?.id, quantity: q, fulfillment, address_id: fulfillment === 'delivery' ? address : null, payment_method: method, note: note || undefined, idempotency_key: key });
      invalidate('/api/v1/orders'); invalidate('/orders');
      toast.success('Order placed! The seller will confirm shortly.');
      navigate(`/orders/${o.id}?placed=1`, { replace: true });
    } catch (e) { toast.error(e.message); setBusy(false); }
  };
  return (
    <div className="container page">
      <PageHead title="Checkout" subtitle="Review your order. Nothing is charged until the seller confirms." />
      <div className="order-grid">
        <div className="stack" style={{ '--gap': '18px' }}>
          <Section n={1} title="Your item">
            <div className="row nowrap" style={{ '--gap': '16px' }}>
              <img className="thumb-md" src={l.image} alt="" style={{ width: 96, height: 96 }} />
              <div className="grow"><Link to={`/l/${l.slug}`} className="semibold">{l.title}</Link><div className="small muted mt-1">{CONDITIONS[l.condition]} · {l.city}</div>
                <div className="row mt-2">{data.offer ? <Badge tone="success" icon={I.Handshake}>Accepted offer {money(data.offer.amount_minor, l.currency)}</Badge> : <b>{money(l.price_minor, l.currency)}</b>}</div></div>
              {!data.offer && l.quantity > 1 && <Field label="Qty"><Select value={qty} onChange={(e) => setQty(Number(e.target.value))} options={Array.from({ length: Math.min(10, l.quantity) }, (_, i) => ({ value: i + 1, label: String(i + 1) }))} style={{ width: 80 }} /></Field>}
            </div>
            <div className="row mt-4 small" style={{ '--gap': '10px' }}><Avatar name={data.seller.name} src={data.seller.avatar_url} size={28} /><span>Sold by <b>{data.seller.name}</b></span>{data.seller.verified && <Verified size={15} />}</div>
          </Section>
          <Section n={2} title="Delivery or pickup">
            <div className="option-grid">
              {data.fulfillment_options.includes('pickup') && <button className="option" aria-pressed={fulfillment === 'pickup'} onClick={() => setFulfillment('pickup')}><span className="option-icon"><I.Store size={20} /></span><span><span className="t">Self pickup · Free</span><span className="d" style={{ display: 'block' }}>{data.pickup?.address}{data.pickup?.times ? ` · ${data.pickup.times}` : ''}</span></span></button>}
              {data.fulfillment_options.includes('delivery') && <button className="option" aria-pressed={fulfillment === 'delivery'} onClick={() => setFulfillment('delivery')}><span className="option-icon"><I.Truck size={20} /></span><span><span className="t">Home delivery · {data.delivery?.fee_minor ? money(data.delivery.fee_minor, l.currency) : 'Free'}</span><span className="d" style={{ display: 'block' }}>Arrives in {data.delivery?.eta_min_days}–{data.delivery?.eta_max_days} days</span></span></button>}
            </div>
            {fulfillment === 'delivery' && (
              <div className="mt-5">
                <div className="spread mb-3"><b>Deliver to</b><Button size="sm" variant="ghost" icon={I.Plus} onClick={() => setAddOpen(true)}>New address</Button></div>
                {data.addresses.length ? <div className="stack" style={{ '--gap': '10px' }}>{data.addresses.map((a) => {
                  const ok = data.deliverability[a.id];
                  return (
                    <button key={a.id} className="option" aria-pressed={address === a.id} onClick={() => setAddress(a.id)} style={!ok?.ok ? { opacity: 0.75 } : undefined}>
                      <span className="option-icon"><I.MapPin size={18} /></span>
                      <span className="grow"><span className="t">{a.label} · {a.full_name}</span><span className="d" style={{ display: 'block' }}>{[a.line1, a.locality, a.city_name, a.postal_code].filter(Boolean).join(', ')} · {a.phone}</span>{!ok?.ok && <span className="error-text" style={{ display: 'block', marginTop: 4 }}>{ok?.reason}</span>}</span>
                    </button>
                  );
                })}</div> : <div className="callout"><I.MapPin size={18} />Add a delivery address to continue.</div>}
              </div>
            )}
            {fulfillment === 'pickup' && <div className="callout info mt-4"><I.Qr size={18} /><span>After the seller accepts, you’ll get a secure pickup code and QR. Share it only after inspecting the item.</span></div>}
          </Section>
          <Section n={3} title="Payment">
            <div className="stack" style={{ '--gap': '10px' }}>
              {methods.map((m) => (
                <button key={m.id} className="option" aria-pressed={method === m.id} onClick={() => setMethod(m.id)}>
                  <span className="option-icon">{m.id === 'online' ? <I.Card size={19} /> : m.id === 'direct' ? <I.Handshake size={19} /> : <I.Cash size={19} />}</span>
                  <span className="grow"><span className="t row" style={{ '--gap': '8px' }}>{m.label}{m.verified ? <Badge tone="success" icon={I.ShieldCheck}>Protected</Badge> : <Badge>Not verified by PASAL</Badge>}</span>
                    <span className="d" style={{ display: 'block' }}>{m.id === 'online' ? `${m.providers.map((p) => p.label + (p.mode === 'test' ? ' — test mode' : '')).join(' · ')}. You’ll pay after the seller confirms.` : m.id === 'direct' ? 'You and the seller agree on how to pay (UPI, bank transfer…). PASAL cannot verify or refund it.' : 'Pay the seller in cash when you receive the item. Inspect before paying.'}</span></span>
                </button>
              ))}
              {!methods.some((m) => m.id === 'online') && <p className="small muted">Online payment isn’t available for this listing’s country right now.</p>}
            </div>
            <Field label="Note for the seller (optional)" className="mt-4"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. Please call before delivery" /></Field>
          </Section>
        </div>
        <aside className="lp-side">
          <div className="card card-pad-lg">
            <h3 className="mb-4">Price breakdown</h3>
            <div className="breakdown">
              <div className="spread"><span>Item{q > 1 ? ` × ${q}` : ''}</span><b>{money(subtotal, l.currency)}</b></div>
              {data.offer && <div className="spread small muted"><span>Listed at {money(l.price_minor, l.currency)}</span><span style={{ color: 'var(--success-text)' }}>−{money(l.price_minor - data.offer.amount_minor, l.currency)}</span></div>}
              <div className="spread"><span>{fulfillment === 'delivery' ? 'Delivery' : 'Pickup'}</span><b>{deliveryFee ? money(deliveryFee, l.currency) : 'Free'}</b></div>
              {fee > 0 && <div className="spread"><span>Platform fee</span><b>{money(fee, l.currency)}</b></div>}
              <div className="spread total"><span className="semibold">Total</span><b style={{ fontSize: 22 }}>{money(total, l.currency)}</b></div>
            </div>
            <Button block size="lg" variant="gradient" className="mt-5" icon={I.Lock} loading={busy} disabled={!fulfillment || !method || !deliverable || (fulfillment === 'delivery' && !address)} onClick={place}>Place order</Button>
            <p className="tiny muted mt-3 center">By placing this order you agree to the <Link to="/terms" className="link">Terms</Link>. Prices are in {l.currency === 'INR' ? 'Indian Rupees (₹)' : 'Nepalese Rupees (रू)'}.</p>
          </div>
          <div className="callout"><I.ShieldCheck size={18} style={{ color: 'var(--accent-text)' }} /><span className="small">Order statuses are enforced by PASAL. Online payments are verified server-side before the seller ships.</span></div>
        </aside>
      </div>
      <AddressModal value={addOpen ? { country_code: l.country_code } : null} onClose={() => setAddOpen(false)} onSaved={(a) => { setAddOpen(false); setAddress(a.id); reload(); }} />
    </div>
  );
}

// ================= Order detail =================
const STEP_ICON = { pending_seller_confirmation: I.Clock, accepted: I.Check, awaiting_payment: I.Wallet, payment_confirmed: I.ShieldCheck, ready_for_dispatch: I.Package, shipped: I.Truck, out_for_delivery: I.Navigation, ready_for_pickup: I.Qr, completed: I.CheckCircle };

function Timeline({ o }) {
  const done = new Set(o.history.map((h) => h.to_status));
  const steps = o.timeline;
  const idx = steps.indexOf(o.status);
  const off = ['cancelled', 'rejected', 'refunded', 'disputed'].includes(o.status);
  return (
    <div className="timeline">
      {steps.map((s, i) => {
        const h = [...o.history].reverse().find((x) => x.to_status === s);
        const state = s === o.status ? (s === 'completed' ? 'done' : 'current') : done.has(s) || (!off && i < idx) ? 'done' : 'pending';
        const Ic = STEP_ICON[s] || I.Check;
        return (
          <div key={s} className={`tl ${state}`}>
            <span className="d">{state === 'done' ? <I.Check size={14} /> : <Ic size={14} />}</span>
            <div><b>{ORDER_LABEL[s]}</b><span>{h ? dateTime(h.created_at) : state === 'current' ? 'In progress' : ''}{s === 'shipped' && o.tracking_number ? ` · ${o.carrier || ''} ${o.tracking_number}` : ''}{s === 'out_for_delivery' && o.eta_date && state !== 'done' ? ` · ETA ${date(o.eta_date)}` : ''}</span></div>
          </div>
        );
      })}
      {off && <div className="tl current"><span className="d" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}><I.XCircle size={14} /></span><div><b>{ORDER_LABEL[o.status]}</b><span>{dateTime(o.history[o.history.length - 1]?.created_at)}{o.history[o.history.length - 1]?.note ? ` · ${o.history[o.history.length - 1].note}` : ''}</span></div></div>}
    </div>
  );
}

function Scanner({ onCode, onClose }) {
  const video = useRef(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let stream, raf, live = true;
    (async () => {
      if (!('BarcodeDetector' in window)) { setErr('QR scanning isn’t supported in this browser. Enter the code instead.'); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.current.srcObject = stream; await video.current.play();
        const det = new window.BarcodeDetector({ formats: ['qr_code'] });
        const tick = async () => { if (!live) return; try { const r = await det.detect(video.current); if (r[0]) { onCode(r[0].rawValue); return; } } catch { /* frame not ready */ } raf = requestAnimationFrame(tick); };
        tick();
      } catch { setErr('Camera access was blocked. Enter the code instead.'); }
    })();
    return () => { live = false; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, [onCode]);
  return <Modal open onClose={onClose} title="Scan the buyer’s pickup QR" width={420}>{err ? <div className="callout warn"><I.Alert size={18} />{err}</div> : <video ref={video} className="scan-video" muted playsInline />}</Modal>;
}

function ActionModal({ action, order, onClose, onDone }) {
  const [f, setF] = useState({ note: '', reason: '', carrier: '', tracking_number: '', eta_date: '', pickup_code: '' });
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState(false);
  useEffect(() => setF({ note: '', reason: '', carrier: '', tracking_number: '', eta_date: order.eta_date || '', pickup_code: '' }), [action]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!action) return null;
  const meta = {
    shipped: ['Mark as shipped', 'Add tracking so the buyer can follow the parcel.'],
    completed: order.fulfillment === 'pickup' && order.role === 'seller' ? ['Complete handover', 'Ask the buyer for their PASAL pickup code or scan their QR.'] : ['Confirm you received it', 'Only confirm once you have the item and it matches the listing.'],
    cancelled: ['Cancel order', 'Let the other party know why.'],
    rejected: ['Decline order', 'The buyer will be notified.'],
    disputed: ['Report a problem', 'PASAL support will review the order and contact both of you.'],
  }[action] || [ORDER_LABEL[action], ''];
  const submit = async () => {
    setBusy(true);
    try { const o = await api.post(`/orders/${order.id}/transition`, { to: action, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) }); onDone(o); onClose(); toast.success(action === 'completed' ? 'Order completed 🎉' : `Order updated: ${ORDER_LABEL[o.status]}`); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={meta[0]} subtitle={meta[1]} footer={<><Button variant="secondary" onClick={onClose}>Back</Button><Button variant={['cancelled', 'rejected', 'disputed'].includes(action) ? 'danger' : 'primary'} loading={busy} onClick={submit} disabled={(action === 'disputed' && !f.reason) || (action === 'completed' && order.fulfillment === 'pickup' && order.role === 'seller' && !f.pickup_code)}>Confirm</Button></>}>
      <div className="stack" style={{ '--gap': '14px' }}>
        {action === 'shipped' && <div className="form-grid"><Field label="Carrier"><Input value={f.carrier} onChange={(e) => setF({ ...f, carrier: e.target.value })} placeholder="e.g. Delhivery, Nepal Can Move, self" /></Field><Field label="Tracking number"><Input value={f.tracking_number} onChange={(e) => setF({ ...f, tracking_number: e.target.value })} /></Field><Field label="Expected delivery"><Input type="date" value={f.eta_date} onChange={(e) => setF({ ...f, eta_date: e.target.value })} /></Field></div>}
        {action === 'completed' && order.fulfillment === 'pickup' && order.role === 'seller' && (
          <><Field label="Pickup code"><div className="row nowrap"><Input className="mono" value={f.pickup_code} onChange={(e) => setF({ ...f, pickup_code: e.target.value.toUpperCase() })} placeholder="6-character code" maxLength={60} style={{ fontSize: 20, letterSpacing: '.2em' }} /><Button variant="secondary" icon={I.Scan} onClick={() => setScan(true)}>Scan</Button></div></Field>
            {scan && <Scanner onCode={(c) => { setF((x) => ({ ...x, pickup_code: c })); setScan(false); toast.success('QR scanned'); }} onClose={() => setScan(false)} />}</>
        )}
        {action === 'disputed' && <Field label="What went wrong?" required><Select value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Choose a reason" options={['Item not received', 'Item not as described', 'Item damaged', 'Seller/buyer not responding', 'Payment issue', 'Other']} /></Field>}
        {['cancelled', 'rejected', 'disputed', 'ready_for_pickup'].includes(action) && <Field label={action === 'disputed' ? 'Details' : 'Note (optional)'}><Textarea rows={3} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={2000} /></Field>}
      </div>
    </Modal>
  );
}

function OrderDetail({ id }) {
  const app = useApp();
  const { query } = useLocation();
  const { data: o, error, loading, mutate, reload } = useApi(`/orders/${id}`);
  const [action, setAction] = useState(null);
  const [review, setReview] = useState(false);
  const [paying, setPaying] = useState(null);
  useTitle(o ? `Order ${o.number}` : 'Order');
  useEffect(() => app.on('order', (d) => { if (d.id === Number(id)) reload(); }), [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (query.payment === 'success') { toast.success('Payment verified! The seller has been notified.'); setTimeout(reload, 1200); } if (query.payment === 'failed') toast.error('Payment was not completed. You can try again.'); }, [query.payment]); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading && !o) return <PageLoader />;
  if (error) return <div className="container page"><ErrorState error={error} retry={reload} /></div>;
  const it = o.items[0];
  const other = o.role === 'buyer' ? o.seller : o.buyer;
  const pay = async (p) => { setPaying(p); try { await startPayment(o, p); reload(); } catch (e) { toast.error(e.message); } finally { setPaying(null); } };
  const doAction = async (a) => {
    if (['accepted', 'ready_for_dispatch', 'out_for_delivery', 'ready_for_pickup'].includes(a)) {
      try { const r = await api.post(`/orders/${o.id}/transition`, { to: a }); mutate(r); toast.success(`Order updated: ${ORDER_LABEL[r.status]}`); } catch (e) { toast.error(e.message); }
    } else setAction(a);
  };
  const BTN = { accepted: ['Accept order', I.Check, 'success'], rejected: ['Decline', I.X, 'ghost'], ready_for_dispatch: ['Ready for dispatch', I.Package, 'primary'], shipped: ['Mark shipped', I.Truck, 'primary'], out_for_delivery: ['Out for delivery', I.Navigation, 'primary'], ready_for_pickup: ['Ready for pickup', I.Qr, 'primary'], completed: [o.role === 'buyer' ? 'I received it' : o.fulfillment === 'pickup' ? 'Complete handover' : 'Mark delivered', I.CheckCircle, 'success'], cancelled: ['Cancel order', I.Ban, 'ghost'] };
  const actions = o.actions.filter((a) => a !== 'disputed' && BTN[a]);
  return (
    <DashLayout>
      <Confetti run={query.placed === '1'} />
      <div className="breadcrumb"><Link to={o.role === 'seller' ? '/seller/orders' : '/orders'}>{o.role === 'seller' ? 'Sales' : 'My orders'}</Link><I.ChevronRight size={13} /><span>{o.number}</span></div>
      <PageHead title={<span className="row" style={{ '--gap': '12px' }}>Order {o.number}<Status tone={ORDER_TONE[o.status]}>{o.status_label}</Status></span>} subtitle={`Placed ${dateTime(o.created_at)} · ${o.fulfillment === 'pickup' ? 'Self pickup' : 'Home delivery'} · ${PAY_METHOD[o.payment_method]}`}
        actions={o.conversation_id && <Button variant="secondary" icon={I.Chat} to={`/messages/${o.conversation_id}`}>Chat with {o.role === 'buyer' ? 'seller' : 'buyer'}</Button>} />
      {query.placed === '1' && o.status === 'pending_seller_confirmation' && <div className="callout success mb-4"><I.CheckCircle size={18} /><span>Order placed! {o.seller.name} has been notified and will confirm availability. {o.payment_method === 'online' ? 'You’ll be asked to pay once they accept.' : ''}</span></div>}
      {o.can_pay && (
        <div className="card card-pad-lg mb-4" style={{ borderColor: 'var(--accent)', boxShadow: '0 0 0 4px color-mix(in srgb, var(--accent) 10%, transparent)' }}>
          <div className="spread"><div><h3>Complete your payment</h3><p className="small muted mt-1">The seller accepted. Pay {money(o.total_minor, o.currency)} to confirm — unpaid orders are cancelled after 48 hours.</p></div><b style={{ fontSize: 24 }}>{money(o.total_minor, o.currency)}</b></div>
          <div className="row mt-4">{o.providers.map((p) => <Button key={p.id} variant={p.id === 'sandbox' ? 'secondary' : 'gradient'} icon={I.Lock} loading={paying === p.id} onClick={() => pay(p.id)}>{p.label}{p.mode === 'test' && p.id !== 'sandbox' ? ' (test)' : ''}</Button>)}</div>
          {!o.providers.length && <p className="small muted mt-3">No online payment provider is configured. Ask PASAL support.</p>}
        </div>
      )}
      <div className="order-grid">
        <div className="stack" style={{ '--gap': '18px' }}>
          {actions.length > 0 && (
            <div className="card card-pad">
              <div className="spread"><b>{o.role === 'seller' ? 'Next step for you' : 'Actions'}</b><div className="row">{actions.map((a) => { const [label, Ic, v] = BTN[a]; return <Button key={a} size="sm" variant={v} icon={Ic} onClick={() => doAction(a)}>{label}</Button>; })}</div></div>
              {o.role === 'seller' && o.status === 'pending_seller_confirmation' && <p className="small muted mt-2">Accepting reserves the item for this buyer{o.payment_method === 'online' ? ' and asks them to pay online' : ''}.</p>}
            </div>
          )}
          {o.status === 'disputed' && o.dispute && <div className="callout danger"><I.Gavel size={18} /><span><b>Dispute open:</b> {o.dispute.reason}{o.dispute.details ? ` — ${o.dispute.details}` : ''}. PASAL support is reviewing it.</span></div>}
          {o.dispute?.status === 'resolved' && <div className="callout info"><I.Gavel size={18} /><span><b>Dispute resolved:</b> {o.dispute.resolution_note}</span></div>}
          <div className="card card-pad-lg"><h3 className="mb-5">Order progress</h3><Timeline o={o} /></div>
          <div className="card card-pad-lg">
            <h3 className="mb-4">{o.fulfillment === 'pickup' ? 'Pickup details' : 'Delivery details'}</h3>
            {o.fulfillment === 'delivery' && o.address && (
              <div className="info-list">
                <div className="info-row"><span className="ic"><I.MapPin size={18} /></span><div><b>{o.address.full_name} · {o.address.phone}</b><span>{[o.address.line1, o.address.line2, o.address.locality, o.address.city, o.address.postal_code].filter(Boolean).join(', ')}</span></div></div>
                <div className="info-row"><span className="ic"><I.Truck size={18} /></span><div><b>{o.carrier ? `${o.carrier}${o.tracking_number ? ` · ${o.tracking_number}` : ''}` : 'Shipping method set by seller'}</b><span>{o.eta_date ? `Estimated arrival ${date(o.eta_date)}` : 'Arrival estimate after dispatch'}</span></div></div>
              </div>
            )}
            {o.fulfillment === 'pickup' && (
              <div className="info-list">
                <div className="info-row"><span className="ic"><I.Store size={18} /></span><div><b>{o.pickup?.address}</b><span>{o.pickup?.times || 'Arrange a time in chat'}{o.pickup?.instructions ? ` · ${o.pickup.instructions}` : ''}</span></div></div>
                {o.role === 'seller' && <div className="info-row"><span className="ic"><I.Qr size={18} /></span><div><b>Secure handover</b><span>At pickup, ask the buyer for their code or scan their QR, then tap “Complete handover”.</span></div></div>}
              </div>
            )}
            {other.phone && <div className="info-row mt-4"><span className="ic"><I.Phone size={18} /></span><div><b>{o.role === 'buyer' ? 'Seller' : 'Buyer'} phone</b><span><a className="link" href={`tel:${other.phone}`}>{other.phone}</a></span></div></div>}
            {o.buyer_note && <div className="callout mt-4 small"><I.MessageText size={16} />Buyer note: {o.buyer_note}</div>}
          </div>
          <div className="card">
            <div className="card-head"><h3>Activity log</h3></div>
            <div className="list-rows">{o.history.map((h) => <div key={h.id} className="list-row small"><span className="grow"><b>{ORDER_LABEL[h.to_status]}</b>{h.note ? <span className="muted"> — {h.note}</span> : null}</span><span className="muted tiny nowrap">{h.actor_name || 'PASAL'} · {dateTime(h.created_at)}</span></div>)}</div>
          </div>
        </div>
        <aside className="lp-side">
          {o.pickup_code && (
            <div className="code-box">
              <span className="small" style={{ color: '#B4B9D6' }}>Your pickup code</span>
              <div className="qr" dangerouslySetInnerHTML={{ __html: qrSvg(o.pickup_qr_payload) }} aria-label="Pickup QR code" />
              <span className="code">{o.pickup_code}</span>
              <span className="tiny" style={{ color: '#B4B9D6', maxWidth: 260 }}>Show this only after you’ve inspected the item. Sharing it confirms the handover.</span>
            </div>
          )}
          <div className="card card-pad">
            <div className="row nowrap" style={{ '--gap': '14px' }}><img className="thumb-md" src={it.image_url} alt="" /><div style={{ minWidth: 0 }}><Link to={`/l/${o.listing.slug}`} className="semibold clamp-2">{it.title}</Link><div className="small muted mt-1">Qty {it.quantity} · {money(it.unit_price_minor, o.currency)}</div></div></div>
            <hr className="divider" />
            <div className="breakdown">
              <div className="spread"><span>Subtotal</span><b>{money(o.subtotal_minor, o.currency)}</b></div>
              <div className="spread"><span>{o.fulfillment === 'delivery' ? 'Delivery' : 'Pickup'}</span><b>{o.delivery_fee_minor ? money(o.delivery_fee_minor, o.currency) : 'Free'}</b></div>
              {o.platform_fee_minor > 0 && <div className="spread"><span>Platform fee</span><b>{money(o.platform_fee_minor, o.currency)}</b></div>}
              <div className="spread total"><span className="semibold">Total</span><b>{money(o.total_minor, o.currency)}</b></div>
            </div>
            <div className="mt-4">{o.payment_verified ? <Badge tone="success" icon={I.ShieldCheck}>Payment verified by PASAL</Badge> : o.payment_method === 'online' ? <Badge tone="warn" icon={I.Clock}>Online payment pending</Badge> : <Badge icon={I.Handshake}>{PAY_METHOD[o.payment_method]} — not verified by PASAL</Badge>}</div>
            {o.refunds.length > 0 && <div className="small mt-3">{o.refunds.map((r) => <div key={r.id} className="spread"><span>Refund ({r.status})</span><b>{money(r.amount_minor, r.currency)}</b></div>)}</div>}
          </div>
          <div className="card card-pad row nowrap" style={{ '--gap': '12px' }}>
            <Avatar name={other.name} src={other.avatar_url} size={42} />
            <div className="grow"><span className="tiny muted">{o.role === 'buyer' ? 'Seller' : 'Buyer'}</span><b className="row" style={{ '--gap': '5px' }}>{other.name}{other.verified && <Verified size={14} />}</b></div>
            <Button size="sm" variant="ghost" icon={I.User} to={`/u/${other.id}`} aria-label="Profile" />
          </div>
          {o.can_review && <div className="card card-pad stack"><b>How did it go?</b><p className="small muted">Your review helps others trade with confidence.</p><Button icon={I.Star} onClick={() => setReview(true)}>Write a review</Button></div>}
          {o.my_review && <div className="callout success small"><I.Star size={16} />You rated this {o.my_review.rating}★.</div>}
          {o.can_dispute && <Button variant="ghost" icon={I.Flag} onClick={() => setAction('disputed')}>Report a problem with this order</Button>}
        </aside>
      </div>
      <ActionModal action={action} order={o} onClose={() => setAction(null)} onDone={(r) => mutate(r)} />
      <ReviewModal order={review ? { id: o.id, title: it.title } : null} onClose={() => setReview(false)} onDone={reload} />
    </DashLayout>
  );
}

// ================= Built-in test gateway =================
function TestPay({ refId }) {
  useTitle('Test payment');
  const { data, error, loading } = useApi(`/payments/test/${encodeURIComponent(refId)}`);
  const [busy, setBusy] = useState(null);
  const [done, setDone] = useState(false);
  if (loading) return <PageLoader />;
  if (error) return <div className="container page"><ErrorState error={error} /></div>;
  const go = async (outcome) => {
    setBusy(outcome);
    try {
      const r = await api.post(`/payments/test/${encodeURIComponent(refId)}/complete`, { outcome });
      if (r.failed) { await api.post(`/payments/${data.id}/failed`, { reason: 'Declined in test gateway' }); navigate(`/orders/${data.order_id}?payment=failed`, { replace: true }); return; }
      // Hand the gateway's signed response to PASAL's server for verification — exactly like a real gateway redirect.
      await api.post('/payments/callback/sandbox', { pid: r.pid, order_id: r.order_id, payment_id: r.payment_id, signature: r.signature });
      setDone(true);
      setTimeout(() => navigate(`/orders/${data.order_id}?payment=success`, { replace: true }), 1400);
    } catch (e) { toast.error(e.message); setBusy(null); }
  };
  return (
    <div className="container page">
      <div className="card card-pad-lg" style={{ maxWidth: 460, margin: '20px auto' }}>
        <div className="spread mb-5"><Logo height={28} /><Badge tone="warn" icon={I.Info}>Test mode</Badge></div>
        {done ? <div className="stack center" style={{ alignItems: 'center' }}><SuccessBurst /><h2>Payment verified</h2><p className="muted small">Returning to your order…</p></div> : <>
          <p className="small muted">Paying for</p><b>{data.title}</b><p className="small muted mt-1">Order {data.number}</p>
          <div className="price-big mt-4 mb-5">{money(data.amount_minor, data.currency)}</div>
          <div className="callout warn small mb-5"><I.Info size={16} /><span>This is PASAL’s built-in test gateway. No real money moves. The result is signed and verified on the server exactly like Razorpay or eSewa.</span></div>
          <div className="stack"><Button block size="lg" variant="gradient" icon={I.CheckCircle} loading={busy === 'success'} onClick={() => go('success')}>Simulate successful payment</Button><Button block variant="secondary" icon={I.XCircle} loading={busy === 'failure'} onClick={() => go('failure')}>Simulate failed payment</Button></div>
        </>}
      </div>
    </div>
  );
}

export default function Orders({ params }) {
  const user = useRequireAuth();
  const { pathname } = useLocation();
  if (!user) return <PageLoader />;
  if (pathname.startsWith('/checkout/')) return <Checkout id={params.id} />;
  if (pathname.startsWith('/pay/test/')) return <TestPay refId={params.ref} />;
  if (params.id) return <OrderDetail id={params.id} />;
  return <OrdersList />;
}
