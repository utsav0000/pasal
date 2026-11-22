import React, { useMemo, useState } from 'react';
import { Link, navigate, useApi, useApp, api } from '../lib/core.jsx';
import { money } from '../lib/format.js';
import { Button, Reveal, CountUp, Avatar, Stars, Verified, Skel, SkeletonCards } from '../components/ui.jsx';
import { SearchBar, SectionHead, LocationPicker } from '../components/layout.jsx';
import { Rail } from '../components/listing.jsx';
import * as I from '../components/icons.jsx';

const toSearch = (q) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q || {})) if (v !== undefined && v !== null && v !== true && k !== 'limit' && k !== 'recommended') p.set(k, v);
  return p.toString();
};

function Hero({ data }) {
  const app = useApp();
  const trending = useApi(`/search/trending?country=${app.country}`);
  const [loc, setLoc] = useState(false);
  const picks = useMemo(() => {
    const all = (data?.sections || []).flatMap((s) => s.items || []);
    const seen = new Set();
    return all.filter((i) => !seen.has(i.id) && seen.add(i.id) && i.thumb).slice(0, 4);
  }, [data]);
  const hero = data?.promotions?.find((p) => p.placement === 'hero');
  const country = app.country === 'NP' ? 'Nepal' : 'India';
  return (
    <section className="hero">
      <div className="hero-mesh" aria-hidden="true"><span /><span /><span /></div>
      <div className="container hero-grid">
        <div>
          {hero ? (
            <Link to={hero.link || '/browse'} className="hero-eyebrow" onClick={() => api.post(`/promotions/${hero.id}/click`).catch(() => {})}><span className="pulse" />{hero.title}<I.ArrowRight size={14} /></Link>
          ) : <span className="hero-eyebrow"><span className="pulse" />Live in India and Nepal</span>}
          <h1>Everything Finds a Buyer<span className="stop">.</span></h1>
          <p className="hero-sub">Discover great deals, sell what you don’t need, and find everything you love — all in one place.</p>
          <SearchBar variant="hero" />
          <div className="hero-popular">
            <button onClick={() => setLoc(true)} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><I.MapPin size={13} />{app.city?.name || `All of ${country}`}</button>
            {(trending.data || ['iphone', 'royal enfield', 'sofa', 'pg']).slice(0, 5).map((t) => (
              <button key={t} onClick={() => navigate(`/search?q=${encodeURIComponent(t)}&country=${app.country}`)}>{t}</button>
            ))}
          </div>
          <div className="hero-ctas">
            <Button variant="gradient" size="lg" icon={I.Plus} to="/sell">Sell something</Button>
            <Button variant="secondary" size="lg" icon={I.GridIcon} to="/categories">Explore categories</Button>
          </div>
          {data?.stats && (
            <div className="hero-stats">
              <div><b><CountUp value={data.stats.listings} /></b><span>live listings in {country}</span></div>
              <div><b><CountUp value={data.stats.sellers} /></b><span>active sellers</span></div>
              <div><b><CountUp value={data.stats.cities} /></b><span>cities</span></div>
            </div>
          )}
        </div>
        <div className="hero-visual" aria-hidden="true">
          {picks[0] && <FloatCard item={picks[0]} style={{ left: '8%', top: '4%', '--r': '-4deg' }} />}
          {picks[1] && <FloatCard item={picks[1]} style={{ right: '0%', top: '14%', animationDelay: '-2s', '--r': '3deg' }} />}
          {picks[2] && <FloatCard item={picks[2]} style={{ left: '22%', bottom: '2%', animationDelay: '-4s', '--r': '2deg' }} />}
          <div className="float-chip" style={{ left: '-4%', top: '46%', animationDelay: '-1s' }}><span className="ic" style={{ background: '#12C08A' }}><I.Handshake size={16} /></span>Offer accepted · {money(7000000, 'INR')}</div>
          <div className="float-chip" style={{ right: '2%', bottom: '24%', animationDelay: '-3s' }}><span className="ic" style={{ background: 'var(--accent)' }}><I.BadgeCheck size={16} /></span>Verified seller</div>
          <div className="float-chip" style={{ right: '18%', top: '-2%', animationDelay: '-5s' }}><span className="ic" style={{ background: 'var(--accent-2)' }}><I.Qr size={16} /></span>Ready for pickup</div>
        </div>
      </div>
      <LocationPicker open={loc} onClose={() => setLoc(false)} />
    </section>
  );
}
function FloatCard({ item, style }) {
  return (
    <Link to={`/l/${item.slug}`} className="float-card" style={style} tabIndex={-1}>
      <img src={item.thumb} alt="" />
      <div className="fc-body"><div className="fc-price">{money(item.price_minor, item.currency)}</div><div className="fc-title ellipsis">{item.title}</div></div>
    </Link>
  );
}

function CategoryTiles({ cats }) {
  return (
    <div className="ctiles stagger">
      {cats.map((c) => (
        <Link key={c.slug} to={`/c/${c.slug}`} className="ctile" style={{ '--c': c.color }}>
          <span className="ctile-icon"><I.CatIcon name={c.icon} size={26} /></span>
          <span><b>{c.name}</b><br /><span>{c.count.toLocaleString('en-IN')} listings</span></span>
        </Link>
      ))}
    </div>
  );
}

function Promos({ promos }) {
  const list = promos.filter((p) => p.placement === 'banner').slice(0, 3);
  if (!list.length) return null;
  return (
    <div className="promos">
      {list.map((p) => (
        <Link key={p.id} to={p.link || '/browse'} className="promo" data-theme-name={p.theme} onClick={() => api.post(`/promotions/${p.id}/click`).catch(() => {})}>
          <div><h3>{p.title}</h3>{p.subtitle && <p>{p.subtitle}</p>}</div>
          {p.cta_label && <span className="btn btn-sm">{p.cta_label}<I.ArrowRight size={15} /></span>}
        </Link>
      ))}
    </div>
  );
}

function Sellers({ sellers }) {
  return (
    <Rail items={sellers}>
      {sellers.map((s) => (
        <Link key={s.id} to={`/u/${s.id}`} className="card hoverable stile">
          <Avatar name={s.name} src={s.avatar_url} size={64} />
          <b className="row" style={{ '--gap': '5px', justifyContent: 'center' }}>{s.name}<Verified /></b>
          <span className="small muted">{s.city}</span>
          <span className="row small" style={{ justifyContent: 'center' }}>{s.rating ? <><Stars value={s.rating} size={13} /><b>{s.rating}</b></> : <span className="muted">New seller</span>}</span>
          <span className="tiny muted">{s.listings} listings · {s.sales} sales</span>
        </Link>
      ))}
    </Rail>
  );
}

function SellCta() {
  const app = useApp();
  return (
    <div className="cta-band">
      <div>
        <span className="badge" style={{ background: 'rgba(255,255,255,.1)', color: '#fff' }}><I.Zap size={13} />Free to list</span>
        <h2 className="mt-4">Turn what you don’t use into cash — in under 2 minutes.</h2>
        <p>Snap a few photos, set your price and choose delivery or pickup. Buyers near you will message you directly.</p>
        <div className="row mt-5"><Button variant="gradient" size="lg" icon={I.Plus} to="/sell">Start selling on PASAL</Button>{!app.user && <Button variant="ghost" size="lg" to="/register" style={{ color: '#fff' }}>Create an account</Button>}</div>
      </div>
      <div className="cta-steps">
        {[['Snap & describe', 'Add photos, pick a category, we’ll guide you.'], ['Set your price', 'In ₹ or रू. Allow offers if you’re flexible.'], ['Deliver or meet up', 'Ship to the buyer, or hand over with a secure QR code.']].map(([t, d], i) => (
          <Reveal key={t} delay={i * 0.1} className="cta-step"><span className="n">{i + 1}</span><span><b>{t}</b><br /><span className="small" style={{ color: '#B4B9D6' }}>{d}</span></span></Reveal>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const app = useApp();
  const { data, loading } = useApi(`/home?country=${app.country}${app.city ? `&city=${app.city.id}` : ''}`, { keep: true });
  return (
    <>
      <Hero data={data} />
      <div className="container">
        {loading && !data && <div className="section"><Skel h={28} w={240} style={{ marginBottom: 18 }} /><SkeletonCards n={5} /></div>}
        {data?.sections.map((s, idx) => {
          let body = null, link = null;
          if (s.kind === 'listings') {
            link = s.query.recommended ? '/browse' : s.query.category ? `/c/${s.query.category}?country=${app.country}` : s.key === 'trending_near' ? `/trending?country=${app.country}` : s.key === 'featured' ? `/featured?country=${app.country}` : `/browse?${toSearch(s.query)}`;
            body = <Rail items={s.items} />;
          } else if (s.kind === 'categories') { body = <CategoryTiles cats={data.categories} />; link = '/categories'; }
          else if (s.kind === 'promo') { body = <Promos promos={data.promotions} />; if (!data.promotions.some((p) => p.placement === 'banner')) return null; }
          else if (s.kind === 'sellers') { body = <Sellers sellers={s.sellers} />; }
          else if (s.kind === 'locations') {
            link = '/locations';
            body = <div className="loc-tiles stagger">{s.locations.map((l) => <Link key={l.id} to={`/in/${l.slug}`} className="loc-tile"><span className="ic"><I.MapPin size={18} /></span><span><b>{l.name}</b><br /><span className="small muted">{l.n} listings · {l.parent}</span></span></Link>)}</div>;
          } else if (s.kind === 'cta') return <section key={s.key} className="section"><Reveal><SellCta /></Reveal></section>;
          if (!body) return null;
          const title = s.key === 'trending_near' && app.city ? `Trending near ${app.city.name}` : s.title;
          return (
            <section key={s.key} className="section" aria-labelledby={`sec-${s.key}`}>
              <Reveal delay={Math.min(idx, 2) * 0.05}>
                <SectionHead title={<span id={`sec-${s.key}`}>{title}</span>} subtitle={s.subtitle} to={link} />
                {body}
              </Reveal>
            </section>
          );
        })}
      </div>
    </>
  );
}
