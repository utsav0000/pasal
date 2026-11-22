-- PASAL core schema. All money is stored as INTEGER minor units (paise / paisa).
PRAGMA foreign_keys = ON;

CREATE TABLE currencies (
  code TEXT PRIMARY KEY,               -- INR, NPR
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  minor_unit INTEGER NOT NULL DEFAULT 2
);

CREATE TABLE countries (
  code TEXT PRIMARY KEY,               -- IN, NP
  name TEXT NOT NULL,
  currency TEXT NOT NULL REFERENCES currencies(code),
  phone_prefix TEXT NOT NULL,
  region_label TEXT NOT NULL,          -- State / Province
  postal_label TEXT NOT NULL,          -- PIN code / Postal code
  flag TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE fx_rates (
  base TEXT NOT NULL REFERENCES currencies(code),
  quote TEXT NOT NULL REFERENCES currencies(code),
  rate_micros INTEGER NOT NULL,        -- 1 base = rate_micros / 1e6 quote
  source TEXT NOT NULL DEFAULT 'manual',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (base, quote)
);

CREATE TABLE locations (
  id INTEGER PRIMARY KEY,
  country_code TEXT NOT NULL REFERENCES countries(code),
  parent_id INTEGER REFERENCES locations(id),
  type TEXT NOT NULL CHECK (type IN ('region','district','city','locality')),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  postal_code TEXT,
  lat REAL, lng REAL,
  popular INTEGER NOT NULL DEFAULT 0,
  UNIQUE (country_code, type, slug, parent_id)
);
CREATE INDEX idx_locations_parent ON locations(parent_id);
CREATE INDEX idx_locations_country_type ON locations(country_code, type);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE COLLATE NOCASE,
  phone TEXT UNIQUE,
  password_hash TEXT,
  google_sub TEXT UNIQUE,
  name TEXT NOT NULL,
  avatar_url TEXT,
  bio TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','support','moderator','admin','super_admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  seller_status TEXT NOT NULL DEFAULT 'none' CHECK (seller_status IN ('none','pending','verified','rejected')),
  country_code TEXT NOT NULL DEFAULT 'IN' REFERENCES countries(code),
  city_id INTEGER REFERENCES locations(id),
  email_verified_at TEXT,
  phone_verified_at TEXT,
  notif_prefs TEXT NOT NULL DEFAULT '{}',
  suspended_reason TEXT,
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_users_role ON users(role);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                 -- sha256 of the cookie token
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip TEXT, user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE auth_tokens (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('email_verify','password_reset','phone_otp')),
  target TEXT NOT NULL,                -- email or phone
  token_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tokens_target ON auth_tokens(type, target);

CREATE TABLE seller_verifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,
  doc_last4 TEXT NOT NULL,
  full_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  notes TEXT,
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE addresses (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'Home',
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  country_code TEXT NOT NULL REFERENCES countries(code),
  region_id INTEGER REFERENCES locations(id),
  district_id INTEGER REFERENCES locations(id),
  city_id INTEGER REFERENCES locations(id),
  locality TEXT,
  line1 TEXT NOT NULL,
  line2 TEXT,
  postal_code TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_addresses_user ON addresses(user_id);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'box',
  color TEXT,
  description TEXT,
  image_url TEXT,
  seo_title TEXT,
  seo_description TEXT,
  moderation TEXT NOT NULL DEFAULT 'auto' CHECK (moderation IN ('auto','review')),
  allows_delivery INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_categories_parent ON categories(parent_id);

CREATE TABLE category_attributes (
  id INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('text','number','select','boolean')),
  options TEXT,                         -- JSON array for select
  unit TEXT,
  required INTEGER NOT NULL DEFAULT 0,
  filterable INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE (category_id, key)
);

CREATE TABLE listings (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  seller_id INTEGER NOT NULL REFERENCES users(id),
  category_id INTEGER NOT NULL REFERENCES categories(id),
  country_code TEXT NOT NULL REFERENCES countries(code),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  brand TEXT, model TEXT,
  condition TEXT NOT NULL DEFAULT 'used_good' CHECK (condition IN ('new','like_new','used_good','used_fair','for_parts')),
  purchase_date TEXT,
  warranty TEXT,
  reason_for_selling TEXT,
  price_minor INTEGER NOT NULL DEFAULT 0 CHECK (price_minor >= 0),
  original_price_minor INTEGER CHECK (original_price_minor IS NULL OR original_price_minor >= 0),
  currency TEXT NOT NULL REFERENCES currencies(code),
  negotiable INTEGER NOT NULL DEFAULT 0,
  accept_offers INTEGER NOT NULL DEFAULT 1,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  fulfillment TEXT NOT NULL DEFAULT 'pickup' CHECK (fulfillment IN ('delivery','pickup','both')),
  region_id INTEGER REFERENCES locations(id),
  district_id INTEGER REFERENCES locations(id),
  city_id INTEGER REFERENCES locations(id),
  locality TEXT,
  postal_code TEXT,
  lat REAL, lng REAL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_review','active','paused','sold','rejected','removed','expired')),
  moderation_note TEXT,
  views INTEGER NOT NULL DEFAULT 0,
  featured_until TEXT,
  published_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_listings_browse ON listings(status, country_code, published_at DESC);
CREATE INDEX idx_listings_category ON listings(category_id, status);
CREATE INDEX idx_listings_seller ON listings(seller_id, status);
CREATE INDEX idx_listings_city ON listings(city_id, status);
CREATE INDEX idx_listings_price ON listings(currency, price_minor);

CREATE VIRTUAL TABLE listings_fts USING fts5(title, description, brand, model, category, city, tokenize = 'trigram');

CREATE TABLE listing_images (
  id INTEGER PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  thumb_url TEXT NOT NULL,
  width INTEGER, height INTEGER,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_listing_images ON listing_images(listing_id, sort);

CREATE TABLE listing_attributes (
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  attribute_id INTEGER NOT NULL REFERENCES category_attributes(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  PRIMARY KEY (listing_id, attribute_id)
);

CREATE TABLE delivery_options (
  listing_id INTEGER PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
  fee_minor INTEGER NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
  radius_km INTEGER,
  supported_locations TEXT NOT NULL DEFAULT '[]',   -- JSON array of city names; empty = within radius
  eta_min_days INTEGER NOT NULL DEFAULT 1,
  eta_max_days INTEGER NOT NULL DEFAULT 3,
  method TEXT NOT NULL DEFAULT 'seller'             -- seller | courier
);

CREATE TABLE pickup_options (
  listing_id INTEGER PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  instructions TEXT,
  times TEXT                                         -- free text e.g. "Weekdays 6–9pm"
);

CREATE TABLE listing_views (
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  viewer_key TEXT NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (listing_id, viewer_key, day)
);

CREATE TABLE recently_viewed (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  viewed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, listing_id)
);

CREATE TABLE wishlists (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, listing_id)
);

CREATE TABLE saved_searches (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  query TEXT NOT NULL,                 -- URL query string
  notify INTEGER NOT NULL DEFAULT 1,
  last_notified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE search_log (
  id INTEGER PRIMARY KEY,
  term TEXT NOT NULL,
  country_code TEXT,
  results INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_search_log ON search_log(created_at, term);

CREATE TABLE conversations (
  id INTEGER PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES listings(id),
  buyer_id INTEGER NOT NULL REFERENCES users(id),
  seller_id INTEGER NOT NULL REFERENCES users(id),
  buyer_read_at TEXT,
  seller_read_at TEXT,
  last_message_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (listing_id, buyer_id)
);
CREATE INDEX idx_conv_buyer ON conversations(buyer_id, last_message_at DESC);
CREATE INDEX idx_conv_seller ON conversations(seller_id, last_message_at DESC);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text','image','offer','system')),
  body TEXT,
  image_url TEXT,
  offer_id INTEGER REFERENCES offers(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_messages_conv ON messages(conversation_id, id);

CREATE TABLE blocks (
  blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE offers (
  id INTEGER PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES listings(id),
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  buyer_id INTEGER NOT NULL REFERENCES users(id),
  seller_id INTEGER NOT NULL REFERENCES users(id),
  made_by INTEGER NOT NULL REFERENCES users(id),
  parent_id INTEGER REFERENCES offers(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL REFERENCES currencies(code),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','countered','expired','withdrawn','used')),
  message TEXT,
  expires_at TEXT NOT NULL,
  responded_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_offers_listing ON offers(listing_id, status);
CREATE INDEX idx_offers_buyer ON offers(buyer_id);
CREATE INDEX idx_offers_seller ON offers(seller_id);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  buyer_id INTEGER NOT NULL REFERENCES users(id),
  seller_id INTEGER NOT NULL REFERENCES users(id),
  listing_id INTEGER NOT NULL REFERENCES listings(id),
  offer_id INTEGER REFERENCES offers(id),
  status TEXT NOT NULL,
  fulfillment TEXT NOT NULL CHECK (fulfillment IN ('delivery','pickup')),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('online','cash_on_pickup','cash_on_delivery','direct')),
  currency TEXT NOT NULL REFERENCES currencies(code),
  subtotal_minor INTEGER NOT NULL,
  delivery_fee_minor INTEGER NOT NULL DEFAULT 0,
  platform_fee_minor INTEGER NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL,
  address_json TEXT,
  pickup_json TEXT,
  pickup_code TEXT,                    -- shown to buyer only; verified by seller at handover
  buyer_note TEXT,
  carrier TEXT,
  tracking_number TEXT,
  eta_date TEXT,
  idempotency_key TEXT UNIQUE,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_orders_buyer ON orders(buyer_id, created_at DESC);
CREATE INDEX idx_orders_seller ON orders(seller_id, created_at DESC);
CREATE INDEX idx_orders_status ON orders(status);

CREATE TABLE order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  listing_id INTEGER NOT NULL REFERENCES listings(id),
  title TEXT NOT NULL,
  image_url TEXT,
  unit_price_minor INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0)
);

CREATE TABLE order_status_history (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_id INTEGER REFERENCES users(id),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_order_history ON order_status_history(order_id, id);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  provider TEXT NOT NULL,
  provider_order_id TEXT NOT NULL UNIQUE,
  provider_payment_id TEXT UNIQUE,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created','captured','failed','refunded','partially_refunded')),
  failure_reason TEXT,
  verified_via TEXT,                   -- callback | webhook
  raw TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_payments_order ON payments(order_id);

CREATE TABLE payment_events (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  type TEXT,
  payload TEXT NOT NULL,
  processed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider, event_id)
);

CREATE TABLE refunds (
  id INTEGER PRIMARY KEY,
  payment_id INTEGER REFERENCES payments(id),
  order_id INTEGER NOT NULL REFERENCES orders(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processed','failed','manual')),
  provider_refund_id TEXT,
  reason TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE reviews (
  id INTEGER PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id),
  listing_id INTEGER REFERENCES listings(id),
  author_id INTEGER NOT NULL REFERENCES users(id),
  subject_id INTEGER NOT NULL REFERENCES users(id),
  direction TEXT NOT NULL CHECK (direction IN ('buyer_to_seller','seller_to_buyer')),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  reply TEXT,
  replied_at TEXT,
  status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (order_id, author_id)
);
CREATE INDEX idx_reviews_subject ON reviews(subject_id, status);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_notifications_user ON notifications(user_id, id DESC);

CREATE TABLE reports (
  id INTEGER PRIMARY KEY,
  reporter_id INTEGER REFERENCES users(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('listing','user','review','message')),
  target_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','actioned','dismissed')),
  handled_by INTEGER REFERENCES users(id),
  resolution TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_reports_status ON reports(status, target_type);

CREATE TABLE disputes (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  opened_by INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','under_review','resolved','closed')),
  outcome TEXT CHECK (outcome IN ('refund_buyer','release_seller','cancelled')),
  resolution_note TEXT,
  previous_status TEXT NOT NULL,
  resolved_by INTEGER REFERENCES users(id),
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE promotions (
  id INTEGER PRIMARY KEY,
  placement TEXT NOT NULL CHECK (placement IN ('hero','banner','strip','ad')),
  title TEXT NOT NULL,
  subtitle TEXT,
  cta_label TEXT,
  link TEXT,
  theme TEXT NOT NULL DEFAULT 'violet',
  country_code TEXT REFERENCES countries(code),
  starts_at TEXT, ends_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE homepage_sections (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  subtitle TEXT,
  kind TEXT NOT NULL,                  -- listings | categories | sellers | locations | cta | promo
  query TEXT NOT NULL DEFAULT '{}',    -- JSON filter for listing sections
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE support_tickets (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  email TEXT NOT NULL,
  name TEXT,
  subject TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','pending','resolved','closed')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  assigned_to INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE ticket_messages (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id INTEGER REFERENCES users(id),
  staff INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY,
  actor_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  data TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE outbox (
  id INTEGER PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('email','sms','push')),
  recipient TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  provider TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
