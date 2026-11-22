// Generates every PASAL brand asset from code: logos (light/dark/stacked/icon), favicon, loader,
// PWA icons and social images. Edit config/brand.json colours and re-run `npm run brand`.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'brand');
fs.mkdirSync(OUT, { recursive: true });
const brand = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'brand.json'), 'utf8'));
const { word, tagline } = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'wordmark.json'), 'utf8'));
const C = brand.colors;
const MINT = '#2EE6A6';

// ---- The mark: a "P" whose counter is a price-tag eyelet, finished with a full stop ----
const glyph = 'M36 21H54A21 21 0 0 1 54 63H44V72A7.5 7.5 0 0 1 29 72V28.5A7.5 7.5 0 0 1 36.5 21Z M46 42a8 8 0 1 0 16 0a8 8 0 1 0 -16 0Z';
const defs = (id) => `<defs>
  <linearGradient id="${id}g" x1="8" y1="4" x2="96" y2="100" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#8A6BFF"/><stop offset=".48" stop-color="${C.accent}"/><stop offset="1" stop-color="${C.accent2}"/></linearGradient>
  <radialGradient id="${id}h" cx="22" cy="12" r="70" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".38"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/></radialGradient>
</defs>`;
const mark = (id = 'm') => `${defs(id)}<rect width="100" height="100" rx="27" fill="url(#${id}g)"/><rect width="100" height="100" rx="27" fill="url(#${id}h)"/>
<path d="${glyph}" fill="#fff" fill-rule="evenodd"/><circle cx="71.5" cy="73" r="7" fill="${MINT}"/>`;

const svg = (w, h, body, extra = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" ${extra}>${body}</svg>`;

// Wordmark scaled so the cap height is `cap` units
const wordAt = (x, baseline, cap, fill) => {
  const s = cap / word.cap;
  return { body: `<path transform="translate(${x} ${baseline}) scale(${s})" d="${word.d}" fill="${fill}"/>`, width: word.width * s };
};
const tagAt = (x, baseline, cap, fill) => {
  const s = cap / tagline.cap;
  return { body: `<path transform="translate(${x} ${baseline}) scale(${s})" d="${tagline.d}" fill="${fill}"/>`, width: tagline.width * s };
};

function horizontal(ink) {
  const w = wordAt(124, 73, 46, ink);
  return svg(Math.ceil(124 + w.width + 2), 100, `<g>${mark('h')}</g>${w.body}`, 'role="img" aria-label="PASAL"');
}
function stacked(ink, sub) {
  const W = 360;
  const wd = wordAt(0, 0, 52, ink);
  const tg = tagAt(0, 0, 17, sub);
  const wx = (W - wd.width) / 2, tx = (W - tg.width) / 2;
  return svg(W, 250, `<g transform="translate(${W / 2 - 50} 0)">${mark('s')}</g>${wordAt(wx, 186, 52, ink).body}${tagAt(tx, 232, 17, sub).body}`, 'role="img" aria-label="PASAL — Everything Finds a Buyer."');
}

const files = {
  'pasal-icon.svg': svg(100, 100, mark('i'), 'role="img" aria-label="PASAL"'),
  'favicon.svg': svg(100, 100, mark('f')),
  'pasal-logo-light.svg': horizontal(C.midnight),
  'pasal-logo-dark.svg': horizontal('#FFFFFF'),
  'pasal-logo-stacked.svg': stacked(C.midnight, '#5B6180'),
  'pasal-logo-stacked-dark.svg': stacked('#FFFFFF', '#A9AFCC'),
  'pasal-wordmark-light.svg': svg(Math.ceil(wordAt(0, 0, 70, '').width) + 2, 72, wordAt(0, 70, 70, C.midnight).body),
  'pasal-wordmark-dark.svg': svg(Math.ceil(wordAt(0, 0, 70, '').width) + 2, 72, wordAt(0, 70, 70, '#fff').body),
  // Loading logo: the mark breathes and the full stop pulses (respects reduced motion via CSS in-app)
  'pasal-loader.svg': svg(100, 100, `${defs('l')}
    <style>@keyframes b{0%,100%{transform:scale(1)}50%{transform:scale(.94)}}@keyframes d{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.55;transform:scale(.6)}}
    .b{animation:b 1.4s cubic-bezier(.6,0,.4,1) infinite;transform-origin:50px 50px}.d{animation:d 1.4s cubic-bezier(.6,0,.4,1) infinite;transform-origin:71.5px 73px}
    @media (prefers-reduced-motion:reduce){.b,.d{animation:none}}</style>
    <g class="b"><rect width="100" height="100" rx="27" fill="url(#lg)"/><rect width="100" height="100" rx="27" fill="url(#lh)"/><path d="${glyph}" fill="#fff" fill-rule="evenodd"/></g>
    <circle class="d" cx="71.5" cy="73" r="7" fill="${MINT}"/>`),
};
for (const [f, s] of Object.entries(files)) fs.writeFileSync(path.join(OUT, f), s);

// ---- Raster assets ----
const iconSvg = Buffer.from(files['pasal-icon.svg']);
const png = (input, size, name) => sharp(input, { density: 600 }).resize(size, size).png().toFile(path.join(OUT, name));
await png(iconSvg, 32, 'favicon-32.png');
await png(iconSvg, 180, 'apple-touch-icon.png');
await png(iconSvg, 192, 'icon-192.png');
await png(iconSvg, 512, 'icon-512.png');
// Maskable icon (safe zone padding on midnight)
await sharp(Buffer.from(svg(512, 512, `<rect width="512" height="512" fill="${C.midnight}"/><g transform="translate(106 106) scale(3)">${mark('k')}</g>`)), { density: 300 }).png().toFile(path.join(OUT, 'icon-maskable-512.png'));

// Social: Open Graph 1200x630, square avatar, X/LinkedIn banner
const chips = ['Smartphones', 'Motorcycles', 'Furniture', 'Rooms &amp; PG', 'Laptops', 'Cameras', 'Bicycles', 'Fashion'];
const chip = (x, y, t, o = 1) => `<g transform="translate(${x} ${y})" opacity="${o}"><rect width="${t.length * 13 + 48}" height="46" rx="23" fill="#fff" fill-opacity=".07" stroke="#fff" stroke-opacity=".14"/><circle cx="23" cy="23" r="5" fill="${MINT}"/><text x="38" y="30" font-family="DM Sans" font-size="20" font-weight="500" fill="#E6E8F5">${t}</text></g>`;
const glow = `<defs><radialGradient id="ga" cx="78%" cy="20%" r="65%"><stop offset="0" stop-color="${C.accent}" stop-opacity=".75"/><stop offset="1" stop-color="${C.accent}" stop-opacity="0"/></radialGradient>
  <radialGradient id="gb" cx="95%" cy="100%" r="60%"><stop offset="0" stop-color="${C.accent2}" stop-opacity=".6"/><stop offset="1" stop-color="${C.accent2}" stop-opacity="0"/></radialGradient></defs>`;
const og = svg(1200, 630, `${glow}<rect width="1200" height="630" fill="#070A18"/><rect width="1200" height="630" fill="url(#ga)"/><rect width="1200" height="630" fill="url(#gb)"/>
  <g transform="translate(80 92) scale(1.12)">${mark('o')}</g>
  ${wordAt(80, 330, 88, '#fff').body}
  ${tagAt(84, 400, 34, '#C9CDE6').body}
  <text x="84" y="470" font-family="DM Sans" font-size="24" fill="#8F96BC">The marketplace for India and Nepal · ₹ INR · NPR</text>
  ${chip(700, 150, chips[0])}${chip(880, 214, chips[1], .9)}${chip(740, 278, chips[2])}${chip(930, 342, chips[3], .85)}${chip(690, 406, chips[4], .9)}${chip(860, 470, chips[5], .75)}`);
await sharp(Buffer.from(og)).png().toFile(path.join(OUT, 'og-image.png'));
await sharp(Buffer.from(svg(1080, 1080, `${glow}<rect width="1080" height="1080" fill="#070A18"/><rect width="1080" height="1080" fill="url(#ga)"/><g transform="translate(290 290) scale(5)">${mark('a')}</g>`))).png().toFile(path.join(OUT, 'social-avatar.png'));
await sharp(Buffer.from(svg(1500, 500, `${glow}<rect width="1500" height="500" fill="#070A18"/><rect width="1500" height="500" fill="url(#ga)"/><rect width="1500" height="500" fill="url(#gb)"/>
  <g transform="translate(120 150) scale(2)">${mark('x')}</g>${wordAt(380, 270, 96, '#fff').body}${tagAt(384, 340, 34, '#C9CDE6').body}`))).png().toFile(path.join(OUT, 'social-banner.png'));

// PWA manifest
fs.writeFileSync(path.join(ROOT, 'public', 'manifest.webmanifest'), JSON.stringify({
  name: brand.title, short_name: brand.name, start_url: '/', display: 'standalone', background_color: '#070A18', theme_color: C.accent,
  icons: [
    { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/brand/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}, null, 2));
console.log('Brand assets written to public/brand');
