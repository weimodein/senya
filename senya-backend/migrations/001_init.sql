-- Senya schema v2 (docs/architecture.md §6). Idempotent: server.js runs every migrations/*.sql file on start.
-- Never edit a migration that has run on Supabase; add 002_*.sql instead.

CREATE TABLE IF NOT EXISTS admins (
    id             SERIAL PRIMARY KEY,
    username       TEXT NOT NULL UNIQUE,
    password_hash  TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS signs (
    id            SERIAL PRIMARY KEY,
    label         TEXT NOT NULL UNIQUE,
    kind          TEXT NOT NULL CHECK (kind IN ('static', 'motion')),
    -- motion signs only: static letters this motion starts from, e.g. ["I"] for J (CONTRACT.md §3 item 8)
    start_shapes  JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The reserved "not a sign" class for the motion model. The API refuses to delete it.
INSERT INTO signs (label, kind) VALUES ('_none', 'motion') ON CONFLICT (label) DO NOTHING;

CREATE TABLE IF NOT EXISTS uploads (
    id              SERIAL PRIMARY KEY,
    sign_id         INTEGER NOT NULL REFERENCES signs(id) ON DELETE CASCADE,
    filename        TEXT NOT NULL,
    samples_added   INTEGER NOT NULL DEFAULT 0,
    segments_found  INTEGER NOT NULL DEFAULT 0,
    no_hand_frames  INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS uploads_sign_idx ON uploads(sign_id);

-- One row per training example, both kinds:
--   static: data = [63 raw floats]                                     (CONTRACT.md §3 item 1)
--   motion: data = {"duration_ms": 1100, "frames": [{"t_ms": 0, "landmarks": [63 floats] | null}, …]}  (raw, not resampled)
CREATE TABLE IF NOT EXISTS samples (
    id          SERIAL PRIMARY KEY,
    sign_id     INTEGER NOT NULL REFERENCES signs(id) ON DELETE CASCADE,
    upload_id   INTEGER NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('static', 'motion')),
    data        JSONB NOT NULL,
    handedness  TEXT,
    thumb       TEXT                         -- small JPEG data URL, optional
);
CREATE INDEX IF NOT EXISTS samples_sign_idx ON samples(sign_id);
CREATE INDEX IF NOT EXISTS samples_upload_idx ON samples(upload_id);

-- One row per model version: static + motion files hang off it in model_files.
CREATE TABLE IF NOT EXISTS model_versions (
    id                   SERIAL PRIMARY KEY,
    version              INTEGER NOT NULL UNIQUE,
    status               TEXT NOT NULL CHECK (status IN ('training', 'trained', 'failed', 'deployed')),
    progress             REAL NOT NULL DEFAULT 0,
    message              TEXT,
    error                TEXT,
    labels               JSONB,
    motion_labels        JSONB,                 -- NULL = static-only version
    val_accuracy         REAL,
    motion_val_accuracy  REAL,
    report               JSONB,                 -- {"static": {...}, "motion": {...}}
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    trained_at           TIMESTAMPTZ,
    deployed_at          TIMESTAMPTZ
);
-- At most one live model, and at most one training run at a time.
CREATE UNIQUE INDEX IF NOT EXISTS model_versions_one_deployed ON model_versions ((true)) WHERE status = 'deployed';
CREATE UNIQUE INDEX IF NOT EXISTS model_versions_one_training ON model_versions ((true)) WHERE status = 'training';

-- Model files live in the database (tens of KB each), so there are no storage buckets to manage.
CREATE TABLE IF NOT EXISTS model_files (
    model_id  INTEGER NOT NULL REFERENCES model_versions(id) ON DELETE CASCADE,
    name      TEXT NOT NULL CHECK (name IN (
        'model.tflite', 'labels.json', 'golden.json',
        'motion.tflite', 'motion_labels.json', 'motion_config.json', 'motion_golden.json')),
    content   BYTEA NOT NULL,
    sha256    TEXT NOT NULL,
    PRIMARY KEY (model_id, name)
);

-- Supabase exposes every table through its REST API to anyone with the public anon key unless row-level security
-- is on. Enabling it with NO policies blocks that API; the backend connects as the owner role, which bypasses RLS.
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE signs ENABLE ROW LEVEL SECURITY;
ALTER TABLE uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_files ENABLE ROW LEVEL SECURITY;
