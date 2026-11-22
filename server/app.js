import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, ROOT } from './config.js';
import { openDb, q } from './db.js';
import { Router, HttpError, parseCookies, readBody, sendJson, can } from './lib/index.js';
import { attachRealtime } from './lib/realtime.js';
import * as auth from './modules/auth.js';
import * as users from './modules/users.js';
import * as categories from './modules/categories.js';
import * as listings from './modules/listings.js';
import * as messaging from './modules/messaging.js';
import * as orders from './modules/orders.js';
import * as social from './modules/social.js';
import * as admin from './modules/admin.js';
import { renderShell, sitemap, robots } from './modules/seo.js';
import { openApi, docsPage } from './modules/docs.js';
import { startJobs } from './jobs.js';
import { seedBase, seedHomepage } from './seed/base.js';
import { hashPassword } from './lib/security.js';

const MIME = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.txt': 'text/plain', '.map': 'application/json', '.gif': 'image/gif' };
const PUBLIC = path.join(ROOT, 'public');

/** First boot on an empty database: load reference data and (optionally) the first super admin. */
async function bootstrap() {
  if (q.val('SELECT COUNT(*) FROM countries') === 0) {
    seedBase();
    seedHomepage();
    console.log('Initialised reference data (countries, locations, categories, homepage).');
  }
  const email = process.env.ADMIN_EMAIL, pw = process.env.ADMIN_PASSWORD;
  if (email && pw && !q.get('SELECT 1 FROM users WHERE email = ?', email)) {
    q.run("INSERT INTO users (name, email, password_hash, role, email_verified_at) VALUES (?, ?, ?, 'super_admin', datetime('now'))", process.env.ADMIN_NAME || 'PASAL Admin', email.toLowerCase(), await hashPassword(pw));
    console.log(`Created super admin ${email}`);
  }
}

export function createApp({ dbPath } = {}) {
  openDb(dbPath || config.dbPath);
  const ready = bootstrap();
  const router = new Router();
  for (const m of [auth, users, categories, listings, messaging, orders, social, admin]) m.register(router);

  router.get('/api/v1/health', () => ({ ok: true, time: new Date().toISOString(), db: q.val('SELECT 1') === 1 }));
  router.get('/api/v1/openapi.json', () => openApi(router));
  if (config.devTools) {
    router.get('/api/v1/dev/outbox', (ctx) => q.all(`SELECT * FROM outbox ${ctx.query.to ? 'WHERE recipient = ?' : ''} ORDER BY id DESC LIMIT 50`, ...(ctx.query.to ? [ctx.query.to] : [])));
  }

  const server = http.createServer(async (req, res) => {
    await ready;
    const url = new URL(req.url, 'http://x');
    const pathname = decodeURIComponent(url.pathname);
    const nonce = crypto.randomBytes(16).toString('base64');
    securityHeaders(res, nonce);
    try {
      if (pathname.startsWith('/api/')) return await handleApi(router, req, res, url, pathname);
      if (pathname === "/api/docs" || pathname === "/docs/api") return html(res, docsPage().replace("<script nonce=\"\">", `<script nonce="${nonce}">`));
      if (pathname === '/sitemap.xml') return text(res, sitemap(), 'application/xml');
      if (pathname === '/robots.txt') return text(res, robots(), 'text/plain');
      if (serveStatic(req, res, pathname)) return;
      if (/\.[a-z0-9]{2,5}$/i.test(pathname)) { res.writeHead(404); return res.end('Not found'); }
      const page = renderShell(pathname, url.searchParams).replace(/<script(?=[ >])/g, `<script nonce="${nonce}"`);
      return html(res, page);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) sendJson(res, 500, { error: 'Something went wrong.' });
    }
  });
  attachRealtime(server, auth.resolveSession);
  server.on('close', () => clearInterval(jobs));
  const jobs = startJobs();
  server.ready = ready;
  return server;
}

function securityHeaders(res, nonce) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  if (config.cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://checkout.razorpay.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    "connect-src 'self' ws: wss: https://api.razorpay.com https://lumberjack.razorpay.com",
    'frame-src https://api.razorpay.com https://checkout.razorpay.com https://www.openstreetmap.org',
    "form-action 'self' https://rc-epay.esewa.com.np https://epay.esewa.com.np",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ].join('; '));
}

async function handleApi(router, req, res, url, pathname) {
  const match = router.match(req.method, pathname);
  if (!match) return sendJson(res, 404, { error: 'Not found.' });
  const { route, params } = match;
  const cookies = parseCookies(req.headers.cookie);
  const ip = (config.isProd && req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket.remoteAddress || '';
  const setCookies = [];
  let redirect = null;
  try {
    // CSRF: state-changing requests must carry our custom header (impossible cross-site without CORS).
    if (req.method !== 'GET' && route.opts.csrf !== false && req.headers['x-pasal-csrf'] !== '1') throw new HttpError(403, 'Missing CSRF header.');
    const user = auth.resolveSession(cookies.pasal_sid);
    if (user) auth.touchSession(user);
    if (route.opts.auth && !user) throw new HttpError(401, 'Please sign in to continue.');
    if (route.opts.perm && !can(user, route.opts.perm)) throw new HttpError(403, 'You do not have permission to do that.');
    let body = {};
    let rawBody = null;
    if (!['GET', 'HEAD'].includes(req.method)) {
      rawBody = await readBody(req, route.opts.bodyLimit || 1_000_000);
      if (!route.opts.raw && rawBody.length) {
        if (!String(req.headers['content-type'] || '').includes('application/json')) throw new HttpError(415, 'Send JSON.');
        try { body = JSON.parse(rawBody.toString('utf8')); } catch { throw new HttpError(400, 'Malformed JSON.'); }
      }
    }
    const ctx = {
      req, res, params, body, rawBody, user, ip, cookies,
      query: Object.fromEntries(url.searchParams),
      setCookie: (c) => setCookies.push(c),
      redirect: (to) => { redirect = to; return { redirect: to }; },
    };
    const data = await route.handler(ctx);
    if (setCookies.length) res.setHeader('Set-Cookie', setCookies);
    if (redirect) { res.writeHead(302, { Location: redirect }); return res.end(); }
    return sendJson(res, 200, data ?? null);
  } catch (e) {
    if (setCookies.length) res.setHeader('Set-Cookie', setCookies);
    if (e instanceof HttpError) {
      const h = e.retryAfter ? { 'Retry-After': String(e.retryAfter) } : {};
      return sendJson(res, e.status, { error: e.message, fields: e.details }, h);
    }
    console.error(`[api] ${req.method} ${pathname}`, e);
    return sendJson(res, 500, { error: 'Something went wrong on our side. Please try again.' });
  }
}

function serveStatic(req, res, pathname) {
  if (pathname === '/favicon.ico') pathname = '/brand/favicon-32.png';
  const allowed = ['/build/', '/brand/', '/fonts/', '/uploads/', '/seed/', '/manifest.webmanifest', '/sw.js'];
  if (!allowed.some((p) => pathname.startsWith(p) || pathname === p)) return false;
  // Uploads may live outside /public (e.g. a mounted volume) — map them to UPLOAD_DIR.
  const rootDir = pathname.startsWith('/uploads/') ? config.uploadDir : PUBLIC;
  const file = path.normalize(path.join(rootDir, pathname.startsWith('/uploads/') ? pathname.slice('/uploads'.length) : pathname));
  if (!file.startsWith(rootDir)) return false;
  let st;
  try { st = fs.statSync(file); } catch { return false; }
  if (!st.isFile()) return false;
  const etag = `"${st.size.toString(36)}-${st.mtimeMs.toString(36)}"`;
  const immutable = pathname.startsWith('/build/') && /-[A-Z0-9]{8}\./.test(pathname) || pathname.startsWith('/uploads/') || pathname.startsWith('/seed/') || pathname.startsWith('/fonts/');
  const headers = {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
    ETag: etag,
  };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return true; }
  const gz = file + '.gz';
  if (/\bgzip\b/.test(req.headers['accept-encoding'] || '') && fs.existsSync(gz)) {
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
    fs.createReadStream(gz).pipe(res);
    return true;
  }
  res.writeHead(200, { ...headers, 'Content-Length': st.size });
  fs.createReadStream(file).pipe(res);
  return true;
}

const html = (res, body) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }); res.end(body); };
const text = (res, body, type) => { res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'public, max-age=600' }); res.end(body); };
