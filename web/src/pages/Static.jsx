import React, { useState } from 'react';
import { Link, useApi, useApp, useLocation, useTitle, api, toast } from '../lib/core.jsx';
import { dateTime, ago } from '../lib/format.js';
import { Button, Field, Input, Textarea, Select, Reveal, Empty, SuccessBurst, Badge, Status, Modal } from '../components/ui.jsx';
import * as I from '../components/icons.jsx';

function PageHero({ eyebrow, title, children }) {
  return (
    <section className="page-hero">
      <div className="hero-mesh" aria-hidden="true" style={{ opacity: 0.55 }}><span /><span /><span /></div>
      <div className="container">{eyebrow && <span className="hero-eyebrow"><span className="pulse" />{eyebrow}</span>}<h1 className="mt-4">{title}</h1>{children && <p>{children}</p>}</div>
    </section>
  );
}

export function About() {
  useTitle('About PASAL');
  const features = [
    [I.ShieldCheck, 'Trust by design', 'ID-verified sellers, verified-purchase reviews, moderation and secure handover codes keep every deal honest.'],
    [I.Chat, 'Real-time chat & offers', 'Ask questions, share photos and negotiate with offers and counter-offers — all in one thread.'],
    [I.Truck, 'Delivery or pickup', 'Sellers choose home delivery, self pickup, or both. Buyers track every step of the order.'],
    [I.Wallet, 'Payments that fit', 'Pay online with UPI, cards and wallets through PASAL, or pay the seller in person — clearly labelled.'],
    [I.Globe, 'Built for India & Nepal', 'Native ₹ INR and रू NPR pricing, +91 and +977 phone sign-in, and locations down to the locality.'],
    [I.Sparkles, 'Smart discovery', 'Typo-tolerant search, saved-search alerts, and recommendations based on what you love.'],
  ];
  return (
    <>
      <PageHero eyebrow="Our story" title={<>Everything finds a buyer<span style={{ color: 'var(--mint)' }}>.</span></>}>PASAL — “shop” in Nepali — is a marketplace where the things you no longer need find people who’ll love them, across India and Nepal.</PageHero>
      <div className="container page" style={{ paddingTop: 0 }}>
        <div className="feature-grid stagger">{features.map(([Ic, t, d]) => <div key={t} className="card feature"><span className="ic"><Ic size={22} /></span><h3>{t}</h3><p>{d}</p></div>)}</div>
        <Reveal className="section prose">
          <h2>Why we built PASAL</h2>
          <p>Every home has a drawer of gadgets, a bike in the corner, books on a shelf — things with plenty of life left. Meanwhile, someone a few streets away is looking for exactly that. PASAL connects the two with a marketplace that is simple enough to list in a minute and trustworthy enough to buy with confidence.</p>
          <p>We combine the ease of local classifieds with the safety of modern commerce: verified sellers, structured listings, real-time negotiation, tracked orders and protected payments.</p>
        </Reveal>
        <div className="row mt-6"><Button variant="gradient" size="lg" to="/sell" icon={I.Plus}>Start selling</Button><Button variant="secondary" size="lg" to="/browse">Browse listings</Button></div>
      </div>
    </>
  );
}

export function Contact() {
  useTitle('Contact us');
  const app = useApp();
  const [f, setF] = useState({ name: app.user?.name || '', email: app.user?.email || '', subject: '', category: 'general', message: '', order_number: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { setDone(await api.post('/support/tickets', { ...f, order_number: f.order_number || undefined })); }
    catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHero title="We’re here to help">Questions about an order, a listing or your account? Send us a message and our team will reply within one working day.</PageHero>
      <div className="container page" style={{ paddingTop: 0 }}>
        <div className="lp" style={{ gridTemplateColumns: 'minmax(0, 1fr) 340px' }}>
          <div className="card card-pad-lg">
            {done ? (
              <div className="stack center" style={{ '--gap': '14px', alignItems: 'center', padding: '24px 0' }}>
                <SuccessBurst /><h2>Message received</h2><p className="muted">Your reference is <b className="mono">{done.reference}</b>. We’ll reply to {f.email}.</p>
                <Button variant="secondary" to="/help">Visit the help centre</Button>
              </div>
            ) : (
              <form className="form-grid" onSubmit={submit}>
                <Field label="Name" required><Input value={f.name} onChange={set('name')} required minLength={2} /></Field>
                <Field label="Email" required><Input type="email" value={f.email} onChange={set('email')} required /></Field>
                <Field label="Topic"><Select value={f.category} onChange={set('category')} options={[{ value: 'general', label: 'General question' }, { value: 'account', label: 'My account' }, { value: 'listing', label: 'A listing' }, { value: 'order', label: 'An order' }, { value: 'payment', label: 'Payments & refunds' }, { value: 'safety', label: 'Safety concern' }, { value: 'business', label: 'Business / partnerships' }]} /></Field>
                <Field label="Order number (optional)"><Input value={f.order_number} onChange={set('order_number')} placeholder="PSL-…" /></Field>
                <Field label="Subject" required className="span-2"><Input value={f.subject} onChange={set('subject')} required minLength={4} /></Field>
                <Field label="Message" required className="span-2" error={err}><Textarea rows={6} value={f.message} onChange={set('message')} required minLength={10} /></Field>
                <div className="span-2"><Button type="submit" size="lg" icon={I.Send} loading={busy}>Send message</Button></div>
              </form>
            )}
          </div>
          <div className="stack">
            <div className="card card-pad stack"><span className="row semibold"><I.Mail size={18} />Email</span><a className="link" href={`mailto:${window.__PASAL__?.brand?.supportEmail}`}>{window.__PASAL__?.brand?.supportEmail}</a></div>
            <div className="card card-pad stack"><span className="row semibold"><I.Clock size={18} />Support hours</span><span className="small muted">Mon–Sat, 9:00–19:00 IST / NPT</span></div>
            <div className="card card-pad stack"><span className="row semibold"><I.ShieldCheck size={18} />Safety emergency?</span><span className="small muted">If you are in danger, call local emergency services first: 112 in India, 100 in Nepal.</span></div>
          </div>
        </div>
      </div>
    </>
  );
}

const FAQ = [
  ['Buying', [
    ['How do I buy an item?', 'Open a listing and tap “Buy now”. Choose home delivery or self pickup, confirm the address or pickup details, and pick how you’ll pay. The seller confirms the order, and you can track every step from “My orders”.'],
    ['Can I negotiate the price?', 'Yes — if the seller accepts offers, tap “Make an offer”. The seller can accept, decline or counter. Accepted offers can be checked out at the agreed price within 48 hours.'],
    ['What is the pickup code?', 'For pickup orders, PASAL gives you a secret 6-character code and a QR. Show it to the seller only after you’ve inspected the item; the seller scans or enters it to complete the handover.'],
    ['Which payment methods are protected?', 'Payments made online through PASAL are verified by our payment partner and marked “Paid online via PASAL”. Cash on pickup/delivery and direct arrangements happen between you and the seller and are labelled as such.'],
  ]],
  ['Selling', [
    ['How much does it cost to list?', 'Listing on PASAL is free. Optional featured placement may be offered by the PASAL team.'],
    ['How do I get the verified badge?', 'Verify your email or phone, then submit your ID from Settings → Seller verification. Our team reviews it, usually within a day. We only store the last 4 characters of your document number.'],
    ['Why is my listing under review?', 'Some categories and keywords need a quick manual check against our prohibited items policy. Most reviews finish within a few hours.'],
  ]],
  ['Safety', [
    ['How do I stay safe?', 'Keep conversations on PASAL, meet in public places, inspect items before paying, never share OTPs, and never pay “advance” to unknown sellers off-platform. Report anything suspicious from the listing or chat.'],
    ['What if something goes wrong with an order?', 'Open a dispute from the order page within 7 days of completion. PASAL support reviews the evidence and can refund verified online payments.'],
  ]],
];

export function Help() {
  useTitle('Help centre');
  const app = useApp();
  const { query } = useLocation();
  const tickets = useApi(app.user ? '/support/tickets' : null);
  const [open, setOpen] = useState(query.ticket ? Number(query.ticket) : null);
  const [q, setQ] = useState('');
  const filtered = FAQ.map(([g, items]) => [g, items.filter(([a, b]) => !q || `${a} ${b}`.toLowerCase().includes(q.toLowerCase()))]).filter(([, i]) => i.length);
  return (
    <>
      <PageHero title="Help centre">Answers to common questions about buying, selling and staying safe on PASAL.</PageHero>
      <div className="container page" style={{ paddingTop: 0 }}>
        <div className="search-box" style={{ maxWidth: 560, background: 'var(--surface)' }}><I.Search size={19} /><input placeholder="Search help articles" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search help" /></div>
        <div className="lp mt-6" style={{ gridTemplateColumns: 'minmax(0, 1fr) 340px' }}>
          <div className="stack" style={{ '--gap': '28px' }}>
            {filtered.map(([g, items]) => (
              <section key={g} id={g.toLowerCase()} className="card card-pad-lg faq">
                <h2 style={{ fontSize: 19 }}>{g}</h2>
                {items.map(([a, b]) => <details key={a}><summary>{a}</summary><p>{b}</p></details>)}
              </section>
            ))}
            {!filtered.length && <Empty title="No articles found">Try different words, or contact us.</Empty>}
          </div>
          <div className="stack">
            <div className="card card-pad stack"><h3>Still need help?</h3><p className="small muted">Our team replies within one working day.</p><Button to="/contact" icon={I.LifeBuoy}>Contact support</Button></div>
            {app.user && tickets.data?.length > 0 && (
              <div className="card"><div className="card-head"><h3>Your tickets</h3></div>
                <div className="list-rows">{tickets.data.map((t) => <button key={t.id} className="list-row" style={{ border: 0, background: 'none', textAlign: 'left', cursor: 'pointer', width: '100%' }} onClick={() => setOpen(t.id)}><div className="grow"><b className="small ellipsis" style={{ display: 'block' }}>{t.subject}</b><span className="tiny muted">T-{String(t.id).padStart(5, '0')} · {ago(t.updated_at)}</span></div><Status tone={t.status === 'resolved' || t.status === 'closed' ? 'success' : t.status === 'pending' ? 'accent' : 'warn'}>{t.status}</Status></button>)}</div>
              </div>
            )}
          </div>
        </div>
      </div>
      {open && <TicketModal id={open} onClose={() => { setOpen(null); tickets.reload(); }} />}
    </>
  );
}

function TicketModal({ id, onClose }) {
  const t = useApi(`/support/tickets/${id}`);
  const [reply, setReply] = useState('');
  const send = async () => { try { await api.post(`/support/tickets/${id}/messages`, { body: reply }); setReply(''); t.reload(); } catch (e) { toast.error(e.message); } };
  return (
    <Modal open onClose={onClose} title={t.data?.subject || 'Ticket'} subtitle={t.data ? `T-${String(id).padStart(5, '0')} · ${t.data.status}` : ''} width={600}
      footer={<><Textarea rows={2} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Add a reply" style={{ flex: 1, minHeight: 44 }} /><Button icon={I.Send} disabled={!reply.trim()} onClick={send}>Send</Button></>}>
      <div className="stack">{t.data?.messages.map((m) => <div key={m.id} className={`card card-pad ${m.staff ? '' : ''}`} style={m.staff ? { background: 'var(--accent-soft)', borderColor: 'transparent' } : undefined}><div className="spread small"><b>{m.staff ? `${m.author_name} · PASAL support` : m.author_name || 'You'}</b><span className="muted tiny">{dateTime(m.created_at)}</span></div><p className="pre small mt-2">{m.body}</p></div>)}</div>
    </Modal>
  );
}

function Legal({ title, updated, children }) {
  useTitle(title);
  return (
    <div className="container page"><article className="prose"><h1>{title}</h1><p className="small muted">Last updated {updated}. This document is a starting template and should be reviewed by qualified counsel in India and Nepal before launch.</p>{children}</article></div>
  );
}
export function Privacy() {
  return (
    <Legal title="Privacy policy" updated="22 November 2026">
      <h2>What we collect</h2>
      <ul><li>Account details: name, email and/or mobile number, password hash (never the password itself), profile photo and city.</li><li>Marketplace activity: listings, messages, offers, orders, reviews and reports.</li><li>Seller verification: document type and only the last four characters of the document number.</li><li>Payments: payment status and gateway reference IDs. Card, UPI and bank details are handled by our payment partners — PASAL never stores them.</li><li>Technical data: IP address, device and browser information for security, fraud prevention and rate limiting.</li></ul>
      <h2>How we use it</h2>
      <p>To run the marketplace (show listings, deliver messages, process orders), keep users safe (moderation, fraud prevention, dispute resolution), send the notifications you choose, and improve PASAL. We do not sell your personal data.</p>
      <h2>What other users see</h2>
      <p>Your name, photo, city, listings, ratings and reviews are public. Your phone number is shared with the other party only after a seller accepts an order. Your exact address is shared with the seller only for delivery orders.</p>
      <h2>Your rights</h2>
      <p>You can access and update your information in Settings, download a copy by contacting support, change notification preferences, and delete your account at any time. These rights reflect India’s Digital Personal Data Protection Act, 2023 and Nepal’s Privacy Act, 2075 (2018).</p>
      <h2>Retention &amp; security</h2>
      <p>We keep order and payment records as long as required by tax and consumer-protection law; other data is removed or anonymised when you delete your account. Data is encrypted in transit; passwords are salted and hashed; access is role-restricted and logged.</p>
      <h2>Contact</h2><p>Questions? <Link to="/contact">Contact us</Link>.</p>
    </Legal>
  );
}
export function Terms() {
  return (
    <Legal title="Terms & conditions" updated="22 November 2026">
      <h2>1. Using PASAL</h2><p>You must be at least 18 years old (or have a guardian’s consent where the law allows) and provide accurate information. One person, one account.</p>
      <h2>2. Listings</h2><p>Sellers are responsible for describing items accurately, holding the right to sell them, and following the <Link to="/prohibited-items">Prohibited items policy</Link>. Prices are set in the listing’s currency (₹ INR or रू NPR). Converted prices shown on PASAL are estimates only.</p>
      <h2>3. Orders &amp; payments</h2><p>A purchase is a contract between buyer and seller. When you pay online through PASAL, payment is processed by a licensed payment partner and verified by PASAL before the seller is told to proceed. Cash and direct payments are arranged between the parties and are not protected by PASAL.</p>
      <h2>4. Pickup and delivery</h2><p>For pickup, the buyer should inspect the item before sharing the pickup code. Sharing the code confirms the handover. For delivery, the buyer confirms receipt in the app.</p>
      <h2>5. Disputes and refunds</h2><p>Either party may open a dispute up to 7 days after completion. PASAL may refund verified online payments based on the evidence. Our decision on platform refunds is final, without affecting your statutory rights.</p>
      <h2>6. Conduct</h2><p>No harassment, spam, fraud, fake reviews or attempts to move payments off-platform to avoid protection. We may remove content, limit features, or suspend accounts that break these terms.</p>
      <h2>7. Liability</h2><p>PASAL is a platform that connects buyers and sellers and is not the seller of items listed by users. To the extent permitted by law, PASAL is not liable for the quality, safety or legality of items listed.</p>
      <h2>8. Changes</h2><p>We may update these terms. Material changes will be notified in the app.</p>
    </Legal>
  );
}
export function Prohibited() {
  const items = [
    ['Weapons & ammunition', 'Firearms, replicas that can be mistaken for real weapons, ammunition, explosives, fireworks.'],
    ['Drugs & medicines', 'Narcotics, psychotropic substances, prescription-only medicines, drug paraphernalia.'],
    ['Wildlife & animals', 'Live animals, and wildlife products protected under India’s Wildlife (Protection) Act, 1972 and Nepal’s National Parks and Wildlife Conservation Act, 2029 — e.g. ivory, rhino horn, pangolin scales, tiger parts, shahtoosh.'],
    ['Counterfeit & stolen goods', '“First copy”, replica or fake branded goods; stolen items; items without the right to sell.'],
    ['Identity & financial documents', 'Government IDs (Aadhaar, PAN, passport, citizenship), SIM cards registered to others, bank accounts, currency, lottery tickets.'],
    ['Human body & health', 'Organs, blood, body parts; unapproved medical devices.'],
    ['Adult & offensive content', 'Sexual services, adult content, hate or extremist material.'],
    ['Hazardous materials', 'Toxic, flammable or radioactive substances; recalled products.'],
    ['Digital & services abuse', 'Hacked or stolen accounts, pirated software or media, academic cheating services.'],
    ['Alcohol & tobacco', 'Alcoholic beverages, tobacco and e-cigarettes.'],
  ];
  return (
    <Legal title="Prohibited items policy" updated="22 November 2026">
      <p>PASAL lets you sell almost anything — as long as it’s legal in India or Nepal (wherever the item is located) and safe. Listings that match the categories below are removed, and repeat violations can lead to suspension. Some listings are automatically held for manual review.</p>
      {items.map(([t, d]) => <React.Fragment key={t}><h3>{t}</h3><p>{d}</p></React.Fragment>)}
      <h2>Reporting</h2><p>Spotted something that shouldn’t be here? Use “Report” on the listing. Listings with several reports are hidden until a moderator reviews them.</p>
    </Legal>
  );
}

export function NotFound() {
  useTitle('Page not found');
  return (
    <div className="container page"><Empty icon={I.Compass} title="This page wandered off" action={<div className="row"><Button to="/" icon={I.Home}>Go home</Button><Button variant="secondary" to="/browse">Browse listings</Button></div>}>The link may be broken or the listing may have been removed.</Empty></div>
  );
}

export function DevMailbox() {
  useTitle('Dev mailbox');
  const box = useApi(window.__PASAL__?.devTools ? '/dev/outbox' : null);
  if (!window.__PASAL__?.devTools) return <NotFound />;
  return (
    <div className="container page">
      <div className="page-head"><div><h1>Dev mailbox</h1><p>Emails and SMS that would be sent by the configured providers. Visible only when ENABLE_DEV_TOOLS is on.</p></div><Button variant="secondary" icon={I.Refresh} onClick={box.reload}>Refresh</Button></div>
      <div className="stack">{(box.data || []).map((m) => (
        <div key={m.id} className="card card-pad">
          <div className="spread small"><span className="row"><Badge tone={m.channel === 'sms' ? 'success' : 'accent'}>{m.channel.toUpperCase()}</Badge><b>{m.recipient}</b>{m.subject && <span className="muted">· {m.subject}</span>}</span><span className="muted tiny">{dateTime(m.created_at)}</span></div>
          <pre className="small text-2 mt-3" style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: '12px 0 0' }}>{linkify(m.body)}</pre>
        </div>
      ))}{box.data?.length === 0 && <Empty title="No messages yet" />}</div>
    </div>
  );
}
const linkify = (s) => s.split(/(https?:\/\/\S+)/g).map((p, i) => (p.startsWith('http') ? <a key={i} className="link" href={p}>{p}</a> : p));
