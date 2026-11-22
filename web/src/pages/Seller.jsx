import React, { useState } from 'react';
import { Link, navigate, useApi, useApp, useLocation, useRequireAuth, useTitle, setQuery, api, toast, invalidate } from '../lib/core.jsx';
import { money, ago, date, ORDER_TONE, LISTING_TONE, LISTING_LABEL, PAY_METHOD, plural } from '../lib/format.js';
import { Button, Badge, Status, Empty, PageLoader, Tabs, Seg, Menu, MenuItem, confirmDialog, Skel, Modal, CountUp } from '../components/ui.jsx';
import { LineChart, Legend, Donut, BarList } from '../components/charts.jsx';
import { DashLayout, Stat, PageHead } from '../components/dash.jsx';
import * as I from '../components/icons.jsx';

const SERIES = [{ key: 'views', label: 'Views' }, { key: 'inquiries', label: 'Inquiries', color: 'var(--accent-2)' }, { key: 'orders', label: 'Orders', color: '#12C08A' }];

function Overview() {
  useTitle('Seller dashboard');
  const app = useApp();
  const o = useApi('/seller/overview');
  const a = useApi('/seller/analytics?days=30');
  const d = o.data, an = a.data;
  return (
    <>
      <PageHead title="Seller dashboard" subtitle="Your listings, orders and performance at a glance." actions={<Button variant="gradient" icon={I.Plus} to="/sell">New listing</Button>} />
      {app.user.seller_status !== 'verified' && <div className="callout accent mb-4"><I.BadgeCheck size={18} /><span className="grow">Get the verified-seller badge to build trust and rank higher.</span><Button size="sm" variant="secondary" to="/settings/verification">{app.user.seller_status === 'pending' ? 'In review' : 'Get verified'}</Button></div>}
      <div className="stat-grid stagger">
        <Stat label="Active listings" value={d ? <CountUp value={d.listings.active || 0} /> : '–'} icon={I.Tag} sub={`${d?.listings.draft || 0} drafts · ${d?.listings.pending_review || 0} in review`} />
        <Stat label="Views (30 days)" value={an ? <CountUp value={an.totals.views} /> : '–'} icon={I.Eye} tone="info" sub={`${an?.totals.all_time_views?.toLocaleString('en-IN') || 0} all time`} />
        <Stat label="Inquiries (30 days)" value={an ? <CountUp value={an.totals.inquiries} /> : '–'} icon={I.Chat} tone="success" sub={`${d?.pending_offers || 0} offers awaiting reply`} />
        <Stat label="Completed sales" value={d ? <CountUp value={d.completed_orders} /> : '–'} icon={I.Receipt} tone="warn" sub={d?.rating?.avg ? `★ ${d.rating.avg} from ${d.rating.n} reviews` : 'No reviews yet'} />
      </div>
      <div className="order-grid mt-5">
        <div className="card">
          <div className="card-head"><h3>Last 30 days</h3><Legend series={SERIES} /></div>
          <div className="card-body">{an ? <LineChart data={an.series.map((s) => ({ x: s.day, ...s }))} series={SERIES} height={240} /> : <Skel h={240} />}</div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Conversion</h3></div>
          <div className="card-body stack" style={{ '--gap': '16px' }}>
            {an && [['View → inquiry', an.conversion.view_to_inquiry], ['Inquiry → order', an.conversion.inquiry_to_order], ['Order → completed', an.conversion.order_completion]].map(([l, v]) => (
              <div key={l}><div className="spread small mb-2"><span className="semibold">{l}</span><b>{v}%</b></div><div className="progress"><i style={{ width: `${Math.min(100, v)}%` }} /></div></div>
            ))}
            {an?.revenue.map((r) => <div key={r.currency} className="spread"><span className="small muted">Sales revenue ({r.currency})</span><b>{money(r.amount, r.currency)}</b></div>)}
          </div>
        </div>
      </div>
      <section className="section" style={{ marginTop: 28 }}>
        <div className="section-head"><h2>Orders to handle</h2><Link to="/seller/orders" className="section-link">All sales<I.ArrowRight size={15} /></Link></div>
        <div className="card">{d?.pending_orders.length ? <div className="list-rows">{d.pending_orders.map((x) => (
          <Link key={x.id} to={`/orders/${x.id}`} className="list-row"><img className="thumb-sm" src={x.image_url} alt="" /><div className="grow" style={{ minWidth: 0 }}><b className="ellipsis" style={{ display: 'block' }}>{x.title}</b><span className="small muted">{x.buyer_name} · {x.number} · {ago(x.created_at)}</span></div><span className="semibold hide-mobile">{money(x.total_minor, x.currency)}</span><Status tone={ORDER_TONE[x.status]}>{x.status_label}</Status></Link>
        ))}</div> : <Empty icon={I.Inbox} title="No open orders">New orders will appear here.</Empty>}</div>
      </section>
      {an?.top.length > 0 && <section className="section" style={{ marginTop: 28 }}><div className="section-head"><h2>Top performing listings</h2><Link to="/seller/analytics" className="section-link">Analytics<I.ArrowRight size={15} /></Link></div><TopTable rows={an.top} /></section>}
    </>
  );
}

function TopTable({ rows }) {
  return (
    <div className="table-wrap"><table className="table">
      <thead><tr><th>Listing</th><th>Views</th><th>Saves</th><th>Inquiries</th><th>Orders</th><th>Status</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id} className="clickable" onClick={() => navigate(`/l/${r.slug}`)}><td><div className="row nowrap"><img className="thumb-sm" src={r.thumb} alt="" /><div style={{ minWidth: 0 }}><b className="ellipsis" style={{ display: 'block', maxWidth: 280 }}>{r.title}</b><span className="small muted">{money(r.price_minor, r.currency)}</span></div></div></td><td>{r.views}</td><td>{r.saves}</td><td>{r.inquiries}</td><td>{r.orders}</td><td><Status tone={LISTING_TONE[r.status]}>{LISTING_LABEL[r.status]}</Status></td></tr>)}</tbody>
    </table></div>
  );
}

function Listings() {
  useTitle('My listings');
  const { query } = useLocation();
  const status = query.status || 'all';
  const { data, loading, reload } = useApi(`/me/listings?status=${status}`);
  const [perf, setPerf] = useState(null);
  const c = data?.counts || {};
  const act = async (l, action) => {
    try { await api.post(`/listings/${l.id}/status`, { action }); toast.success({ pause: 'Listing paused', resume: 'Listing is live again', sold: 'Marked as sold 🎉', renew: 'Listing renewed for 60 days', unsold: 'Listing is active again' }[action]); invalidate('/api/v1/listings'); reload(); }
    catch (e) { toast.error(e.message); }
  };
  const del = async (l) => {
    if (!(await confirmDialog({ title: 'Delete this listing?', message: `“${l.title}” will be removed permanently.`, confirm: 'Delete', danger: true }))) return;
    try { await api.del(`/listings/${l.id}`); toast.success('Listing deleted'); reload(); } catch (e) { toast.error(e.message); }
  };
  const tabs = [['all', 'All', Object.values(c).reduce((a, b) => a + b, 0) - (c.removed || 0)], ['active', 'Active', c.active], ['drafts', 'Drafts', c.draft], ['review', 'In review', (c.pending_review || 0) + (c.rejected || 0)], ['paused', 'Paused', c.paused], ['sold', 'Sold', c.sold], ['expired', 'Expired', c.expired]];
  return (
    <>
      <PageHead title="My listings" subtitle="Edit, pause, renew or mark items as sold." actions={<Button variant="gradient" icon={I.Plus} to="/sell">New listing</Button>} />
      <Tabs value={status} onChange={(v) => setQuery({ status: v === 'all' ? '' : v })} tabs={tabs.map(([v, l, n]) => ({ value: v, label: l, count: n || 0 }))} />
      <div className="card mt-4">
        {loading && !data ? <div className="card-body"><Skel h={64} /></div> : data?.items.length ? <div className="list-rows">{data.items.map((l) => (
          <div key={l.id} className="list-row" style={{ alignItems: 'flex-start' }}>
            {l.thumb ? <img className="thumb-md" src={l.thumb} alt="" /> : <span className="thumb-md" style={{ display: 'grid', placeItems: 'center' }}><I.ImageIcon className="muted" /></span>}
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="row" style={{ '--gap': '8px' }}><Status tone={LISTING_TONE[l.status]}>{LISTING_LABEL[l.status]}</Status>{l.pending_offers > 0 && <Badge tone="warn" icon={I.Handshake}>{l.pending_offers} offer{l.pending_offers > 1 ? 's' : ''}</Badge>}</div>
              <Link to={['active', 'sold'].includes(l.status) ? `/l/${l.slug}` : `/sell/${l.id}`} className="semibold ellipsis mt-1" style={{ display: 'block' }}>{l.title}</Link>
              <div className="small muted row mt-1" style={{ '--gap': '12px' }}><b className="text-2">{money(l.price_minor, l.currency)}</b><span><I.Eye size={12} style={{ display: 'inline', verticalAlign: '-1px' }} /> {l.views}</span><span><I.Heart size={12} style={{ display: 'inline', verticalAlign: '-1px' }} /> {l.saves}</span><span><I.Chat size={12} style={{ display: 'inline', verticalAlign: '-1px' }} /> {l.inquiries}</span>{l.expires_at && l.status === 'active' && <span>Expires {date(l.expires_at)}</span>}{l.status === 'draft' && <span>Updated {ago(l.updated_at)}</span>}</div>
              {l.moderation_note && ['rejected', 'pending_review'].includes(l.status) && <div className="callout warn small mt-2" style={{ padding: '8px 12px' }}><I.Info size={15} />{l.moderation_note}</div>}
            </div>
            <div className="row nowrap">
              {['active', 'paused', 'sold'].includes(l.status) && <Button size="sm" variant="ghost" icon={I.BarChart} onClick={() => setPerf(l)} className="hide-mobile">Stats</Button>}
              <Button size="sm" variant="secondary" icon={I.Pencil} to={`/sell/${l.id}`}>Edit</Button>
              <Menu trigger={({ toggle }) => <Button size="sm" variant="ghost" icon={I.MoreV} onClick={toggle} aria-label="More actions" />}>
                {l.status === 'active' && <MenuItem icon={I.Pause} onClick={() => act(l, 'pause')}>Pause</MenuItem>}
                {l.status === 'paused' && <MenuItem icon={I.Play} onClick={() => act(l, 'resume')}>Resume</MenuItem>}
                {['active', 'paused'].includes(l.status) && <MenuItem icon={I.CheckCircle} onClick={() => act(l, 'sold')}>Mark as sold</MenuItem>}
                {l.status === 'sold' && <MenuItem icon={I.Undo} onClick={() => act(l, 'unsold')}>Relist</MenuItem>}
                {['expired', 'active', 'paused'].includes(l.status) && <MenuItem icon={I.Refresh} onClick={() => act(l, 'renew')}>Renew for 60 days</MenuItem>}
                {['active', 'sold'].includes(l.status) && <MenuItem icon={I.Eye} to={`/l/${l.slug}`}>View listing</MenuItem>}
                <div className="menu-sep" />
                <MenuItem icon={I.Trash} danger onClick={() => del(l)}>Delete</MenuItem>
              </Menu>
            </div>
          </div>
        ))}</div> : <Empty icon={I.Tag} title="No listings here" action={<Button to="/sell" icon={I.Plus}>Post a listing</Button>}>List something in under two minutes.</Empty>}
      </div>
      <PerfModal listing={perf} onClose={() => setPerf(null)} />
    </>
  );
}

function PerfModal({ listing, onClose }) {
  const p = useApi(listing ? `/listings/${listing.id}/performance` : null);
  const days = [];
  for (let i = 29; i >= 0; i--) { const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10); days.push({ x: d, views: p.data?.daily.find((v) => v.day === d)?.n || 0 }); }
  return (
    <Modal open={!!listing} onClose={onClose} title="Listing performance" subtitle={listing?.title} width={720}>
      {p.data ? <>
        <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>{[['Views', p.data.views], ['Saves', p.data.saves], ['Inquiries', p.data.inquiries], ['Offers', p.data.offers], ['Orders', p.data.orders]].map(([l, v]) => <div key={l} className="stat" style={{ padding: 14 }}><span className="small muted">{l}</span><span className="v" style={{ fontSize: 22 }}>{v}</span></div>)}</div>
        <div className="mt-5"><LineChart data={days} series={[{ key: 'views', label: 'Views' }]} height={200} /></div>
      </> : <Skel h={260} />}
    </Modal>
  );
}

function Sales() {
  useTitle('Sales');
  const [status, setStatus] = useState('open');
  const { data, loading } = useApi(`/orders?role=selling&status=${status}`);
  return (
    <>
      <PageHead title="Sales" subtitle="Orders placed on your listings." actions={<Seg value={status} onChange={setStatus} options={[{ value: 'open', label: 'Open' }, { value: 'completed', label: 'Completed' }, { value: 'closed', label: 'Cancelled' }, { value: 'all', label: 'All' }]} label="Status" />} />
      <OrderTable rows={data} loading={loading} role="selling" />
    </>
  );
}
export function OrderTable({ rows, loading, role }) {
  if (loading && !rows) return <Skel h={240} r={20} />;
  if (!rows?.length) return <Empty icon={I.Package} title="No orders here" action={role === 'buying' ? <Button to="/browse">Start shopping</Button> : <Button to="/sell">Post a listing</Button>} />;
  return (
    <div className="table-wrap"><table className="table">
      <thead><tr><th>Item</th><th className="hide-mobile">{role === 'selling' ? 'Buyer' : 'Seller'}</th><th className="hide-mobile">Fulfilment</th><th>Total</th><th>Status</th></tr></thead>
      <tbody>{rows.map((o) => (
        <tr key={o.id} className="clickable" onClick={() => navigate(`/orders/${o.id}`)}>
          <td><div className="row nowrap"><img className="thumb-sm" src={o.image_url} alt="" /><div style={{ minWidth: 0 }}><b className="ellipsis" style={{ display: 'block', maxWidth: 280 }}>{o.title}</b><span className="tiny muted">{o.number} · {date(o.created_at)}</span></div></div></td>
          <td className="hide-mobile">{role === 'selling' ? o.buyer_name : o.seller_name}</td>
          <td className="hide-mobile"><span className="small">{o.fulfillment === 'pickup' ? 'Self pickup' : 'Delivery'}<br /><span className="muted tiny">{PAY_METHOD[o.payment_method]}</span></span></td>
          <td className="semibold nowrap">{money(o.total_minor, o.currency)}</td>
          <td><Status tone={ORDER_TONE[o.status]}>{o.status_label}</Status></td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

function Analytics() {
  useTitle('Seller analytics');
  const [days, setDays] = useState(30);
  const { data } = useApi(`/seller/analytics?days=${days}`);
  return (
    <>
      <PageHead title="Analytics" subtitle="Real numbers from your listings, chats and orders." actions={<Seg value={days} onChange={setDays} options={[{ value: 7, label: '7 days' }, { value: 30, label: '30 days' }, { value: 90, label: '90 days' }]} label="Range" />} />
      {!data ? <Skel h={400} r={20} /> : <>
        <div className="stat-grid">
          <Stat label="Product views" value={<CountUp value={data.totals.views} />} icon={I.Eye} />
          <Stat label="Total inquiries" value={<CountUp value={data.totals.inquiries} />} icon={I.Chat} tone="info" />
          <Stat label="Total orders" value={<CountUp value={data.totals.orders} />} icon={I.Package} tone="success" />
          <Stat label="Completed sales" value={<CountUp value={data.totals.completed} />} icon={I.CheckCircle} tone="warn" />
        </div>
        <div className="card mt-5"><div className="card-head"><h3>Activity</h3><Legend series={SERIES} /></div><div className="card-body"><LineChart data={data.series.map((s) => ({ x: s.day, ...s }))} series={SERIES} height={280} /></div></div>
        <div className="order-grid mt-5" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="card"><div className="card-head"><h3>Conversion funnel</h3></div><div className="card-body"><BarList rows={[{ label: 'Views', value: data.totals.views }, { label: 'Inquiries', value: data.totals.inquiries }, { label: 'Orders', value: data.totals.orders }, { label: 'Completed', value: data.totals.completed }]} /><p className="small muted mt-4">View→inquiry {data.conversion.view_to_inquiry}% · inquiry→order {data.conversion.inquiry_to_order}% · completion {data.conversion.order_completion}%</p></div></div>
          <div className="card"><div className="card-head"><h3>Where views go</h3></div><div className="card-body">{data.top.length ? <Donut label="views" parts={data.top.slice(0, 5).map((t) => ({ label: t.title.slice(0, 26), value: t.views }))} /> : <Empty title="No data yet" />}</div></div>
        </div>
        <section className="section" style={{ marginTop: 24 }}><h2 className="mb-4">Top performing products</h2><TopTable rows={data.top} /></section>
      </>}
    </>
  );
}

export default function SellerPages() {
  const user = useRequireAuth();
  const { pathname } = useLocation();
  if (!user) return <PageLoader />;
  return <DashLayout>{{ '/seller': <Overview />, '/seller/listings': <Listings />, '/seller/orders': <Sales />, '/seller/analytics': <Analytics /> }[pathname]}</DashLayout>;
}
