import React, { useEffect, useState } from 'react';
import { Link, navigate, useApi, useApp, useLocation, useTitle, useDebounce, setQuery, api, toast } from '../lib/core.jsx';
import { money, date, dateTime, ago, ORDER_TONE, ORDER_LABEL, LISTING_TONE, LISTING_LABEL, PAY_METHOD } from '../lib/format.js';
import { Button, IconButton, Field, Input, Textarea, Select, Toggle, Seg, Badge, Status, Avatar, Empty, PageLoader, Modal, Drawer, Pager, Mark, Logo, Tabs, confirmDialog, Skel, CountUp } from '../components/ui.jsx';
import { ThemeSwitch } from '../components/layout.jsx';
import { LineChart, Legend, BarList, Donut } from '../components/charts.jsx';
import { Stat, PageHead } from '../components/dash.jsx';
import * as I from '../components/icons.jsx';

const NAV = [
  { group: 'Overview' },
  { to: '/admin', label: 'Dashboard', icon: I.Dashboard, perm: 'admin.access' },
  { to: '/admin/analytics', label: 'Analytics', icon: I.LineChart, perm: 'analytics.view' },
  { group: 'Marketplace' },
  { to: '/admin/users', label: 'Users', icon: I.Users, perm: 'users.view' },
  { to: '/admin/verification', label: 'Seller verification', icon: I.BadgeCheck, perm: 'sellers.verify', badge: 'pending_verifications' },
  { to: '/admin/listings', label: 'Listing moderation', icon: I.Tag, perm: 'listings.moderate', badge: 'pending_review' },
  { to: '/admin/categories', label: 'Categories', icon: I.GridIcon, perm: 'categories.manage' },
  { to: '/admin/reports', label: 'Reports', icon: I.Flag, perm: 'reports.manage', badge: 'open_reports' },
  { group: 'Commerce' },
  { to: '/admin/orders', label: 'Orders', icon: I.Package, perm: 'orders.view' },
  { to: '/admin/payments', label: 'Payments', icon: I.Wallet, perm: 'payments.view' },
  { to: '/admin/disputes', label: 'Disputes', icon: I.Gavel, perm: 'disputes.manage', badge: 'open_disputes' },
  { group: 'Growth & support' },
  { to: '/admin/promotions', label: 'Promotions & homepage', icon: I.Megaphone, perm: 'promotions.manage' },
  { to: '/admin/tickets', label: 'Support tickets', icon: I.LifeBuoy, perm: 'tickets.manage', badge: 'open_tickets' },
  { group: 'System' },
  { to: '/admin/settings', label: 'Platform settings', icon: I.Settings, perm: 'admin.access' },
  { to: '/admin/audit', label: 'Audit logs', icon: I.Scroll, perm: 'audit.view' },
];
const ROLE_LABEL = { user: 'User', support: 'Customer support', moderator: 'Moderator', admin: 'Admin', super_admin: 'Super admin' };

function AdminShell({ children, counts }) {
  const app = useApp();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  return (
    <div className="admin">
      {open && <div className="drawer-backdrop" onClick={() => setOpen(false)} />}
      <aside className={`admin-side ${open ? 'open' : ''}`}>
        <Link to="/admin" className="brand"><Logo height={30} color="#fff" /><Badge className="badge-dark" style={{ background: 'rgba(140,116,255,.2)', color: '#B3A3FF' }}>Admin</Badge></Link>
        <nav aria-label="Admin">
          {NAV.filter((n) => n.group || app.can(n.perm)).map((n, i) => (n.group ? <div key={i} className="grp">{n.group}</div> : (
            <Link key={n.to} to={n.to} className={pathname === n.to || (n.to !== '/admin' && pathname.startsWith(n.to)) ? 'active' : ''}><n.icon size={18} />{n.label}{n.badge && counts?.[n.badge] > 0 && <span className="n">{counts[n.badge]}</span>}</Link>
          )))}
        </nav>
        <div className="me"><Avatar name={app.user.name} src={app.user.avatar_url} size={34} /><div style={{ minWidth: 0 }} className="grow"><b className="small ellipsis" style={{ display: 'block', color: '#fff' }}>{app.user.name}</b><span className="tiny" style={{ color: '#7E85AA' }}>{ROLE_LABEL[app.user.role]}</span></div><Link to="/" className="icon-btn sm" title="Back to PASAL" style={{ color: '#A9AFCC' }}><I.External size={16} /></Link></div>
      </aside>
      <div className="admin-main">
        <header className="admin-top">
          <IconButton icon={I.Menu} label="Menu" className="show-mobile" onClick={() => setOpen(true)} />
          <span className="semibold">{NAV.find((n) => n.to === pathname || (n.to !== '/admin' && n.to && pathname.startsWith(n.to)))?.label || 'Admin'}</span>
          <div className="row" style={{ marginLeft: 'auto' }}><ThemeSwitch /><Button size="sm" variant="ghost" to="/" icon={I.Home}>View site</Button></div>
        </header>
        <div className="admin-content route-enter" key={pathname}>{children}</div>
      </div>
    </div>
  );
}

function SearchInput({ value, onChange, placeholder }) {
  const [v, setV] = useState(value || '');
  const d = useDebounce(v, 300);
  useEffect(() => { if (d !== (value || '')) onChange(d); }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="search-box" style={{ height: 38, minWidth: 240, background: 'var(--surface)' }}><I.Search size={16} /><input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} aria-label={placeholder} /></div>;
}

// ---------------- Dashboard ----------------
function Dashboard({ ov }) {
  useTitle('Admin');
  if (!ov) return <Skel h={400} r={20} />;
  const S = [{ key: 'users', label: 'Signups' }, { key: 'listings', label: 'New listings', color: 'var(--accent-2)' }, { key: 'orders', label: 'Orders', color: '#12C08A' }];
  const sum = (arr) => arr.map((g) => money(g.amount, g.currency, { compact: true })).join(' · ') || '—';
  return (
    <>
      <PageHead title="Marketplace overview" subtitle={`As of ${dateTime(new Date().toISOString())}`} />
      <div className="stat-grid stagger">
        <Stat label="Total users" value={<CountUp value={ov.users} />} icon={I.Users} sub={`${ov.buyers} buyers · ${ov.sellers} sellers · ${ov.verified_sellers} verified`} />
        <Stat label="Active listings" value={<CountUp value={ov.active_listings} />} icon={I.Tag} tone="info" sub={`${ov.total_listings} total · ${ov.by_country.map((c) => `${c.country_code} ${c.n}`).join(' · ')}`} />
        <Stat label="Orders" value={<CountUp value={ov.orders} />} icon={I.Package} tone="success" sub={`${ov.completed} completed transactions`} />
        <Stat label="Completed GMV" value={<span style={{ fontSize: 20 }}>{sum(ov.gmv)}</span>} icon={I.Wallet} tone="warn" sub={`Platform revenue ${sum(ov.revenue)}`} />
      </div>
      <div className="stat-grid mt-4">
        {[['Listings to review', ov.pending_review, '/admin/listings?status=pending_review', I.Tag], ['Open reports', ov.open_reports, '/admin/reports', I.Flag], ['Open disputes', ov.open_disputes, '/admin/disputes', I.Gavel], ['Seller verifications', ov.pending_verifications, '/admin/verification', I.BadgeCheck], ['Open tickets', ov.open_tickets, '/admin/tickets', I.LifeBuoy]].map(([l, n, to, Ic]) => (
          <Link key={l} to={to} className="stat" style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}><span className="ic" style={n ? { background: 'var(--warning-soft)', color: 'var(--warning-text)' } : undefined}><Ic size={17} /></span><span className="grow"><span className="small muted">{l}</span><br /><b style={{ fontSize: 20 }}>{n}</b></span><I.ChevronRight size={16} className="muted" /></Link>
        ))}
      </div>
      <div className="order-grid mt-5">
        <div className="card"><div className="card-head"><h3>Last 30 days</h3><Legend series={S} /></div><div className="card-body"><LineChart data={ov.series.map((s) => ({ x: s.day, ...s }))} series={S} height={260} /></div></div>
        <div className="card"><div className="card-head"><h3>Recent orders</h3><Link to="/admin/orders" className="section-link">All</Link></div><div className="list-rows">{ov.recent_orders.map((o) => <Link key={o.id} to={`/admin/orders?open=${o.id}`} className="list-row small"><div className="grow" style={{ minWidth: 0 }}><b className="ellipsis" style={{ display: 'block' }}>{o.title}</b><span className="tiny muted">{o.number} · {ago(o.created_at)}</span></div><Status tone={ORDER_TONE[o.status]}>{o.status_label}</Status></Link>)}</div></div>
      </div>
      <div className="card card-pad mt-5"><h3 className="mb-3">Verified payments</h3><div className="row">{ov.verified_payments.map((p) => <Badge key={p.currency} tone="success" icon={I.ShieldCheck}>{p.n} payments · {money(p.amount, p.currency)}</Badge>)}{!ov.verified_payments.length && <span className="muted small">No verified payments yet.</span>}</div></div>
    </>
  );
}

// ---------------- Users ----------------
function Users() {
  useTitle('Users');
  const { query } = useLocation();
  const qs = new URLSearchParams(query).toString();
  const { data, reload } = useApi(`/admin/users?${qs}`, { keep: true });
  const [open, setOpen] = useState(null);
  return (
    <>
      <PageHead title="Users" subtitle="Search, inspect, verify and suspend accounts." />
      <div className="filter-bar">
        <SearchInput value={query.q} onChange={(v) => setQuery({ q: v })} placeholder="Name, email, phone or ID" />
        <Select value={query.role || ''} onChange={(e) => setQuery({ role: e.target.value })} placeholder="All roles" options={Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label }))} />
        <Select value={query.status || ''} onChange={(e) => setQuery({ status: e.target.value })} placeholder="Any status" options={['active', 'suspended']} />
        <Select value={query.seller || ''} onChange={(e) => setQuery({ seller: e.target.value })} placeholder="Any seller status" options={['none', 'pending', 'verified', 'rejected']} />
        <Select value={query.country || ''} onChange={(e) => setQuery({ country: e.target.value })} placeholder="Both countries" options={[{ value: 'IN', label: 'India' }, { value: 'NP', label: 'Nepal' }]} />
        <span className="muted small" style={{ marginLeft: 'auto' }}>{data?.total ?? '…'} users</span>
      </div>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Seller</th><th>Listings</th><th>Orders</th><th>Joined</th></tr></thead>
        <tbody>{data?.items.map((u) => (
          <tr key={u.id} className="clickable" onClick={() => setOpen(u.id)}>
            <td><div className="row nowrap"><Avatar name={u.name} size={34} /><div style={{ minWidth: 0 }}><b className="ellipsis" style={{ display: 'block' }}>{u.name}</b><span className="tiny muted">{u.email || u.phone} · #{u.id} · {u.country_code}</span></div></div></td>
            <td>{u.role !== 'user' ? <Badge tone="accent">{ROLE_LABEL[u.role]}</Badge> : <span className="muted small">User</span>}</td>
            <td><Status tone={u.status === 'active' ? 'success' : 'danger'}>{u.status}</Status></td>
            <td>{u.seller_status === 'verified' ? <Badge tone="info" icon={I.BadgeCheck}>Verified</Badge> : <span className="small muted">{u.seller_status}</span>}</td>
            <td>{u.listings}</td><td>{u.orders}</td><td className="small muted nowrap">{date(u.created_at)}</td>
          </tr>
        ))}</tbody>
      </table></div>
      {data && <Pager page={data.page} pages={data.pages} onPage={(p) => setQuery({ page: p })} />}
      <UserDrawer id={open} onClose={() => setOpen(null)} onChange={reload} />
    </>
  );
}
function UserDrawer({ id, onClose, onChange }) {
  const app = useApp();
  const { data, reload } = useApi(id ? `/admin/users/${id}` : null);
  const u = data?.user;
  const status = async (action) => {
    const reason = action === 'suspend' ? await confirmDialog({ title: `Suspend ${u.name}?`, message: 'They will be signed out and their listings paused.', input: { label: 'Reason (shown to the user)', required: true }, confirm: 'Suspend', danger: true }) : await confirmDialog({ title: `Reactivate ${u.name}?`, confirm: 'Reactivate' });
    if (!reason) return;
    try { await api.post(`/admin/users/${u.id}/status`, { action, reason: typeof reason === 'string' ? reason : undefined }); toast.success('Updated'); reload(); onChange(); } catch (e) { toast.error(e.message); }
  };
  const role = async (r) => { try { await api.post(`/admin/users/${u.id}/role`, { role: r }); toast.success('Role updated'); reload(); onChange(); } catch (e) { toast.error(e.message); } };
  return (
    <Drawer open={!!id} onClose={onClose} title="User details" side="right">
      {!u ? <Skel h={300} /> : (
        <div className="stack" style={{ '--gap': '18px' }}>
          <div className="row nowrap" style={{ '--gap': '14px' }}><Avatar name={u.name} src={u.avatar_url} size={56} /><div><h3>{u.name}</h3><span className="small muted">#{u.id} · joined {date(u.created_at)}</span></div></div>
          <dl className="kv">
            <dt>Email</dt><dd>{u.email || '—'} {u.email_verified_at && <Badge tone="success">verified</Badge>}</dd>
            <dt>Phone</dt><dd>{u.phone || '—'} {u.phone_verified_at && <Badge tone="success">verified</Badge>}</dd>
            <dt>Country</dt><dd>{u.country_code}</dd>
            <dt>Status</dt><dd><Status tone={u.status === 'active' ? 'success' : 'danger'}>{u.status}</Status>{u.suspended_reason && <div className="small muted">{u.suspended_reason}</div>}</dd>
            <dt>Seller</dt><dd>{u.seller_status}</dd>
            <dt>Last seen</dt><dd>{ago(u.last_seen_at)}</dd>
            <dt>Sessions</dt><dd>{data.sessions} active</dd>
          </dl>
          <div className="row">
            {app.can('users.manage') && (u.status === 'active' ? <Button variant="danger-soft" icon={I.Ban} onClick={() => status('suspend')}>Suspend</Button> : <Button variant="success" icon={I.Check} onClick={() => status('reactivate')}>Reactivate</Button>)}
            <Button variant="secondary" icon={I.External} to={`/u/${u.id}`}>Public profile</Button>
          </div>
          {app.can('users.roles') && <Field label="Role"><Select value={u.role} onChange={(e) => role(e.target.value)} options={Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label }))} /></Field>}
          <div><h4 className="mb-2">Listings ({data.listings.length})</h4><div className="stack" style={{ '--gap': '6px' }}>{data.listings.slice(0, 8).map((l) => <Link key={l.id} to={`/l/${l.slug}`} className="spread small"><span className="ellipsis">{l.title}</span><Status tone={LISTING_TONE[l.status]}>{LISTING_LABEL[l.status]}</Status></Link>)}</div></div>
          <div><h4 className="mb-2">Orders ({data.orders.length})</h4><div className="stack" style={{ '--gap': '6px' }}>{data.orders.slice(0, 8).map((o) => <div key={o.id} className="spread small"><span>{o.number} · {o.role}</span><Status tone={ORDER_TONE[o.status]}>{ORDER_LABEL[o.status]}</Status></div>)}</div></div>
          {data.verifications.length > 0 && <div><h4 className="mb-2">Verification history</h4>{data.verifications.map((v) => <div key={v.id} className="small">{v.doc_type} ••••{v.doc_last4} · {v.status} · {date(v.created_at)}</div>)}</div>}
          {data.audit.length > 0 && <div><h4 className="mb-2">Audit trail</h4>{data.audit.map((a) => <div key={a.id} className="small muted">{a.action} · {dateTime(a.created_at)}</div>)}</div>}
        </div>
      )}
    </Drawer>
  );
}

// ---------------- Seller verification ----------------
function Verification() {
  useTitle('Seller verification');
  const [status, setStatus] = useState('pending');
  const { data, reload } = useApi(`/admin/verifications?status=${status}`);
  const decide = async (v, decision) => {
    const notes = decision === 'reject' ? await confirmDialog({ title: 'Reject verification', input: { label: 'Reason (sent to the seller)', required: true }, confirm: 'Reject', danger: true }) : await confirmDialog({ title: `Approve ${v.name}?`, message: 'They will get the verified badge on all listings.', confirm: 'Approve' });
    if (!notes) return;
    try { await api.post(`/admin/verifications/${v.id}`, { decision, notes: typeof notes === 'string' ? notes : undefined }); toast.success(decision === 'approve' ? 'Seller verified' : 'Rejected'); reload(); } catch (e) { toast.error(e.message); }
  };
  return (
    <>
      <PageHead title="Seller verification" subtitle="Only the last 4 characters of document numbers are stored." actions={<Seg value={status} onChange={setStatus} options={[{ value: 'pending', label: 'Pending' }, { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' }]} label="Status" />} />
      {data?.length ? <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>{data.map((v) => (
        <div key={v.id} className="card card-pad stack">
          <div className="row nowrap"><Avatar name={v.name} size={44} /><div className="grow"><b>{v.name}</b><div className="tiny muted">{v.email || v.phone} · {v.country_code}</div></div><Status tone={v.status === 'pending' ? 'warn' : v.status === 'approved' ? 'success' : 'danger'}>{v.status}</Status></div>
          <dl className="kv" style={{ gridTemplateColumns: '120px 1fr' }}><dt>Document</dt><dd>{v.doc_type.replace('_', ' ')} ••••{v.doc_last4}</dd><dt>Name on doc</dt><dd>{v.full_name}{v.full_name.toLowerCase() !== v.name.toLowerCase() && <Badge tone="warn" className="ml-2">differs</Badge>}</dd><dt>Account</dt><dd>since {date(v.user_created)} · {v.email_verified_at ? 'email ✓' : 'email ✗'} · {v.phone_verified_at ? 'phone ✓' : 'phone ✗'}</dd><dt>Activity</dt><dd>{v.listings} listings · {v.sales} sales · {v.reports} reports</dd><dt>Submitted</dt><dd>{dateTime(v.created_at)}</dd></dl>
          {v.notes && <div className="small muted">Notes: {v.notes}</div>}
          {v.status === 'pending' && <div className="row"><Button size="sm" variant="success" icon={I.Check} onClick={() => decide(v, 'approve')}>Approve</Button><Button size="sm" variant="danger-soft" icon={I.X} onClick={() => decide(v, 'reject')}>Reject</Button></div>}
        </div>
      ))}</div> : <Empty icon={I.BadgeCheck} title="Queue is empty" />}
    </>
  );
}

// ---------------- Listing moderation ----------------
function Listings() {
  useTitle('Listing moderation');
  const app = useApp();
  const { query } = useLocation();
  const { data, reload } = useApi(`/admin/listings?${new URLSearchParams(query)}`, { keep: true });
  const mod = async (l, action) => {
    const note = ['reject', 'remove'].includes(action) ? await confirmDialog({ title: `${action === 'reject' ? 'Reject' : 'Remove'} “${l.title}”?`, input: { label: 'Note to the seller', required: true }, confirm: action === 'reject' ? 'Reject' : 'Remove', danger: true }) : true;
    if (!note) return;
    try { await api.post(`/admin/listings/${l.id}/moderate`, { action, note: typeof note === 'string' ? note : undefined }); toast.success('Done'); reload(); } catch (e) { toast.error(e.message); }
  };
  const feature = async (l, days) => { try { await api.post(`/admin/listings/${l.id}/feature`, { days }); toast.success(days ? `Featured for ${days} days` : 'Unfeatured'); reload(); } catch (e) { toast.error(e.message); } };
  return (
    <>
      <PageHead title="Listing moderation" subtitle="Approve held listings, remove prohibited items and feature great ones." />
      <div className="filter-bar">
        <SearchInput value={query.q} onChange={(v) => setQuery({ q: v })} placeholder="Title, seller or ID" />
        <Select value={query.status || ''} onChange={(e) => setQuery({ status: e.target.value })} placeholder="All statuses" options={Object.entries(LISTING_LABEL).map(([value, label]) => ({ value, label }))} />
        <Select value={query.country || ''} onChange={(e) => setQuery({ country: e.target.value })} placeholder="Both countries" options={[{ value: 'IN', label: 'India' }, { value: 'NP', label: 'Nepal' }]} />
        <Toggle label="Reported" checked={!!query.reported} onChange={(v) => setQuery({ reported: v ? '1' : '' })} />
        <Toggle label="Featured" checked={!!query.featured} onChange={(v) => setQuery({ featured: v ? '1' : '' })} />
      </div>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Listing</th><th>Seller</th><th>Status</th><th>Price</th><th>Reports</th><th>Actions</th></tr></thead>
        <tbody>{data?.items.map((l) => (
          <tr key={l.id}>
            <td><div className="row nowrap"><img className="thumb-sm" src={l.thumb} alt="" /><div style={{ minWidth: 0 }}><Link to={`/l/${l.slug}`} className="semibold ellipsis" style={{ display: 'block', maxWidth: 300 }}>{l.title}</Link><span className="tiny muted">#{l.id} · {l.category} · {l.country_code} · {date(l.created_at)}</span>{l.moderation_note && <div className="tiny" style={{ color: 'var(--warning-text)' }}>{l.moderation_note}</div>}</div></div></td>
            <td className="small">{l.seller_name}{l.seller_status === 'verified' && <I.BadgeCheck size={13} className="verified-tick" style={{ display: 'inline', marginLeft: 4 }} />}</td>
            <td><Status tone={LISTING_TONE[l.status]}>{LISTING_LABEL[l.status]}</Status>{l.featured_until > new Date().toISOString().replace('T', ' ') && <Badge tone="grad" className="mt-1">Featured</Badge>}</td>
            <td className="nowrap">{money(l.price_minor, l.currency)}</td>
            <td>{l.open_reports ? <Badge tone="danger">{l.open_reports}</Badge> : '—'}</td>
            <td><div className="row nowrap">
              {['pending_review', 'rejected'].includes(l.status) && <Button size="xs" variant="success" onClick={() => mod(l, 'approve')}>Approve</Button>}
              {['pending_review', 'active'].includes(l.status) && <Button size="xs" variant="secondary" onClick={() => mod(l, 'reject')}>Reject</Button>}
              {l.status !== 'removed' && <Button size="xs" variant="danger-soft" onClick={() => mod(l, 'remove')}>Remove</Button>}
              {l.status === 'removed' && <Button size="xs" variant="secondary" onClick={() => mod(l, 'restore')}>Restore</Button>}
              {app.can('listings.feature') && l.status === 'active' && (l.featured_until > new Date().toISOString().replace('T', ' ') ? <Button size="xs" variant="ghost" onClick={() => feature(l, 0)}>Unfeature</Button> : <Button size="xs" variant="soft" icon={I.Sparkles} onClick={() => feature(l, 14)}>Feature</Button>)}
            </div></td>
          </tr>
        ))}</tbody>
      </table></div>
      {data?.items.length === 0 && <Empty icon={I.Tag} title="No listings match" />}
      {data && <Pager page={data.page} pages={data.pages} onPage={(p) => setQuery({ page: p })} />}
    </>
  );
}

// ---------------- Categories ----------------
function Categories() {
  useTitle('Categories');
  const { data, reload } = useApi('/admin/categories');
  const [edit, setEdit] = useState(null);
  const [attrFor, setAttrFor] = useState(null);
  if (!data) return <Skel h={400} r={20} />;
  const roots = data.categories.filter((c) => !c.parent_id);
  const del = async (c) => { if (!(await confirmDialog({ title: `Delete ${c.name}?`, message: 'Only possible when no listings use it.', confirm: 'Delete', danger: true }))) return; try { await api.del(`/admin/categories/${c.id}`); reload(); } catch (e) { toast.error(e.message); } };
  return (
    <>
      <PageHead title="Categories" subtitle={`${roots.length} main categories · ${data.categories.length - roots.length} subcategories`} actions={<Button icon={I.Plus} onClick={() => setEdit({})}>New category</Button>} />
      <div className="stack">{roots.map((r) => (
        <div key={r.id} className="card">
          <div className="card-head">
            <div className="row"><span className="ctile-icon" style={{ '--c': r.color, width: 38, height: 38 }}><I.CatIcon name={r.icon} size={20} /></span><div><b>{r.name}</b> <span className="tiny muted">/{r.slug} · {r.allows_delivery ? 'delivery allowed' : 'pickup only'}{!r.active ? ' · hidden' : ''}</span></div></div>
            <div className="row"><Button size="xs" variant="ghost" icon={I.Plus} onClick={() => setEdit({ parent_id: r.id, color: r.color })}>Subcategory</Button><Button size="xs" variant="secondary" icon={I.Pencil} onClick={() => setEdit(r)}>Edit</Button></div>
          </div>
          <div className="list-rows">{data.categories.filter((c) => c.parent_id === r.id).map((c) => (
            <div key={c.id} className="list-row small">
              <I.CatIcon name={c.icon} size={18} style={{ color: r.color }} />
              <span className="grow"><b>{c.name}</b> <span className="muted tiny">/{c.slug}</span>{c.moderation === 'review' && <Badge tone="warn" className="ml-2" style={{ marginLeft: 8 }}>Manual review</Badge>}{!c.active && <Badge style={{ marginLeft: 8 }}>Hidden</Badge>}</span>
              <span className="muted tiny">{c.listings} listings · {c.attributes} fields</span>
              <Button size="xs" variant="ghost" icon={I.Sliders} onClick={() => setAttrFor(c)}>Fields</Button>
              <Button size="xs" variant="ghost" icon={I.Pencil} onClick={() => setEdit(c)} aria-label="Edit" />
              <Button size="xs" variant="ghost" icon={I.Trash} onClick={() => del(c)} aria-label="Delete" />
            </div>
          ))}</div>
        </div>
      ))}</div>
      <CategoryModal value={edit} roots={roots} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />
      <AttributesModal category={attrFor} attrs={data.attributes.filter((a) => a.category_id === attrFor?.id)} onClose={() => setAttrFor(null)} onChange={reload} />
    </>
  );
}
function CategoryModal({ value, roots, onClose, onSaved }) {
  const [f, setF] = useState({});
  useEffect(() => { if (value) setF({ name: '', slug: '', icon: 'Tag', color: '#6A4DFF', description: '', seo_title: '', seo_description: '', moderation: 'auto', allows_delivery: true, sort: 0, active: true, parent_id: null, ...value, allows_delivery: value.allows_delivery === undefined ? true : !!value.allows_delivery, active: value.active === undefined ? true : !!value.active }); }, [value]);
  const save = async () => {
    const body = { name: f.name, slug: f.slug || undefined, parent_id: f.parent_id ? Number(f.parent_id) : null, icon: f.icon, color: f.color || null, description: f.description || null, seo_title: f.seo_title || null, seo_description: f.seo_description || null, moderation: f.moderation, allows_delivery: !!f.allows_delivery, sort: Number(f.sort) || 0, active: !!f.active };
    try { value.id ? await api.put(`/admin/categories/${value.id}`, body) : await api.post('/admin/categories', body); toast.success('Category saved'); onSaved(); } catch (e) { toast.error(e.message); }
  };
  return (
    <Modal open={!!value} onClose={onClose} title={value?.id ? `Edit ${value.name}` : 'New category'} width={640} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!f.name}>Save</Button></>}>
      <div className="form-grid">
        <Field label="Name"><Input value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Slug" help="Leave empty to generate"><Input value={f.slug || ''} onChange={(e) => setF({ ...f, slug: e.target.value })} /></Field>
        <Field label="Parent"><Select value={f.parent_id || ''} onChange={(e) => setF({ ...f, parent_id: e.target.value })} placeholder="— Main category —" options={roots.filter((r) => r.id !== value?.id).map((r) => ({ value: r.id, label: r.name }))} /></Field>
        <Field label="Icon"><div className="row nowrap"><span className="ctile-icon" style={{ '--c': f.color, width: 44, height: 44 }}><I.CatIcon name={f.icon} size={22} /></span><Select value={f.icon} onChange={(e) => setF({ ...f, icon: e.target.value })} options={Object.keys(I.CAT_ICONS)} /></div></Field>
        <Field label="Colour"><Input type="color" value={f.color || '#6A4DFF'} onChange={(e) => setF({ ...f, color: e.target.value })} style={{ padding: 4 }} /></Field>
        <Field label="Sort order"><Input type="number" value={f.sort ?? 0} onChange={(e) => setF({ ...f, sort: e.target.value })} /></Field>
        <Field label="Description" className="span-2"><Input value={f.description || ''} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="SEO title" className="span-2" help={`${(f.seo_title || '').length}/70`}><Input value={f.seo_title || ''} maxLength={70} onChange={(e) => setF({ ...f, seo_title: e.target.value })} /></Field>
        <Field label="SEO description" className="span-2" help={`${(f.seo_description || '').length}/170`}><Textarea rows={2} value={f.seo_description || ''} maxLength={170} onChange={(e) => setF({ ...f, seo_description: e.target.value })} /></Field>
        <Field label="Moderation"><Seg value={f.moderation} onChange={(v) => setF({ ...f, moderation: v })} options={[{ value: 'auto', label: 'Auto-publish' }, { value: 'review', label: 'Manual review' }]} label="Moderation" /></Field>
        <div className="stack"><Toggle label="Allow home delivery" checked={f.allows_delivery} onChange={(v) => setF({ ...f, allows_delivery: v })} /><Toggle label="Visible" checked={f.active} onChange={(v) => setF({ ...f, active: v })} /></div>
      </div>
    </Modal>
  );
}
function AttributesModal({ category, attrs, onClose, onChange }) {
  const [f, setF] = useState(null);
  const save = async () => {
    const body = { key: f.key, label: f.label, type: f.type, options: f.type === 'select' ? f.optionsText.split(',').map((s) => s.trim()).filter(Boolean) : null, unit: f.unit || null, required: !!f.required, filterable: !!f.filterable, sort: Number(f.sort) || 0 };
    try { f.id ? await api.put(`/admin/attributes/${f.id}`, body) : await api.post(`/admin/categories/${category.id}/attributes`, body); toast.success('Field saved'); setF(null); onChange(); } catch (e) { toast.error(e.message); }
  };
  return (
    <Modal open={!!category} onClose={() => { setF(null); onClose(); }} title={`${category?.name} — listing fields`} subtitle="Category-specific fields shown in the sell form and filters." width={720}>
      {!f ? <>
        <div className="table-wrap"><table className="table"><thead><tr><th>Field</th><th>Type</th><th>Required</th><th>Filter</th><th /></tr></thead>
          <tbody>{attrs.map((a) => <tr key={a.id}><td><b>{a.label}</b> <span className="tiny muted">{a.key}{a.unit ? ` · ${a.unit}` : ''}</span>{a.options && <div className="tiny muted ellipsis" style={{ maxWidth: 280 }}>{a.options.join(', ')}</div>}</td><td>{a.type}</td><td>{a.required ? '✓' : ''}</td><td>{a.filterable ? '✓' : ''}</td><td><div className="row nowrap"><Button size="xs" variant="ghost" icon={I.Pencil} onClick={() => setF({ ...a, optionsText: (a.options || []).join(', ') })} aria-label="Edit" /><Button size="xs" variant="ghost" icon={I.Trash} aria-label="Delete" onClick={async () => { if (await confirmDialog({ title: `Delete ${a.label}?`, confirm: 'Delete', danger: true })) { await api.del(`/admin/attributes/${a.id}`); onChange(); } }} /></div></td></tr>)}</tbody></table></div>
        {!attrs.length && <p className="muted small mt-3">No fields yet (parent category fields still apply).</p>}
        <Button className="mt-4" icon={I.Plus} onClick={() => setF({ key: '', label: '', type: 'text', optionsText: '', unit: '', required: false, filterable: false, sort: attrs.length })}>Add field</Button>
      </> : (
        <div className="form-grid">
          <Field label="Label"><Input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value, key: f.id ? f.key : e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') })} /></Field>
          <Field label="Key"><Input value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} /></Field>
          <Field label="Type"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} options={['text', 'number', 'select', 'boolean']} /></Field>
          <Field label="Unit"><Input value={f.unit || ''} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="km, GB, sq ft…" /></Field>
          {f.type === 'select' && <Field label="Options (comma-separated)" className="span-2"><Input value={f.optionsText} onChange={(e) => setF({ ...f, optionsText: e.target.value })} /></Field>}
          <div className="row span-2"><Toggle label="Required" checked={f.required} onChange={(v) => setF({ ...f, required: v })} /><Toggle label="Use as search filter" checked={f.filterable} onChange={(v) => setF({ ...f, filterable: v })} /></div>
          <div className="row span-2"><Button onClick={save}>Save field</Button><Button variant="ghost" onClick={() => setF(null)}>Cancel</Button></div>
        </div>
      )}
    </Modal>
  );
}

// ---------------- Orders ----------------
function Orders() {
  useTitle('Orders');
  const { query } = useLocation();
  const qp = new URLSearchParams(query); qp.delete('open');
  const { data, reload } = useApi(`/admin/orders?${qp}`, { keep: true });
  const [open, setOpen] = useState(query.open ? Number(query.open) : null);
  return (
    <>
      <PageHead title="Orders" subtitle="Every transaction on PASAL with its full history." />
      <div className="filter-bar">
        <SearchInput value={query.q} onChange={(v) => setQuery({ q: v })} placeholder="Order no., item, buyer or seller" />
        <Select value={query.status || ''} onChange={(e) => setQuery({ status: e.target.value })} placeholder="All statuses" options={Object.entries(ORDER_LABEL).map(([value, label]) => ({ value, label }))} />
        <Select value={query.method || ''} onChange={(e) => setQuery({ method: e.target.value })} placeholder="All payment methods" options={Object.entries(PAY_METHOD).map(([value, label]) => ({ value, label }))} />
      </div>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Order</th><th>Buyer → Seller</th><th>Method</th><th>Total</th><th>Payment</th><th>Status</th></tr></thead>
        <tbody>{data?.items.map((o) => (
          <tr key={o.id} className="clickable" onClick={() => setOpen(o.id)}>
            <td><b className="ellipsis" style={{ display: 'block', maxWidth: 260 }}>{o.title}</b><span className="tiny muted">{o.number} · {dateTime(o.created_at)}</span></td>
            <td className="small">{o.buyer_name} → {o.seller_name}</td>
            <td className="small">{o.fulfillment === 'pickup' ? 'Pickup' : 'Delivery'}<br /><span className="tiny muted">{PAY_METHOD[o.payment_method]}</span></td>
            <td className="semibold nowrap">{money(o.total_minor, o.currency)}</td>
            <td>{o.payment_status ? <Status tone={o.payment_status === 'captured' ? 'success' : o.payment_status === 'failed' ? 'danger' : 'warn'}>{o.payment_status}</Status> : <span className="muted small">—</span>}</td>
            <td><Status tone={ORDER_TONE[o.status]}>{o.status_label}</Status></td>
          </tr>
        ))}</tbody>
      </table></div>
      {data && <Pager page={data.page} pages={data.pages} onPage={(p) => setQuery({ page: p })} />}
      <OrderDrawer id={open} onClose={() => setOpen(null)} onChange={reload} />
    </>
  );
}
function OrderDrawer({ id, onClose, onChange }) {
  const app = useApp();
  const { data: o, reload } = useApi(id ? `/orders/${id}` : null);
  const act = async (to) => { const note = await confirmDialog({ title: `${ORDER_LABEL[to]} order?`, input: { label: 'Note (visible to both parties)', required: true }, confirm: 'Confirm', danger: to !== 'completed' }); if (!note) return; try { await api.post(`/admin/orders/${id}/transition`, { to, note }); toast.success('Order updated'); reload(); onChange(); } catch (e) { toast.error(e.message); } };
  const refund = async () => { const reason = await confirmDialog({ title: 'Refund the full verified payment?', input: { label: 'Reason', required: true }, confirm: 'Refund', danger: true }); if (!reason) return; try { const r = await api.post(`/admin/orders/${id}/refund`, { reason }); toast.success(r.manual ? `Recorded — ${r.note}` : 'Refund processed'); reload(); onChange(); } catch (e) { toast.error(e.message); } };
  return (
    <Drawer open={!!id} onClose={onClose} title={o ? `Order ${o.number}` : 'Order'} side="right">
      {!o ? <Skel h={300} /> : (
        <div className="stack" style={{ '--gap': '16px' }}>
          <div className="row"><Status tone={ORDER_TONE[o.status]}>{o.status_label}</Status><Badge>{o.fulfillment}</Badge><Badge>{PAY_METHOD[o.payment_method]}</Badge></div>
          <div className="row nowrap"><img className="thumb-md" src={o.items[0].image_url} alt="" /><div><b>{o.items[0].title}</b><div className="small muted">{money(o.total_minor, o.currency)}</div></div></div>
          <dl className="kv"><dt>Buyer</dt><dd>{o.buyer.name}</dd><dt>Seller</dt><dd>{o.seller.name}</dd><dt>Placed</dt><dd>{dateTime(o.created_at)}</dd>{o.address && <><dt>Ship to</dt><dd>{[o.address.line1, o.address.city, o.address.postal_code].filter(Boolean).join(', ')}</dd></>}{o.tracking_number && <><dt>Tracking</dt><dd>{o.carrier} {o.tracking_number}</dd></>}</dl>
          <div><h4 className="mb-2">Payments</h4>{o.payments.length ? o.payments.map((p) => <div key={p.id} className="spread small"><span>{p.provider} · {p.provider_payment_id || p.provider_order_id}</span><Status tone={p.status === 'captured' ? 'success' : 'warn'}>{p.status}{p.verified_via ? ` (${p.verified_via})` : ''}</Status></div>) : <span className="small muted">No online payments</span>}</div>
          {o.refunds.length > 0 && <div><h4 className="mb-2">Refunds</h4>{o.refunds.map((r) => <div key={r.id} className="spread small"><span>{r.reason}</span><b>{money(r.amount_minor, r.currency)} · {r.status}</b></div>)}</div>}
          <div><h4 className="mb-2">History</h4>{o.history.map((h) => <div key={h.id} className="small"><b>{ORDER_LABEL[h.to_status]}</b> <span className="muted">· {h.actor_name || 'system'} · {dateTime(h.created_at)}{h.note ? ` — ${h.note}` : ''}</span></div>)}</div>
          <div className="row">
            {o.actions.includes('completed') && <Button size="sm" variant="success" onClick={() => act('completed')}>Force complete</Button>}
            {o.actions.includes('cancelled') && <Button size="sm" variant="danger-soft" onClick={() => act('cancelled')}>Cancel</Button>}
            {app.can('refunds.manage') && o.payment_verified && !['refunded'].includes(o.status) && <Button size="sm" variant="secondary" icon={I.Undo} onClick={refund}>Refund payment</Button>}
            {o.conversation_id && <Button size="sm" variant="ghost" to={`/messages/${o.conversation_id}`} disabled>Chat (participants only)</Button>}
          </div>
        </div>
      )}
    </Drawer>
  );
}

// ---------------- Payments ----------------
function Payments() {
  useTitle('Payments');
  const { query } = useLocation();
  const { data } = useApi(`/admin/payments?${new URLSearchParams(query)}`, { keep: true });
  return (
    <>
      <PageHead title="Payments" subtitle="Gateway transactions verified on the server, refunds and webhook events." />
      <div className="stat-grid mb-5">{data?.providers.map((p) => <div key={p.id} className="stat"><div className="label-row">{p.label}<span className="ic"><I.Wallet size={16} /></span></div><div className="row">{p.configured ? <Badge tone="success" icon={I.Check}>Configured</Badge> : <Badge tone="warn">Missing credentials</Badge>}<Badge>{p.mode} mode</Badge><Badge>{p.countries.join(', ')}</Badge></div></div>)}</div>
      <div className="filter-bar"><Select value={query.status || ''} onChange={(e) => setQuery({ status: e.target.value })} placeholder="All statuses" options={['created', 'captured', 'failed', 'refunded', 'partially_refunded']} /><Select value={query.provider || ''} onChange={(e) => setQuery({ provider: e.target.value })} placeholder="All providers" options={['razorpay', 'esewa', 'sandbox']} /></div>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Order</th><th>Provider</th><th>Gateway IDs</th><th>Amount</th><th>Status</th><th>Verified via</th><th>Created</th></tr></thead>
        <tbody>{data?.items.map((p) => <tr key={p.id}><td className="semibold">{p.number}</td><td>{p.provider}</td><td className="tiny mono">{p.provider_order_id}<br />{p.provider_payment_id || '—'}</td><td className="nowrap">{money(p.amount_minor, p.currency)}</td><td><Status tone={p.status === 'captured' ? 'success' : p.status === 'failed' ? 'danger' : 'warn'}>{p.status}</Status>{p.failure_reason && <div className="tiny muted">{p.failure_reason}</div>}</td><td className="small">{p.verified_via || '—'}</td><td className="small muted nowrap">{dateTime(p.created_at)}</td></tr>)}</tbody>
      </table></div>
      {data && <Pager page={data.page} pages={data.pages} onPage={(p) => setQuery({ page: p })} />}
      <div className="order-grid mt-5" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="card"><div className="card-head"><h3>Refunds</h3></div><div className="list-rows">{data?.refunds.map((r) => <div key={r.id} className="list-row small"><span className="grow">{r.number} · {r.reason}</span><b>{money(r.amount_minor, r.currency)}</b><Status tone={r.status === 'processed' ? 'success' : r.status === 'failed' ? 'danger' : 'warn'}>{r.status}</Status></div>)}{!data?.refunds.length && <div className="card-body small muted">No refunds.</div>}</div></div>
        <div className="card"><div className="card-head"><h3>Webhook events (deduplicated)</h3></div><div className="list-rows">{data?.events.map((e) => <div key={e.id} className="list-row small"><span className="grow mono tiny">{e.event_id}</span><span>{e.type}</span><span className="muted tiny">{ago(e.processed_at)}</span></div>)}{!data?.events.length && <div className="card-body small muted">No events yet.</div>}</div></div>
      </div>
    </>
  );
}

// ---------------- Disputes ----------------
function Disputes() {
  useTitle('Disputes');
  const [status, setStatus] = useState('open');
  const { data, reload } = useApi(`/admin/disputes?status=${status}`);
  const act = async (d, action) => {
    let note;
    if (action !== 'review') { note = await confirmDialog({ title: { refund_buyer: 'Refund the buyer', release_seller: 'Release to seller (complete order)', cancelled: 'Cancel the order' }[action], message: d.payment_method === 'online' && action === 'refund_buyer' ? 'The verified online payment will be refunded.' : action === 'refund_buyer' ? 'Direct payment — PASAL cannot move money; both parties are told to settle.' : undefined, input: { label: 'Resolution note for both parties', required: true }, confirm: 'Resolve', danger: action !== 'release_seller' }); if (!note) return; }
    try { await api.post(`/admin/disputes/${d.id}`, { action, note }); toast.success('Dispute updated'); reload(); } catch (e) { toast.error(e.message); }
  };
  return (
    <>
      <PageHead title="Disputes" actions={<Seg value={status} onChange={setStatus} options={[{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Resolved' }]} label="Status" />} />
      {data?.length ? <div className="stack">{data.map((d) => (
        <div key={d.id} className="card card-pad">
          <div className="spread"><div><b>{d.reason}</b> <span className="muted small">· #{d.id} · order {d.number}</span></div><Status tone={d.status === 'open' ? 'danger' : d.status === 'under_review' ? 'warn' : 'success'}>{d.status.replace('_', ' ')}</Status></div>
          <p className="small text-2 mt-2">{d.details}</p>
          <div className="row small muted mt-2" style={{ '--gap': '14px' }}><span>Item: {d.title}</span><span>{money(d.total_minor, d.currency)} · {PAY_METHOD[d.payment_method]}</span><span>Opened by {d.opened_by_name} ({d.opened_by_role}) {ago(d.created_at)}</span><span>{d.buyer_name} → {d.seller_name}</span></div>
          {d.resolution_note && <div className="callout info small mt-3"><I.Gavel size={15} />{d.outcome?.replace('_', ' ')}: {d.resolution_note}</div>}
          {['open', 'under_review'].includes(d.status) && <div className="row mt-4">{d.status === 'open' && <Button size="sm" variant="secondary" onClick={() => act(d, 'review')}>Start review</Button>}<Button size="sm" variant="danger-soft" onClick={() => act(d, 'refund_buyer')}>Refund buyer</Button><Button size="sm" variant="success" onClick={() => act(d, 'release_seller')}>Release to seller</Button><Button size="sm" variant="ghost" onClick={() => act(d, 'cancelled')}>Cancel order</Button><Button size="sm" variant="ghost" to={`/admin/orders?open=${d.order_id}`}>View order</Button></div>}
        </div>
      ))}</div> : <Empty icon={I.Gavel} title="No disputes" />}
    </>
  );
}

// ---------------- Reports ----------------
function Reports() {
  useTitle('Reports');
  const [status, setStatus] = useState('open');
  const [type, setType] = useState('');
  const { data, reload } = useApi(`/admin/reports?status=${status}&type=${type}`);
  const act = async (r, action) => {
    const note = action === 'dismiss' ? 'Dismissed' : await confirmDialog({ title: 'Take action', input: { label: 'Note (sent to the owner)', required: true }, confirm: 'Confirm', danger: true });
    if (!note) return;
    try { await api.post(`/admin/reports/${r.id}`, { action, note }); toast.success('Report handled'); reload(); } catch (e) { toast.error(e.message); }
  };
  return (
    <>
      <PageHead title="Reports" subtitle="Listings with 3+ reports are hidden automatically until reviewed." actions={<><Select value={type} onChange={(e) => setType(e.target.value)} placeholder="All types" options={['listing', 'user', 'review', 'message']} style={{ width: 150 }} /><Seg value={status} onChange={setStatus} options={[{ value: 'open', label: 'Open' }, { value: 'actioned', label: 'Actioned' }, { value: 'dismissed', label: 'Dismissed' }]} label="Status" /></>} />
      {data?.length ? <div className="table-wrap"><table className="table">
        <thead><tr><th>Target</th><th>Reason</th><th>Reporter</th><th>When</th><th /></tr></thead>
        <tbody>{data.map((r) => (
          <tr key={r.id}>
            <td><Badge>{r.target_type}</Badge> {r.target_type === 'listing' && r.target ? <Link to={`/l/${r.target.slug}`} className="link">{r.target.title}</Link> : r.target_type === 'user' && r.target ? <span>{r.target.name}</span> : <span className="small ellipsis" style={{ maxWidth: 260, display: 'inline-block', verticalAlign: 'bottom' }}>{r.target?.body}</span>}</td>
            <td><b className="small">{r.reason.replace('_', ' ')}</b>{r.details && <div className="tiny muted">{r.details}</div>}</td>
            <td className="small">{r.reporter_name}</td><td className="small muted nowrap">{ago(r.created_at)}</td>
            <td>{status === 'open' && <div className="row nowrap"><Button size="xs" variant="secondary" onClick={() => act(r, 'dismiss')}>Dismiss</Button>{r.target_type !== 'user' ? <Button size="xs" variant="danger-soft" onClick={() => act(r, 'remove_target')}>{r.target_type === 'review' ? 'Hide review' : 'Remove'}</Button> : <Button size="xs" variant="ghost" to={`/admin/users?q=${r.target_id}`}>Review user</Button>}</div>}{status !== 'open' && <span className="tiny muted">{r.resolution}</span>}</td>
          </tr>
        ))}</tbody>
      </table></div> : <Empty icon={I.Flag} title="No reports" />}
    </>
  );
}

// ---------------- Promotions & homepage ----------------
function Promotions() {
  useTitle('Promotions');
  const { data, reload } = useApi('/admin/promotions');
  const [edit, setEdit] = useState(null);
  const [sections, setSections] = useState(null);
  useEffect(() => { if (data) setSections(data.sections); }, [data]);
  if (!data) return <Skel h={400} r={20} />;
  const saveSections = async () => { try { await api.put('/admin/homepage-sections', sections.map((s, i) => ({ id: s.id, active: !!s.active, sort: i, title: s.title, subtitle: s.subtitle }))); toast.success('Homepage updated'); reload(); } catch (e) { toast.error(e.message); } };
  const move = (i, d) => setSections((s) => { const a = [...s]; const [x] = a.splice(i, 1); a.splice(i + d, 0, x); return a; });
  return (
    <>
      <PageHead title="Promotions & homepage" subtitle="Banners, hero messages and the order of homepage sections." actions={<Button icon={I.Plus} onClick={() => setEdit({})}>New promotion</Button>} />
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
        {data.promotions.map((p) => (
          <div key={p.id} className="stack" style={{ '--gap': '8px' }}>
            <div className="promo" data-theme-name={p.theme} style={{ minHeight: 150, opacity: p.active ? 1 : 0.5 }}><div><h3 style={{ fontSize: 18 }}>{p.title}</h3>{p.subtitle && <p>{p.subtitle}</p>}</div>{p.cta_label && <span className="btn btn-sm">{p.cta_label}</span>}</div>
            <div className="spread small"><span className="row" style={{ '--gap': '6px' }}><Badge>{p.placement}</Badge>{p.country_code && <Badge>{p.country_code}</Badge>}<span className="muted">{p.clicks} clicks</span></span><span className="row"><Button size="xs" variant="ghost" icon={I.Pencil} onClick={() => setEdit(p)}>Edit</Button><Button size="xs" variant="ghost" icon={I.Trash} aria-label="Delete" onClick={async () => { if (await confirmDialog({ title: 'Delete promotion?', confirm: 'Delete', danger: true })) { await api.del(`/admin/promotions/${p.id}`); reload(); } }} /></span></div>
          </div>
        ))}
      </div>
      <section className="section">
        <div className="section-head"><div><h2>Homepage sections</h2><p>Reorder, rename or hide sections. Listing sections fill automatically from live data.</p></div><Button icon={I.Check} onClick={saveSections}>Save homepage</Button></div>
        <div className="card"><div className="list-rows">{sections?.map((s, i) => (
          <div key={s.id} className="list-row">
            <div className="stack" style={{ '--gap': '2px' }}><IconButton icon={I.ChevronDown} label="Move up" className="sm" style={{ transform: 'rotate(180deg)' }} disabled={i === 0} onClick={() => move(i, -1)} /><IconButton icon={I.ChevronDown} label="Move down" className="sm" disabled={i === sections.length - 1} onClick={() => move(i, 1)} /></div>
            <Input className="input-sm" value={s.title} onChange={(e) => setSections((a) => a.map((x) => (x.id === s.id ? { ...x, title: e.target.value } : x)))} style={{ maxWidth: 260 }} />
            <span className="tiny muted grow">{s.kind} · {s.key}</span>
            <Toggle checked={!!s.active} onChange={(v) => setSections((a) => a.map((x) => (x.id === s.id ? { ...x, active: v } : x)))} label={s.active ? 'Shown' : 'Hidden'} />
          </div>
        ))}</div></div>
      </section>
      <PromoModal value={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />
    </>
  );
}
function PromoModal({ value, onClose, onSaved }) {
  const [f, setF] = useState({});
  useEffect(() => { if (value) setF({ placement: 'banner', title: '', subtitle: '', cta_label: '', link: '/', theme: 'violet', country_code: '', starts_at: '', ends_at: '', active: true, sort: 0, ...value, active: value.active === undefined ? true : !!value.active }); }, [value]);
  const save = async () => {
    const body = { ...f, country_code: f.country_code || null, subtitle: f.subtitle || null, cta_label: f.cta_label || null, starts_at: f.starts_at || null, ends_at: f.ends_at || null, active: !!f.active, sort: Number(f.sort) || 0 };
    for (const k of ['id', 'clicks', 'created_at']) delete body[k];
    try { value.id ? await api.put(`/admin/promotions/${value.id}`, body) : await api.post('/admin/promotions', body); toast.success('Saved'); onSaved(); } catch (e) { toast.error(e.message); }
  };
  return (
    <Modal open={!!value} onClose={onClose} title={value?.id ? 'Edit promotion' : 'New promotion'} width={620} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!f.title}>Save</Button></>}>
      <div className="promo mb-5" data-theme-name={f.theme} style={{ minHeight: 140 }}><div><h3 style={{ fontSize: 18 }}>{f.title || 'Promotion title'}</h3>{f.subtitle && <p>{f.subtitle}</p>}</div>{f.cta_label && <span className="btn btn-sm">{f.cta_label}</span>}</div>
      <div className="form-grid">
        <Field label="Placement"><Select value={f.placement} onChange={(e) => setF({ ...f, placement: e.target.value })} options={[{ value: 'hero', label: 'Hero eyebrow' }, { value: 'banner', label: 'Homepage banner' }, { value: 'strip', label: 'Strip' }, { value: 'ad', label: 'Ad slot' }]} /></Field>
        <Field label="Theme"><Select value={f.theme} onChange={(e) => setF({ ...f, theme: e.target.value })} options={['violet', 'midnight', 'sunrise', 'mint', 'ocean']} /></Field>
        <Field label="Title" className="span-2"><Input value={f.title || ''} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Subtitle" className="span-2"><Input value={f.subtitle || ''} onChange={(e) => setF({ ...f, subtitle: e.target.value })} /></Field>
        <Field label="Button label"><Input value={f.cta_label || ''} onChange={(e) => setF({ ...f, cta_label: e.target.value })} /></Field>
        <Field label="Link (site path)"><Input value={f.link || ''} onChange={(e) => setF({ ...f, link: e.target.value })} placeholder="/c/smartphones" /></Field>
        <Field label="Country"><Select value={f.country_code || ''} onChange={(e) => setF({ ...f, country_code: e.target.value })} placeholder="Both" options={[{ value: 'IN', label: 'India' }, { value: 'NP', label: 'Nepal' }]} /></Field>
        <Field label="Sort"><Input type="number" value={f.sort ?? 0} onChange={(e) => setF({ ...f, sort: e.target.value })} /></Field>
        <Field label="Starts"><Input type="date" value={(f.starts_at || '').slice(0, 10)} onChange={(e) => setF({ ...f, starts_at: e.target.value })} /></Field>
        <Field label="Ends"><Input type="date" value={(f.ends_at || '').slice(0, 10)} onChange={(e) => setF({ ...f, ends_at: e.target.value ? `${e.target.value} 23:59:59` : '' })} /></Field>
        <Toggle label="Active" checked={f.active} onChange={(v) => setF({ ...f, active: v })} />
      </div>
    </Modal>
  );
}

// ---------------- Analytics ----------------
function Analytics() {
  useTitle('Analytics');
  const [days, setDays] = useState(30);
  const { data } = useApi(`/admin/analytics?days=${days}`);
  const S = [{ key: 'views', label: 'Listing views' }, { key: 'messages', label: 'Messages', color: 'var(--accent-2)' }];
  const S2 = [{ key: 'signups', label: 'Signups' }, { key: 'listings', label: 'Listings', color: 'var(--accent-2)' }, { key: 'orders', label: 'Orders', color: '#12C08A' }];
  return (
    <>
      <PageHead title="Analytics" actions={<Seg value={days} onChange={setDays} options={[{ value: 7, label: '7d' }, { value: 30, label: '30d' }, { value: 90, label: '90d' }]} label="Range" />} />
      {!data ? <Skel h={500} r={20} /> : <>
        <div className="order-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="card"><div className="card-head"><h3>Engagement</h3><Legend series={S} /></div><div className="card-body"><LineChart data={data.series.map((s) => ({ x: s.day, ...s }))} series={S} height={220} /></div></div>
          <div className="card"><div className="card-head"><h3>Growth</h3><Legend series={S2} /></div><div className="card-body"><LineChart data={data.series.map((s) => ({ x: s.day, ...s }))} series={S2} height={220} /></div></div>
        </div>
        <div className="order-grid mt-5" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="card"><div className="card-head"><h3>Marketplace funnel</h3></div><div className="card-body"><BarList rows={[{ label: 'Listing views', value: data.funnel.views }, { label: 'Conversations', value: data.funnel.conversations }, { label: 'Offers', value: data.funnel.offers }, { label: 'Orders', value: data.funnel.orders }, { label: 'Completed', value: data.funnel.completed }]} /></div></div>
          <div className="card"><div className="card-head"><h3>Payment & fulfilment mix</h3></div><div className="card-body stack" style={{ '--gap': '20px' }}><Donut label="orders" parts={data.payment_mix.map((p) => ({ label: PAY_METHOD[p.payment_method], value: p.n }))} /><Donut label="orders" parts={data.fulfillment_mix.map((p) => ({ label: p.fulfillment, value: p.n }))} /></div></div>
        </div>
        <div className="order-grid mt-5" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          <div className="card"><div className="card-head"><h3>Top categories</h3></div><div className="card-body"><BarList rows={data.categories.map((c) => ({ label: c.name, value: c.listings }))} /></div></div>
          <div className="card"><div className="card-head"><h3>Top cities</h3></div><div className="card-body"><BarList rows={data.cities.map((c) => ({ label: `${c.name} (${c.country_code})`, value: c.listings }))} /></div></div>
          <div className="card"><div className="card-head"><h3>Searches</h3></div><div className="card-body"><BarList rows={data.top_searches.map((s) => ({ label: s.term, value: s.n }))} />{data.zero_result_searches.length > 0 && <><h4 className="mt-5 mb-2 small">Zero-result searches (supply gaps)</h4><div className="chips">{data.zero_result_searches.map((s) => <Badge key={s.term} tone="warn">{s.term} · {s.n}</Badge>)}</div></>}</div></div>
        </div>
      </>}
    </>
  );
}

// ---------------- Tickets ----------------
function Tickets() {
  useTitle('Support tickets');
  const [status, setStatus] = useState('open');
  const { data, reload } = useApi(`/admin/tickets?status=${status}`);
  const [open, setOpen] = useState(null);
  const pt = { urgent: 'danger', high: 'warn', normal: 'info', low: '' };
  return (
    <>
      <PageHead title="Support tickets" actions={<Seg value={status} onChange={setStatus} options={[{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Resolved' }]} label="Status" />} />
      {data?.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Ticket</th><th>From</th><th>Category</th><th>Priority</th><th>Assignee</th><th>Updated</th><th>Status</th></tr></thead>
        <tbody>{data.map((t) => <tr key={t.id} className="clickable" onClick={() => setOpen(t.id)}><td><b>{t.subject}</b><div className="tiny muted">T-{String(t.id).padStart(5, '0')} · {t.messages} messages</div></td><td className="small">{t.name}<div className="tiny muted">{t.email}</div></td><td><Badge>{t.category}</Badge></td><td><Status tone={pt[t.priority]}>{t.priority}</Status></td><td className="small">{t.assignee || '—'}</td><td className="small muted">{ago(t.updated_at)}</td><td><Status tone={t.status === 'open' ? 'warn' : t.status === 'pending' ? 'accent' : 'success'}>{t.status}</Status></td></tr>)}</tbody></table></div> : <Empty icon={I.LifeBuoy} title="No tickets" />}
      <TicketDrawer id={open} onClose={() => setOpen(null)} onChange={reload} />
    </>
  );
}
function TicketDrawer({ id, onClose, onChange }) {
  const { data: t, reload } = useApi(id ? `/admin/tickets/${id}` : null);
  const [reply, setReply] = useState('');
  const update = async (patch) => { try { await api.post(`/admin/tickets/${id}`, patch); setReply(''); reload(); onChange(); toast.success('Ticket updated'); } catch (e) { toast.error(e.message); } };
  return (
    <Drawer open={!!id} onClose={onClose} title={t ? t.subject : 'Ticket'} side="right" footer={t && <div className="stack w-full"><Textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply to the customer" /><div className="row"><Button icon={I.Send} disabled={!reply.trim()} onClick={() => update({ reply })}>Send reply</Button><Button variant="secondary" onClick={() => update({ status: 'resolved' })}>Mark resolved</Button></div></div>}>
      {!t ? <Skel h={300} /> : (
        <div className="stack" style={{ '--gap': '14px' }}>
          <div className="row"><Badge>{t.category}</Badge><Status tone={t.status === 'open' ? 'warn' : 'success'}>{t.status}</Status><span className="small muted">{t.name} · {t.email}</span></div>
          <div className="form-grid"><Field label="Priority"><Select value={t.priority} onChange={(e) => update({ priority: e.target.value })} options={['low', 'normal', 'high', 'urgent']} /></Field><Field label="Assignee"><Select value={t.assigned_to || ''} onChange={(e) => update({ assigned_to: e.target.value ? Number(e.target.value) : null })} placeholder="Unassigned" options={t.staff.map((s) => ({ value: s.id, label: s.name }))} /></Field></div>
          {t.messages.map((m) => <div key={m.id} className="card card-pad" style={m.staff ? { background: 'var(--accent-soft)', borderColor: 'transparent' } : undefined}><div className="spread small"><b>{m.staff ? `${m.author_name} (staff)` : m.author_name || t.name}</b><span className="tiny muted">{dateTime(m.created_at)}</span></div><p className="pre small mt-2">{m.body}</p></div>)}
        </div>
      )}
    </Drawer>
  );
}

// ---------------- Settings ----------------
function Settings() {
  useTitle('Platform settings');
  const app = useApp();
  const { data, reload } = useApi('/admin/settings');
  const [s, setS] = useState(null);
  const [rate, setRate] = useState('');
  useEffect(() => { if (data) { setS(data.settings); setRate(String((data.rates.find((r) => r.base === 'INR' && r.quote === 'NPR')?.rate_micros || 1600000) / 1e6)); } }, [data]);
  if (!data || !s) return <Skel h={500} r={20} />;
  const canEdit = app.can('settings.manage');
  const save = async () => { try { await api.put('/admin/settings', s); toast.success('Settings saved'); reload(); } catch (e) { toast.error(e.message); } };
  return (
    <>
      <PageHead title="Platform settings" actions={canEdit && <Button icon={I.Check} onClick={save}>Save settings</Button>} />
      {!canEdit && <div className="callout info mb-4"><I.Lock size={18} />Read-only: your role can’t change platform settings.</div>}
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="order-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className="card card-pad-lg stack" style={{ '--gap': '16px' }}>
            <h3>Listings & offers</h3>
            <Field label="Listing expiry (days)"><Input type="number" value={s.listing_expiry_days} onChange={(e) => setS({ ...s, listing_expiry_days: Number(e.target.value) })} /></Field>
            <Field label="Offer expiry (hours)"><Input type="number" value={s.offer_expiry_hours} onChange={(e) => setS({ ...s, offer_expiry_hours: Number(e.target.value) })} /></Field>
            <Field label="Max photos per listing"><Input type="number" value={s.max_images_per_listing} onChange={(e) => setS({ ...s, max_images_per_listing: Number(e.target.value) })} /></Field>
            <Toggle label="Manually review listings from unverified sellers" checked={s.require_review_new_sellers} onChange={(v) => setS({ ...s, require_review_new_sellers: v })} />
            <Field label="Site-wide banner (optional)"><Input value={s.maintenance_banner} onChange={(e) => setS({ ...s, maintenance_banner: e.target.value })} /></Field>
          </div>
          <div className="card card-pad-lg stack" style={{ '--gap': '16px' }}>
            <h3>Payments</h3>
            <Field label="Platform fee on online payments (basis points)" help={`${(s.platform_fee_bps / 100).toFixed(2)}% · charged to the buyer`}><Input type="number" value={s.platform_fee_bps} onChange={(e) => setS({ ...s, platform_fee_bps: Number(e.target.value) })} /></Field>
            <Toggle label="Test mode (offer the built-in test gateway)" checked={s.payments_test_mode} onChange={(v) => setS({ ...s, payments_test_mode: v })} />
            {data.providers.map((p) => <div key={p.id} className="spread"><span className="small"><b>{p.label}</b> <span className="muted">· {p.countries.join('/')} · {p.configured ? 'credentials set' : 'no credentials'}</span></span><Toggle checked={s.payment_providers[p.id] !== false} onChange={(v) => setS({ ...s, payment_providers: { ...s.payment_providers, [p.id]: v } })} aria-label={`Enable ${p.label}`} /></div>)}
            <p className="tiny muted">Providers without credentials are never shown to buyers, even if enabled.</p>
            <Toggle label="Allow cross-border listings (India ↔ Nepal)" checked={s.cross_border_enabled} onChange={(v) => setS({ ...s, cross_border_enabled: v })} />
            <p className="tiny muted">Only enable once shipping, payments and legal arrangements genuinely support it.</p>
          </div>
          <div className="card card-pad-lg stack" style={{ '--gap': '16px' }}>
            <h3>Countries & currency</h3>
            {data.countries.map((c) => <div key={c.code} className="spread"><span>{c.flag} <b>{c.name}</b> <span className="muted small">· {c.currency} · {c.phone_prefix}</span></span><Toggle checked={!!c.enabled} onChange={async (v) => { try { await api.put(`/admin/countries/${c.code}`, { enabled: v }); reload(); } catch (e) { toast.error(e.message); } }} aria-label={`Enable ${c.name}`} /></div>)}
            <Field label="Exchange rate: 1 INR = ? NPR" help={`Estimates only. Last updated ${dateTime(data.rates[0]?.updated_at)} (${data.rates[0]?.source}).`}><div className="row nowrap"><Input type="number" step="0.0001" value={rate} onChange={(e) => setRate(e.target.value)} /><Button variant="secondary" onClick={async () => { try { await api.put('/admin/fx', { base: 'INR', quote: 'NPR', rate }); toast.success('Rate updated'); reload(); } catch (e) { toast.error(e.message); } }}>Update</Button></div></Field>
          </div>
          <div className="card card-pad-lg stack" style={{ '--gap': '12px' }}>
            <h3>Integrations</h3>
            {Object.entries(data.integrations).map(([k, v]) => <div key={k} className="spread small"><span className="semibold" style={{ textTransform: 'capitalize' }}>{k}</span><Badge tone={/not|outbox/i.test(v) ? 'warn' : 'success'}>{v}</Badge></div>)}
            <p className="tiny muted">Configure providers with environment variables — see .env.example and the deployment guide.</p>
          </div>
        </div>
      </fieldset>
      <section className="section">
        <h2 className="mb-4">Roles & permissions</h2>
        <div className="table-wrap"><table className="table"><thead><tr><th>Permission</th>{['support', 'moderator', 'admin', 'super_admin'].map((r) => <th key={r}>{ROLE_LABEL[r]}</th>)}</tr></thead>
          <tbody>{Object.entries(data.roles).map(([p, roles]) => <tr key={p}><td className="mono small">{p}</td>{['support', 'moderator', 'admin', 'super_admin'].map((r) => <td key={r}>{roles.includes(r) ? <I.Check size={16} style={{ color: 'var(--success-text)' }} /> : <span className="muted">—</span>}</td>)}</tr>)}</tbody></table></div>
      </section>
    </>
  );
}

// ---------------- Audit ----------------
function Audit() {
  useTitle('Audit logs');
  const { query } = useLocation();
  const { data } = useApi(`/admin/audit?${new URLSearchParams(query)}`, { keep: true });
  return (
    <>
      <PageHead title="Audit logs" subtitle="Every administrative action, with who, what and when." />
      <div className="filter-bar"><SearchInput value={query.action} onChange={(v) => setQuery({ action: v })} placeholder="Action prefix (e.g. listing.)" /><Select value={query.entity || ''} onChange={(e) => setQuery({ entity: e.target.value })} placeholder="All entities" options={['user', 'listing', 'order', 'category', 'dispute', 'promotion', 'settings', 'payment', 'ticket', 'fx', 'country']} /></div>
      <div className="table-wrap"><table className="table"><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th><th>IP</th></tr></thead>
        <tbody>{data?.items.map((a) => <tr key={a.id}><td className="small nowrap">{dateTime(a.created_at)}</td><td className="small">{a.actor_name || 'system'}{a.actor_role && <div className="tiny muted">{ROLE_LABEL[a.actor_role]}</div>}</td><td><Badge tone="accent">{a.action}</Badge></td><td className="small">{a.entity_type} {a.entity_id && `#${a.entity_id}`}</td><td className="tiny mono muted" style={{ maxWidth: 360, wordBreak: 'break-word' }}>{a.data ? JSON.stringify(a.data).slice(0, 200) : '—'}</td><td className="tiny muted">{a.ip || '—'}</td></tr>)}</tbody></table></div>
      {data && <Pager page={data.page} pages={data.pages} onPage={(p) => setQuery({ page: p })} />}
    </>
  );
}

export default function Admin() {
  const app = useApp();
  const { pathname } = useLocation();
  const ov = useApi(app.user && app.can('admin.access') ? '/admin/overview' : null, { deps: [pathname] });
  useEffect(() => { if (!app.loading && !app.user) navigate(`/login?next=${encodeURIComponent(pathname)}`, { replace: true }); }, [app.loading, app.user]); // eslint-disable-line react-hooks/exhaustive-deps
  if (app.loading || !app.user) return <PageLoader />;
  if (!app.can('admin.access')) return <div className="container page"><Empty icon={I.Lock} title="Admins only" action={<Button to="/">Go home</Button>}>Your account doesn’t have access to the admin console.</Empty></div>;
  const section = pathname.split('/')[2] || '';
  const item = NAV.find((n) => n.to === `/admin${section ? `/${section}` : ''}`);
  const allowed = !item || app.can(item.perm);
  const pages = { '': <Dashboard ov={ov.data} />, users: <Users />, verification: <Verification />, listings: <Listings />, categories: <Categories />, orders: <Orders />, payments: <Payments />, disputes: <Disputes />, reports: <Reports />, promotions: <Promotions />, analytics: <Analytics />, tickets: <Tickets />, settings: <Settings />, audit: <Audit /> };
  return <AdminShell counts={ov.data}>{allowed ? pages[section] || <Empty title="Not found" /> : <Empty icon={I.Lock} title="No permission">Your role ({ROLE_LABEL[app.user.role]}) can’t open this section.</Empty>}</AdminShell>;
}
