import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, n, salt, key] = stored.split('$');
  const derived = await scrypt(pw, Buffer.from(salt, 'base64'), 64, { ...SCRYPT, N: Number(n) });
  const expected = Buffer.from(key, 'base64');
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const hmacHex = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');
export const hmacB64 = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('base64');

export function safeEqual(a, b) {
  const A = Buffer.from(String(a ?? ''));
  const B = Buffer.from(String(b ?? ''));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

export const otp = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

/** Strip tags & control chars from user text (output is also escaped by React; this is defence in depth). */
export function cleanText(s, max = 5000) {
  if (s == null) return s;
  return String(s)
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}

// ---- Phone numbers ----
export function normalizePhone(raw, country) {
  const digits = String(raw || '').replace(/[^\d+]/g, '');
  let d = digits.replace(/^\+/, '');
  if (country === 'IN') {
    if (d.startsWith('91') && d.length === 12) d = d.slice(2);
    if (d.startsWith('0') && d.length === 11) d = d.slice(1);
    return /^[6-9]\d{9}$/.test(d) ? `+91${d}` : null;
  }
  if (country === 'NP') {
    if (d.startsWith('977') && d.length === 13) d = d.slice(3);
    return /^9[678]\d{8}$/.test(d) ? `+977${d}` : null;
  }
  return null;
}

// ---- Roles & permissions ----
export const ROLE_RANK = { user: 0, support: 1, moderator: 2, admin: 3, super_admin: 4 };
export const PERMISSIONS = {
  'admin.access': ['support', 'moderator', 'admin', 'super_admin'],
  'users.view': ['support', 'moderator', 'admin', 'super_admin'],
  'users.manage': ['admin', 'super_admin'],
  'users.roles': ['super_admin'],
  'sellers.verify': ['moderator', 'admin', 'super_admin'],
  'listings.moderate': ['moderator', 'admin', 'super_admin'],
  'listings.feature': ['admin', 'super_admin'],
  'categories.manage': ['admin', 'super_admin'],
  'orders.view': ['support', 'admin', 'super_admin'],
  'payments.view': ['admin', 'super_admin'],
  'refunds.manage': ['admin', 'super_admin'],
  'disputes.manage': ['support', 'admin', 'super_admin'],
  'reports.manage': ['moderator', 'admin', 'super_admin'],
  'promotions.manage': ['admin', 'super_admin'],
  'analytics.view': ['admin', 'super_admin'],
  'tickets.manage': ['support', 'admin', 'super_admin'],
  'settings.manage': ['super_admin', 'admin'],
  'audit.view': ['admin', 'super_admin'],
};
export const can = (user, perm) => !!user && (PERMISSIONS[perm] || []).includes(user.role);
export const permissionsFor = (role) => Object.keys(PERMISSIONS).filter((p) => PERMISSIONS[p].includes(role));
