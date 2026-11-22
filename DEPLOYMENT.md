# Deploying PASAL

PASAL is a single Node.js process that serves the API, the WebSocket gateway (`/ws`) and the built frontend. Data lives in one SQLite file plus an uploads folder, so a deployment needs one small server and a persistent disk.

## 1. Prerequisites

- Node.js **22.5+** (or Docker)
- A domain with HTTPS (terminate TLS at a reverse proxy)
- Credentials for the providers you want live (see `.env.example`): Razorpay, eSewa, Resend, Twilio, Google OAuth

## 2. Configure

```bash
cp .env.example .env
```

Set at least:

```ini
NODE_ENV=production
PUBLIC_URL=https://your-domain.example
COOKIE_SECURE=true
ENABLE_DEV_TOOLS=false
ADMIN_EMAIL=you@your-domain.example
ADMIN_PASSWORD=<a long password>
SANDBOX_PAYMENT_SECRET=<random string>
```

On first start with an empty database PASAL creates the reference data (countries, all Indian states/UTs and Nepali provinces with districts and major cities, categories and fields, homepage layout) and the super admin from `ADMIN_EMAIL`/`ADMIN_PASSWORD`. **Don't run `npm run seed` in production** — it wipes the database and loads demo content.

## 3a. Run with Docker

```bash
docker compose up -d --build
docker compose logs -f
```

Data (`/data/pasal.db`, `/data/uploads`) is kept in the `pasal-data` volume. The image has a health check on `/api/v1/health`.

> The Dockerfile hasn't been built in the environment this was written in. If `npm ci` complains about a missing lockfile, it falls back to `npm install`; commit the generated `package-lock.json` afterwards.

## 3b. Run on a server (systemd)

```bash
npm ci && npm run build
sudo useradd --system --home /opt/pasal pasal
```

`/etc/systemd/system/pasal.service`:

```ini
[Unit]
Description=PASAL marketplace
After=network.target

[Service]
User=pasal
WorkingDirectory=/opt/pasal
EnvironmentFile=/opt/pasal/.env
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning server/index.js
Restart=always

[Install]
WantedBy=multi-user.target
```

## 4. Reverse proxy (nginx)

WebSockets need the upgrade headers, and the app trusts `X-Forwarded-For` for rate limiting when `NODE_ENV=production`.

```nginx
server {
  server_name your-domain.example;
  client_max_body_size 14m;              # photo uploads

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 75s;
  }
}
```

Static assets under `/build` are fingerprinted and served with `Cache-Control: immutable`, so a CDN in front is safe.

## 5. Payments

**Razorpay (India)**
1. Dashboard → Settings → API keys → set `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` (`rzp_live_…` switches the adapter to live mode).
2. Webhooks → URL `https://your-domain.example/api/v1/payments/webhook/razorpay`, events `payment.captured`, `payment.failed`, `order.paid`, secret → `RAZORPAY_WEBHOOK_SECRET`.
3. Orders are marked paid only after the checkout signature (`order_id|payment_id`, HMAC-SHA256) or a signed webhook is verified on the server. Webhook events are de-duplicated by event ID.

**eSewa (Nepal)**
1. Set `ESEWA_PRODUCT_CODE` and `ESEWA_SECRET_KEY`.
2. For production, change `ESEWA_FORM_URL` and `ESEWA_STATUS_URL` to eSewa's live endpoints.
3. PASAL verifies the signed response *and* confirms with eSewa's status API before marking an order paid. Refunds are recorded as manual (eSewa has no refund API).

Then in **Admin → Platform settings**: turn **off** "Test mode" so the built-in test gateway is no longer offered, and check each provider shows "credentials set".

## 6. Email, SMS and Google sign-in

- **Email**: `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` on a verified domain.
- **SMS OTP**: `SMS_PROVIDER=twilio` with an SMS-capable sender for +91 and +977. (India requires DLT registration for SMS templates — set that up with your provider.)
- **Google**: create an OAuth client, authorised redirect URI `https://your-domain.example/api/v1/auth/google/callback`.

Every outgoing email/SMS is also logged in the `outbox` table with its delivery status.

## 7. Backups

SQLite runs in WAL mode. Back up online with:

```bash
node -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync('/data/pasal.db').exec(\"VACUUM INTO '/backups/pasal-$(date +%F).db'\")"
```

and copy `/data/uploads` alongside it (e.g. nightly to object storage). Restore by stopping the service and replacing both.

## 8. Operating

- Health: `GET /api/v1/health`
- Scheduled jobs run every 10 minutes in-process: expire listings and offers, cancel orders unpaid for 48 h, send saved-search alerts, clean up sessions.
- Admin actions are recorded in **Admin → Audit logs**.

## 9. Scaling beyond one instance

Until you need more than one process, keep a single instance. To scale out:
1. Move rate limits and WebSocket fan-out to Redis (`server/lib/http.js` `rateLimit`, `server/lib/realtime.js` `emitTo`).
2. Run `server/jobs.js` in one worker only.
3. Move images to object storage (`server/providers/storage.js`).
4. Migrate to PostgreSQL: `server/migrations/001_init.sql` is standard SQL apart from the FTS5 search table (use a `tsvector` column with `pg_trgm` for typo tolerance) and `datetime('now')` defaults (use `now()`); the data layer is isolated in `server/db.js`.
