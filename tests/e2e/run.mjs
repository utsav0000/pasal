// End-to-end journeys in a real browser against a copy of the seeded database.
//   npm run seed && npm run build && npm run test:e2e
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pasal-e2e-'));
fs.copyFileSync(path.join(ROOT, 'data/pasal.db'), path.join(tmp, 'e2e.db'));
const PORT = 3700 + Math.floor(Math.random() * 200);
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.env.E2E_SHOTS || path.join(tmp, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT), PUBLIC_URL: BASE, DATABASE_PATH: path.join(tmp, 'e2e.db'), UPLOAD_DIR: path.join(tmp, 'uploads'), ENABLE_DEV_TOOLS: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
await new Promise((res, rej) => { server.stdout.on('data', (d) => d.toString().includes('PASAL running') && res()); setTimeout(() => rej(new Error('server did not start')), 15000); });

const browser = await chromium.launch();
const results = [];
const pages = [];
const errors = [];
async function newUser(viewport = { width: 1366, height: 860 }, scheme = 'light') {
  const ctx = await browser.newContext({ viewport, colorScheme: scheme, permissions: [] });
  await ctx.addInitScript(() => { try { localStorage.setItem('pasal.askedLoc', 'true'); } catch { /* cross-origin frames */ } });
  const page = await ctx.newPage();
  pages.push(page);
  page.on('pageerror', (e) => errors.push(`${page.url()} → ${process.env.E2E_STACK ? e.stack : e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${page.url()} → ${m.text()}`); });
  return { ctx, page };
}
async function signIn(page, email, password) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').fill(email);
  await page.locator('#pw').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}
async function step(name, fn) {
  const t = Date.now();
  try { await fn(); results.push(['✔', name, Date.now() - t]); }
  catch (e) {
    results.push(['✖', name, Date.now() - t, e.message.split('\n')[0]]);
    for (const [i, pg] of pages.entries()) await pg.screenshot({ path: path.join(SHOTS, `fail-${results.length}-${i}.png`) }).catch(() => {});
  }
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });

const seller = await newUser();
const buyer = await newUser();
let listingUrl;

await step('Seller signs in and lists an item through the 8-step wizard (with photo upload)', async () => {
  const p = seller.page;
  await signIn(p, 'seller@pasal.example', 'Seller@12345');
  await p.goto(`${BASE}/sell`);
  await p.getByRole('button', { name: /India/ }).first().click();
  await p.getByRole('button', { name: 'Continue' }).click();
  await p.locator('.cat-pick button', { hasText: 'Electronics' }).click();
  await p.locator('.chip', { hasText: 'Headphones' }).click();
  await p.getByRole('button', { name: 'Continue' }).click();
  await p.locator('input[placeholder^="e.g. iPhone"]').fill('Bose QuietComfort 45 headphones, white');
  await p.locator('label:has-text("Brand") + input').fill('Bose');
  await p.locator('textarea').first().fill('Excellent noise cancelling, used for six months. Comes with case, cable and box. No scratches.');
  await p.getByRole('button', { name: 'Continue' }).click();
  const img = path.join(tmp, 'photo.png');
  await sharp({ create: { width: 900, height: 700, channels: 3, background: '#d9d4ff' } }).png().toFile(img);
  await p.locator('input[type=file]').setInputFiles(img);
  await p.locator('.thumb img').first().waitFor({ timeout: 15000 });
  await p.getByRole('button', { name: 'Continue' }).click();
  await p.locator('.input-group input').first().fill('14999');
  await p.getByRole('button', { name: 'Continue' }).click();
  const selects = p.locator('select');
  await selects.nth(0).selectOption({ label: 'Maharashtra' });
  await selects.nth(1).selectOption({ label: 'Mumbai Suburban' });
  await selects.nth(2).selectOption({ label: 'Mumbai' });
  await p.getByRole('button', { name: 'Continue' }).click();
  await p.getByRole('button', { name: /Both available/ }).click();
  await p.locator('input[placeholder^="e.g. Near Forum Mall"]').fill('Powai, near Hiranandani Gardens');
  await p.getByRole('button', { name: 'Continue' }).click();
  await p.getByText('This is exactly how buyers will see your listing.').waitFor();
  await shot(p, 'seller-preview');
  await p.getByRole('button', { name: 'Publish listing' }).click();
  await p.getByText('Your listing is live!').waitFor({ timeout: 10000 });
  await shot(p, 'seller-published');
  await p.getByRole('link', { name: 'View listing' }).click();
  await p.waitForURL(/\/l\//);
  listingUrl = p.url();
  await p.getByRole('heading', { name: /Bose QuietComfort 45/ }).waitFor();
});

await step('Buyer searches with a typo and finds the new listing', async () => {
  const p = buyer.page;
  await signIn(p, 'buyer@pasal.example', 'Buyer@12345');
  await p.goto(BASE);
  await p.getByRole('combobox', { name: 'Search PASAL' }).first().fill('bose quietcomfrt');
  await p.keyboard.press('Enter');
  await p.waitForURL(/\/search/);
  await p.getByText(/Showing results for/).waitFor();
  await p.locator('.pcard', { hasText: 'Bose QuietComfort 45' }).first().waitFor();
  await shot(p, 'buyer-search');
});

await step('Real-time chat: buyer messages, seller sees it live and replies with typing indicator', async () => {
  const b = buyer.page, s = seller.page;
  await b.goto(listingUrl);
  await b.getByRole('button', { name: 'Chat with seller' }).click();
  await b.getByRole('dialog').getByRole('button', { name: 'Send message' }).click();
  await b.waitForURL(/\/messages\/\d+/);
  const convUrl = b.url();
  await s.goto(convUrl);
  await s.locator('.msg', { hasText: 'Is this still available?' }).waitFor();
  await b.locator('.chat-compose textarea').fill('Can I pick it up tonight?');
  await b.keyboard.press('Enter');
  await s.locator('.msg', { hasText: 'Can I pick it up tonight?' }).waitFor({ timeout: 8000 });
  await s.locator('.chat-compose textarea').pressSequentially('Sure', { delay: 60 });
  await b.locator('.typing').waitFor({ timeout: 6000 });
  await s.keyboard.press('Enter');
  await b.locator('.msg', { hasText: 'Sure' }).waitFor({ timeout: 8000 });
  await shot(b, 'chat-buyer');
});

await step('Offer → seller counters in chat → buyer accepts the counter', async () => {
  const b = buyer.page, s = seller.page;
  await b.goto(listingUrl);
  await b.getByRole('button', { name: 'Make an offer' }).first().click();
  const dlg = b.getByRole('dialog');
  await dlg.locator('.input-group input').fill('12500');
  await dlg.getByRole('button', { name: 'Send offer' }).click();
  await b.getByText('Offer sent!').waitFor();
  await s.reload();
  await s.locator('.offer-card', { hasText: '12,500' }).getByRole('button', { name: 'Counter' }).click();
  await s.getByRole('dialog').locator('textarea').fill('13500');
  await s.getByRole('dialog').getByRole('button', { name: 'Send counter' }).click();
  await b.goto(b.url().includes('/messages/') ? b.url() : `${BASE}/offers`);
  await b.goto(`${BASE}/messages`);
  await b.locator('.chat-item').first().click();
  await b.locator('.offer-card', { hasText: '13,500' }).getByRole('button', { name: 'Accept' }).click();
  await b.locator('.offer-card', { hasText: '13,500' }).getByRole('link', { name: 'Buy at this price' }).waitFor();
  await shot(b, 'offer-accepted');
});

let orderUrl;
await step('Buyer checks out at the offer price with self pickup + pay at pickup', async () => {
  const b = buyer.page;
  await b.locator('.offer-card', { hasText: '13,500' }).getByRole('link', { name: 'Buy at this price' }).click();
  await b.waitForURL(/\/checkout\//);
  await b.getByRole('button', { name: /Self pickup/ }).click();
  await b.getByRole('button', { name: /Pay the seller at pickup/ }).click();
  await b.getByText('₹ 13,500').first().waitFor();
  await shot(b, 'checkout');
  await b.getByRole('button', { name: 'Place order' }).click();
  await b.waitForURL(/\/orders\/\d+/);
  orderUrl = b.url().split('?')[0];
  await b.getByText('Pending seller confirmation').first().waitFor();
});

await step('Seller accepts → marks ready → completes handover with the buyer’s code', async () => {
  const s = seller.page, b = buyer.page;
  await s.goto(orderUrl);
  await s.getByRole('button', { name: 'Accept order' }).click();
  await s.getByRole('button', { name: 'Ready for pickup' }).click();
  await s.getByText('Ready for pickup').first().waitFor();
  await b.goto(orderUrl);
  const code = (await b.locator('.code-box .code').innerText()).trim();
  assert.match(code, /^[0-9A-F]{6}$/);
  assert.ok(await b.locator('.code-box .qr svg').count(), 'QR rendered');
  await shot(b, 'pickup-code');
  await s.getByRole('button', { name: 'Complete handover' }).click();
  await s.getByRole('dialog').locator('input.mono').fill('ZZZZZZ');
  await s.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await s.getByText(/Handover code does not match/).waitFor();
  await s.getByRole('dialog').locator('input.mono').fill(code);
  await s.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await s.locator('.status', { hasText: 'Completed' }).first().waitFor();
});

await step('Buyer leaves a verified review', async () => {
  const b = buyer.page;
  await b.goto(orderUrl);
  await b.getByRole('button', { name: 'Write a review' }).click();
  await b.getByRole('radio', { name: '5 stars' }).click();
  await b.getByRole('dialog').locator('textarea').fill('Great seller, smooth pickup.');
  await b.getByRole('button', { name: 'Post review' }).click();
  await b.getByText('You rated this 5★.').waitFor();
});

await step('Online payment journey: delivery order → seller accepts → test gateway → verified', async () => {
  const b = buyer.page, s = seller.page;
  await b.goto(`${BASE}/search?q=iphone%2014%20pro&country=IN`);
  await b.locator('.pcard a', { hasText: 'iPhone 14 Pro' }).first().click();
  await b.getByRole('button', { name: 'Buy now' }).first().click();
  await b.waitForURL(/\/checkout\//);
  await b.getByRole('button', { name: /Home delivery/ }).click();
  await b.getByRole('button', { name: /Pay online through PASAL/ }).click();
  await b.getByRole('button', { name: 'Place order' }).click();
  await b.waitForURL(/\/orders\/\d+/);
  const url = b.url().split('?')[0];
  // Seller (Aarav) accepts
  const priya = await newUser();
  await signIn(priya.page, 'aarav@pasal.example', 'Seller@12345');
  await priya.page.goto(url);
  await priya.page.getByRole('button', { name: 'Accept order' }).click();
  await priya.page.getByText('Awaiting payment').first().waitFor();
  await b.goto(url);
  await b.getByText('Complete your payment').waitFor();
  await b.getByRole('button', { name: /Test payment/ }).click();
  await b.waitForURL(/\/pay\/test\//);
  await shot(b, 'test-gateway');
  await b.getByRole('button', { name: 'Simulate successful payment' }).click();
  await b.waitForURL(/\/orders\/\d+\?payment=success/, { timeout: 10000 });
  await b.getByText('Payment verified by PASAL').waitFor({ timeout: 8000 });
  await b.locator('.status', { hasText: 'Payment confirmed' }).first().waitFor();
  await priya.page.reload();
  await priya.page.getByRole('button', { name: 'Ready for dispatch' }).waitFor();
  await priya.ctx.close();
});

await step('Admin approves a held listing and a seller verification; audit log records it', async () => {
  const a = await newUser();
  await signIn(a.page, 'admin@pasal.example', 'Admin@12345');
  await a.page.goto(`${BASE}/admin`);
  await a.page.getByRole('heading', { name: 'Marketplace overview' }).waitFor();
  await shot(a.page, 'admin-dashboard');
  await a.page.goto(`${BASE}/admin/listings?status=pending_review`);
  await a.page.getByRole('row', { name: /First copy designer handbag/ }).getByRole('button', { name: 'Reject' }).click();
  await a.page.getByRole('dialog').locator('textarea').fill('Counterfeit goods are not allowed.');
  await a.page.getByRole('dialog').getByRole('button', { name: 'Reject' }).click();
  await a.page.getByText('Done').first().waitFor();
  await a.page.goto(`${BASE}/admin/verification`);
  await a.page.locator('.card', { hasText: 'Kabir Singh' }).getByRole('button', { name: 'Approve' }).click();
  await a.page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
  await a.page.getByText('Seller verified').waitFor();
  await a.page.goto(`${BASE}/admin/audit`);
  await a.page.getByText('listing.reject').first().waitFor();
  await a.page.getByText('seller.approve').first().waitFor();
  await a.ctx.close();
});

await step('Theme switch persists and mobile layout shows bottom navigation', async () => {
  const m = await newUser({ width: 390, height: 844 }, 'light');
  await m.page.goto(BASE);
  await m.page.locator('.bnav').waitFor();
  await m.page.getByRole('button', { name: /Theme/ }).click(); // system → light
  await m.page.getByRole('button', { name: /Theme/ }).click(); // light → dark
  assert.equal(await m.page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await m.page.reload();
  assert.equal(await m.page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await shot(m.page, 'mobile-dark-home');
  await m.ctx.close();
});

await browser.close();
server.kill();
console.log('\nPASAL end-to-end journeys');
for (const [s, n, ms, err] of results) console.log(`${s} ${n} (${ms} ms)${err ? `\n    ${err}` : ''}`);
if (errors.length) { console.log('\nBrowser console errors:'); [...new Set(errors)].slice(0, 20).forEach((e) => console.log('  -', e)); }
console.log(`\nScreenshots: ${SHOTS}`);
const failed = results.filter((r) => r[0] === '✖').length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed || errors.length ? 1 : 0);
