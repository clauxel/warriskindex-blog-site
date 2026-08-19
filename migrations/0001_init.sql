CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  site_key TEXT NOT NULL,
  domain TEXT NOT NULL DEFAULT 'warriskindex.blog',
  hostname TEXT,
  event_name TEXT NOT NULL,
  path TEXT NOT NULL,
  route_path TEXT,
  session_id TEXT,
  visitor_id TEXT,
  referrer TEXT,
  referrer_host TEXT,
  source TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  user_agent TEXT,
  country TEXT,
  occurred_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS analytics_events_site_created_idx ON analytics_events(site_key, created_at);
CREATE INDEX IF NOT EXISTS analytics_events_domain_created_idx ON analytics_events(domain, created_at);
CREATE INDEX IF NOT EXISTS analytics_events_event_created_idx ON analytics_events(event_name, created_at);

CREATE TABLE IF NOT EXISTS risk_snapshots (
  id TEXT PRIMARY KEY,
  site_key TEXT NOT NULL,
  region_slug TEXT NOT NULL,
  region_label TEXT NOT NULL,
  score INTEGER NOT NULL,
  level TEXT NOT NULL,
  source TEXT NOT NULL,
  query TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS risk_snapshots_region_created_idx ON risk_snapshots(region_slug, created_at);
CREATE INDEX IF NOT EXISTS risk_snapshots_site_created_idx ON risk_snapshots(site_key, created_at);
