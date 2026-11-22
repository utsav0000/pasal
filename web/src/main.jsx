import React, { Suspense, lazy, useEffect, Component } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/app.css';
import { AppProvider, useLocation, matchRoute, useApp } from './lib/core.jsx';
import { Header, Footer, BottomNav } from './components/layout.jsx';
import { Toaster, ConfirmHost, PageLoader } from './components/ui.jsx';
import Home from './pages/Home.jsx';
import { Browse, Categories, Locations } from './pages/Browse.jsx';
import { ListingPage, SellerProfile } from './pages/Listing.jsx';
import { Login, Register, Forgot, Reset, VerifyEmail } from './pages/Auth.jsx';
import { About, Contact, Help, Privacy, Terms, Prohibited, NotFound, DevMailbox } from './pages/Static.jsx';

const Sell = lazy(() => import('./pages/Sell.jsx'));
const Account = lazy(() => import('./pages/Account.jsx'));
const SellerPages = lazy(() => import('./pages/Seller.jsx'));
const Messages = lazy(() => import('./pages/Messages.jsx'));
const Orders = lazy(() => import('./pages/Orders.jsx'));
const Admin = lazy(() => import('./pages/Admin.jsx'));

class ErrorBoundary extends Component {
  constructor(p) { super(p); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('[PASAL] render error', error, info?.componentStack); }
  componentDidUpdate(prev) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="container page"><div className="empty"><div className="ic">⚠️</div><h3>Something went wrong on this page</h3><p>Please refresh. If it keeps happening, contact support.</p>
        <div className="row mt-2"><button className="btn btn-primary" onClick={() => location.reload()}>Reload page</button><a className="btn btn-secondary" href="/">Go home</a></div></div></div>
    );
  }
}

const ROUTES = [
  ['/', Home], ['/browse', Browse], ['/search', Browse], ['/c/:slug', Browse], ['/in/:city', Browse], ['/trending', Browse], ['/featured', Browse],
  ['/categories', Categories], ['/locations', Locations], ['/l/:slug', ListingPage], ['/u/:id', SellerProfile],
  ['/about', About], ['/contact', Contact], ['/help', Help], ['/privacy', Privacy], ['/terms', Terms], ['/prohibited-items', Prohibited],
  ['/login', Login], ['/register', Register], ['/forgot-password', Forgot], ['/reset-password', Reset], ['/verify-email', VerifyEmail], ['/dev/mailbox', DevMailbox],
  ['/sell', Sell], ['/sell/:id', Sell],
  ['/dashboard', Account], ['/wishlist', Account], ['/saved-searches', Account], ['/notifications', Account], ['/settings', Account], ['/settings/:tab', Account], ['/reviews', Account], ['/recently-viewed', Account], ['/offers', Account],
  ['/seller', SellerPages], ['/seller/listings', SellerPages], ['/seller/orders', SellerPages], ['/seller/analytics', SellerPages],
  ['/messages', Messages], ['/messages/:id', Messages],
  ['/orders', Orders], ['/orders/:id', Orders], ['/checkout/:id', Orders], ['/pay/test/:ref', Orders],
];

function Router() {
  const loc = useLocation();
  const app = useApp();
  useEffect(() => { document.getElementById('main')?.focus({ preventScroll: true }); }, [loc.pathname]);
  if (loc.pathname.startsWith('/admin')) {
    return <ErrorBoundary resetKey={loc.pathname}><Suspense fallback={<PageLoader />}><Admin /></Suspense></ErrorBoundary>;
  }
  let Page = NotFound, params = {};
  for (const [pattern, C] of ROUTES) { const p = matchRoute(pattern, loc.pathname); if (p) { Page = C; params = p; break; } }
  const bare = ['/login', '/register', '/forgot-password', '/reset-password'].includes(loc.pathname);
  return (
    <>
      <a href="#main" className="skip-link">Skip to content</a>
      <Header />
      {app.settingsBanner && <div className="callout warn">{app.settingsBanner}</div>}
      <main id="main" tabIndex={-1} style={{ outline: 'none' }} key={loc.pathname} className="route-enter">
        <ErrorBoundary resetKey={loc.pathname + loc.search}><Suspense fallback={<PageLoader />}><Page params={params} /></Suspense></ErrorBoundary>
      </main>
      {!bare && <Footer />}
      <BottomNav />
    </>
  );
}

createRoot(document.getElementById('root')).render(
  <AppProvider>
    <Router />
    <Toaster />
    <ConfirmHost />
  </AppProvider>,
);
