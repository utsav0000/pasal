import React, { useEffect, useMemo, useState } from 'react';
import { Link, navigate, setQuery, useApi, useApp, useLocation, useTitle, api, toast, storage } from '../lib/core.jsx';
import { CONDITIONS, plural } from '../lib/format.js';
import { Button, Select, Check, Toggle, Seg, Drawer, Pager, ErrorState, Reveal, Field, Modal, Input } from '../components/ui.jsx';
import { ListingGrid } from '../components/listing.jsx';
import * as I from '../components/icons.jsx';

const SORTS = [
  { value: 'relevance', label: 'Most relevant' }, { value: 'newest', label: 'Newest first' }, { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' }, { value: 'views', label: 'Most viewed' }, { value: 'trending', label: 'Trending' },
];

function Filters({ query, category, cats, onClose }) {
  const app = useApp();
  const [min, setMin] = useState(query.min || '');
  const [max, setMax] = useState(query.max || '');
  useEffect(() => { setMin(query.min || ''); setMax(query.max || ''); }, [query.min, query.max]);
  const conds = (query.condition || '').split(',').filter(Boolean);
  const toggleCond = (c) => setQuery({ condition: (conds.includes(c) ? conds.filter((x) => x !== c) : [...conds, c]).join(',') });
  const display = query.display || app.currency;
  const root = category ? (category.breadcrumb[0]?.slug) : null;
  const tree = cats || [];
  const filterAttrs = (category?.attributes || []).filter((a) => a.filterable && a.type !== 'text' && a.type !== 'number');
  return (
    <div>
      <div className="fgroup">
        <h4>Country</h4>
        <Seg full value={query.country || app.country} onChange={(v) => { setQuery({ country: v, city: '' }); app.setCountry(v === 'all' ? app.country : v); }} options={[{ value: 'IN', label: '🇮🇳 India' }, { value: 'NP', label: '🇳🇵 Nepal' }, { value: 'all', label: 'Both' }]} label="Country" />
      </div>
      <div className="fgroup cat-tree">
        <h4>Category</h4>
        {category && <Link to={`/browse${location.search}`}>← All categories</Link>}
        {tree.filter((c) => !root || c.slug === root).map((c) => (
          <div key={c.slug}>
            <Link to={`/c/${c.slug}`} className={category?.slug === c.slug ? 'active' : ''}><span className="row" style={{ '--gap': '8px' }}><I.CatIcon name={c.icon} size={16} />{c.name}</span><span className="muted tiny">{c.count}</span></Link>
            {root === c.slug && <div className="sub">{c.children.map((s) => <Link key={s.slug} to={`/c/${s.slug}`} className={category?.slug === s.slug ? 'active' : ''}><span>{s.name}</span><span className="muted tiny">{s.count || ''}</span></Link>)}</div>}
          </div>
        ))}
      </div>
      <div className="fgroup">
        <h4>Price <Select className="input-sm" style={{ width: 'auto', height: 28, fontSize: 12, padding: '0 28px 0 8px' }} value={display} onChange={(e) => setQuery({ display: e.target.value })} options={[{ value: 'INR', label: '₹ INR' }, { value: 'NPR', label: 'रू NPR' }]} aria-label="Price currency" /></h4>
        <form className="range-row" onSubmit={(e) => { e.preventDefault(); setQuery({ min, max }); onClose?.(); }}>
          <input className="input input-sm" inputMode="numeric" placeholder="Min" value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, ''))} aria-label="Minimum price" />
          <span className="muted">–</span>
          <input className="input input-sm" inputMode="numeric" placeholder="Max" value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ''))} aria-label="Maximum price" />
          <Button type="submit" variant="secondary" size="sm" className="w-full" style={{ gridColumn: '1 / -1' }}>Apply price</Button>
        </form>
        <p className="tiny muted mt-2">Listings in the other currency are matched using an estimated exchange rate.</p>
      </div>
      <div className="fgroup">
        <h4>Condition</h4>
        <div className="stack">{Object.entries(CONDITIONS).map(([k, v]) => <Check key={k} label={v} checked={conds.includes(k)} onChange={() => toggleCond(k)} />)}</div>
      </div>
      {filterAttrs.map((a) => (
        <div className="fgroup" key={a.key}>
          <h4>{a.label}</h4>
          {a.type === 'boolean'
            ? <Toggle label="Yes" checked={query[`attr_${a.key}`] === 'Yes'} onChange={(v) => setQuery({ [`attr_${a.key}`]: v ? 'Yes' : '' })} />
            : <div className="chips">{a.options.map((o) => <button key={o} className={`chip sm ${query[`attr_${a.key}`] === o ? 'active' : ''}`} onClick={() => setQuery({ [`attr_${a.key}`]: query[`attr_${a.key}`] === o ? '' : o })}>{o}</button>)}</div>}
        </div>
      ))}
      <div className="fgroup">
        <h4>Delivery &amp; trust</h4>
        <div className="stack">
          <Toggle label="Home delivery available" checked={query.delivery === '1'} onChange={(v) => setQuery({ delivery: v ? '1' : '' })} />
          <Toggle label="Self pickup available" checked={query.pickup === '1'} onChange={(v) => setQuery({ pickup: v ? '1' : '' })} />
          <Toggle label="Verified sellers only" checked={query.verified === '1'} onChange={(v) => setQuery({ verified: v ? '1' : '' })} />
          <Toggle label="Price negotiable" checked={query.negotiable === '1'} onChange={(v) => setQuery({ negotiable: v ? '1' : '' })} />
        </div>
      </div>
      {(query.city || app.city) && (
        <div className="fgroup">
          <h4>Distance</h4>
          <div className="chips">{['', '5', '15', '50', '150'].map((r) => <button key={r} className={`chip sm ${(query.radius || '') === r ? 'active' : ''}`} onClick={() => setQuery({ radius: r })}>{r ? `${r} km` : 'City only'}</button>)}</div>
        </div>
      )}
    </div>
  );
}

export function Browse({ params }) {
  const app = useApp();
  const { pathname, query } = useLocation();
  const [layout, setLayout] = useState(() => storage.get('pasal.layout', 'grid'));
  const [drawer, setDrawer] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const cats = useApi('/categories');
  const category = useApi(params.slug ? `/categories/${params.slug}` : null);
  const cityLoc = useApi(params.city ? `/locations/${params.city}` : null);

  const apiQuery = useMemo(() => {
    const q = { ...query };
    if (!q.country) q.country = params.city && cityLoc.data ? cityLoc.data.country_code : app.country;
    if (params.slug) q.category = params.slug;
    if (params.city) { if (!cityLoc.data) return null; q.city = cityLoc.data.id; }
    else if (q.city === undefined && app.city && q.country === app.city.country) q.city = app.city.id;
    if (q.city === 'all') delete q.city;
    if (!q.display) q.display = q.country === 'NP' ? 'NPR' : app.currency;
    if (pathname === '/trending' && !q.sort) q.sort = 'trending';
    if (pathname === '/featured') q.featured = '1';
    return q;
  }, [query, params.slug, params.city, cityLoc.data, app.country, app.city, app.currency, pathname]);
  const res = useApi(apiQuery ? `/listings?${new URLSearchParams(apiQuery)}` : null, { keep: true });

  const cityName = cityLoc.data?.name || (apiQuery?.city && app.city?.id === Number(apiQuery.city) ? app.city.name : null);
  const where = cityName ? ` in ${cityName}` : apiQuery?.country === 'all' ? ' in India & Nepal' : ` in ${apiQuery?.country === 'NP' ? 'Nepal' : 'India'}`;
  const title = query.q ? `“${query.q}”` : category.data ? category.data.name : pathname === '/trending' ? 'Trending now' : pathname === '/featured' ? 'Featured listings' : cityLoc.data ? `Buy & sell in ${cityLoc.data.name}` : 'All listings';
  useTitle(query.q ? `${query.q} — search` : title);

  const chips = [];
  if (query.q) chips.push(['q', `“${query.q}”`]);
  if (query.min || query.max) chips.push(['min,max', `${query.min || 0} – ${query.max || 'any'} ${apiQuery?.display}`]);
  if (query.condition) query.condition.split(',').forEach((c) => chips.push(['condition', CONDITIONS[c], c]));
  if (query.delivery) chips.push(['delivery', 'Delivery']);
  if (query.pickup) chips.push(['pickup', 'Pickup']);
  if (query.verified) chips.push(['verified', 'Verified sellers']);
  if (query.negotiable) chips.push(['negotiable', 'Negotiable']);
  if (query.radius) chips.push(['radius', `Within ${query.radius} km`]);
  if (apiQuery?.city && !params.city) chips.push(['city', cityName || 'Selected city', null, 'all']);
  Object.keys(query).filter((k) => k.startsWith('attr_')).forEach((k) => chips.push([k, query[k]]));
  const removeChip = ([keys, , val, clear]) => {
    if (keys === 'condition') return setQuery({ condition: query.condition.split(',').filter((c) => c !== val).join(',') });
    const patch = {}; keys.split(',').forEach((k) => (patch[k] = clear || '')); setQuery(patch);
  };

  const saveSearch = async (name) => {
    const qs = new URLSearchParams(apiQuery); qs.delete('page'); qs.delete('display');
    try { await api.post('/saved-searches', { name, query: qs.toString(), notify: true }); toast.success('Search saved. We’ll notify you about new matches.', { link: '/saved-searches', linkLabel: 'Manage' }); setSaveOpen(false); }
    catch (e) { toast.error(e.message); }
  };
  const data = res.data;
  const c = category.data;
  return (
    <div className="container page">
      {c && <nav className="breadcrumb" aria-label="Breadcrumb"><Link to="/">Home</Link><I.ChevronRight size={13} /><Link to="/categories">Categories</Link>{c.breadcrumb.map((b) => <React.Fragment key={b.slug}><I.ChevronRight size={13} /><Link to={`/c/${b.slug}`}>{b.name}</Link></React.Fragment>)}</nav>}
      <div className="spread result-head mb-4" style={{ alignItems: 'flex-end' }}>
        <div>
          <h1>{title}<span className="muted" style={{ fontWeight: 500 }}>{!query.q && where}</span></h1>
          <p className="muted mt-2">{data ? `${plural(data.total, 'listing')}${query.q ? where : ''}` : 'Searching…'}{c?.description ? ` · ${c.description}` : ''}</p>
        </div>
      </div>
      {c && (c.children.length > 0 || c.siblings.length > 0) && (
        <div className="chips scroll mb-4">
          {(c.children.length ? c.children : c.siblings).map((s) => <Link key={s.slug} to={`/c/${s.slug}`} className={`chip ${s.slug === c.slug ? 'active' : ''}`}>{s.name}<span className="muted tiny">{s.count || ''}</span></Link>)}
        </div>
      )}
      {data?.corrected && <div className="callout accent mb-4"><I.Sparkles size={18} /><span>No exact matches for “{query.q}”. Showing results for <b>“{data.corrected}”</b> instead.</span></div>}
      <div className="browse">
        <aside className="filters-side" aria-label="Filters"><Filters query={query} category={c} cats={cats.data} /></aside>
        <div>
          <div className="toolbar">
            <div className="row">
              <Button variant="secondary" size="sm" icon={I.Sliders} className="show-mobile" onClick={() => setDrawer(true)}>Filters{chips.length ? ` (${chips.length})` : ''}</Button>
              <Select className="input-sm" style={{ width: 'auto' }} value={apiQuery?.sort || 'relevance'} onChange={(e) => setQuery({ sort: e.target.value })} options={SORTS} aria-label="Sort by" />
            </div>
            <div className="row">
              <Button variant="soft" size="sm" icon={I.Bookmark} onClick={() => (app.user ? setSaveOpen(true) : navigate(`/login?next=${encodeURIComponent(pathname + location.search)}`))}>Save search</Button>
              <Seg value={layout} onChange={(v) => { setLayout(v); storage.set('pasal.layout', v); }} options={[{ value: 'grid', icon: I.GridIcon, label: '' }, { value: 'list', icon: I.ListIcon, label: '' }]} label="Layout" />
            </div>
          </div>
          {chips.length > 0 && (
            <div className="active-filters">
              {chips.map((ch) => <button key={ch[0] + (ch[2] || '')} className="chip sm" onClick={() => removeChip(ch)}>{ch[1]}<I.X size={13} className="x" /></button>)}
              <button className="link small" onClick={() => navigate(pathname + (query.q ? `?q=${encodeURIComponent(query.q)}` : ''), { replace: true })}>Clear all</button>
            </div>
          )}
          {res.error ? <ErrorState error={res.error} retry={res.reload} /> : (
            <ListingGrid items={data?.items} loading={res.loading} layout={layout} empty={
              <div className="empty"><div className="ic"><I.Search size={32} /></div><h3>No listings match yet</h3><p>Try removing a filter, widening the distance, or save this search and we’ll tell you when something turns up.</p>
                <div className="row mt-2"><Button variant="secondary" onClick={() => navigate(pathname, { replace: true })}>Clear filters</Button>{app.user && <Button icon={I.Bookmark} onClick={() => setSaveOpen(true)}>Save search</Button>}</div></div>
            } />
          )}
          {data && <Pager page={data.page} pages={data.pages} onPage={(p) => { setQuery({ page: p }); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />}
        </div>
      </div>
      <Drawer open={drawer} onClose={() => setDrawer(false)} title="Filters" footer={<Button block onClick={() => setDrawer(false)}>Show {data ? plural(data.total, 'result') : 'results'}</Button>}>
        <Filters query={query} category={c} cats={cats.data} onClose={() => setDrawer(false)} />
      </Drawer>
      <SaveSearchModal open={saveOpen} onClose={() => setSaveOpen(false)} onSave={saveSearch} suggested={`${query.q || c?.name || 'All listings'}${cityName ? ` in ${cityName}` : ''}`} />
    </div>
  );
}

function SaveSearchModal({ open, onClose, onSave, suggested }) {
  const [name, setName] = useState(suggested);
  useEffect(() => { if (open) setName(suggested); }, [open, suggested]);
  return (
    <Modal open={open} onClose={onClose} title="Save this search" subtitle="Get notified when new listings match." width={440}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => onSave(name)} disabled={!name.trim()}>Save search</Button></>}>
      <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Field>
    </Modal>
  );
}

export function Categories() {
  useTitle('All categories');
  const { data } = useApi('/categories');
  return (
    <div className="container page">
      <div className="page-head"><div><h1>Explore every category</h1><p>From phones to flats, find exactly what you need — or sell anything that’s allowed.</p></div></div>
      <div className="stack" style={{ '--gap': '16px' }}>
        {(data || []).map((c, i) => (
          <Reveal key={c.slug} delay={Math.min(i, 6) * 0.03} className="card card-pad">
            <div className="spread mb-4">
              <Link to={`/c/${c.slug}`} className="row" style={{ '--gap': '14px' }}>
                <span className="ctile-icon" style={{ '--c': c.color }}><I.CatIcon name={c.icon} size={26} /></span>
                <span><h3 style={{ fontSize: 18 }}>{c.name}</h3><span className="small muted">{c.description}</span></span>
              </Link>
              <Link to={`/c/${c.slug}`} className="section-link hide-mobile">{c.count} listings<I.ArrowRight size={15} /></Link>
            </div>
            <div className="chips">{c.children.map((s) => <Link key={s.slug} to={`/c/${s.slug}`} className="chip sm">{s.name}{s.count > 0 && <span className="muted">{s.count}</span>}</Link>)}</div>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

export function Locations() {
  useTitle('Browse by city');
  const india = useApi('/locations?country=IN&popular=1');
  const nepal = useApi('/locations?country=NP&popular=1');
  const block = (title, flag, list) => (
    <section className="section">
      <h2 className="mb-4">{flag} {title}</h2>
      <div className="loc-tiles stagger">{(list || []).map((l) => <Link key={l.id} to={`/in/${l.slug}`} className="loc-tile"><span className="ic"><I.MapPin size={18} /></span><span><b>{l.name}</b><br /><span className="small muted">{l.listing_count} listings · {l.parent_name}</span></span></Link>)}</div>
    </section>
  );
  return (
    <div className="container page">
      <div className="page-head"><div><h1>Browse by city</h1><p>See what’s for sale near you across India and Nepal.</p></div></div>
      {block('India', '🇮🇳', india.data)}
      {block('Nepal', '🇳🇵', nepal.data)}
    </div>
  );
}
