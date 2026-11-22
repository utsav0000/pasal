import { q, json } from '../db.js';
import { notFound } from '../lib/http.js';

let treeCache = null;
export const invalidateCategories = () => (treeCache = null);

export function categoryTree() {
  if (treeCache) return treeCache;
  const rows = q.all('SELECT id, parent_id, slug, name, icon, color, description, image_url, sort, moderation, allows_delivery FROM categories WHERE active = 1 ORDER BY sort, name');
  const counts = Object.fromEntries(q.all("SELECT category_id, COUNT(*) n FROM listings WHERE status = 'active' GROUP BY category_id").map((r) => [r.category_id, r.n]));
  const byId = new Map(rows.map((r) => [r.id, { ...r, children: [], count: counts[r.id] || 0 }]));
  const roots = [];
  for (const c of byId.values()) {
    if (c.parent_id && byId.has(c.parent_id)) byId.get(c.parent_id).children.push(c);
    else if (!c.parent_id) roots.push(c);
  }
  for (const r of roots) r.count += r.children.reduce((s, c) => s + c.count, 0);
  treeCache = { roots, byId, bySlug: new Map([...byId.values()].map((c) => [c.slug, c])) };
  setTimeout(() => (treeCache = null), 60_000).unref();
  return treeCache;
}

/** IDs of a category and all its descendants. */
export function descendantIds(slugOrId) {
  const t = categoryTree();
  const root = typeof slugOrId === 'number' ? t.byId.get(slugOrId) : t.bySlug.get(slugOrId);
  if (!root) return [];
  const out = [];
  const walk = (c) => { out.push(c.id); c.children.forEach(walk); };
  walk(root);
  return out;
}

export function breadcrumb(categoryId) {
  const t = categoryTree();
  const out = [];
  let c = t.byId.get(categoryId);
  while (c) { out.unshift({ id: c.id, slug: c.slug, name: c.name, icon: c.icon }); c = c.parent_id ? t.byId.get(c.parent_id) : null; }
  return out;
}

/** Attributes for a category, including those inherited from its ancestors. */
export function attributesFor(categoryId) {
  const ids = breadcrumb(categoryId).map((c) => c.id);
  if (!ids.length) return [];
  return q.all(`SELECT * FROM category_attributes WHERE category_id IN (${ids.map(() => '?').join(',')}) ORDER BY sort, id`, ...ids)
    .map((a) => ({ ...a, options: json(a.options, null), required: !!a.required, filterable: !!a.filterable }));
}

export function register(r) {
  r.get('/api/v1/categories', () => {
    const strip = (c) => ({ id: c.id, slug: c.slug, name: c.name, icon: c.icon, color: c.color, description: c.description, count: c.count, children: c.children.map(strip) });
    return categoryTree().roots.map(strip);
  });

  r.get('/api/v1/categories/:slug', (ctx) => {
    const c = categoryTree().bySlug.get(ctx.params.slug);
    if (!c) throw notFound('Category not found.');
    const full = q.get('SELECT * FROM categories WHERE id = ?', c.id);
    const parent = c.parent_id ? categoryTree().byId.get(c.parent_id) : null;
    return {
      ...full,
      count: c.count,
      breadcrumb: breadcrumb(c.id),
      children: c.children.map((x) => ({ id: x.id, slug: x.slug, name: x.name, icon: x.icon, count: x.count })),
      siblings: parent ? parent.children.map((x) => ({ id: x.id, slug: x.slug, name: x.name, count: x.count })) : [],
      attributes: attributesFor(c.id),
    };
  });
}
