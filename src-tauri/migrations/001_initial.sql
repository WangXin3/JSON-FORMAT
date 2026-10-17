CREATE TABLE IF NOT EXISTS history (
    id TEXT PRIMARY KEY NOT NULL,
    source TEXT NOT NULL,
    preview TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('format', 'unescape'))
);
CREATE INDEX IF NOT EXISTS idx_history_created_at ON history(created_at DESC);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
);
