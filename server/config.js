import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader (no dependency). Real environment variables win.
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const env = (k, d = '') => process.env[k] ?? d;
const bool = (k, d = false) => (process.env[k] === undefined ? d : /^(1|true|yes)$/i.test(process.env[k]));

export const config = {
  env: env('NODE_ENV', 'development'),
  isProd: env('NODE_ENV') === 'production',
  port: Number(env('PORT', '3000')),
  publicUrl: env('PUBLIC_URL', `http://localhost:${env('PORT', '3000')}`).replace(/\/$/, ''),
  dbPath: env('DATABASE_PATH', path.join(ROOT, 'data', 'pasal.db')),
  uploadDir: env('UPLOAD_DIR', path.join(ROOT, 'public', 'uploads')),
  sessionDays: Number(env('SESSION_DAYS', '30')),
  cookieSecure: bool('COOKIE_SECURE', env('NODE_ENV') === 'production'),
  devTools: bool('ENABLE_DEV_TOOLS', env('NODE_ENV') !== 'production'), // dev mailbox + sandbox payments
  platformFeeBps: Number(env('PLATFORM_FEE_BPS', '0')),                    // 100 = 1%
  email: {
    provider: env('EMAIL_PROVIDER', 'outbox'),          // outbox | resend
    from: env('EMAIL_FROM', 'PASAL <no-reply@pasal.example>'),
    resendKey: env('RESEND_API_KEY'),
  },
  sms: {
    provider: env('SMS_PROVIDER', 'outbox'),            // outbox | twilio
    twilioSid: env('TWILIO_ACCOUNT_SID'),
    twilioToken: env('TWILIO_AUTH_TOKEN'),
    twilioFrom: env('TWILIO_FROM'),
  },
  google: {
    clientId: env('GOOGLE_CLIENT_ID'),
    clientSecret: env('GOOGLE_CLIENT_SECRET'),
  },
  razorpay: {
    keyId: env('RAZORPAY_KEY_ID'),
    keySecret: env('RAZORPAY_KEY_SECRET'),
    webhookSecret: env('RAZORPAY_WEBHOOK_SECRET'),
  },
  esewa: {
    productCode: env('ESEWA_PRODUCT_CODE'),
    secretKey: env('ESEWA_SECRET_KEY'),
    formUrl: env('ESEWA_FORM_URL', 'https://rc-epay.esewa.com.np/api/epay/main/v2/form'),
    statusUrl: env('ESEWA_STATUS_URL', 'https://rc.esewa.com.np/api/epay/transaction/status/'),
  },
  sandboxPaymentSecret: env('SANDBOX_PAYMENT_SECRET', 'pasal-sandbox-secret-change-me'),
};

export const brand = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'brand.json'), 'utf8'));
