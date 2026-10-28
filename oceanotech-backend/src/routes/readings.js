/**
 * routes/readings.js
 * Sensor readings ingestion & retrieval — Phase 1.
 *
 * Range rules now come from domain/modelConfig (fixes TD-01 duplication).
 *
 * POST /api/v1/readings          — ingest a new reading
 * GET  /api/v1/readings          — list readings (paginated)
 * GET  /api/v1/readings/latest   — latest reading per sensor
 * GET  /api/v1/readings/history  — time-series history
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const { requireAuth } = require('../middleware/auth');
const { pushReading } = require('./twin');
const { MODEL_CONFIG } = require('../domain/modelConfig');
const { DataSource, QualityStatus } = require('../domain/provenance');
const { DEFAULT_SITE_ID, DEFAULT_CAGE_ID } = require('../domain/seedData');

const router = express.Router();

// ─── In-memory sensor readings (Phase 1 — persistent storage in Phase 6) ──────

const sensorReadings = [];
const MAX_READINGS = 5000;

// Valid parameters come from the shared model config (single source of truth)
const VALID_PARAMETERS = Object.keys(MODEL_CONFIG.PARAMETER_RANGES);

// Range rules from shared model config
const RANGE_RULES = MODEL_CONFIG.PARAMETER_RANGES;

// ─── Validation ───────────────────────────────────────────────────────────────

function validateReading(reading) {
  const errors = [];
  const warnings = [];

  // Required fields
  if (!reading.device_id) errors.push('Missing device_id');
  if (!reading.parameter) errors.push('Missing parameter');
  if (reading.value === undefined || reading.value === null) errors.push('Missing value');

  if (errors.length > 0) {
    return { valid: false, errors, warnings, quality_score: 0, quality_status: 'INVALID' };
  }

  // Parameter known?
  if (!VALID_PARAMETERS.includes(reading.parameter)) {
    warnings.push(`Unknown parameter: ${reading.parameter}`);
  }

  // Range check
  const rule = RANGE_RULES[reading.parameter];
  if (rule) {
    const v = Number(reading.value);
    if (!Number.isFinite(v)) {
      errors.push('Value is not a finite number');
    } else if (v < rule.min || v > rule.max) {
      errors.push(`Value ${v} out of range [${rule.min}, ${rule.max}] for ${reading.parameter}`);
    }
  }

  // Timestamp check
  if (reading.timestamp) {
    const ts = new Date(reading.timestamp);
    const now = Date.now();
    const age_ms = now - ts.getTime();
    if (isNaN(ts.getTime())) {
      errors.push('Invalid timestamp format');
    } else if (age_ms > 24 * 3600 * 1000) {
      warnings.push('Timestamp is older than 24h');
    } else if (age_ms < -300 * 1000) {
      warnings.push('Timestamp is more than 5 minutes in the future');
    }
  }

  const quality_score = errors.length > 0 ? 0
    : warnings.length === 0 ? 100
    : Math.max(60, 100 - warnings.length * 10);

  const quality_status = errors.length > 0 ? 'INVALID'
    : warnings.length === 0 ? 'VALID'
    : 'VALID_WITH_WARNINGS';

  return { valid: errors.length === 0, errors, warnings, quality_score, quality_status };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/readings
 * Body: { device_id, site_id, cage_id, parameter, value, unit, timestamp }
 *    OR array of the above
 */
router.post(
  '/',
  requireAuth,
  [
    body().custom((body) => {
      if (!body || (typeof body !== 'object')) throw new Error('Invalid body');
      return true;
    }),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Invalid request body.' });

    const items = Array.isArray(req.body) ? req.body : [req.body];
    const results = [];

    for (const item of items) {
      const validation = validateReading(item);
      const stored = {
        reading_id: `R-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        device_id: item.device_id || 'UNKNOWN',
        site_id: item.site_id || DEFAULT_SITE_ID,
        cage_id: item.cage_id || DEFAULT_CAGE_ID,
        parameter: item.parameter,
        value: Number(item.value),
        unit: item.unit || '',
        timestamp: item.timestamp || new Date().toISOString(),
        received_at: new Date().toISOString(),
        quality_score: validation.quality_score,
        quality_status: validation.quality_status,
        validation_errors: validation.errors,
        validation_warnings: validation.warnings,
      };

      if (validation.valid) {
        sensorReadings.push(stored);
        if (sensorReadings.length > MAX_READINGS) sensorReadings.shift();
        // Also push to twin sync
        pushReading({ source: 'sensor', ...stored });
      }

      results.push({
        reading_id: stored.reading_id,
        accepted: validation.valid,
        quality_score: validation.quality_score,
        quality_status: validation.quality_status,
        errors: validation.errors,
        warnings: validation.warnings,
      });
    }

    const accepted = results.filter(r => r.accepted).length;
    return res.status(accepted > 0 ? 201 : 400).json({
      accepted,
      rejected: results.length - accepted,
      results,
    });
  }
);

/**
 * GET /api/v1/readings
 * Query: ?limit=50&cage_id=CAGE07&parameter=dissolved_oxygen
 */
router.get('/', requireAuth, (req, res) => {
  let filtered = [...sensorReadings];

  if (req.query.cage_id) filtered = filtered.filter(r => r.cage_id === req.query.cage_id);
  if (req.query.site_id) filtered = filtered.filter(r => r.site_id === req.query.site_id);
  if (req.query.parameter) filtered = filtered.filter(r => r.parameter === req.query.parameter);
  if (req.query.device_id) filtered = filtered.filter(r => r.device_id === req.query.device_id);

  const limit = Math.min(parseInt(req.query.limit || '50', 10), 500);
  const page = Math.max(0, parseInt(req.query.page || '0', 10));

  const total = filtered.length;
  const paginated = filtered.slice(-(limit + page * limit), filtered.length - page * limit || undefined);

  return res.json({ total, limit, page, count: paginated.length, readings: paginated });
});

/**
 * GET /api/v1/readings/latest
 * Returns the most recent reading per (device_id, parameter)
 */
router.get('/latest', requireAuth, (req, res) => {
  const latestMap = new Map();

  for (const reading of sensorReadings) {
    const key = `${reading.device_id}::${reading.parameter}`;
    latestMap.set(key, reading);
  }

  const latest = Array.from(latestMap.values());

  // If no real readings yet, return simulated "bootstrap" values
  if (latest.length === 0) {
    const now = new Date().toISOString();
    const simulated = [
      { device_id: `V-DO-${DEFAULT_SITE_ID}-${DEFAULT_CAGE_ID}`,  site_id: DEFAULT_SITE_ID, cage_id: DEFAULT_CAGE_ID, parameter: 'dissolved_oxygen', value: 8.21, unit: 'mg/L', timestamp: now, quality_score: 100, quality_status: QualityStatus.SIMULATED, source: DataSource.SIMULATION },
      { device_id: `V-TMP-${DEFAULT_SITE_ID}-${DEFAULT_CAGE_ID}`, site_id: DEFAULT_SITE_ID, cage_id: DEFAULT_CAGE_ID, parameter: 'temperature',      value: 12.5,  unit: '°C',   timestamp: now, quality_score: 100, quality_status: QualityStatus.SIMULATED, source: DataSource.SIMULATION },
      { device_id: `V-SAL-${DEFAULT_SITE_ID}-${DEFAULT_CAGE_ID}`, site_id: DEFAULT_SITE_ID, cage_id: DEFAULT_CAGE_ID, parameter: 'salinity',         value: 33.1,  unit: 'PSU',  timestamp: now, quality_score: 100, quality_status: QualityStatus.SIMULATED, source: DataSource.SIMULATION },
      { device_id: `V-PH-${DEFAULT_SITE_ID}-${DEFAULT_CAGE_ID}`,  site_id: DEFAULT_SITE_ID, cage_id: DEFAULT_CAGE_ID, parameter: 'pH',               value: 7.82,  unit: null,   timestamp: now, quality_score: 100, quality_status: QualityStatus.SIMULATED, source: DataSource.SIMULATION },
      { device_id: `V-NH3-${DEFAULT_SITE_ID}-${DEFAULT_CAGE_ID}`, site_id: DEFAULT_SITE_ID, cage_id: DEFAULT_CAGE_ID, parameter: 'ammonia',          value: 0.009, unit: 'mg/L', timestamp: now, quality_score: 100, quality_status: QualityStatus.SIMULATED, source: DataSource.SIMULATION },
      { device_id: `V-TRB-${DEFAULT_SITE_ID}-${DEFAULT_CAGE_ID}`, site_id: DEFAULT_SITE_ID, cage_id: DEFAULT_CAGE_ID, parameter: 'turbidity',        value: 2.2,   unit: 'NTU',  timestamp: now, quality_score: 100, quality_status: QualityStatus.SIMULATED, source: DataSource.SIMULATION },
      { device_id: `V-FLW-${DEFAULT_SITE_ID}-${DEFAULT_CAGE_ID}`, site_id: DEFAULT_SITE_ID, cage_id: DEFAULT_CAGE_ID, parameter: 'flow',             value: 1185,  unit: 'L/min',timestamp: now, quality_score: 100, quality_status: QualityStatus.SIMULATED, source: DataSource.SIMULATION },
    ];
    return res.json({ count: simulated.length, source: DataSource.SIMULATION, readings: simulated });
  }

  return res.json({ count: latest.length, source: 'LIVE', readings: latest });
});

/**
 * GET /api/v1/readings/history
 * Query: ?parameter=dissolved_oxygen&limit=200
 */
router.get('/history', requireAuth, (req, res) => {
  let filtered = [...sensorReadings];
  if (req.query.parameter) filtered = filtered.filter(r => r.parameter === req.query.parameter);
  if (req.query.cage_id)   filtered = filtered.filter(r => r.cage_id === req.query.cage_id);
  if (req.query.device_id) filtered = filtered.filter(r => r.device_id === req.query.device_id);

  const limit = Math.min(parseInt(req.query.limit || '200', 10), 1000);
  const slice = filtered.slice(-limit);

  return res.json({ count: slice.length, readings: slice });
});

module.exports = router;
