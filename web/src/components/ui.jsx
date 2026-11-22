import React, { useEffect, useId, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Link, onToast, navigate, useClickOutside } from '../lib/core.jsx';
import { initials } from '../lib/format.js';
import { WORD } from './wordmark.js';
import * as I from './icons.jsx';

// ---------- Brand ----------
const GLYPH = 'M36 21H54A21 21 0 0 1 54 63H44V72A7.5 7.5 0 0 1 29 72V28.5A7.5 7.5 0 0 1 36.5 21Z M46 42a8 8 0 1 0 16 0a8 8 0 1 0 -16 0Z';
export function Mark({ size = 36, animated = false }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" className={animated ? 'mark-anim' : undefined}>
      <defs>
        <linearGradient id={`${id}g`} x1="8" y1="4" x2="96" y2="100" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#8A6BFF" /><stop offset=".48" stopColor="var(--brand-accent, #6A4DFF)" /><stop offset="1" stopColor="var(--brand-accent-2, #2F7BFF)" /></linearGradient>
        <radialGradient id={`${id}h`} cx="22" cy="12" r="70" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#fff" stopOpacity=".38" /><stop offset=".6" stopColor="#fff" stopOpacity="0" /></radialGradient>
      </defs>
      <rect width="100" height="100" rx="27" fill={`url(#${id}g)`} />
      <rect width="100" height="100" rx="27" fill={`url(#${id}h)`} />
      <path d={GLYPH} fill="#fff" fillRule="evenodd" />
      <circle cx="71.5" cy="73" r="7" fill="#2EE6A6" />
    </svg>
  );
}
export function Logo({ height = 34, word = true, color = 'var(--text)' }) {
  const capH = height * 0.46;
  const s = capH / WORD.cap;
  const w = WORD.width * s;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: height * 0.26 }} aria-label="PASAL">
      <Mark size={height} />
      {word && (
        <svg width={w} height={capH + 2} viewBox={`0 ${-WORD.cap - 10} ${WORD.width} ${WORD.cap + 20}`} aria-hidden="true">
          <path d={WORD.d} fill={color} />
        </svg>
      )}
    </span>
  );
}

// ---------- Buttons ----------
export function Button({ variant = 'primary', size, block, loading, icon: Icon, iconRight: IconR, to, className = '', children, ...rest }) {
  const cls = ['btn', `btn-${variant}`, size && `btn-${size}`, block && 'btn-block', !children && Icon && 'btn-icon', className].filter(Boolean).join(' ');
  const inner = <>{Icon && <Icon size={size === 'sm' || size === 'xs' ? 15 : 18} />}{children}{IconR && <IconR size={16} />}</>;
  if (to) return <Link to={to} className={cls} {...rest}>{inner}</Link>;
  return <button type="button" className={cls} data-loading={loading ? 'true' : undefined} disabled={rest.disabled || loading} {...rest}>{inner}</button>;
}
export function IconButton({ icon: Icon, label, size = 20, className = '', badge, ...rest }) {
  return (
    <button type="button" className={`icon-btn ${className}`} aria-label={label} title={label} {...rest}>
      <Icon size={size} />
      {badge > 0 && <span className="count-badge">{badge > 99 ? '99+' : badge}</span>}
    </button>
  );
}

// ---------- Form fields ----------
export function Field({ label, required, help, error, children, className = '', htmlFor }) {
  return (
    <div className={`field ${className}`}>
      {label && <label htmlFor={htmlFor}>{label}{required && <span className="req">*</span>}</label>}
      {children}
      {error ? <span className="error-text" role="alert">{error}</span> : help ? <span className="help">{help}</span> : null}
    </div>
  );
}
export const Input = React.forwardRef(function Input({ className = '', invalid, ...p }, ref) {
  return <input ref={ref} className={`input ${className}`} aria-invalid={invalid || undefined} {...p} />;
});
export const Textarea = React.forwardRef(function Textarea({ className = '', ...p }, ref) { return <textarea ref={ref} className={`textarea ${className}`} {...p} />; });
export function Select({ options, placeholder, className = '', ...p }) {
  return (
    <select className={`select ${className}`} {...p}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>))}
    </select>
  );
}
export function Toggle({ label, checked, onChange, ...p }) {
  return <label className="switch"><input type="checkbox" role="switch" checked={!!checked} onChange={(e) => onChange(e.target.checked)} {...p} />{label && <span>{label}</span>}</label>;
}
export function Check({ label, checked, onChange, type = 'checkbox', ...p }) {
  return <label className="check"><input type={type} checked={!!checked} onChange={(e) => onChange(e.target.checked)} {...p} /><span>{label}</span></label>;
}
export function Seg({ value, onChange, options, full, label }) {
  return (
    <div className={`seg ${full ? 'full' : ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.icon && <o.icon size={15} />}{o.label}</button>
      ))}
    </div>
  );
}
export function MoneyInput({ currency, value, onChange, ...p }) {
  return (
    <div className="input-group">
      <span className="addon">{currency === 'NPR' ? 'रू' : '₹'}</span>
      <input className="input" inputMode="decimal" value={value ?? ''} onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))} {...p} />
    </div>
  );
}

// ---------- Display ----------
export function Badge({ tone, icon: Icon, children, className = '' }) {
  return <span className={`badge ${tone ? `badge-${tone}` : ''} ${className}`}>{Icon && <Icon />}{children}</span>;
}
export function Status({ tone, children }) { return <span className="status" data-tone={tone}>{children}</span>; }
export function Avatar({ name, src, size = 40, online }) {
  return (
    <span className="avatar" style={{ '--s': `${size}px` }} aria-hidden="true">
      {src ? <img src={src} alt="" loading="lazy" /> : initials(name)}
      {online && <span className="dot online" />}
    </span>
  );
}
export function Stars({ value = 0, size = 14 }) {
  return (
    <span className="stars" aria-label={`${Number(value).toFixed(1)} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => <I.Star key={i} size={size} className={i <= Math.round(value) ? '' : 'off'} fill={i <= Math.round(value) ? 'currentColor' : 'none'} />)}
    </span>
  );
}
export function StarsInput({ value, onChange }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="stars-input" role="radiogroup" aria-label="Rating" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((i) => (
        <button key={i} type="button" role="radio" aria-checked={value === i} aria-label={`${i} star${i > 1 ? 's' : ''}`} className={(hover || value) >= i ? 'on' : ''} onMouseEnter={() => setHover(i)} onClick={() => onChange(i)}>
          <I.Star size={30} fill="currentColor" />
        </button>
      ))}
    </div>
  );
}
export function Verified({ size = 16 }) { return <I.BadgeCheck size={size} className="verified-tick" aria-label="Verified seller" />; }
export function Spinner() { return <span className="spinner" role="status" aria-label="Loading" />; }
export function PageLoader() { return <div className="loading-page"><Spinner /></div>; }
export function Empty({ icon: Icon = I.Inbox, title, children, action }) {
  return (
    <div className="empty">
      <div className="ic"><Icon size={32} /></div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
export function ErrorState({ error, retry }) {
  return <Empty icon={I.Alert} title={error?.status === 404 ? 'Not found' : 'Something went wrong'} action={retry && <Button variant="secondary" icon={I.Refresh} onClick={retry}>Try again</Button>}>{error?.message}</Empty>;
}
export function SkeletonCards({ n = 8 }) {
  return (
    <div className="grid">
      {Array.from({ length: n }, (_, i) => (
        <div className="sk-card" key={i} aria-hidden="true"><div className="sk sk-img" /><div className="sk sk-line" style={{ width: '50%', height: 16 }} /><div className="sk sk-line" style={{ width: '85%' }} /><div className="sk sk-line" style={{ width: '40%', marginBottom: 16 }} /></div>
      ))}
    </div>
  );
}
export function Skel({ h = 16, w = '100%', r, style }) { return <div className="sk" style={{ height: h, width: w, borderRadius: r, ...style }} />; }

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" type="button" className="tab" aria-selected={value === t.value} onClick={() => onChange(t.value)}>
          {t.icon && <t.icon size={16} />}{t.label}{t.count != null && <span className="n">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------- Overlays ----------
function useLockScroll(active) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [active]);
}
export function Modal({ open, onClose, title, subtitle, children, footer, width = 520 }) {
  const ref = useRef(null);
  useLockScroll(open);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement;
    const k = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', k);
    setTimeout(() => ref.current?.querySelector('input,textarea,select,button:not([data-close])')?.focus(), 30);
    return () => { document.removeEventListener('keydown', k); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} style={{ '--mw': `${width}px` }} ref={ref}>
        <div className="modal-head">
          <div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div>
          <IconButton icon={I.X} label="Close" onClick={onClose} className="sm" data-close />
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
export function Drawer({ open, onClose, title, children, footer, side = 'left' }) {
  useLockScroll(open);
  useEffect(() => { if (!open) return; const k = (e) => e.key === 'Escape' && onClose(); document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className={`drawer ${side}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="drawer-head"><h3>{title}</h3><IconButton icon={I.X} label="Close" onClick={onClose} className="sm" /></div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </aside>
    </>,
    document.body,
  );
}

let confirmFn = null;
export function confirmDialog(opts) { return new Promise((resolve) => confirmFn?.({ ...opts, resolve })); }
export function ConfirmHost() {
  const [s, setS] = useState(null);
  const [val, setVal] = useState('');
  useEffect(() => { confirmFn = (o) => { setVal(''); setS(o); }; return () => (confirmFn = null); }, []);
  const close = (v) => { s?.resolve(v); setS(null); };
  return (
    <Modal open={!!s} onClose={() => close(false)} title={s?.title} subtitle={s?.message} width={440}
      footer={<><Button variant="secondary" onClick={() => close(false)}>{s?.cancel || 'Cancel'}</Button><Button variant={s?.danger ? 'danger' : 'primary'} disabled={s?.input?.required && !val.trim()} onClick={() => close(s?.input ? val : true)}>{s?.confirm || 'Confirm'}</Button></>}>
      {s?.input ? <Field label={s.input.label}><Textarea value={val} onChange={(e) => setVal(e.target.value)} placeholder={s.input.placeholder} rows={3} /></Field> : null}
    </Modal>
  );
}

export function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => onToast((t) => {
    setItems((s) => [...s.slice(-3), t]);
    setTimeout(() => setItems((s) => s.map((x) => (x.id === t.id ? { ...x, out: true } : x))), t.duration || 4200);
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== t.id)), (t.duration || 4200) + 300);
  }), []);
  const Ic = { success: I.CheckCircle, error: I.Alert, info: I.Bell };
  return createPortal(
    <div className="toasts" aria-live="polite">
      {items.map((t) => {
        const C = Ic[t.type] || I.Info;
        return (
          <div key={t.id} className={`toast ${t.type} ${t.out ? 'out' : ''}`} role="status">
            <span className="ic"><C size={16} /></span>
            <span className="grow">{t.message}</span>
            {t.link && <button className="link" onClick={() => navigate(t.link)}>{t.linkLabel || 'Open'}</button>}
          </div>
        );
      })}
    </div>,
    document.body,
  );
}

export function Menu({ trigger, children, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useClickOutside(ref, useCallback(() => setOpen(false), []), open);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && <div className="menu" style={align === 'left' ? { left: 0, right: 'auto', transformOrigin: 'top left' } : undefined} onClick={() => setOpen(false)}>{children}</div>}
    </div>
  );
}
export function MenuItem({ icon: Icon, children, danger, to, ...p }) {
  const inner = <>{Icon && <Icon size={17} />}{children}</>;
  if (to) return <Link to={to} className={`menu-item ${danger ? 'danger' : ''}`} {...p}>{inner}</Link>;
  return <button type="button" className={`menu-item ${danger ? 'danger' : ''}`} {...p}>{inner}</button>;
}

export function Pager({ page, pages, onPage }) {
  if (!pages || pages <= 1) return null;
  const nums = [];
  for (let i = Math.max(1, page - 2); i <= Math.min(pages, page + 2); i++) nums.push(i);
  return (
    <nav className="pager" aria-label="Pagination">
      <Button variant="secondary" size="sm" icon={I.ChevronLeft} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page" />
      {nums[0] > 1 && <><Button variant="ghost" size="sm" onClick={() => onPage(1)}>1</Button>{nums[0] > 2 && <span className="muted">…</span>}</>}
      {nums.map((n) => <Button key={n} variant={n === page ? 'primary' : 'ghost'} size="sm" onClick={() => onPage(n)} aria-current={n === page ? 'page' : undefined}>{n}</Button>)}
      {nums[nums.length - 1] < pages && <>{nums[nums.length - 1] < pages - 1 && <span className="muted">…</span>}<Button variant="ghost" size="sm" onClick={() => onPage(pages)}>{pages}</Button></>}
      <Button variant="secondary" size="sm" icon={I.ChevronRight} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page" />
    </nav>
  );
}

// ---------- Motion helpers ----------
export function Reveal({ children, delay = 0, as: Tag = 'div', className = '', ...rest }) {
  const ref = useRef(null);
  const [inView, setIn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!('IntersectionObserver' in window)) { setIn(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setIn(true); io.disconnect(); } }, { rootMargin: '0px 0px -8% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <Tag ref={ref} className={`reveal ${inView ? 'in' : ''} ${className}`} style={{ '--d': `${delay}s` }} {...rest}>{children}</Tag>;
}
export function CountUp({ value, duration = 900 }) {
  const [v, setV] = useState(0);
  const ref = useRef(null);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setV(value); return; }
    let raf, start;
    const step = (t) => { start ??= t; const p = Math.min(1, (t - start) / duration); setV(Math.round(value * (1 - (1 - p) ** 3))); if (p < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span ref={ref}>{v.toLocaleString('en-IN')}</span>;
}
export function Confetti({ run }) {
  const [pieces, setPieces] = useState([]);
  useEffect(() => {
    if (!run || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const colors = ['#6A4DFF', '#2F7BFF', '#2EE6A6', '#FFC857', '#F0445F', '#8A6BFF'];
    setPieces(Array.from({ length: 90 }, (_, i) => ({ i, left: Math.random() * 100, delay: Math.random() * 0.5, x: (Math.random() - 0.5) * 300, rot: Math.random() * 900, c: colors[i % colors.length] })));
    const t = setTimeout(() => setPieces([]), 3400);
    return () => clearTimeout(t);
  }, [run]);
  if (!pieces.length) return null;
  return createPortal(<div className="confetti">{pieces.map((p) => <i key={p.i} style={{ left: `${p.left}%`, background: p.c, animationDelay: `${p.delay}s`, '--x': `${p.x}px`, '--rot': `${p.rot}deg` }} />)}</div>, document.body);
}
export function SuccessBurst() {
  return (
    <div className="success-burst" aria-hidden="true">
      <span className="ring" />
      <span className="circle"><svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path className="check-path" d="M5 12.5l4.5 4.5L19 7.5" /></svg></span>
    </div>
  );
}
export function CopyButton({ text, label = 'Copy' }) {
  const [ok, setOk] = useState(false);
  return <Button variant="secondary" size="sm" icon={ok ? I.Check : I.Copy} onClick={async () => { try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); } catch { /* ignore */ } }}>{ok ? 'Copied' : label}</Button>;
}
