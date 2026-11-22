// Decimal-safe money helpers. Amounts are integer minor units (1 INR = 100 paise, 1 NPR = 100 paisa).
import { q } from '../db.js';

export const CURRENCIES = {
  INR: { symbol: '₹', locale: 'en-IN' },
  NPR: { symbol: 'रू', locale: 'en-IN' },
};

/** Parse a user-entered major-unit amount ("1,25,000.50") to integer minor units without floats. */
export function toMinor(input) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) throw new Error('Invalid amount');
    input = input.toFixed(2);
  }
  const s = String(input).replace(/[,\s]/g, '');
  const m = s.match(/^(\d{1,12})(?:\.(\d{1,2}))?$/);
  if (!m) throw new Error('Invalid amount');
  return Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0'));
}

export const toMajorString = (minor) => `${Math.trunc(minor / 100)}.${String(Math.abs(minor % 100)).padStart(2, '0')}`;

/** Multiply minor amount by basis points with half-up rounding using BigInt. */
export function applyBps(minor, bps) {
  const v = BigInt(minor) * BigInt(bps);
  return Number((v + 5000n) / 10000n);
}

/** Convert using an integer micro-rate (rate * 1e6); result rounded half-up. */
export function convertMinor(minor, rateMicros) {
  const v = BigInt(minor) * BigInt(rateMicros);
  return Number((v + 500000n) / 1000000n);
}

export function getRate(from, to) {
  if (from === to) return 1_000_000;
  const r = q.get('SELECT rate_micros FROM fx_rates WHERE base = ? AND quote = ?', from, to);
  if (r) return r.rate_micros;
  const inv = q.get('SELECT rate_micros FROM fx_rates WHERE base = ? AND quote = ?', to, from);
  if (inv) return Math.round(1e12 / inv.rate_micros);
  return null;
}

export function formatMoney(minor, currency) {
  const c = CURRENCIES[currency] || { symbol: currency, locale: 'en-IN' };
  const major = minor / 100;
  const digits = minor % 100 === 0 ? 0 : 2;
  return `${c.symbol} ${major.toLocaleString(c.locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
