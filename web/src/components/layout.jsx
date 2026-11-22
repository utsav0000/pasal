import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, navigate, useApp, useApi, useDebounce, useLocation, useClickOutside, api, storage, toast } from '../lib/core.jsx';
import { Logo, Button, IconButton, Avatar, Menu, MenuItem, Modal, Seg, Input, Badge, Mark } from './ui.jsx';
import * as I from './icons.jsx';

// ---------------- Search with autocomplete ----------------
export function SearchBar({ variant, autoFocus, onDone }) {
  const app = useApp();
  const { query, pathname } = useLocation();
  const [q, setQ] = useState(pathname === '/search' ? query.q || '' : '');
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(-1);
  const dq = useDebounce(q.trim(), 180);
  const ref = useRef(null);
  const [sugg, setSugg] = useState(null);
  const trending = useApi(`/search/trending?country=${app.country}`);
  const [recent, setRecent] = useState(() => storage.get('pasal.recent', []));
  useClickOutside(ref, useCallback(() => setOpen(false), []), open);
  useEffect(() => { if (pathname === '/search') setQ(query.q || ''); }, [pathname, query.q]);
  useEffect(() => {
    if (dq.length < 2) { setSugg(null); return; }
    let live = true;
    api(`/search/suggest?q=${encodeURIComponent(dq)}&country=${app.country}`).then((r) => live && setSugg(r)).catch(() => {});
    return () => { live = false; };
  }, [dq, app.country]);

  const go = (term, extra = '') => {
    const t = term.trim();
    setOpen(false);
    onDone?.();
    if (t) { const r = [t, ...recent.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, 6); setRecent(r); storage.set('pasal.recent', r); }
    const p = new URLSearchParams();
    if (t) p.set('q', t);
    p.set('country', app.country);
    if (app.city) p.set('city', app.city.id);
    navigate(`/search?${p}${extra}`);
  };
  const items = useMemo(() => {
    const out = [];
    if (sugg) {
      sugg.suggestions.forEach((s) => out.push({ type: 'q', label: s, run: () => go(s) }));
      sugg.categories.forEach((c) => out.push({ type: 'c', label: c.name, sub: c.parent, run: () => { setOpen(false); onDone?.(); navigate(`/c/${c.slug}?country=${app.country}`); } }));
      sugg.brands.forEach((b) => out.push({ type: 'b', label: b, run: () => go(b) }));
      if (sugg.corrected) out.unshift({ type: 'fix', label: sugg.corrected, run: () => go(sugg.corrected) });
    } else if (!dq) {
      recent.forEach((s) => out.push({ type: 'r', label: s, run: () => go(s) }));
      (trending.data || []).slice(0, 6).forEach((s) => out.push({ type: 't', label: s, run: () => go(s) }));
    }
    return out;
  }, [sugg, dq, recent, trending.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const hl = (label) => {
    const i = label.toLowerCase().indexOf(dq.toLowerCase());
    if (!dq || i < 0) return label;
    return <>{label.slice(0, i)}<mark>{label.slice(i, i + dq.length)}</mark>{label.slice(i + dq.length)}</>;
  };
  const groups = [
    ['fix', 'Did you mean', I.Sparkles], ['r', 'Recent searches', I.History], ['t', 'Trending', I.Trending], ['q', 'Suggestions', I.Search], ['c', 'Categories', I.GridIcon], ['b', 'Brands', I.Tag],
  ];
  return (
    <div className={`search ${variant ? `search-${variant}` : ''}`} ref={ref}>
      <form className="search-box" role="search" onSubmit={(e) => { e.preventDefault(); sel >= 0 && items[sel] ? items[sel].run() : go(q); }}>
        <I.Search size={variant === 'hero' ? 22 : 19} />
        <input
          value={q} autoFocus={autoFocus} placeholder={variant === 'hero' ? 'Search phones, bikes, rooms, sofas…' : 'Search for anything'}
          aria-label="Search PASAL" aria-autocomplete="list" aria-expanded={open} role="combobox"
          onChange={(e) => { setQ(e.target.value); setOpen(true); setSel(-1); }} onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(-1, s - 1)); }
          }}
        />
        {q && <IconButton icon={I.X} label="Clear search" className="sm" onClick={() => { setQ(''); setSugg(null); }} />}
        <Button type="submit" variant={variant === 'hero' ? 'gradient' : 'primary'} className="search-go" size={variant === 'hero' ? undefined : 'sm'}>{variant === 'hero' ? 'Search' : <I.ArrowRight size={17} />}</Button>
      </form>
      {open && items.length > 0 && (
        <div className="pop" role="listbox">
          {groups.map(([type, title, Ic]) => {
            const g = items.map((it, idx) => ({ ...it, idx })).filter((it) => it.type === type);
            if (!g.length) return null;
            return (
              <div className="pop-group" key={type}>
                <div className="pop-title">{title}</div>
                {g.map((it) => (
                  <button key={it.idx} type="button" className="pop-item" role="option" aria-selected={sel === it.idx} onMouseEnter={() => setSel(it.idx)} onClick={it.run}>
                    <Ic size={16} /><span className="grow ellipsis">{hl(it.label)}</span>{it.sub && <span className="tiny muted">in {it.sub}</span>}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------- Location picker ----------------
export function LocationPicker({ open, onClose }) {
  const app = useApp();
  const [country, setCountry] = useState(app.country);
  const [q, setQ] = useState('');
  const dq = useDebounce(q, 200);
  const popular = useApi(open ? `/locations?country=${country}&popular=1` : null);
  const results = useApi(open && dq.length >= 2 ? `/locations?country=${country}&q=${encodeURIComponent(dq)}` : null);
  const [locating, setLocating] = useState(false);
  useEffect(() => { if (open) { setCountry(app.country); setQ(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const choose = (c) => { app.setCity(c ? { id: c.id, name: c.name, country, slug: c.slug } : null); if (!c) app.setCountry(country); onClose(); toast.success(c ? `Showing listings near ${c.name}` : `Showing all of ${country === 'IN' ? 'India' : 'Nepal'}`); };
  const nearMe = () => {
    if (!navigator.geolocation) return toast.error('Location is not available in this browser.');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude: la, longitude: lo } = pos.coords;
      const [inn, np] = await Promise.all([api('/locations?country=IN&popular=1'), api('/locations?country=NP&popular=1')]);
      const all = [...inn.map((c) => ({ ...c, country: 'IN' })), ...np.map((c) => ({ ...c, country: 'NP' }))];
      const best = all.sort((a, b) => ((a.lat - la) ** 2 + (a.lng - lo) ** 2) - ((b.lat - la) ** 2 + (b.lng - lo) ** 2))[0];
      setLocating(false);
      if (best) { app.setCity({ id: best.id, name: best.name, country: best.country, slug: best.slug }); onClose(); toast.success(`Showing listings near ${best.name}`); }
    }, () => { setLocating(false); toast.error('We could not get your location. Choose a city instead.'); }, { timeout: 8000 });
  };
  const list = dq.length >= 2 ? results.data || [] : popular.data || [];
  return (
    <Modal open={open} onClose={onClose} title="Choose your location" subtitle="We'll show listings near you first." width={560}>
      <div className="stack" style={{ '--gap': '14px' }}>
        <Seg full value={country} onChange={setCountry} options={[{ value: 'IN', label: '🇮🇳 India · ₹ INR' }, { value: 'NP', label: '🇳🇵 Nepal · रू NPR' }]} label="Country" />
        <div className="input-group"><span className="addon"><I.Search size={16} /></span><input className="input" placeholder={`Search a city in ${country === 'IN' ? 'India' : 'Nepal'}`} value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></div>
        <div className="row">
          <Button variant="soft" size="sm" icon={I.Locate} loading={locating} onClick={nearMe}>Use my current location</Button>
          <Button variant="ghost" size="sm" icon={I.Globe} onClick={() => choose(null)}>All of {country === 'IN' ? 'India' : 'Nepal'}</Button>
        </div>
        <div>
          <div className="pop-title" style={{ padding: '4px 0 8px' }}>{dq.length >= 2 ? 'Results' : 'Popular cities'}</div>
          <div className="loc-tiles" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
            {list.map((c) => (
              <button key={c.id} className="loc-tile" style={{ cursor: 'pointer', textAlign: 'left', padding: '10px 12px' }} onClick={() => choose(c)}>
                <span className="ic" style={{ width: 30, height: 30 }}><I.MapPin size={15} /></span>
                <span className="grow" style={{ minWidth: 0 }}><b className="ellipsis" style={{ display: 'block', fontSize: 14 }}>{c.name}</b><span className="tiny muted ellipsis" style={{ display: 'block' }}>{c.parent_name}</span></span>
              </button>
            ))}
            {dq.length >= 2 && !results.loading && !list.length && <p className="muted small">No cities match “{dq}”.</p>}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ---------------- Theme switcher ----------------
export function ThemeSwitch() {
  const app = useApp();
  const order = ['light', 'dark', 'system'];
  const Ic = { light: I.Sun, dark: I.Moon, system: I.Monitor }[app.theme];
  return <IconButton icon={Ic} label={`Theme: ${app.theme} (click to change)`} onClick={() => app.setTheme(order[(order.indexOf(app.theme) + 1) % 3])} />;
}

// ---------------- Header ----------------
export function Header() {
  const app = useApp();
  const { pathname } = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [locOpen, setLocOpen] = useState(false);
  const [mega, setMega] = useState(false);
  const [mobileSearch, setMobileSearch] = useState(false);
  const cats = useApi('/categories');
  const [root, setRoot] = useState(null);
  const megaRef = useRef(null);
  useClickOutside(megaRef, useCallback(() => setMega(false), []), mega);
  useEffect(() => { const h = () => setScrolled(window.scrollY > 4); h(); window.addEventListener('scroll', h, { passive: true }); return () => window.removeEventListener('scroll', h); }, []);
  useEffect(() => { setMega(false); setMobileSearch(false); }, [pathname]);
  useEffect(() => { if (!app.countryChosen && !app.loading && !app.user && !storage.get('pasal.askedLoc', false)) { storage.set('pasal.askedLoc', true); setTimeout(() => setLocOpen(true), 1200); } }, [app.loading]); // eslint-disable-line react-hooks/exhaustive-deps
  const country = app.countries.find((c) => c.code === app.country);
  const rootCat = (cats.data || []).find((c) => c.slug === root) || cats.data?.[0];
  const u = app.user;
  return (
    <header className={`hdr ${scrolled ? 'scrolled' : ''}`} ref={megaRef}>
      <div className="container hdr-inner">
        <Link to="/" className="hdr-logo" aria-label="PASAL home"><span className="hide-mobile"><Logo height={36} /></span><span className="show-mobile"><Logo height={32} /></span></Link>
        <button className="hdr-loc hide-mobile" onClick={() => setLocOpen(true)} aria-label="Change country or city">
          <span className="flag">{country?.flag || '🇮🇳'}</span>
          <span style={{ textAlign: 'left', minWidth: 0 }}><span className="ellipsis" style={{ display: 'block' }}>{app.city?.name || (app.country === 'NP' ? 'Nepal' : 'India')}</span><span className="sub">{app.currency === 'NPR' ? 'रू NPR' : '₹ INR'}{app.city ? '' : ' · All cities'}</span></span>
          <I.ChevronDown size={16} className="muted" />
        </button>
        <div className="hdr-search hide-mobile"><SearchBar /></div>
        <div className="hdr-actions">
          <IconButton icon={I.Search} label="Search" className="show-mobile" onClick={() => setMobileSearch((v) => !v)} />
          <button className="icon-btn show-mobile" onClick={() => setLocOpen(true)} aria-label="Change location"><span style={{ fontSize: 19 }}>{country?.flag || '🇮🇳'}</span></button>
          <ThemeSwitch />
          {u && <Link to="/wishlist" className="icon-btn hide-mobile" aria-label="Wishlist" title="Wishlist"><I.Heart size={20} /></Link>}
          {u && <Link to="/messages" className="icon-btn hide-mobile" aria-label="Messages" title="Messages"><I.Chat size={20} />{app.counts.messages > 0 && <span className="count-badge">{app.counts.messages}</span>}</Link>}
          {u && <Link to="/notifications" className="icon-btn" aria-label={`Notifications${app.counts.notifications ? ` (${app.counts.notifications} unread)` : ''}`} title="Notifications"><I.Bell size={20} />{app.counts.notifications > 0 && <span className="count-badge">{app.counts.notifications > 99 ? '99+' : app.counts.notifications}</span>}</Link>}
          {u ? (
            <Menu trigger={({ toggle, open }) => (
              <button className="icon-btn" onClick={toggle} aria-expanded={open} aria-label="Account menu" style={{ width: 'auto', padding: '0 4px', marginLeft: 4 }}><Avatar name={u.name} src={u.avatar_url} size={34} /></button>
            )}>
              <div className="menu-head"><Avatar name={u.name} src={u.avatar_url} size={42} /><div style={{ minWidth: 0 }}><b className="ellipsis" style={{ display: 'block' }}>{u.name}</b><span className="tiny muted ellipsis" style={{ display: 'block' }}>{u.email || u.phone}</span></div></div>
              <div className="menu-sep" />
              <MenuItem icon={I.Dashboard} to="/dashboard">Buyer dashboard</MenuItem>
              <MenuItem icon={I.Store} to="/seller">Seller dashboard</MenuItem>
              <MenuItem icon={I.Package} to="/orders">My orders</MenuItem>
              <MenuItem icon={I.Tag} to="/seller/listings">My listings</MenuItem>
              <MenuItem icon={I.Handshake} to="/offers">Offers</MenuItem>
              <MenuItem icon={I.Bookmark} to="/saved-searches">Saved searches</MenuItem>
              <MenuItem icon={I.Star} to="/reviews">Reviews</MenuItem>
              <MenuItem icon={I.Settings} to="/settings">Account settings</MenuItem>
              {app.can('admin.access') && <><div className="menu-sep" /><MenuItem icon={I.ShieldCheck} to="/admin">Admin console</MenuItem></>}
              <div className="menu-sep" />
              <MenuItem icon={I.LogOut} danger onClick={app.logout}>Sign out</MenuItem>
            </Menu>
          ) : (
            <Button variant="ghost" to={`/login?next=${encodeURIComponent(pathname)}`} className="hide-mobile">Sign in</Button>
          )}
          <Button variant="gradient" icon={I.Plus} to="/sell" className="hide-mobile" style={{ marginLeft: 6 }}>Sell now</Button>
          {!u && <Button variant="primary" size="sm" to="/login" className="show-mobile">Sign in</Button>}
        </div>
      </div>
      {mobileSearch && <div className="container show-mobile" style={{ paddingBottom: 12 }}><SearchBar autoFocus onDone={() => setMobileSearch(false)} /></div>}
      <nav className="catbar hide-mobile" aria-label="Categories">
        <div className="container catbar-inner">
          <button onClick={() => setMega((m) => !m)} aria-expanded={mega}><I.GridIcon size={16} />All categories<I.ChevronDown size={14} style={{ transform: mega ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} /></button>
          {(cats.data || []).slice(0, 10).map((c) => (
            <Link key={c.slug} to={`/c/${c.slug}`} activeClass="active"><I.CatIcon name={c.icon} size={17} />{c.name}</Link>
          ))}
        </div>
      </nav>
      {mega && cats.data && (
        <div className="mega">
          <div className="container mega-grid">
            <div className="mega-roots">
              {cats.data.map((c) => (
                <button key={c.slug} className={rootCat?.slug === c.slug ? 'active' : ''} onMouseEnter={() => setRoot(c.slug)} onFocus={() => setRoot(c.slug)} onClick={() => navigate(`/c/${c.slug}`)}>
                  <I.CatIcon name={c.icon} size={19} style={{ color: c.color }} />{c.name}
                </button>
              ))}
            </div>
            <div>
              <div className="spread" style={{ padding: '20px 24px 0' }}>
                <div><h3>{rootCat?.name}</h3><p className="small muted mt-1">{rootCat?.description}</p></div>
                <Link to={`/c/${rootCat?.slug}`} className="section-link">View all {rootCat?.count ? `(${rootCat.count})` : ''}<I.ArrowRight size={15} /></Link>
              </div>
              <div className="mega-subs">
                {rootCat?.children.map((s) => <Link key={s.slug} to={`/c/${s.slug}`}><span>{s.name}</span><span className="muted tiny">{s.count || ''}</span></Link>)}
              </div>
            </div>
          </div>
        </div>
      )}
      <LocationPicker open={locOpen} onClose={() => setLocOpen(false)} />
    </header>
  );
}

// ---------------- Bottom navigation (mobile) ----------------
export function BottomNav() {
  const app = useApp();
  const { pathname } = useLocation();
  const is = (p) => (p === '/' ? pathname === '/' : pathname.startsWith(p));
  return (
    <nav className="bnav show-mobile" aria-label="Primary">
      <Link to="/" className={is('/') ? 'active' : ''}><I.Home size={22} />Home</Link>
      <Link to="/browse" className={is('/browse') || is('/search') || is('/c/') ? 'active' : ''}><I.Compass size={22} />Explore</Link>
      <Link to="/sell" className="sell" aria-label="Sell an item"><I.Plus size={26} /></Link>
      <Link to="/messages" className={is('/messages') ? 'active' : ''}><I.Chat size={22} />Chats{app.counts.messages > 0 && <span className="count-badge">{app.counts.messages}</span>}</Link>
      <Link to={app.user ? '/dashboard' : '/login'} className={is('/dashboard') || is('/seller') || is('/settings') || is('/orders') ? 'active' : ''}><I.User size={22} />Account</Link>
    </nav>
  );
}

// ---------------- Footer ----------------
export function Footer() {
  const app = useApp();
  return (
    <footer className="ftr">
      <div className="container">
        <div className="ftr-grid">
          <div>
            <Logo height={36} />
            <p className="muted mt-3" style={{ maxWidth: 300, fontSize: 14 }}>Everything Finds a Buyer. The trusted marketplace to buy and sell almost anything across India and Nepal.</p>
            <div className="row mt-4">
              <Badge tone="accent" icon={I.ShieldCheck}>Verified sellers</Badge>
              <Badge tone="success" icon={I.Lock}>Secure payments</Badge>
            </div>
          </div>
          <div><h4>Marketplace</h4><ul><li><Link to="/browse">Browse all</Link></li><li><Link to="/categories">Categories</Link></li><li><Link to="/trending">Trending</Link></li><li><Link to="/featured">Featured</Link></li><li><Link to="/locations">Browse by city</Link></li></ul></div>
          <div><h4>Sell</h4><ul><li><Link to="/sell">Post a listing</Link></li><li><Link to="/seller">Seller dashboard</Link></li><li><Link to="/settings/verification">Get verified</Link></li><li><Link to="/prohibited-items">Prohibited items</Link></li></ul></div>
          <div><h4>Support</h4><ul><li><Link to="/help">Help centre</Link></li><li><Link to="/contact">Contact us</Link></li><li><Link to="/help#safety">Safety tips</Link></li><li><a href="/api/docs">API docs</a></li></ul></div>
          <div><h4>Company</h4><ul><li><Link to="/about">About PASAL</Link></li><li><Link to="/terms">Terms</Link></li><li><Link to="/privacy">Privacy</Link></li></ul></div>
        </div>
        <div className="ftr-bottom">
          <span>© {new Date().getFullYear()} PASAL. Made for India 🇮🇳 and Nepal 🇳🇵.</span>
          <span className="row" style={{ '--gap': '14px' }}>
            <button className="link" onClick={() => app.setCountry('IN')}>🇮🇳 India (₹)</button>
            <button className="link" onClick={() => app.setCountry('NP')}>🇳🇵 Nepal (रू)</button>
          </span>
        </div>
      </div>
    </footer>
  );
}

export function SectionHead({ title, subtitle, to, linkLabel = 'See all' }) {
  return (
    <div className="section-head">
      <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
      {to && <Link to={to} className="section-link">{linkLabel}<I.ArrowRight size={15} /></Link>}
    </div>
  );
}

export function DashNav({ items }) {
  const { pathname } = useLocation();
  return (
    <>
      <nav className="dash-nav" aria-label="Dashboard">
        {items.map((it, i) => (it.group ? <div key={i} className="grp">{it.group}</div> : (
          <Link key={it.to} to={it.to} className={pathname === it.to || (it.prefix && pathname.startsWith(it.to)) ? 'active' : ''}>
            <it.icon size={18} />{it.label}{it.n > 0 && <span className="n">{it.n}</span>}
          </Link>
        )))}
      </nav>
      <div className="dash-mobile-nav show-mobile">
        {items.filter((i) => !i.group).map((it) => <Link key={it.to} to={it.to} className={`chip sm ${pathname === it.to ? 'active' : ''}`}><it.icon size={14} />{it.label}</Link>)}
      </div>
    </>
  );
}
export { Mark };
