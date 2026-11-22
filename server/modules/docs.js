// OpenAPI 3.1 document generated from the live route table, plus a self-contained docs page.
import { brand, config } from '../config.js';

const TAGS = {
  auth: 'Authentication, sessions, OTP, Google sign-in', countries: 'Countries & currencies', fx: 'Exchange rates (estimates)', locations: 'States, provinces, districts, cities',
  users: 'Public profiles, blocking, reviews', me: 'The signed-in user', categories: 'Category tree & attributes', listings: 'Listings: search, detail, create, manage',
  search: 'Autocomplete & trending', media: 'Image uploads', conversations: 'Real-time chat (REST + WebSocket /ws)', offers: 'Offers & counter-offers',
  checkout: 'Checkout quotes', orders: 'Orders & status transitions', payments: 'Payments, callbacks, webhooks', wishlist: 'Wishlist', 'recently-viewed': 'Recently viewed',
  'saved-searches': 'Saved searches', notifications: 'Notifications', reviews: 'Reviews', reports: 'Reports', support: 'Support tickets', home: 'Homepage content',
  promotions: 'Promotions', seller: 'Seller analytics', admin: 'Administration (role-based)', health: 'Health', dev: 'Development tools', 'openapi.json': 'This document',
};

export function openApi(router) {
  const paths = {};
  for (const r of router.routes) {
    const p = r.re.source.replace(/\\\//g, '/').replace(/^\^/, '').replace(/\/\?\$$/, '');
    let i = 0;
    const openPath = p.replace(/\(\[\^\/\]\+\)/g, () => `{${r.keys[i++]}}`);
    const seg = openPath.split('/')[3] || 'misc';
    const op = {
      tags: [seg],
      summary: `${r.method} ${openPath.replace('/api/v1', '')}`,
      parameters: r.keys.map((k) => ({ name: k, in: 'path', required: true, schema: { type: 'string' } })),
      responses: { 200: { description: 'OK' }, 400: { description: 'Validation error' }, 401: { description: 'Not signed in' }, 403: { description: 'Forbidden' }, 404: { description: 'Not found' }, 429: { description: 'Rate limited' } },
    };
    if (r.opts.auth) op.security = [{ session: [] }];
    if (r.opts.perm) op.description = `Requires permission \`${r.opts.perm}\`.`;
    if (!['GET'].includes(r.method)) op.requestBody = { content: { 'application/json': { schema: { type: 'object' } } } };
    (paths[openPath] ||= {})[r.method.toLowerCase()] = op;
  }
  return {
    openapi: '3.1.0',
    info: { title: `${brand.name} API`, version: '1.0.0', description: `${brand.tagline} — REST API v1. State-changing requests require the header \`X-Pasal-CSRF: 1\`. Money is integer minor units.` },
    servers: [{ url: config.publicUrl }],
    tags: Object.entries(TAGS).map(([name, description]) => ({ name, description })),
    components: { securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: 'pasal_sid' } } },
    paths,
  };
}

export function docsPage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${brand.name} API</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:0;background:#0a0f24;color:#e8eaf6}main{max-width:1000px;margin:0 auto;padding:40px 24px}h1{margin:0 0 4px}p{color:#a5abc9}
section{margin:28px 0}h2{font-size:15px;text-transform:uppercase;letter-spacing:.08em;color:#9e8cff;border-bottom:1px solid #222a4a;padding-bottom:8px}
.r{display:flex;gap:12px;align-items:baseline;padding:6px 0;border-bottom:1px solid #151b36;font-family:ui-monospace,monospace;font-size:13px}.m{width:62px;font-weight:700}
.GET{color:#4ade80}.POST{color:#60a5fa}.PUT,.PATCH{color:#fbbf24}.DELETE{color:#f87171}.t{margin-left:auto;color:#6b7299;font-family:system-ui;font-size:12px}</style></head>
<body><main><h1>${brand.name} API v1</h1><p>Machine-readable spec: <a style="color:#9e8cff" href="/api/v1/openapi.json">/api/v1/openapi.json</a> (OpenAPI 3.1 — import into Swagger UI, Postman or Insomnia). WebSocket: <code>/ws</code> (session cookie).</p><div id="d">Loading…</div></main>
<script nonce="">fetch('/api/v1/openapi.json').then(r=>r.json()).then(s=>{const g={};for(const[p,ops]of Object.entries(s.paths))for(const[m,o]of Object.entries(ops))(g[o.tags[0]]||=[]).push([m.toUpperCase(),p,o]);
const tag=Object.fromEntries(s.tags.map(t=>[t.name,t.description]));document.getElementById('d').innerHTML=Object.entries(g).map(([k,v])=>'<section><h2>'+k+(tag[k]?' — <span style="text-transform:none;color:#a5abc9;letter-spacing:0">'+tag[k]+'</span>':'')+'</h2>'+v.map(([m,p,o])=>'<div class="r"><span class="m '+m+'">'+m+'</span><span>'+p+'</span><span class="t">'+(o.security?'🔒 ':'')+(o.description||'')+'</span></div>').join('')+'</section>').join('')})</script></body></html>`;
}
