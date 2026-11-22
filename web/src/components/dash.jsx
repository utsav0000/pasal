import React from 'react';
import { useApp } from '../lib/core.jsx';
import { DashNav } from './layout.jsx';
import * as I from './icons.jsx';

export function DashLayout({ children }) {
  const app = useApp();
  const items = [
    { group: 'Buying' },
    { to: '/dashboard', label: 'Overview', icon: I.Dashboard },
    { to: '/orders', label: 'My orders', icon: I.Package, prefix: true },
    { to: '/wishlist', label: 'Wishlist', icon: I.Heart },
    { to: '/offers', label: 'Offers', icon: I.Handshake },
    { to: '/saved-searches', label: 'Saved searches', icon: I.Bookmark },
    { to: '/recently-viewed', label: 'Recently viewed', icon: I.History },
    { group: 'Selling' },
    { to: '/seller', label: 'Seller dashboard', icon: I.Store },
    { to: '/seller/listings', label: 'My listings', icon: I.Tag },
    { to: '/seller/orders', label: 'Sales', icon: I.Receipt },
    { to: '/seller/analytics', label: 'Analytics', icon: I.LineChart },
    { group: 'Account' },
    { to: '/messages', label: 'Messages', icon: I.Chat, n: app.counts.messages },
    { to: '/notifications', label: 'Notifications', icon: I.Bell, n: app.counts.notifications },
    { to: '/reviews', label: 'Reviews', icon: I.Star },
    { to: '/settings', label: 'Settings', icon: I.Settings, prefix: true },
  ];
  return (
    <div className="container page">
      <div className="dash">
        <DashNav items={items} />
        <div style={{ minWidth: 0 }}>{children}</div>
      </div>
    </div>
  );
}

export function Stat({ label, value, icon: Icon, sub, tone }) {
  return (
    <div className="stat">
      <div className="label-row">{label}{Icon && <span className="ic" style={tone ? { background: `var(--${tone}-soft)`, color: `var(--${tone}-text)` } : undefined}><Icon size={17} /></span>}</div>
      <div className="v">{value}</div>
      {sub && <div className="d">{sub}</div>}
    </div>
  );
}
export function PageHead({ title, subtitle, actions }) {
  return <div className="page-head"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{actions && <div className="row">{actions}</div>}</div>;
}
