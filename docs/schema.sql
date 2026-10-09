-- Senya PostgreSQL schema. Apply once: psql "$DATABASE_URL" -f docs/schema.sql
-- Mirrors spec §4.1 and docs/architecture.md §5. Person B owns migrations after this first version.

CREATE TABLE IF NOT EXISTS signs (
    id            SERIAL PRIMARY KEY,
    label         TEXT NOT NULL UNIQUE,
    kind          TEXT NOT NULL CHECK (kind IN ('static', 'motion')),
    -- motion signs only: static letters this motion starts from, e.g. ["I"] for J (contract §3 item 8)
    start_shapes  JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The reserved "not a sign" class for the motion model. Created at startup; the API refuses to delete it.
INSERT INTO signs (label, kind, start_shapes) VALUES ('_none', 'motion', NULL) ON CONFLICT (label) DO NOTHING;

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

-- Static signs: one row per frame/image with a hand. 63 raw floats (contract §3 item 1).
CREATE TABLE IF NOT EXISTS samples (
    id           SERIAL PRIMARY KEY,
    sign_id      INTEGER NOT NULL REFERENCES signs(id) ON DELETE CASCADE,
    upload_id    INTEGER NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
    landmarks    JSONB NOT NULL,
    handedness   TEXT,
    frame_index  INTEGER,
    thumb        TEXT,                      -- small JPEG data URL, optional
    CONSTRAINT samples_63_floats CHECK (jsonb_typeof(landmarks) = 'array' AND jsonb_array_length(landmarks) = 63)
);
CREATE INDEX IF NOT EXISTS samples_sign_idx ON samples(sign_id);
CREATE INDEX IF NOT EXISTS samples_upload_idx ON samples(upload_id);

-- Motion signs: one row per detected movement, stored RAW (not resampled) so the segmenter/resampler can change later.
-- frames = [{"t_ms": 0, "landmarks": [63 floats] | null}, ...]
CREATE TABLE IF NOT EXISTS sequences (
    id           SERIAL PRIMARY KEY,
    sign_id      INTEGER NOT NULL REFERENCES signs(id) ON DELETE CASCADE,
    upload_id    INTEGER NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
    frames       JSONB NOT NULL,
    duration_ms  INTEGER NOT NULL,
    handedness   TEXT,
    thumb        TEXT
);
CREATE INDEX IF NOT EXISTS sequences_sign_idx ON sequences(sign_id);
CREATE INDEX IF NOT EXISTS sequences_upload_idx ON sequences(upload_id);

CREATE TABLE IF NOT EXISTS train_jobs (
    id             SERIAL PRIMARY KEY,
    status         TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
    progress       REAL NOT NULL DEFAULT 0,
    message        TEXT,
    error          TEXT,
    model_version  INTEGER,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- At most one queued/running job at a time (POST /api/train returns 409 otherwise)
CREATE UNIQUE INDEX IF NOT EXISTS train_jobs_one_active ON train_jobs ((true)) WHERE status IN ('queued', 'running');

CREATE TABLE IF NOT EXISTS models (
    version              SERIAL PRIMARY KEY,
    labels               JSONB NOT NULL,
    val_accuracy         REAL,
    report               JSONB,
    motion_labels        JSONB,             -- NULL = static-only version
    motion_val_accuracy  REAL,
    motion_report        JSONB,
    is_current           BOOLEAN NOT NULL DEFAULT false,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Exactly one current version: a second TRUE violates this index. Publish = flip old to false, new to true, in one transaction.
CREATE UNIQUE INDEX IF NOT EXISTS models_one_current ON models ((true)) WHERE is_current;

-- Model files live here so the host needs no persistent disk. name is one of the seven contract file names.
CREATE TABLE IF NOT EXISTS model_files (
    version  INTEGER NOT NULL REFERENCES models(version) ON DELETE CASCADE,
    name     TEXT NOT NULL,
    content  BYTEA NOT NULL,
    sha256   TEXT NOT NULL,
    PRIMARY KEY (version, name),
    CONSTRAINT model_file_names CHECK (name IN (
        'model.tflite', 'labels.json', 'golden.json',
        'motion.tflite', 'motion_labels.json', 'motion_config.json', 'motion_golden.json'))
);
