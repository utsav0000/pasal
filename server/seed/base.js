// Reference data every environment needs: currencies, countries, FX, locations, categories.
import { q } from '../db.js';
import { slugify } from '../lib/services.js';
import { INDIA, NEPAL } from './locations.js';
import { CATEGORIES, NO_DELIVERY, REVIEW } from './categories.js';

export function seedBase() {
  const cityIds = {}, catIds = {}, catIcon = {}, catColor = {};
  q.run('BEGIN');
  q.run("INSERT INTO currencies VALUES ('INR','Indian Rupee','₹',2), ('NPR','Nepalese Rupee','रू',2)");
  q.run("INSERT INTO countries VALUES ('IN','India','INR','+91','State','PIN code','🇮🇳',1), ('NP','Nepal','NPR','+977','Province','Postal code','🇳🇵',1)");
  // NPR is pegged to INR at 1.6 — used for clearly-labelled estimates only.
  q.run("INSERT INTO fx_rates VALUES ('INR','NPR',1600000,'NRB peg (1 INR = 1.60 NPR)',datetime('now')), ('NPR','INR',625000,'NRB peg',datetime('now'))");
  let jitter = 7;
  const j = () => ((jitter = (jitter * 9301 + 49297) % 233280) / 233280 - 0.5) * 0.06;
  for (const [country, tree] of [['IN', INDIA], ['NP', NEPAL]]) {
    for (const [region, districts] of Object.entries(tree)) {
      const { id: rid } = q.run('INSERT INTO locations (country_code, parent_id, type, name, slug) VALUES (?,?,?,?,?)', country, null, 'region', region, slugify(region));
      for (const [district, cities] of Object.entries(districts)) {
        const { id: did } = q.run('INSERT INTO locations (country_code, parent_id, type, name, slug) VALUES (?,?,?,?,?)', country, rid, 'district', district, slugify(district));
        for (const [name, lat, lng, pin, popular, localities] of cities) {
          const { id: cid } = q.run('INSERT INTO locations (country_code, parent_id, type, name, slug, postal_code, lat, lng, popular) VALUES (?,?,?,?,?,?,?,?,?)', country, did, 'city', name, slugify(name), pin, lat, lng, popular ? 1 : 0);
          cityIds[name] = { id: cid, lat, lng, pin, country };
          for (const loc of localities || []) q.run('INSERT INTO locations (country_code, parent_id, type, name, slug, lat, lng) VALUES (?,?,?,?,?,?,?)', country, cid, 'locality', loc, slugify(`${name}-${loc}`), lat + j(), lng + j());
        }
      }
    }
  }
  CATEGORIES.forEach(([slug, name, icon, color, desc, children], i) => {
    const { id } = q.run('INSERT INTO categories (slug, name, icon, color, description, sort, allows_delivery, moderation, seo_title, seo_description) VALUES (?,?,?,?,?,?,?,?,?,?)',
      slug, name, icon, color, desc, i, NO_DELIVERY.has(slug) ? 0 : 1, REVIEW.has(slug) ? 'review' : 'auto', `${name} — buy & sell in India and Nepal | PASAL`, `${desc} Browse verified sellers near you on PASAL.`);
    catIds[slug] = id; catIcon[slug] = icon; catColor[slug] = color;
    children.forEach(([cslug, cname, cicon, attrs], k) => {
      const { id: cid } = q.run('INSERT INTO categories (parent_id, slug, name, icon, color, sort, allows_delivery, moderation) VALUES (?,?,?,?,?,?,?,?)', id, cslug, cname, cicon, color, k, NO_DELIVERY.has(slug) ? 0 : 1, REVIEW.has(cslug) ? 'review' : 'auto');
      catIds[cslug] = cid; catIcon[cslug] = cicon; catColor[cslug] = color;
      attrs.forEach(([key, label, type, options, unit, required, filterable], n) =>
        q.run('INSERT INTO category_attributes (category_id, key, label, type, options, unit, required, filterable, sort) VALUES (?,?,?,?,?,?,?,?,?)', cid, key, label, type, options ? JSON.stringify(options) : null, unit, required ? 1 : 0, filterable ? 1 : 0, n));
    });
  });
  q.run('COMMIT');
  return { cityIds, catIds, catIcon, catColor };
}

export const HOMEPAGE_SECTIONS = [
  ['trending_near', 'Trending near you', 'What people around you are looking at', 'listings', { near: true, sort: 'trending' }],
  ['featured', 'Featured listings', 'Hand-picked by the PASAL team', 'listings', { featured: '1' }],
  ['recent', 'Recently added', 'Fresh listings from the last few days', 'listings', { sort: 'newest' }],
  ['categories', 'Popular categories', null, 'categories', {}],
  ['deals', 'Best deals', 'Negotiable listings people are watching', 'listings', { sort: 'views', negotiable: '1' }],
  ['promo_1', 'Promotions', null, 'promo', {}],
  ['electronics', 'Electronics', 'Phones, laptops, cameras & more', 'listings', { category: 'electronics' }],
  ['vehicles', 'Vehicles', 'Cars, bikes and scooters', 'listings', { category: 'vehicles' }],
  ['fashion', 'Fashion', null, 'listings', { category: 'fashion' }],
  ['furniture', 'Home & furniture', null, 'listings', { category: 'furniture-home' }],
  ['property', 'Property', 'Rooms, PGs, flats and land', 'listings', { category: 'property' }],
  ['jobs', 'Jobs & services', 'Local pros and tutors', 'listings', { category: 'jobs-services' }],
  ['sports', 'Sports & fitness', null, 'listings', { category: 'sports-fitness' }],
  ['books', 'Books & education', null, 'listings', { category: 'books-education' }],
  ['gaming', 'Gaming & entertainment', null, 'listings', { category: 'gaming-entertainment' }],
  ['verified_sellers', 'Verified sellers', 'ID-checked sellers with great ratings', 'sellers', {}],
  ['pickup', 'Available for pickup', 'Meet the seller and check before you pay', 'listings', { pickup: '1', sort: 'newest' }],
  ['delivery', 'Delivered to your door', 'Sellers who ship', 'listings', { delivery: '1' }],
  ['recommended', 'Recommended for you', 'Based on what you browse and save', 'listings', { recommended: true }],
  ['locations', 'Popular locations', null, 'locations', {}],
  ['sell_cta', 'Start selling on PASAL', null, 'cta', {}],
];
export function seedHomepage() {
  HOMEPAGE_SECTIONS.forEach(([key, title, subtitle, kind, query], i) => q.run('INSERT INTO homepage_sections (key, title, subtitle, kind, query, sort) VALUES (?,?,?,?,?,?)', key, title, subtitle, kind, JSON.stringify(query), i));
}
