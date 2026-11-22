# PASAL — Everything Finds a Buyer.

PASAL is a peer-to-peer marketplace for **India and Nepal**. People can list almost anything that's legal, chat and negotiate in real time, and finish the deal with home delivery or a secure QR-code pickup. Payments can go online through PASAL (verified on the server) or happen in cash, and every order follows enforced status rules from placement to completion.

This repository is a complete, runnable application: frontend, API, database, real-time messaging, payments, admin console, seed data and automated tests.

---

## Quick start

Requires **Node.js 22.5+** (uses the built-in `node:sqlite`). No database server needed.

```bash
npm install
npm run setup        # builds the frontend and seeds a demo marketplace (~1 min, generates product images)
npm start            # → http://localhost:3000
```

For development with auto-rebuild and server restart: `npm run dev` (dev tools are on unless `NODE_ENV=production`).

### Demo accounts (seeded)

| Role | Email | Password |
|---|---|---|
| Buyer (India) | `buyer@pasal.example` | `Buyer@12345` |
| Buyer (Nepal) | `buyer.np@pasal.example` | `Buyer@12345` |
| Seller (verified) | `seller@pasal.example` | `Seller@12345` |
| Any other seller | `aarav@`, `priya@`, `sujan@`, `anisha@` … `@pasal.example` | `Seller@12345` |
| Super admin | `admin@pasal.example` | `Admin@12345` |
| Admin / Moderator / Support | `ops@` / `moderator@` / `support@pasal.example` | `Staff@12345` |

In development, emails and SMS (verification links, password resets, phone OTPs) are not sent — open **`/dev/mailbox`** to read them. Online payments use a built-in **test gateway** that signs its responses exactly like a real one; no money moves.

---

## What's in it

**Brand** — Original PASAL mark (a "P" whose counter is a price-tag eyelet, finished with a mint full stop), wordmark, stacked logo, light/dark variants, favicon, PWA icons, animated loader and social images (`public/brand`). All generated from code by `npm run brand`; colours live in `config/brand.json` and flow into the site automatically.

**Design system** — Light, dark and system themes (remembered per device), DM Sans typography with a Devanagari fallback for रू, design tokens, responsive layouts with a dedicated mobile bottom navigation, skeletons, toasts, modals that become bottom sheets on phones, View-Transition page changes, scroll reveals, micro-interactions and confetti/success states. All motion respects `prefers-reduced-motion`.

**Marketplace**
- India (+91, ₹ INR, states → districts → cities → localities, PIN codes) and Nepal (+977, रू NPR, provinces → districts → municipalities, postal codes). All 36 Indian states/UTs and 7 Nepali provinces.
- 13 main categories / 90 subcategories with category-specific fields (e.g. fuel, km driven, BHK, storage), managed from the admin console.
- 8-step listing wizard: country, category, details, photos (drag-and-drop, reorder, cover, client-side compression, upload progress; server strips EXIF/GPS), pricing, location (map pin), delivery/pickup, live preview, publish with success animation. Drafts, edit, pause, renew, mark sold, delete.
- Search with autocomplete, recent and trending searches, typo correction ("royl enfeild" → "royal enfield"), filters (country, category, price in either currency, condition, distance, delivery, pickup, verified seller, negotiable, category attributes) and sorting. Saved searches with new-match alerts.
- Listing pages with zoomable gallery, specs, delivery/pickup info, seller trust card, reviews, similar items, share and report. Server-rendered meta, Open Graph, canonical URLs and schema.org `Product` JSON-LD; `sitemap.xml` and `robots.txt`.

**Buying & selling**
- Real-time chat per listing (WebSocket): photos, typing indicators, read receipts, online presence, unread counts, search, blocking and reporting.
- Offers with accept / decline / counter-offer, 48-hour expiry and checkout at the agreed price.
- Checkout with delivery or pickup, saved addresses, delivery-area checks, price breakdown, idempotent order creation.
- Order state machine enforced on the server (13 statuses), complete history, tracking details, 6-character pickup code + QR that the seller scans or types to complete the handover.
- Payments: provider-independent adapters for **Razorpay** (India) and **eSewa** (Nepal) plus the test gateway. Signatures verified server-side; webhooks signature-checked and de-duplicated; failed payments, duplicate prevention, refunds. Cash on pickup/delivery and direct arrangements are always labelled as *not verified by PASAL*.
- Buyer dashboard, seller dashboard with real analytics (views, inquiries, orders, conversion, top listings), reviews with verified-purchase badges and seller replies, notifications (in-app real time + email, with per-type preferences).

**Admin console** (`/admin`) — dashboard, analytics, users (search, inspect, suspend, roles), seller verification, listing moderation (keyword hold, approve/reject/remove, feature), category & field management, orders, payments & refunds, disputes, reports (auto-hide after 3 reports), promotions & homepage layout, support tickets, platform settings (fees, test mode, providers, countries, exchange rate) and audit logs. Four staff roles — Super admin, Admin, Moderator, Customer support — with a permission matrix enforced on every endpoint.

**Security** — scrypt password hashing, HttpOnly SameSite session cookies (hashed in the DB), CSRF header check, nonce-based Content-Security-Policy, rate limits on auth/OTP/uploads/messages, OTP attempt caps, Zod validation on every input, parameterised SQL everywhere, HTML stripped from user text, image type sniffing and re-encoding, role checks with "can't manage equal or higher roles", audit logging, no account enumeration on password reset, only the last 4 characters of ID documents stored.

---

## Architecture

```
server/
  index.js, app.js        HTTP server, security headers, static files, SSR meta shell, first-boot bootstrap
  db.js                   node:sqlite, migrations runner, transactions
  migrations/             SQL schema (42 tables, FKs, unique constraints, indexes, FTS5 search)
  lib/                    router & validation, money (integer minor units, BigInt FX), security & RBAC,
                          order state machine, realtime gateway, notifications/audit/settings
  modules/                auth, users, categories, listings (+search, media), messaging (+offers),
                          orders (+payments), social (wishlist, reviews, reports, support, home, dashboards),
                          admin, seo, docs (OpenAPI)
  providers/              payments (razorpay, esewa, sandbox), messaging (email/SMS), storage (images)
  seed/                   locations, categories, demo listings; base.js = reference data
web/src/
  main.jsx                routes, lazy-loaded areas, error boundary
  lib/                    API client, router (View Transitions), app store + WebSocket, formatting, QR encoder
  components/             design-system UI, header/search/location picker, product cards, charts, icons
  pages/                  Home, Browse, Listing, Auth, Static, Sell, Account, Seller, Messages, Orders, Admin
  styles/app.css          tokens, themes, components, motion
config/brand.json         central branding
tests/api/*.test.js       45 API/unit tests (node:test against a real server + fresh DB)
tests/e2e/run.mjs         10 browser journeys (Playwright)
```

API documentation: **`/api/docs`** (human-readable) and **`/api/v1/openapi.json`** (OpenAPI 3.1 — import into Swagger UI or Postman). All endpoints are versioned under `/api/v1`. Money is always integer minor units (paise/paisa).

### How this maps to the original brief

This build was made in an environment where npm packages couldn't be installed, so it uses only what was available. The architecture keeps the same boundaries so it can be ported module by module:

| Brief | This build | Notes |
|---|---|---|
| Next.js + React + TS | React 19 SPA bundled with esbuild; server-rendered meta per route | Plain JavaScript (ESM). Code-split per area. |
| NestJS | Modular Node HTTP server: one module per domain, thin route handlers, logic in services/libs | Same module list as the brief. |
| PostgreSQL + Prisma | SQLite (`node:sqlite`) with SQL migrations, FKs, indexes, transactions, FTS5 | Schema is standard SQL and portable to PostgreSQL. |
| Socket.IO | `ws` WebSocket gateway with auth, presence, typing, read receipts | |
| Framer Motion | CSS animations, Web Animations, View Transitions API, IntersectionObserver | Reduced-motion supported. |
| Redis | In-memory rate limiter and caches behind small interfaces | Needed only when running more than one instance. |
| Jest + Supertest + Playwright | `node:test` + `fetch` against a live server; Playwright journeys | |
| Swagger | Generated OpenAPI 3.1 + docs page | |

---

## Scripts

| | |
|---|---|
| `npm start` | Run the server (`PORT`, default 3000) |
| `npm run dev` | Watch-build the frontend and auto-restart the server |
| `npm run build` | Production frontend build (hashed, gzipped, manifest) |
| `npm run seed` | **Wipes** `data/pasal.db` and loads the demo marketplace |
| `npm run brand` | Regenerate logos and social images from `config/brand.json` (needs Python `fontTools`) |
| `npm test` | API + unit tests |
| `npm run test:e2e` | Browser journeys (run `npm run seed && npm run build` first) |

## Testing

`npm test` runs 45 tests covering auth (email, verification, reset, phone OTP for +91/+977, sessions, rate limits, CSRF, security headers), listings (upload validation, publish rules, moderation holds, sanitisation, management), search (full text, typo correction, cross-currency price ranges, distance, attributes), chat, offers (validation, counter, expiry), orders (pickup with QR code, online-paid delivery, forged signature rejection, webhook de-duplication, delivery-area rules, stock restoration, idempotency), disputes and refunds, notifications, admin permissions per role, moderation, categories, settings and audit logs.

`npm run test:e2e` drives a real browser through: listing an item with a photo upload, typo search, live chat with typing indicator, offer → counter → accept, checkout at the offer price, pickup handover with the buyer's code, a verified review, an online-paid delivery through the test gateway, admin moderation and seller verification, and theme persistence on mobile.

## Configuration

Everything is driven by environment variables — see **`.env.example`**. Without credentials, PASAL still runs: emails/SMS go to the dev mailbox, Google sign-in is hidden, and only the test gateway is offered for online payments. Providers without credentials are never shown to buyers.

## Status and known limitations

Verified here: all API tests and browser journeys above, in Chromium, on desktop and mobile viewports.

Not yet verified, and needed before calling this production-ready:
- **Live integrations** — Razorpay order creation/refunds, eSewa status checks, Google OAuth, Resend email and Twilio SMS are implemented but were not exercised against the real services (no credentials or outbound network here). eSewa has no refund API, so eSewa refunds are recorded as manual.
- **Docker image** — the Dockerfile and compose file were written but not built here (no Docker daemon available).
- **Push notifications** — in-app real-time and email notifications work; per-type push preferences are stored, but Web Push delivery (VAPID + service worker) is not implemented yet.
- **Scale-out** — rate limits, the WebSocket hub and scheduled jobs are in-process, so run a single instance (or add Redis) until you need more.
- **Exchange rate** — set manually by admins (seeded with the official 1 INR = 1.60 NPR peg); there's no live FX feed. Converted prices are always labelled as estimates.
- **Storage** — images are stored on local disk; an S3/R2 adapter would implement the same two functions in `server/providers/storage.js`.
- **Maps** — the listing wizard embeds an OpenStreetMap preview; there's no address geocoding.
- **Legal pages** — Terms, Privacy and Prohibited items are starting templates and need review by counsel in India and Nepal.
- Seed product photos are generated illustrations; real uploads work normally.

See **DEPLOYMENT.md** for running it in production.
