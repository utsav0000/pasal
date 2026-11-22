import React, { useEffect, useRef, useState } from 'react';
import { Link, useApp } from '../lib/core.jsx';
import { money, approx, ago, CONDITIONS, discount } from '../lib/format.js';
import { Badge, Verified, Empty, SkeletonCards } from './ui.jsx';
import * as I from './icons.jsx';

export function Price({ minor, currency, original, showApprox = true, className = 'p' }) {
  const app = useApp();
  const other = currency === 'INR' ? 'NPR' : 'INR';
  const show = showApprox && app.currency !== currency;
  const off = discount(minor, original);
  return (
    <>
      <span className={className}>{money(minor, currency)}</span>
      {off >= 10 && <span className="was">{money(original, currency)}</span>}
      {off >= 10 && <span className="off">{off}% off</span>}
      {show && <span className="was" style={{ textDecoration: 'none' }} title="Estimated conversion — the seller's price is in the original currency">{approx(minor, currency, other, app.rate(currency, other))}</span>}
    </>
  );
}

export function ProductCard({ item, layout = 'grid', priority = false }) {
  const app = useApp();
  const wished = app.wishlist.has(item.id) || (item.wished && !app.user);
  const [loaded, setLoaded] = useState(false);
  const delivery = item.fulfillment === 'delivery' || item.fulfillment === 'both';
  const pickup = item.fulfillment === 'pickup' || item.fulfillment === 'both';
  return (
    <article className={`pcard ${layout === 'list' ? 'list' : ''}`}>
      <div className="pcard-media">
        {item.thumb ? <img src={layout === 'list' ? item.thumb : item.image || item.thumb} alt="" loading={priority ? 'eager' : 'lazy'} decoding="async" className={loaded ? '' : 'loading'} onLoad={() => setLoaded(true)} /> : <div className="sk" style={{ width: '100%', height: '100%', borderRadius: 0 }} />}
        <div className="pcard-badges">
          {item.featured && <Badge tone="grad" icon={I.Sparkles}>Featured</Badge>}
          {item.status === 'sold' && <Badge tone="dark">Sold</Badge>}
          {item.condition === 'new' && !item.featured && <Badge className="badge-glass">New</Badge>}
        </div>
        <button className={`pcard-heart ${wished ? 'on' : ''}`} aria-label={wished ? 'Remove from wishlist' : 'Save to wishlist'} aria-pressed={wished} onClick={(e) => { e.preventDefault(); e.stopPropagation(); app.toggleWish(item.id); }}>
          <I.Heart size={17} fill={wished ? 'currentColor' : 'none'} strokeWidth={2.2} />
        </button>
        {item.image_count > 1 && <span className="pcard-count badge badge-dark"><I.Camera size={12} />{item.image_count}</span>}
      </div>
      <div className="pcard-body">
        <div className="pcard-price"><Price minor={item.price_minor} currency={item.currency} original={item.original_price_minor} /></div>
        <Link to={`/l/${item.slug}`} className="pcard-title pcard-link">{item.title}</Link>
        <div className="pcard-meta">
          <I.MapPin size={13} /><span className="ellipsis">{[item.locality, item.city].filter(Boolean).join(', ') || item.region}</span>
          <span style={{ marginLeft: 'auto' }} className="nowrap">{ago(item.published_at)}</span>
        </div>
        <div className="pcard-foot">
          <span className="row" style={{ '--gap': '5px', minWidth: 0 }}>{item.seller?.verified && <Verified size={14} />}<span className="ellipsis">{CONDITIONS[item.condition]}</span></span>
          <span className="ful">
            {delivery && <span title="Home delivery available"><I.Truck size={13} />{item.delivery_fee_minor === 0 ? 'Free' : ''}</span>}
            {pickup && <span title="Self pickup available"><I.Store size={13} /></span>}
          </span>
        </div>
      </div>
    </article>
  );
}

export function ListingGrid({ items, loading, layout = 'grid', empty }) {
  if (loading && !items?.length) return <SkeletonCards n={8} />;
  if (!items?.length) return empty || <Empty icon={I.Search} title="Nothing here yet">Try changing your filters or searching for something else.</Empty>;
  return (
    <div className={layout === 'list' ? 'stack' : 'grid stagger'} style={layout === 'list' ? { '--gap': '14px' } : undefined}>
      {items.map((it, i) => <ProductCard key={it.id} item={it} layout={layout} priority={i < 4} />)}
    </div>
  );
}

export function Rail({ items, children }) {
  const ref = useRef(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  const update = () => { const el = ref.current; if (!el) return; setEdges({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 8 }); };
  useEffect(() => { update(); }, [items]);
  const by = (d) => ref.current?.scrollBy({ left: d * ref.current.clientWidth * 0.85, behavior: 'smooth' });
  return (
    <div className="rail-wrap">
      <button className="rail-btn prev" onClick={() => by(-1)} disabled={edges.start} aria-label="Scroll left"><I.ChevronLeft size={20} /></button>
      <div className="rail" ref={ref} onScroll={update}>{children || items.map((it) => <ProductCard key={it.id} item={it} />)}</div>
      <button className="rail-btn next" onClick={() => by(1)} disabled={edges.end} aria-label="Scroll right"><I.ChevronRight size={20} /></button>
    </div>
  );
}
