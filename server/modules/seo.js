import fs from 'node:fs';
import path from 'node:path';
import { q } from '../db.js';
import { config, brand, ROOT } from '../config.js';
import { categoryTree } from './categories.js';
import { CONDITIONS } from './listings.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PRIVATE = /^\/(dashboard|seller|sell|orders|wishlist|messages|offers|notifications|saved-searches|settings|reviews|checkout|pay|admin|recently-viewed|verify-email|reset-password|dev)/;

let manifest = null;
function assets() {
  if (manifest && config.isProd) return manifest;
  const f = path.join(ROOT, 'public', 'build', 'manifest.json');
  manifest = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { js: '/build/app.js', css: '/build/app.css' };
  return manifest;
}

const fmt = (minor, cur) => `${cur === 'NPR' ? 'रू' : '₹'} ${(minor / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function metaFor(pathname, search) {
  const base = { title: brand.title, description: brand.description, image: `${config.publicUrl}${brand.logo.og}`, canonical: config.publicUrl + pathname, jsonld: null, robots: 'index,follow' };
  if (PRIVATE.test(pathname)) return { ...base, robots: 'noindex,nofollow' };
  let m;
  if ((m = pathname.match(/^\/l\/([^/]+)$/))) {
    const l = q.get(`SELECT l.*, c.name AS city, cat.name AS category, u.name AS seller, (SELECT url FROM listing_images WHERE listing_id = l.id ORDER BY sort LIMIT 1) AS image
      FROM listings l LEFT JOIN locations c ON c.id = l.city_id JOIN categories cat ON cat.id = l.category_id JOIN users u ON u.id = l.seller_id WHERE l.slug = ?`, decodeURIComponent(m[1]));
    if (!l || !['active', 'sold'].includes(l.status)) return { ...base, title: `Listing not available | ${brand.name}`, robots: 'noindex' };
    const images = q.all('SELECT url FROM listing_images WHERE listing_id = ? ORDER BY sort', l.id).map((i) => config.publicUrl + i.url);
    return {
      ...base,
      title: `${l.title} · ${fmt(l.price_minor, l.currency)}${l.city ? ` in ${l.city}` : ''} | ${brand.name}`,
      description: `${CONDITIONS[l.condition]} · ${l.category}. ${l.description.slice(0, 140)}`,
      image: l.image ? config.publicUrl + l.image : base.image,
      canonical: `${config.publicUrl}/l/${l.slug}`,
      ogType: 'product',
      jsonld: {
        '@context': 'https://schema.org', '@type': 'Product', name: l.title, description: l.description.slice(0, 500), image: images, category: l.category,
        ...(l.brand ? { brand: { '@type': 'Brand', name: l.brand } } : {}), ...(l.model ? { model: l.model } : {}),
        offers: {
          '@type': 'Offer', price: (l.price_minor / 100).toFixed(2), priceCurrency: l.currency, url: `${config.publicUrl}/l/${l.slug}`,
          availability: l.status === 'active' ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut',
          itemCondition: l.condition === 'new' ? 'https://schema.org/NewCondition' : l.condition === 'for_parts' ? 'https://schema.org/DamagedCondition' : 'https://schema.org/UsedCondition',
          seller: { '@type': 'Person', name: l.seller },
          ...(l.city ? { areaServed: l.city } : {}),
        },
      },
    };
  }
  if ((m = pathname.match(/^\/c\/([^/]+)$/))) {
    const c = q.get('SELECT * FROM categories WHERE slug = ? AND active = 1', m[1]);
    if (c) return { ...base, title: c.seo_title || `${c.name} for sale — buy & sell ${c.name.toLowerCase()} | ${brand.name}`, description: c.seo_description || `Find great deals on ${c.name.toLowerCase()} near you in India and Nepal. ${c.description || ''}`.trim(), canonical: `${config.publicUrl}/c/${c.slug}` };
  }
  if ((m = pathname.match(/^\/u\/(\d+)$/))) {
    const u = q.get("SELECT name FROM users WHERE id = ? AND status = 'active'", Number(m[1]));
    if (u) return { ...base, title: `${u.name} — seller on ${brand.name}`, description: `See listings, ratings and reviews for ${u.name} on ${brand.name}.` };
  }
  if ((m = pathname.match(/^\/in\/([^/]+)$/))) {
    const l = q.get("SELECT name FROM locations WHERE slug = ? AND type = 'city'", m[1]);
    if (l) return { ...base, title: `Buy & sell in ${l.name} | ${brand.name}`, description: `Second-hand and new items for sale in ${l.name}: phones, bikes, furniture, rentals and more.` };
  }
  const statics = {
    '/': base,
    '/browse': { title: `Browse listings | ${brand.name}`, description: 'Search phones, vehicles, property, fashion, furniture and more across India and Nepal.' },
    '/search': { title: `${search.get('q') ? `${search.get('q')} — ` : ''}Search | ${brand.name}`, robots: 'noindex,follow' },
    '/categories': { title: `All categories | ${brand.name}`, description: 'Explore every category on PASAL.' },
    '/trending': { title: `Trending now | ${brand.name}` },
    '/featured': { title: `Featured listings | ${brand.name}` },
    '/locations': { title: `Browse by city | ${brand.name}` },
    '/about': { title: `About ${brand.name}`, description: `${brand.name} is a marketplace for India and Nepal. ${brand.tagline}` },
    '/contact': { title: `Contact ${brand.name}` },
    '/help': { title: `Help centre | ${brand.name}` },
    '/privacy': { title: `Privacy policy | ${brand.name}` },
    '/terms': { title: `Terms & conditions | ${brand.name}` },
    '/prohibited-items': { title: `Prohibited items policy | ${brand.name}` },
    '/login': { title: `Sign in | ${brand.name}`, robots: 'noindex' },
    '/register': { title: `Create your account | ${brand.name}`, robots: 'noindex' },
    '/forgot-password': { title: `Reset password | ${brand.name}`, robots: 'noindex' },
  };
  return { ...base, ...(statics[pathname] || { robots: 'noindex' }), canonical: config.publicUrl + pathname };
}

export function renderShell(pathname, search) {
  const m = metaFor(pathname, search);
  const a = assets();
  const c = brand.colors;
  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(m.title)}</title>
<meta name="description" content="${esc(m.description || brand.description)}">
<meta name="robots" content="${m.robots}">
<link rel="canonical" href="${esc(m.canonical)}">
<meta property="og:site_name" content="${esc(brand.name)}">
<meta property="og:type" content="${m.ogType || 'website'}">
<meta property="og:title" content="${esc(m.title)}">
<meta property="og:description" content="${esc(m.description || brand.description)}">
<meta property="og:url" content="${esc(m.canonical)}">
<meta property="og:image" content="${esc(m.image || base(brand))}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="${esc(brand.social.twitter)}">
<meta name="theme-color" content="#FFFFFF" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#070A18" media="(prefers-color-scheme: dark)">
<link rel="icon" href="${brand.logo.favicon}" type="image/svg+xml">
<link rel="icon" href="/brand/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="preload" href="/fonts/DMSans-var.ttf" as="font" type="font/ttf" crossorigin>
<style>:root{--brand-accent:${c.accent};--brand-accent-2:${c.accent2};--brand-ink:${c.accentInk};--brand-midnight:${c.midnight};--brand-success:${c.success};--brand-warning:${c.warning};--brand-danger:${c.danger}}</style>
<script>(function(){try{var t=localStorage.getItem('pasal.theme')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';document.documentElement.dataset.themePref=t}catch(e){}})()</script>
<link rel="stylesheet" href="${a.css}">
${m.jsonld ? `<script type="application/ld+json">${JSON.stringify(m.jsonld).replace(/</g, '\\u003c')}</script>` : ''}
</head>
<body>
<div id="root"><div class="boot"><img src="/brand/pasal-loader.svg" alt="PASAL" width="72" height="72"></div></div>
<noscript><p style="padding:24px;font-family:sans-serif">PASAL needs JavaScript to run. Please enable it in your browser.</p></noscript>
<script>window.__PASAL__=${JSON.stringify({ brand: { name: brand.name, tagline: brand.tagline, logo: brand.logo, supportEmail: brand.supportEmail }, devTools: config.devTools }).replace(/</g, '\\u003c')}</script>
<script type="module" src="${a.js}"></script>
</body>
</html>`;
}
const base = (b) => `${config.publicUrl}${b.logo.og}`;

export function sitemap() {
  const urls = ['/', '/browse', '/categories', '/trending', '/featured', '/locations', '/about', '/help', '/contact', '/privacy', '/terms', '/prohibited-items'];
  for (const c of categoryTree().byId.values()) urls.push(`/c/${c.slug}`);
  for (const l of q.all("SELECT slug FROM locations WHERE type = 'city' AND popular = 1")) urls.push(`/in/${l.slug}`);
  const listings = q.all("SELECT slug, updated_at FROM listings WHERE status = 'active' ORDER BY updated_at DESC LIMIT 45000");
  const body = [
    ...urls.map((u) => `<url><loc>${config.publicUrl}${u}</loc></url>`),
    ...listings.map((l) => `<url><loc>${config.publicUrl}/l/${esc(l.slug)}</loc><lastmod>${l.updated_at.slice(0, 10)}</lastmod></url>`),
  ].join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`;
}

export const robots = () => `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\nDisallow: /dashboard\nDisallow: /seller\nDisallow: /messages\nDisallow: /orders\nDisallow: /checkout\nDisallow: /settings\nSitemap: ${config.publicUrl}/sitemap.xml\n`;
