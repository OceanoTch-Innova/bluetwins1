const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, '..', 'oceanotech.sqlite');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─────────────────────────────────────────────────────────────────────────────
// Auth tables (original schema — unchanged)
// ─────────────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    name            TEXT,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until    INTEGER,               -- timestamp epoch ms, NULL si no está bloqueada
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL,
    expires_at  INTEGER NOT NULL,
    created_at  INTEGER NOT NULL,
    revoked     INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS login_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT NOT NULL,
    ip          TEXT,
    success     INTEGER NOT NULL,
    created_at  INTEGER NOT NULL
  );
`);

// ─────────────────────────────────────────────────────────────────────────────
// AquaTwins domain tables (Phase 1)
// Added via CREATE TABLE IF NOT EXISTS — safe to run on existing databases.
// ─────────────────────────────────────────────────────────────────────────────
db.exec(`
  -- ── Farm ──────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS farms (
    farm_id    TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    company    TEXT,
    country    TEXT,
    region     TEXT,
    species    TEXT NOT NULL DEFAULT 'Salmo salar',
    created_at TEXT NOT NULL
  );

  -- ── Site ──────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS sites (
    site_id    TEXT PRIMARY KEY,
    farm_id    TEXT NOT NULL REFERENCES farms(farm_id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    latitude   REAL,
    longitude  REAL,
    depth_m    REAL,
    cage_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  -- ── Cage ──────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS cages (
    cage_id     TEXT NOT NULL,
    site_id     TEXT NOT NULL REFERENCES sites(site_id) ON DELETE CASCADE,
    twin_id     TEXT NOT NULL UNIQUE,    -- e.g. DT-SITE01-CAGE07
    name        TEXT,
    type        TEXT NOT NULL DEFAULT 'circular_net_pen',
    diameter_m  REAL,
    depth_m     REAL,
    volume_m3   REAL,
    status      TEXT NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE | FALLOW | MAINTENANCE
    created_at  TEXT NOT NULL,
    PRIMARY KEY (cage_id, site_id)
  );

  -- ── Cohort ────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS cohorts (
    cohort_id         TEXT PRIMARY KEY,
    cage_id           TEXT NOT NULL,
    site_id           TEXT NOT NULL,
    species           TEXT NOT NULL DEFAULT 'Salmo salar',
    strain            TEXT,
    stocking_date     TEXT,
    expected_harvest  TEXT,
    initial_count     INTEGER,
    initial_weight_g  REAL,
    status            TEXT NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE | HARVESTED | TERMINATED
    created_at        TEXT NOT NULL,
    FOREIGN KEY (cage_id, site_id) REFERENCES cages(cage_id, site_id)
  );

  -- ── Device ────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS devices (
    device_id         TEXT PRIMARY KEY,
    site_id           TEXT NOT NULL REFERENCES sites(site_id),
    cage_id           TEXT NOT NULL,
    name              TEXT,
    type              TEXT NOT NULL DEFAULT 'MULTI_PARAMETER_PROBE',
    manufacturer      TEXT,
    model             TEXT,
    firmware_version  TEXT,
    device_kind       TEXT NOT NULL DEFAULT 'VIRTUAL',  -- VIRTUAL | PHYSICAL
    status            TEXT NOT NULL DEFAULT 'ACTIVE',
    calibrated_at     TEXT,
    installed_at      TEXT,
    created_at        TEXT NOT NULL
  );

  -- ── Sensor ────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS sensors (
    sensor_id         TEXT PRIMARY KEY,
    device_id         TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    parameter         TEXT NOT NULL,
    unit              TEXT,
    range_min         REAL,
    range_max         REAL,
    accuracy          TEXT,
    calibration_date  TEXT,
    status            TEXT NOT NULL DEFAULT 'ACTIVE',
    source            TEXT NOT NULL DEFAULT 'SIMULATION',
    created_at        TEXT NOT NULL
  );

  -- ── Readings (persistent sensor telemetry) ────────────────────────────────
  -- Replaces the in-memory sensorReadings[] array in readings.js (Phase 1 → 6 migration).
  -- Rows are INSERT-only; never updated after write.
  CREATE TABLE IF NOT EXISTS readings (
    reading_id           TEXT PRIMARY KEY,
    device_id            TEXT NOT NULL,
    sensor_id            TEXT,
    site_id              TEXT,
    cage_id              TEXT,
    parameter            TEXT NOT NULL,
    value                REAL NOT NULL,
    unit                 TEXT,
    timestamp            TEXT NOT NULL,
    received_at          TEXT NOT NULL,
    source               TEXT NOT NULL DEFAULT 'SIMULATION',
    quality_score        REAL,
    quality_status       TEXT,
    validation_errors    TEXT NOT NULL DEFAULT '[]',   -- JSON array
    validation_warnings  TEXT NOT NULL DEFAULT '[]'    -- JSON array
  );

  -- Index for time-series queries per cage/parameter
  CREATE INDEX IF NOT EXISTS idx_readings_cage_param_ts
    ON readings(cage_id, parameter, timestamp);

  CREATE INDEX IF NOT EXISTS idx_readings_device_ts
    ON readings(device_id, timestamp);

  -- ── Events ────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS events (
    event_id    TEXT PRIMARY KEY,
    cage_id     TEXT NOT NULL,
    cohort_id   TEXT,
    site_id     TEXT,
    event_type  TEXT NOT NULL,
    timestamp   TEXT NOT NULL,
    source      TEXT NOT NULL DEFAULT 'MANUAL',
    description TEXT,
    metadata    TEXT NOT NULL DEFAULT '{}',   -- JSON object
    created_at  TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_events_cage_ts ON events(cage_id, timestamp);

  -- ── Twin States ───────────────────────────────────────────────────────────
  -- Persistent snapshot of Digital Twin state at each update.
  -- Rows are INSERT-only; each update creates a new row.
  CREATE TABLE IF NOT EXISTS twin_states (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    twin_id          TEXT NOT NULL,
    site_id          TEXT NOT NULL,
    cage_id          TEXT NOT NULL,
    cohort_id        TEXT,
    mode             TEXT NOT NULL DEFAULT 'SIMULATION',
    state_version    INTEGER NOT NULL DEFAULT 0,
    timestamp        TEXT NOT NULL,
    state_json       TEXT NOT NULL,    -- full TwinState as JSON
    data_quality     REAL,
    twin_confidence  REAL,
    update_reason    TEXT,
    created_at       TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_twin_states_twin_ts ON twin_states(twin_id, timestamp);

  -- ── Predictions ───────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS predictions (
    prediction_id  TEXT PRIMARY KEY,
    twin_id        TEXT NOT NULL,
    cage_id        TEXT,
    model_version  TEXT,
    timestamp      TEXT NOT NULL,
    horizon_h      REAL,
    inputs_json    TEXT NOT NULL DEFAULT '{}',
    outputs_json   TEXT NOT NULL DEFAULT '{}',
    confidence     REAL,
    created_at     TEXT NOT NULL
  );

  -- ── Alerts ────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS alerts (
    alert_id            TEXT PRIMARY KEY,
    cage_id             TEXT NOT NULL,
    site_id             TEXT,
    twin_id             TEXT,
    alert_type          TEXT NOT NULL,
    severity            TEXT NOT NULL DEFAULT 'MEDIUM',
    timestamp           TEXT NOT NULL,
    message             TEXT NOT NULL,
    root_cause          TEXT,
    confidence          REAL,
    recommended_action  TEXT,
    drivers_json        TEXT NOT NULL DEFAULT '[]',
    acknowledged        INTEGER NOT NULL DEFAULT 0,
    acknowledged_at     TEXT,
    source              TEXT NOT NULL DEFAULT 'SIMULATION',
    created_at          TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_alerts_cage_ts ON alerts(cage_id, timestamp);

  -- ── Model Registry ────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS model_versions (
    model_id         TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    version          TEXT NOT NULL,
    description      TEXT,
    species          TEXT NOT NULL DEFAULT 'Salmo salar',
    dataset          TEXT,
    training_date    TEXT,
    validation_date  TEXT,
    metrics_json     TEXT NOT NULL DEFAULT '{}',
    status           TEXT NOT NULL DEFAULT 'EXPERIMENTAL',
    created_at       TEXT NOT NULL
  );
`);

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap: insert reference domain data if not already present.
// Uses INSERT OR IGNORE to be safe on repeat startups.
// ─────────────────────────────────────────────────────────────────────────────
(function bootstrapDomainData() {
  const { DEMO_FARM, DEMO_SITES, DEMO_CAGES, DEMO_COHORTS, DEMO_DEVICES, DEMO_SENSORS } = require('./domain/seedData');

  const insertFarm = db.prepare(`
    INSERT OR IGNORE INTO farms (farm_id, name, company, country, region, species, created_at)
    VALUES (@farm_id, @name, @company, @country, @region, @species, @created_at)
  `);
  insertFarm.run(DEMO_FARM);

  const insertSite = db.prepare(`
    INSERT OR IGNORE INTO sites (site_id, farm_id, name, latitude, longitude, depth_m, cage_count, created_at)
    VALUES (@site_id, @farm_id, @name, @latitude, @longitude, @depth_m, @cage_count, @created_at)
  `);
  DEMO_SITES.forEach(s => insertSite.run(s));

  const insertCage = db.prepare(`
    INSERT OR IGNORE INTO cages (cage_id, site_id, twin_id, name, type, diameter_m, depth_m, volume_m3, status, created_at)
    VALUES (@cage_id, @site_id, @twin_id, @name, @type, @diameter_m, @depth_m, @volume_m3, @status, @created_at)
  `);
  DEMO_CAGES.forEach(c => insertCage.run(c));

  const insertCohort = db.prepare(`
    INSERT OR IGNORE INTO cohorts (cohort_id, cage_id, site_id, species, strain, stocking_date, expected_harvest, initial_count, initial_weight_g, status, created_at)
    VALUES (@cohort_id, @cage_id, @site_id, @species, @strain, @stocking_date, @expected_harvest, @initial_count, @initial_weight_g, @status, @created_at)
  `);
  DEMO_COHORTS.forEach(c => insertCohort.run(c));

  const insertDevice = db.prepare(`
    INSERT OR IGNORE INTO devices (device_id, site_id, cage_id, name, type, manufacturer, model, firmware_version, device_kind, status, calibrated_at, installed_at, created_at)
    VALUES (@device_id, @site_id, @cage_id, @name, @type, @manufacturer, @model, @firmware_version, @device_kind, @status, @calibrated_at, @installed_at, @created_at)
  `);
  DEMO_DEVICES.forEach(d => insertDevice.run(d));

  const insertSensor = db.prepare(`
    INSERT OR IGNORE INTO sensors (sensor_id, device_id, parameter, unit, range_min, range_max, accuracy, calibration_date, status, source, created_at)
    VALUES (@sensor_id, @device_id, @parameter, @unit, @range_min, @range_max, @accuracy, @calibration_date, @status, @source, @created_at)
  `);
  DEMO_SENSORS.forEach(s => insertSensor.run(s));

  // Seed the model registry entry for the current TGC model
  db.prepare(`
    INSERT OR IGNORE INTO model_versions (model_id, name, version, description, species, status, metrics_json, created_at)
    VALUES ('TGC-V2.5', 'Thermal Growth Coefficient Model', '2.5',
            'TGC-based growth model with multi-parameter stress correction. References: Johansson 2014, Tran-Duy 2012, Martins 2011.',
            'Salmo salar', 'EXPERIMENTAL', '{}', ?)
  `).run(new Date().toISOString());
})();

module.exports = db;
