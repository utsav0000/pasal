import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, navigate, useApi, useApp, useRequireAuth, useTitle, useIsMobile, api, toast, invalidate } from '../lib/core.jsx';
import { money, CONDITIONS, CONDITION_HELP, majorInput } from '../lib/format.js';
import { Button, Field, Input, Textarea, Select, Toggle, MoneyInput, Badge, PageLoader, SuccessBurst, Confetti, Seg, Verified } from '../components/ui.jsx';
import { ProductCard } from '../components/listing.jsx';
import * as I from '../components/icons.jsx';

const STEPS = [
  ['country', 'Country', I.Globe], ['category', 'Category', I.GridIcon], ['details', 'Product details', I.FileText], ['photos', 'Photos', I.Camera],
  ['pricing', 'Pricing', I.Tag], ['location', 'Location', I.MapPin], ['delivery', 'Delivery & pickup', I.Truck], ['preview', 'Preview', I.Eye],
];

const blank = (country) => ({
  country_code: country, category_id: null, category_slug: null, root_slug: null, title: '', description: '', brand: '', model: '', condition: 'used_good',
  purchase_date: '', warranty: '', reason_for_selling: '', price: '', original_price: '', currency: country === 'NP' ? 'NPR' : 'INR',
  negotiable: true, accept_offers: true, quantity: 1, region_id: '', district_id: '', city_id: '', locality: '', postal_code: '', lat: null, lng: null,
  fulfillment: 'pickup', delivery: { fee: '0', radius_km: 25, supported_locations: [], eta_min_days: 1, eta_max_days: 3, method: 'seller' },
  pickup: { address: '', instructions: '', times: '' }, attributes: {}, images: [],
});

// ---------- Image pipeline: client-side resize/compress, then upload with progress ----------
async function compress(file) {
  if (!/^image\//.test(file.type)) throw new Error(`${file.name} is not an image.`);
  if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name} is larger than 20 MB.`);
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error(`${file.name} could not be read.`);
  const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.86);
}
function upload(dataUrl, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', '/api/v1/media/images');
    x.setRequestHeader('Content-Type', 'application/json');
    x.setRequestHeader('X-Pasal-CSRF', '1');
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 95));
    x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch { /* */ } x.status < 300 ? resolve(j) : reject(new Error(j.error || 'Upload failed')); };
    x.onerror = () => reject(new Error('Network error while uploading.'));
    x.send(JSON.stringify({ data: dataUrl }));
  });
}

function Photos({ f, set }) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState([]);
  const [drag, setDrag] = useState(null);
  const [dropAt, setDropAt] = useState(null);
  const input = useRef(null);
  const add = async (files) => {
    const list = [...files].slice(0, 12 - f.images.length - busy.length);
    if (files.length > list.length) toast.info('You can add up to 12 photos.');
    for (const file of list) {
      const key = `${file.name}-${Math.random()}`;
      setBusy((b) => [...b, { key, p: 2, preview: URL.createObjectURL(file) }]);
      try {
        const data = await compress(file);
        const img = await upload(data, (p) => setBusy((b) => b.map((x) => (x.key === key ? { ...x, p } : x))));
        set((s) => ({ ...s, images: [...s.images, { url: img.url, thumb_url: img.thumbUrl, width: img.width, height: img.height }] }));
      } catch (e) { toast.error(e.message); }
      setBusy((b) => b.filter((x) => x.key !== key));
    }
  };
  const move = (from, to) => set((s) => { const a = [...s.images]; const [x] = a.splice(from, 1); a.splice(to, 0, x); return { ...s, images: a }; });
  return (
    <div>
      <div className={`dropzone ${over ? 'over' : ''}`} role="button" tabIndex={0} onClick={() => input.current.click()} onKeyDown={(e) => e.key === 'Enter' && input.current.click()}
        onDragOver={(e) => { e.preventDefault(); if (drag === null) setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); if (drag === null) add(e.dataTransfer.files); }}>
        <span className="ic"><I.ImagePlus size={26} /></span>
        <b>Drag photos here or click to upload</b>
        <span className="small muted">JPG, PNG, WebP or HEIC · up to 12 photos · we compress and strip location data automatically</span>
        <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
      </div>
      {(f.images.length > 0 || busy.length > 0) && (
        <div className="thumbs">
          {f.images.map((img, i) => (
            <div key={img.url} className={`thumb ${drag === i ? 'dragging' : ''} ${dropAt === i && drag !== i ? 'over' : ''}`} draggable
              onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => { setDrag(null); setDropAt(null); }}
              onDragOver={(e) => { e.preventDefault(); setDropAt(i); }} onDrop={(e) => { e.preventDefault(); if (drag !== null && drag !== i) move(drag, i); setDrag(null); setDropAt(null); }}>
              <img src={img.thumb_url} alt={`Photo ${i + 1}`} />
              {i === 0 && <Badge tone="grad" className="cover-tag">Cover</Badge>}
              <div className="tools">
                {i > 0 && <button type="button" title="Move left" aria-label="Move photo left" onClick={() => move(i, i - 1)}><I.ChevronLeft size={15} /></button>}
                {i > 0 && <button type="button" title="Make cover" aria-label="Make cover photo" onClick={() => move(i, 0)}><I.Star size={14} /></button>}
                <button type="button" title="Remove" aria-label="Remove photo" onClick={() => set((s) => ({ ...s, images: s.images.filter((_, k) => k !== i) }))}><I.Trash size={14} /></button>
              </div>
            </div>
          ))}
          {busy.map((b) => <div key={b.key} className="thumb"><img src={b.preview} alt="" style={{ opacity: 0.6 }} /><div className="prog" style={{ '--p': `${b.p}%` }}>{b.p}%</div></div>)}
        </div>
      )}
      <p className="small muted mt-4"><I.Grip size={13} style={{ display: 'inline', verticalAlign: '-2px' }} /> Drag to reorder. The first photo is the cover buyers see in search.</p>
    </div>
  );
}

function ChipsInput({ value, onChange, placeholder }) {
  const [t, setT] = useState('');
  const add = () => { const v = t.trim(); if (v && !value.includes(v)) onChange([...value, v]); setT(''); };
  return (
    <div className="stack" style={{ '--gap': '8px' }}>
      <div className="row nowrap"><Input value={t} onChange={(e) => setT(e.target.value)} placeholder={placeholder} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} /><Button variant="secondary" onClick={add} icon={I.Plus}>Add</Button></div>
      {value.length > 0 && <div className="chips">{value.map((v) => <button type="button" key={v} className="chip sm" onClick={() => onChange(value.filter((x) => x !== v))}>{v}<I.X size={12} className="x" /></button>)}</div>}
    </div>
  );
}

function Attr({ a, value, onChange }) {
  const label = `${a.label}${a.unit ? ` (${a.unit})` : ''}`;
  if (a.type === 'select') return <Field label={label} required={a.required}><Select value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder="Select" options={a.options} /></Field>;
  if (a.type === 'boolean') return <Field label={label}><Toggle checked={value === 'Yes' || value === true} onChange={(v) => onChange(v ? 'Yes' : 'No')} label={value === 'Yes' || value === true ? 'Yes' : 'No'} /></Field>;
  return <Field label={label} required={a.required}><Input type={a.type === 'number' ? 'number' : 'text'} inputMode={a.type === 'number' ? 'decimal' : undefined} value={value ?? ''} onChange={(e) => onChange(e.target.value)} /></Field>;
}

function LocationStep({ f, set }) {
  const regions = useApi(`/locations?country=${f.country_code}`);
  const districts = useApi(f.region_id ? `/locations?parent=${f.region_id}` : null);
  const cities = useApi(f.district_id ? `/locations?parent=${f.district_id}` : null);
  const localities = useApi(f.city_id ? `/locations?parent=${f.city_id}` : null);
  const [locating, setLocating] = useState(false);
  const IN = f.country_code === 'IN';
  const locate = () => {
    if (!navigator.geolocation) return toast.error('Location is not available in this browser.');
    setLocating(true);
    navigator.geolocation.getCurrentPosition((p) => { set((s) => ({ ...s, lat: +p.coords.latitude.toFixed(5), lng: +p.coords.longitude.toFixed(5) })); setLocating(false); toast.success('Pinned your current location'); }, () => { setLocating(false); toast.error('Could not get your location.'); });
  };
  const city = cities.data?.find((c) => c.id === Number(f.city_id));
  const lat = f.lat ?? city?.lat, lng = f.lng ?? city?.lng;
  return (
    <div className="form-grid">
      <Field label={IN ? 'State / union territory' : 'Province'} required><Select value={f.region_id} onChange={(e) => set((s) => ({ ...s, region_id: e.target.value, district_id: '', city_id: '', locality: '' }))} placeholder="Select" options={(regions.data || []).map((r) => ({ value: r.id, label: r.name }))} /></Field>
      <Field label="District" required><Select value={f.district_id} disabled={!f.region_id} onChange={(e) => set((s) => ({ ...s, district_id: e.target.value, city_id: '', locality: '' }))} placeholder="Select" options={(districts.data || []).map((r) => ({ value: r.id, label: r.name }))} /></Field>
      <Field label={IN ? 'City' : 'City / municipality'} required><Select value={f.city_id} disabled={!f.district_id} onChange={(e) => { const c = cities.data.find((x) => x.id === Number(e.target.value)); set((s) => ({ ...s, city_id: e.target.value, locality: '', postal_code: s.postal_code || c?.postal_code || '', lat: null, lng: null })); }} placeholder="Select" options={(cities.data || []).map((r) => ({ value: r.id, label: r.name }))} /></Field>
      <Field label="Locality / area">
        <Input list="localities" value={f.locality} onChange={(e) => set((s) => ({ ...s, locality: e.target.value }))} placeholder="e.g. Koramangala, Thamel" />
        <datalist id="localities">{(localities.data || []).map((l) => <option key={l.id} value={l.name} />)}</datalist>
      </Field>
      <Field label={IN ? 'PIN code' : 'Postal code'} help={IN ? '6 digits' : '5 digits, where applicable'}><Input inputMode="numeric" maxLength={IN ? 6 : 5} value={f.postal_code} onChange={(e) => set((s) => ({ ...s, postal_code: e.target.value.replace(/\D/g, '') }))} /></Field>
      <Field label="Map location" help="Buyers see an approximate area, never your exact address.">
        <div className="row"><Button variant="secondary" icon={I.Locate} loading={locating} onClick={locate}>Use my current location</Button>{f.lat && <Badge tone="success" icon={I.Check}>Pinned</Badge>}</div>
      </Field>
      {lat && lng && (
        <div className="span-2" style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid var(--border)', height: 220, background: 'var(--surface-2)' }}>
          <iframe title="Map preview" width="100%" height="220" style={{ border: 0, display: 'block' }} loading="lazy"
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.03},${lat - 0.02},${lng + 0.03},${lat + 0.02}&layer=mapnik&marker=${lat},${lng}`} />
        </div>
      )}
    </div>
  );
}

export default function Sell({ params }) {
  const user = useRequireAuth();
  const app = useApp();
  const isMobile = useIsMobile();
  const editing = params?.id;
  useTitle(editing ? 'Edit listing' : 'Sell on PASAL');
  const cats = useApi('/categories');
  const existing = useApi(editing ? `/listings/${editing}/edit` : null);
  const [f, set] = useState(() => blank(app.country));
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [errs, setErrs] = useState({});
  const catDetail = useApi(f.category_slug ? `/categories/${f.category_slug}` : null);
  const attrs = catDetail.data?.attributes || [];
  const root = cats.data?.find((c) => c.slug === f.root_slug);
  const sub = root?.children.find((c) => c.slug === f.category_slug);
  const noDelivery = ['property', 'jobs-services'].includes(f.root_slug);

  useEffect(() => {
    const l = existing.data;
    if (!l) return;
    set({
      ...blank(l.country_code), country_code: l.country_code, category_id: l.category_id, category_slug: l.category[l.category.length - 1].slug, root_slug: l.category[0].slug,
      title: l.title, description: l.description, brand: l.brand || '', model: l.model || '', condition: l.condition, purchase_date: l.purchase_date || '', warranty: l.warranty || '',
      reason_for_selling: l.reason_for_selling || '', price: majorInput(l.price_minor), original_price: majorInput(l.original_price_minor), currency: l.currency,
      negotiable: l.negotiable, accept_offers: l.accept_offers, quantity: l.quantity || 1, region_id: l.region_id || '', district_id: l.district_id || '', city_id: l.city_id || '',
      locality: l.locality || '', postal_code: l.postal_code || '', lat: null, lng: null, fulfillment: l.fulfillment,
      delivery: l.delivery ? { fee: majorInput(l.delivery.fee_minor), radius_km: l.delivery.radius_km, supported_locations: l.delivery.supported_locations, eta_min_days: l.delivery.eta_min_days, eta_max_days: l.delivery.eta_max_days, method: l.delivery.method } : blank().delivery,
      pickup: l.pickup ? { address: l.pickup.address, instructions: l.pickup.instructions || '', times: l.pickup.times || '' } : blank().pickup,
      attributes: l.attribute_values, images: l.images.map((i) => ({ url: i.url, thumb_url: i.thumb_url, width: i.width, height: i.height })),
    });
    setStep(2); setMaxStep(7);
  }, [existing.data]);

  const payload = (publish) => ({
    country_code: f.country_code, category_id: f.category_id, title: f.title, description: f.description, brand: f.brand || null, model: f.model || null,
    condition: f.condition, purchase_date: f.purchase_date || null, warranty: f.warranty || null, reason_for_selling: f.reason_for_selling || null,
    price: f.price || null, original_price: f.original_price || null, currency: f.currency, negotiable: f.negotiable, accept_offers: f.accept_offers, quantity: Number(f.quantity) || 1,
    city_id: f.city_id ? Number(f.city_id) : null, locality: f.locality || null, postal_code: f.postal_code || null, lat: f.lat, lng: f.lng,
    fulfillment: noDelivery ? 'pickup' : f.fulfillment,
    delivery: !noDelivery && f.fulfillment !== 'pickup' ? { ...f.delivery, radius_km: f.delivery.radius_km ? Number(f.delivery.radius_km) : null } : null,
    pickup: noDelivery || f.fulfillment !== 'delivery' ? f.pickup : null,
    attributes: Object.fromEntries(Object.entries(f.attributes).filter(([, v]) => v !== '' && v != null)),
    images: f.images, publish,
  });

  const validate = (i) => {
    const e = {};
    const k = STEPS[i][0];
    if (k === 'category' && !f.category_id) e.category = 'Choose a category and subcategory.';
    if (k === 'details') {
      if (f.title.trim().length < 5) e.title = 'Add a title of at least 5 characters.';
      if (f.description.trim().length < 20) e.description = 'Describe the item in at least 20 characters.';
      for (const a of attrs) if (a.required && !f.attributes[a.key]) e[`attr_${a.key}`] = `${a.label} is required.`;
    }
    if (k === 'photos' && !f.images.length) e.photos = 'Add at least one photo.';
    if (k === 'pricing' && !(Number(f.price) > 0)) e.price = 'Enter a price.';
    if (k === 'location' && !f.city_id) e.city = 'Choose your city.';
    if (k === 'location' && f.postal_code && !(f.country_code === 'IN' ? /^[1-9]\d{5}$/ : /^\d{5}$/).test(f.postal_code)) e.city = f.country_code === 'IN' ? 'PIN code must be 6 digits.' : 'Postal code must be 5 digits.';
    if (k === 'delivery') {
      if ((noDelivery || f.fulfillment !== 'delivery') && f.pickup.address.trim().length < 5) e.pickup = 'Add a pickup area or landmark.';
      if (!noDelivery && f.fulfillment !== 'pickup' && Number(f.delivery.eta_max_days) < Number(f.delivery.eta_min_days)) e.delivery = 'Max delivery days must be at least the minimum.';
    }
    setErrs(e);
    if (Object.keys(e).length) toast.error(Object.values(e)[0]);
    return !Object.keys(e).length;
  };
  const go = (i) => { if (i > step && !validate(step)) return; setStep(i); setMaxStep((m) => Math.max(m, i)); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  const save = async (publish) => {
    if (publish) for (let i = 1; i < 7; i++) if (!validate(i)) { setStep(i); return; }
    if (!f.category_id) { toast.error('Choose a category before saving.'); setStep(1); return; }
    setBusy(true);
    try {
      const r = editing ? await api.put(`/listings/${editing}`, payload(publish)) : await api.post('/listings', payload(publish));
      invalidate('/api/v1/me/listings'); invalidate('/me/listings'); invalidate(`/listings/${r.slug}`);
      if (publish) setDone(r);
      else { toast.success('Draft saved'); if (!editing) navigate(`/sell/${r.id}`, { replace: true }); }
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  if (!user || (editing && existing.loading && !existing.data)) return <PageLoader />;
  if (done) {
    return (
      <div className="container page">
        <Confetti run />
        <div className="card card-pad-lg center stack" style={{ maxWidth: 560, margin: '24px auto', '--gap': '16px', alignItems: 'center' }}>
          <SuccessBurst />
          <h1 style={{ fontSize: 28 }}>{done.status === 'active' ? 'Your listing is live!' : 'Submitted for review'}</h1>
          <p className="muted">{done.status === 'active' ? 'Buyers near you can now find, chat and order. We’ll notify you about messages and offers.' : 'This category or wording needs a quick check against our policies. We’ll notify you as soon as it’s approved — usually within a few hours.'}</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <Button to={`/l/${done.slug}`} icon={I.Eye}>View listing</Button>
            <Button variant="secondary" to="/seller/listings" icon={I.Store}>My listings</Button>
            <Button variant="ghost" icon={I.Plus} onClick={() => { set(blank(app.country)); setDone(null); setStep(0); setMaxStep(0); navigate('/sell', { replace: true }); }}>Sell another</Button>
          </div>
        </div>
      </div>
    );
  }
  const k = STEPS[step][0];
  const preview = {
    id: 0, slug: '#', title: f.title || 'Your title', price_minor: Math.round(Number(f.price || 0) * 100), original_price_minor: f.original_price ? Math.round(Number(f.original_price) * 100) : null,
    currency: f.currency, condition: f.condition, fulfillment: noDelivery ? 'pickup' : f.fulfillment, image: f.images[0]?.url, thumb: f.images[0]?.thumb_url, image_count: f.images.length,
    locality: f.locality, city: 'Your city', published_at: new Date().toISOString(), seller: { verified: user.seller_status === 'verified' }, delivery_fee_minor: Number(f.delivery.fee) ? 1 : 0,
  };
  return (
    <div className="container page">
      <div className="page-head">
        <div><h1>{editing ? 'Edit your listing' : 'What are you selling?'}</h1><p>{editing ? 'Changes go live as soon as you republish.' : 'Takes about two minutes. You can save a draft at any step.'}</p></div>
        <Button variant="secondary" icon={I.Bookmark} loading={busy} onClick={() => save(false)}>Save draft</Button>
      </div>
      {!user.email_verified && !user.phone_verified && <div className="callout warn mb-4"><I.Alert size={18} /><span>Verify your email or phone before publishing. <Link to="/settings" className="link">Go to settings</Link></span></div>}
      <div className="wizard">
        {isMobile ? (
          <div className="steps-mobile"><span className="small semibold nowrap">Step {step + 1} of {STEPS.length}</span><div className="progress"><i style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div></div>
        ) : (
          <nav className="steps" aria-label="Listing steps">
            {STEPS.map(([key, label], i) => (
              <button key={key} className={`step ${i === step ? 'active' : ''} ${i < step || i <= maxStep && i !== step ? 'done' : ''}`} disabled={i > maxStep} onClick={() => go(i)} aria-current={i === step ? 'step' : undefined}>
                <span className="n">{i < step || (i <= maxStep && i !== step) ? <I.Check size={15} /> : i + 1}</span>{label}
              </button>
            ))}
          </nav>
        )}
        <div className="card wizard-card" key={k} style={{ animation: 'fadeUp .35s var(--ease)' }}>
          <h2 className="wizard-title">{STEPS[step][1]}</h2>
          {k === 'country' && <>
            <p className="wizard-sub">Where is the item? This sets the currency buyers see.</p>
            <div className="option-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
              {[['IN', '🇮🇳', 'India', '₹ Indian Rupee (INR) · PIN codes · +91'], ['NP', '🇳🇵', 'Nepal', 'रू Nepalese Rupee (NPR) · Provinces · +977']].map(([c, flag, name, d]) => (
                <button key={c} type="button" className="option" aria-pressed={f.country_code === c} onClick={() => set((s) => ({ ...s, country_code: c, currency: c === 'IN' ? 'INR' : 'NPR', region_id: '', district_id: '', city_id: '' }))}>
                  <span className="option-icon" style={{ fontSize: 22 }}>{flag}</span><span><span className="t">{name}</span><span className="d" style={{ display: 'block' }}>{d}</span></span>
                </button>
              ))}
            </div>
          </>}
          {k === 'category' && <>
            <p className="wizard-sub">Pick the best match — it unlocks the right fields for your item.</p>
            <div className="cat-pick">
              {(cats.data || []).map((c) => (
                <button key={c.slug} type="button" aria-pressed={f.root_slug === c.slug} style={{ '--c': c.color }} onClick={() => set((s) => ({ ...s, root_slug: c.slug, category_slug: null, category_id: null, attributes: {} }))}>
                  <span className="ci"><I.CatIcon name={c.icon} size={22} /></span>{c.name}
                </button>
              ))}
            </div>
            {root && (
              <div className="mt-5" style={{ animation: 'fadeUp .3s var(--ease)' }}>
                <h3 className="mb-3">{root.name} — choose a subcategory</h3>
                <div className="chips">{root.children.map((s) => <button key={s.slug} type="button" className={`chip ${f.category_slug === s.slug ? 'active' : ''}`} onClick={() => set((x) => ({ ...x, category_slug: s.slug, category_id: s.id, attributes: {} }))}>{s.name}</button>)}</div>
              </div>
            )}
            {errs.category && <p className="error-text mt-3">{errs.category}</p>}
          </>}
          {k === 'details' && <>
            <p className="wizard-sub">{sub ? <>Listing in <b>{root.name} › {sub.name}</b>. </> : null}Clear, honest details sell faster.</p>
            <div className="form-grid">
              <Field label="Title" required className="span-2" error={errs.title} help={`${f.title.length}/90 · Include brand, model and key spec`}><Input value={f.title} maxLength={90} onChange={(e) => set((s) => ({ ...s, title: e.target.value }))} placeholder="e.g. iPhone 14 Pro 256GB, Deep Purple" /></Field>
              <Field label="Brand"><Input value={f.brand} onChange={(e) => set((s) => ({ ...s, brand: e.target.value }))} /></Field>
              <Field label="Model"><Input value={f.model} onChange={(e) => set((s) => ({ ...s, model: e.target.value }))} /></Field>
              <Field label="Condition" required className="span-2">
                <div className="option-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
                  {Object.entries(CONDITIONS).map(([c, label]) => <button type="button" key={c} className="option" style={{ padding: 12 }} aria-pressed={f.condition === c} onClick={() => set((s) => ({ ...s, condition: c }))}><span><span className="t">{label}</span><span className="d" style={{ display: 'block' }}>{CONDITION_HELP[c]}</span></span></button>)}
                </div>
              </Field>
              {attrs.map((a) => <div key={a.key}><Attr a={a} value={f.attributes[a.key]} onChange={(v) => set((s) => ({ ...s, attributes: { ...s.attributes, [a.key]: v } }))} />{errs[`attr_${a.key}`] && <span className="error-text">{errs[`attr_${a.key}`]}</span>}</div>)}
              <Field label="Purchase date" help="Month and year"><Input type="month" value={f.purchase_date?.slice(0, 7) || ''} max={new Date().toISOString().slice(0, 7)} onChange={(e) => set((s) => ({ ...s, purchase_date: e.target.value }))} /></Field>
              <Field label="Warranty"><Input value={f.warranty} onChange={(e) => set((s) => ({ ...s, warranty: e.target.value }))} placeholder="e.g. 6 months manufacturer warranty left" /></Field>
              <Field label="Description" required className="span-2" error={errs.description} help={`${f.description.length}/5000`}><Textarea rows={6} value={f.description} maxLength={5000} onChange={(e) => set((s) => ({ ...s, description: e.target.value }))} placeholder="Condition, what’s included, any faults, why it’s great…" /></Field>
              <Field label="Reason for selling" className="span-2"><Input value={f.reason_for_selling} onChange={(e) => set((s) => ({ ...s, reason_for_selling: e.target.value }))} placeholder="e.g. Upgrading, moving cities" /></Field>
            </div>
          </>}
          {k === 'photos' && <><p className="wizard-sub">Listings with 3+ clear photos get far more messages. Natural light, plain background.</p><Photos f={f} set={set} />{errs.photos && <p className="error-text mt-3">{errs.photos}</p>}</>}
          {k === 'pricing' && <>
            <p className="wizard-sub">Your price is always shown in {f.currency === 'INR' ? '₹ INR' : 'रू NPR'}. Buyers in the other country see a clearly-labelled estimate.</p>
            <div className="form-grid">
              <Field label="Selling price" required error={errs.price}><MoneyInput currency={f.currency} value={f.price} onChange={(v) => set((s) => ({ ...s, price: v }))} placeholder="0" /></Field>
              <Field label="Currency"><Seg full value={f.currency} onChange={() => {}} options={[{ value: f.currency, label: f.currency === 'INR' ? '₹ INR (India)' : 'रू NPR (Nepal)' }]} label="Currency" /></Field>
              <Field label="Original price (optional)" help="Shows buyers how much they save."><MoneyInput currency={f.currency} value={f.original_price} onChange={(v) => set((s) => ({ ...s, original_price: v }))} /></Field>
              <Field label="Quantity available"><Input type="number" min={1} max={999} value={f.quantity} onChange={(e) => set((s) => ({ ...s, quantity: e.target.value }))} /></Field>
              <div className="span-2 stack" style={{ '--gap': '14px' }}>
                <Field label="Price type"><Seg value={f.negotiable ? 'neg' : 'fixed'} onChange={(v) => set((s) => ({ ...s, negotiable: v === 'neg' }))} options={[{ value: 'neg', label: 'Negotiable' }, { value: 'fixed', label: 'Fixed price' }]} label="Price type" /></Field>
                <Toggle label="Accept offers from buyers" checked={f.accept_offers} onChange={(v) => set((s) => ({ ...s, accept_offers: v }))} />
              </div>
              {Number(f.price) > 0 && Number(f.original_price) > Number(f.price) && <div className="callout success span-2"><I.Sparkles size={18} />Buyers will see {Math.round((1 - f.price / f.original_price) * 100)}% off the original price.</div>}
            </div>
          </>}
          {k === 'location' && <><p className="wizard-sub">Helps buyers nearby find you. Your exact address is never shown.</p><LocationStep f={f} set={set} />{errs.city && <p className="error-text mt-3">{errs.city}</p>}</>}
          {k === 'delivery' && <>
            <p className="wizard-sub">How will the buyer get it?</p>
            {noDelivery ? <div className="callout info mb-4"><I.Info size={18} />{root?.name} listings are viewed or arranged in person. Tell buyers where to meet.</div> : (
              <div className="option-grid mb-5">
                {[['delivery', I.Truck, 'Home delivery', 'You ship or drop it off'], ['pickup', I.Store, 'Self pickup', 'Buyer collects from you'], ['both', I.Package, 'Both available', 'Buyer chooses at checkout']].map(([v, Ic, t, d]) => (
                  <button key={v} type="button" className="option" aria-pressed={f.fulfillment === v} onClick={() => set((s) => ({ ...s, fulfillment: v }))}><span className="option-icon"><Ic size={20} /></span><span><span className="t">{t}</span><span className="d" style={{ display: 'block' }}>{d}</span></span></button>
                ))}
              </div>
            )}
            {!noDelivery && f.fulfillment !== 'pickup' && (
              <fieldset className="card card-pad mb-4" style={{ border: '1px solid var(--border)' }}>
                <legend className="semibold" style={{ padding: '0 6px' }}>Delivery</legend>
                <div className="form-grid">
                  <Field label="Delivery fee" help="Enter 0 for free delivery"><MoneyInput currency={f.currency} value={f.delivery.fee} onChange={(v) => set((s) => ({ ...s, delivery: { ...s.delivery, fee: v } }))} /></Field>
                  <Field label="Delivery method"><Select value={f.delivery.method} onChange={(e) => set((s) => ({ ...s, delivery: { ...s.delivery, method: e.target.value } }))} options={[{ value: 'seller', label: 'I’ll deliver it myself' }, { value: 'courier', label: 'Courier / shipping partner' }]} /></Field>
                  <Field label="Estimated delivery (days)" error={errs.delivery}><div className="range-row"><Input type="number" min={0} value={f.delivery.eta_min_days} onChange={(e) => set((s) => ({ ...s, delivery: { ...s.delivery, eta_min_days: e.target.value } }))} aria-label="Minimum days" /><span className="muted">to</span><Input type="number" min={0} value={f.delivery.eta_max_days} onChange={(e) => set((s) => ({ ...s, delivery: { ...s.delivery, eta_max_days: e.target.value } }))} aria-label="Maximum days" /></div></Field>
                  <Field label="Delivery radius (km)" help="Leave empty to deliver anywhere in the country"><Input type="number" min={1} value={f.delivery.radius_km ?? ''} onChange={(e) => set((s) => ({ ...s, delivery: { ...s.delivery, radius_km: e.target.value } }))} /></Field>
                  <Field label="Only deliver to these cities (optional)" className="span-2"><ChipsInput value={f.delivery.supported_locations} onChange={(v) => set((s) => ({ ...s, delivery: { ...s.delivery, supported_locations: v } }))} placeholder="Type a city and press Enter" /></Field>
                </div>
              </fieldset>
            )}
            {(noDelivery || f.fulfillment !== 'delivery') && (
              <fieldset className="card card-pad" style={{ border: '1px solid var(--border)' }}>
                <legend className="semibold" style={{ padding: '0 6px' }}>{noDelivery ? 'Where to meet / visit' : 'Pickup'}</legend>
                <div className="form-grid">
                  <Field label="Pickup area or landmark" required className="span-2" error={errs.pickup} help="Share the exact address in chat once you accept an order."><Input value={f.pickup.address} onChange={(e) => set((s) => ({ ...s, pickup: { ...s.pickup, address: e.target.value } }))} placeholder="e.g. Near Forum Mall, Koramangala" /></Field>
                  <Field label="Available pickup times"><Input value={f.pickup.times} onChange={(e) => set((s) => ({ ...s, pickup: { ...s.pickup, times: e.target.value } }))} placeholder="e.g. Weekdays after 6 pm" /></Field>
                  <Field label="Pickup instructions"><Input value={f.pickup.instructions} onChange={(e) => set((s) => ({ ...s, pickup: { ...s.pickup, instructions: e.target.value } }))} placeholder="e.g. Call when you reach the gate" /></Field>
                </div>
              </fieldset>
            )}
          </>}
          {k === 'preview' && <>
            <p className="wizard-sub">This is exactly how buyers will see your listing.</p>
            <div className="preview-frame">
              <div className="lp" style={{ gridTemplateColumns: 'minmax(220px, 280px) 1fr', gap: 24 }}>
                <div style={{ pointerEvents: 'none' }}><ProductCard item={preview} /></div>
                <div className="stack" style={{ '--gap': '12px' }}>
                  <div className="row"><Badge>{CONDITIONS[f.condition]}</Badge>{f.negotiable && <Badge tone="success">Negotiable</Badge>}{user.seller_status === 'verified' && <Badge tone="accent" icon={I.BadgeCheck}>Verified seller</Badge>}</div>
                  <h2>{f.title}</h2>
                  <div className="price-big">{money(Math.round(Number(f.price || 0) * 100), f.currency)}</div>
                  <p className="text-2 pre clamp-2" style={{ WebkitLineClamp: 5 }}>{f.description}</p>
                  <dl className="spec">{[['Category', sub?.name], ['Brand', f.brand], ['Model', f.model], ...attrs.filter((a) => f.attributes[a.key]).map((a) => [a.label, `${f.attributes[a.key]}${a.unit ? ` ${a.unit}` : ''}`])].filter(([, v]) => v).map(([t, v]) => <div key={t}><dt>{t}</dt><dd>{v}</dd></div>)}</dl>
                  <div className="row small muted">{f.fulfillment !== 'pickup' && !noDelivery && <span className="row" style={{ '--gap': '6px' }}><I.Truck size={14} />Delivery {Number(f.delivery.fee) ? money(Math.round(f.delivery.fee * 100), f.currency) : 'free'} · {f.delivery.eta_min_days}–{f.delivery.eta_max_days} days</span>}{(noDelivery || f.fulfillment !== 'delivery') && <span className="row" style={{ '--gap': '6px' }}><I.Store size={14} />Pickup at {f.pickup.address}</span>}</div>
                  <div className="row small muted"><Verified size={14} />{f.images.length} photos · {f.accept_offers ? 'Accepting offers' : 'No offers'}</div>
                </div>
              </div>
            </div>
          </>}
          <div className="wizard-foot">
            <Button variant="ghost" icon={I.ArrowLeft} disabled={step === 0} onClick={() => go(step - 1)}>Back</Button>
            {step < STEPS.length - 1
              ? <Button iconRight={I.ArrowRight} onClick={() => go(step + 1)}>Continue</Button>
              : <Button variant="gradient" size="lg" icon={I.Zap} loading={busy} onClick={() => save(true)}>{editing ? 'Save & publish' : 'Publish listing'}</Button>}
          </div>
        </div>
      </div>
    </div>
  );
}
