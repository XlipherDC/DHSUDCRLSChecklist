CREATE TABLE IF NOT EXISTS crls_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO crls_meta(id, version) VALUES (1, 0);
CREATE TABLE IF NOT EXISTS crls_projects (
  id TEXT PRIMARY KEY NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),
  revision TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS crls_requests (
  id TEXT PRIMARY KEY NOT NULL,
  digest TEXT NOT NULL,
  result TEXT NOT NULL CHECK (json_valid(result)),
  created_at INTEGER NOT NULL
);
