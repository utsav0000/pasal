import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

// ======================= API client =======================
export class ApiError extends Error {
  constructor(status, message, fields) { super(message); this.status = status; this.fields = fields; }
}
export async function api(path, { method = 'GET', body, signal } = {}) {
  const res = await fetch(path.startsWith('/api') ? path : `/api/v1${path}`, {
    method,
    signal,
    credentials: 'same-origin',
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'X-Pasal-CSRF': '1' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { if (signal?.aborted || e.name === 'AbortError') throw e; }
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!res.ok) throw new ApiError(res.status, data?.error || `Request failed (${res.status})`, data?.fields);
  return data;
}
api.post = (p, body) => api(p, { method: 'POST', body: body ?? {} });
api.put = (p, body) => api(p, { method: 'PUT', body });
api.patch = (p, body) => api(p, { method: 'PATCH', body });
api.del = (p) => api(p, { method: 'DELETE' });

// ======================= Router =======================
const listeners = new Set();
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const snapshot = () => location.pathname + location.search;
window.addEventListener('popstate', () => listeners.forEach((l) => l()));

export function navigate(to, { replace = false, scroll = true } = {}) {
  if (to === snapshot()) return;
  const go = () => {
    history[replace ? 'replaceState' : 'pushState']({}, '', to);
    listeners.forEach((l) => l());
    if (scroll && !to.includes('#')) window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (document.startViewTransition && !reduce && !replace) document.startViewTransition(go);
  else go();
}

export function useLocation() {
  const loc = useSyncExternalStore(subscribe, snapshot);
  return useMemo(() => {
    const u = new URL(loc, location.origin);
    return { pathname: u.pathname, search: u.search, query: Object.fromEntries(u.searchParams), params: u.searchParams };
  }, [loc]);
}

export function matchRoute(pattern, pathname) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/\/:(\w+)(\?)?/g, (_, k, opt) => { keys.push(k); return opt ? '(?:/([^/]+))?' : '/([^/]+)'; }).replace(/\*$/, '.*') + '/?$');
  const m = pathname.match(re);
  if (!m) return null;
  const params = {};
  keys.forEach((k, i) => (params[k] = m[i + 1] ? decodeURIComponent(m[i + 1]) : undefined));
  return params;
}

export function Link({ to, replace, children, onClick, className, activeClass, exact, ...rest }) {
  const { pathname } = useLocation();
  const active = activeClass && (exact ? pathname === to.split('?')[0] : pathname === to.split('?')[0] || pathname.startsWith(to.split('?')[0] + '/'));
  return (
    <a
      href={to}
      className={[className, active ? activeClass : ''].filter(Boolean).join(' ') || undefined}
      aria-current={active ? 'page' : undefined}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || rest.target === '_blank') return;
        e.preventDefault();
        navigate(to, { replace });
      }}
      {...rest}
    >
      {children}
    </a>
  );
}

export function setQuery(patch, { replace = true } = {}) {
  const u = new URL(location.href);
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null || v === '' || v === false) u.searchParams.delete(k);
    else u.searchParams.set(k, v);
  }
  if (!('page' in patch)) u.searchParams.delete('page');
  navigate(u.pathname + (u.searchParams.toString() ? `?${u.searchParams}` : ''), { replace, scroll: false });
}

// ======================= Data hooks =======================
const cache = new Map();
export function useApi(path, { deps = [], keep = false } = {}) {
  const [state, setState] = useState(() => ({ data: path && cache.get(path), loading: !!path && !cache.has(path), error: null }));
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) { setState({ data: null, loading: false, error: null }); return; }
    const ctl = new AbortController();
    setState((s) => ({ data: cache.has(path) ? cache.get(path) : keep ? s.data : null, loading: true, error: null }));
    api(path, { signal: ctl.signal })
      .then((data) => { if (ctl.signal.aborted) return; cache.set(path, data); if (cache.size > 80) cache.delete(cache.keys().next().value); setState({ data, loading: false, error: null }); })
      .catch((e) => { if (e.name !== 'AbortError') setState((s) => ({ ...s, loading: false, error: e })); });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps]);
  const reload = useCallback(() => { if (path) cache.delete(path); setTick((t) => t + 1); }, [path]);
  const mutate = useCallback((fn) => setState((s) => { const data = typeof fn === 'function' ? fn(s.data) : fn; if (path) cache.set(path, data); return { ...s, data }; }), [path]);
  return { ...state, reload, mutate };
}
export const invalidate = (prefix) => { for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k); };

export function useDebounce(value, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
export function useMedia(q) {
  const get = () => matchMedia(q).matches;
  const [m, setM] = useState(get);
  useEffect(() => { const mq = matchMedia(q); const h = () => setM(mq.matches); mq.addEventListener('change', h); return () => mq.removeEventListener('change', h); }, [q]);
  return m;
}
export const useIsMobile = () => useMedia('(max-width: 860px)');
export function useClickOutside(ref, fn, active = true) {
  useEffect(() => {
    if (!active) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) fn(); };
    const k = (e) => { if (e.key === 'Escape') fn(); };
    document.addEventListener('pointerdown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('pointerdown', h); document.removeEventListener('keydown', k); };
  }, [ref, fn, active]);
}
export function useTitle(t) {
  useEffect(() => { if (t) document.title = `${t} | PASAL`; }, [t]);
}
const storage = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};
export { storage };

// ======================= Toasts =======================
const toastListeners = new Set();
let toastId = 0;
export const toast = Object.assign(
  (message, type = 'info', opts = {}) => { const t = { id: ++toastId, message, type, ...opts }; toastListeners.forEach((l) => l(t)); return t.id; },
  { success: (m, o) => toast(m, 'success', o), error: (m, o) => toast(m, 'error', o), info: (m, o) => toast(m, 'info', o) },
);
export const onToast = (fn) => { toastListeners.add(fn); return () => toastListeners.delete(fn); };

// ======================= App store =======================
const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

function applyTheme(pref) {
  const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  const root = document.documentElement;
  root.classList.add('theme-anim');
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.themePref = pref;
  setTimeout(() => root.classList.remove('theme-anim'), 400);
}

export function AppProvider({ children }) {
  const [me, setMe] = useState({ loading: true, user: null, counts: { notifications: 0, messages: 0 } });
  const [wishlist, setWishlist] = useState(() => new Set());
  const [countries, setCountries] = useState([]);
  const [rates, setRates] = useState([]);
  const [country, setCountryState] = useState(() => storage.get('pasal.country', null));
  const [city, setCityState] = useState(() => storage.get('pasal.city', null));
  const [theme, setThemeState] = useState(() => storage.get('pasal.theme', 'system'));
  const socket = useRef(null);
  const bus = useRef(new Map());
  const [online, setOnline] = useState(new Set());

  const refreshMe = useCallback(async () => {
    try {
      const r = await api('/auth/me');
      setMe({ loading: false, user: r.user, counts: r.counts || { notifications: 0, messages: 0 } });
      setWishlist(new Set(r.wishlist || []));
      if (r.user && !storage.get('pasal.country', null)) setCountryState(r.user.country_code);
      return r.user;
    } catch {
      setMe((m) => ({ ...m, loading: false }));
      return null;
    }
  }, []);

  useEffect(() => { refreshMe(); api('/countries').then((r) => { setCountries(r.countries); setRates(r.rates); }).catch(() => {}); }, [refreshMe]);

  // Theme
  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const h = () => applyTheme('system');
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [theme]);
  const setTheme = (t) => { storage.set('pasal.theme', t); setThemeState(t); };

  const effectiveCountry = country || 'IN';
  const setCountry = (c) => { storage.set('pasal.country', c); setCountryState(c); if (city && city.country !== c) { storage.set('pasal.city', null); setCityState(null); } };
  const setCity = (c) => { storage.set('pasal.city', c); setCityState(c); if (c) { storage.set('pasal.country', c.country); setCountryState(c.country); } };

  // Realtime socket
  const on = useCallback((type, fn) => {
    if (!bus.current.has(type)) bus.current.set(type, new Set());
    bus.current.get(type).add(fn);
    return () => bus.current.get(type)?.delete(fn);
  }, []);
  const send = useCallback((type, data) => { if (socket.current?.readyState === 1) socket.current.send(JSON.stringify({ type, data })); }, []);
  useEffect(() => {
    if (!me.user) return;
    let ws, retry = 0, closed = false, timer;
    const connect = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      socket.current = ws;
      ws.onopen = () => { retry = 0; };
      ws.onmessage = (e) => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.type === 'notification') {
          setMe((s) => ({ ...s, counts: { ...s.counts, notifications: s.counts.notifications + 1 } }));
          if (!location.pathname.startsWith('/messages') || m.data.type !== 'message') toast(m.data.title, 'info', { link: m.data.link });
        }
        if (m.type === 'message' && m.data.message.sender_id !== me.user.id && !location.pathname.startsWith(`/messages/${m.data.conversation_id}`)) {
          setMe((s) => ({ ...s, counts: { ...s.counts, messages: s.counts.messages + 1 } }));
        }
        if (m.type === 'presence') setOnline((s) => { const n = new Set(s); m.data.online ? n.add(m.data.user_id) : n.delete(m.data.user_id); return n; });
        bus.current.get(m.type)?.forEach((fn) => fn(m.data));
      };
      ws.onclose = () => { if (!closed) timer = setTimeout(connect, Math.min(15000, 800 * 2 ** retry++)); };
    };
    connect();
    return () => { closed = true; clearTimeout(timer); ws?.close(); };
  }, [me.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleWish = useCallback(async (id) => {
    if (!me.user) { navigate(`/login?next=${encodeURIComponent(location.pathname)}`); toast.info('Sign in to save items to your wishlist.'); return; }
    const has = wishlist.has(id);
    setWishlist((s) => { const n = new Set(s); has ? n.delete(id) : n.add(id); return n; });
    try {
      if (has) await api.del(`/wishlist/${id}`);
      else { await api.post(`/wishlist/${id}`); toast.success('Saved to your wishlist', { link: '/wishlist', linkLabel: 'View' }); }
      invalidate('/api/v1/wishlist'); invalidate('/wishlist');
    } catch (e) {
      setWishlist((s) => { const n = new Set(s); has ? n.add(id) : n.delete(id); return n; });
      toast.error(e.message);
    }
  }, [me.user, wishlist]);

  const logout = async () => { await api.post('/auth/logout'); setMe({ loading: false, user: null, counts: { notifications: 0, messages: 0 } }); setWishlist(new Set()); cache.clear(); navigate('/'); toast.info('You are signed out.'); };
  const can = (perm) => !!me.user?.permissions?.includes(perm);
  const rate = (from, to) => { if (from === to) return 1; const r = rates.find((x) => x.base === from && x.quote === to); return r ? r.rate_micros / 1e6 : null; };

  const value = {
    ...me, refreshMe, setCounts: (fn) => setMe((s) => ({ ...s, counts: typeof fn === 'function' ? fn(s.counts) : fn })),
    wishlist, toggleWish, logout, can,
    countries, rates, rate, country: effectiveCountry, countryChosen: !!country, setCountry, city, setCity,
    currency: effectiveCountry === 'NP' ? 'NPR' : 'INR',
    theme, setTheme, on, send, online, isOnline: (id) => online.has(id),
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

// Require sign-in for a page
export function useRequireAuth() {
  const app = useApp();
  useEffect(() => {
    if (!app.loading && !app.user) navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
  }, [app.loading, app.user]);
  return app.user;
}
