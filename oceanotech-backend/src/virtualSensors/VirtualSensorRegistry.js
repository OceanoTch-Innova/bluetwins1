/**
 * VirtualSensorRegistry.js
 * AquaTwins — Phase 3: Virtual Sensor Registry
 *
 * A registry of all virtual sensor definitions known to the system.
 * Each entry describes ONE sensor channel on ONE device in ONE cage.
 *
 * RESPONSIBILITY:
 *   - Stores static sensor metadata (what exists, on what device, in what cage).
 *   - Does NOT store readings or runtime state.
 *   - Does NOT talk to the PhysicalSystemSimulator.
 *   - Is consumed by VirtualSensorEngine to know which channels to sample.
 *
 * DESIGN FOR REAL-SENSOR COMPATIBILITY:
 *   The schema is identical whether the sensor is VIRTUAL or PHYSICAL.
 *   A real sensor registration would simply set:
 *     device_kind: 'PHYSICAL'
 *     source:      'SENSOR'
 *   The rest of the system (VirtualSensorEngine, data ingestion, Digital Twin)
 *   must not care about this distinction except through provenance metadata.
 *
 * Extension points for future sensor types:
 *   chlorophyll, ORP, current_speed, current_direction, wave_height, wind, camera
 *   — add entries to SENSOR_SPECS and register them via registerSensor().
 *   The engine will pick them up automatically once a physical model provides
 *   the corresponding field.
 */

'use strict';

const { MODEL_CONFIG } = require('../domain/modelConfig');
const { DataSource }   = require('../domain/provenance');

// ─── Sensor parameter specifications ─────────────────────────────────────────
//
// These define the physical characteristics of each sensor type:
// noise level (std), typical bias range, drift rate, and the field name
// that the PhysicalSystemSimulator exposes for this parameter.
//
// ASSUMPTION: All noise/bias/drift values are simulation assumptions.
// They are NOT calibrated against real sensor datasheets.
// References: YSI Pro series, AquaGro/Neptune Systems, Aanderaa oxygen optodes —
//   used as order-of-magnitude guides only.

const SENSOR_SPECS = Object.freeze({
  temperature: {
    unit:            '°C',
    physical_field:  'temperature',          // field name in SimulatedPhysicalState
    noise_std:       MODEL_CONFIG.SENSOR_NOISE.temperature,
    bias_range:      [-0.15,  0.15],         // constant offset (°C) — ASSUMPTION
    drift_rate:      0.002,                  // °C/day — ASSUMPTION
    sampling_hz:     1 / 60,                 // 1 reading per minute (default)
    range_min:       MODEL_CONFIG.PARAMETER_RANGES.temperature.min,
    range_max:       MODEL_CONFIG.PARAMETER_RANGES.temperature.max,
    resolution:      0.01,                   // measurement resolution (°C)
  },
  dissolved_oxygen: {
    unit:            'mg/L',
    physical_field:  'dissolved_oxygen',
    noise_std:       MODEL_CONFIG.SENSOR_NOISE.dissolved_oxygen,
    bias_range:      [-0.20,  0.20],         // mg/L — ASSUMPTION
    drift_rate:      0.004,                  // mg/L per day — ASSUMPTION
    sampling_hz:     1 / 60,
    range_min:       MODEL_CONFIG.PARAMETER_RANGES.dissolved_oxygen.min,
    range_max:       MODEL_CONFIG.PARAMETER_RANGES.dissolved_oxygen.max,
    resolution:      0.01,
  },
  salinity: {
    unit:            'PSU',
    physical_field:  'salinity',
    noise_std:       MODEL_CONFIG.SENSOR_NOISE.salinity,
    bias_range:      [-0.10,  0.10],         // PSU — ASSUMPTION
    drift_rate:      0.001,                  // PSU/day — ASSUMPTION
    sampling_hz:     1 / 300,               // 1 reading per 5 minutes
    range_min:       MODEL_CONFIG.PARAMETER_RANGES.salinity.min,
    range_max:       MODEL_CONFIG.PARAMETER_RANGES.salinity.max,
    resolution:      0.01,
  },
  pH: {
    unit:            null,                   // dimensionless
    physical_field:  'pH',
    noise_std:       MODEL_CONFIG.SENSOR_NOISE.pH,
    bias_range:      [-0.05,  0.05],         // pH units — ASSUMPTION
    drift_rate:      0.0015,                 // pH/day — ASSUMPTION
    sampling_hz:     1 / 60,
    range_min:       MODEL_CONFIG.PARAMETER_RANGES.pH.min,
    range_max:       MODEL_CONFIG.PARAMETER_RANGES.pH.max,
    resolution:      0.001,
  },
  ammonia: {
    unit:            'mg/L',
    physical_field:  'ammonia',
    noise_std:       MODEL_CONFIG.SENSOR_NOISE.ammonia,
    bias_range:      [-0.002, 0.002],        // mg/L — ASSUMPTION
    drift_rate:      0.0001,                 // mg/L/day — ASSUMPTION
    sampling_hz:     1 / 600,               // 1 reading per 10 minutes
    range_min:       MODEL_CONFIG.PARAMETER_RANGES.ammonia.min,
    range_max:       MODEL_CONFIG.PARAMETER_RANGES.ammonia.max,
    resolution:      0.0001,
  },
  turbidity: {
    unit:            'NTU',
    physical_field:  'turbidity',
    noise_std:       MODEL_CONFIG.SENSOR_NOISE.turbidity,
    bias_range:      [-0.5,   0.5],          // NTU — ASSUMPTION
    drift_rate:      0.003,                  // NTU/day — ASSUMPTION
    sampling_hz:     1 / 120,               // 1 reading per 2 minutes
    range_min:       MODEL_CONFIG.PARAMETER_RANGES.turbidity.min,
    range_max:       MODEL_CONFIG.PARAMETER_RANGES.turbidity.max,
    resolution:      0.1,
  },
  flow: {
    unit:            'L/min',
    physical_field:  'flow',
    noise_std:       MODEL_CONFIG.SENSOR_NOISE.flow,
    bias_range:      [-15,    15],           // L/min — ASSUMPTION
    drift_rate:      0.1,                    // L/min/day — ASSUMPTION
    sampling_hz:     1 / 60,
    range_min:       MODEL_CONFIG.PARAMETER_RANGES.flow.min,
    range_max:       MODEL_CONFIG.PARAMETER_RANGES.flow.max,
    resolution:      1.0,
  },

  // ── Extension points for future sensor types ──────────────────────────────
  // These are NOT yet backed by PhysicalSystemSimulator fields.
  // Register them here so the schema is complete; the engine will
  // return quality_status: 'UNAVAILABLE' until the physical model provides the field.
  chlorophyll: {
    unit:            'μg/L',
    physical_field:  'chlorophyll',          // not yet in PhysicalSystemSimulator
    noise_std:       0.5,
    bias_range:      [-1.0,   1.0],
    drift_rate:      0.02,
    sampling_hz:     1 / 300,
    range_min:       MODEL_CONFIG.PARAMETER_RANGES.chlorophyll?.min ?? 0,
    range_max:       MODEL_CONFIG.PARAMETER_RANGES.chlorophyll?.max ?? 100,
    resolution:      0.1,
  },
  ORP: {
    unit:            'mV',
    physical_field:  'ORP',
    noise_std:       2.0,
    bias_range:      [-10,    10],
    drift_rate:      0.5,
    sampling_hz:     1 / 120,
    range_min:       MODEL_CONFIG.PARAMETER_RANGES.ORP?.min ?? -500,
    range_max:       MODEL_CONFIG.PARAMETER_RANGES.ORP?.max ??  500,
    resolution:      1.0,
  },
  current_speed: {
    unit:            'm/s',
    physical_field:  'current_speed',
    noise_std:       0.02,
    bias_range:      [-0.05,  0.05],
    drift_rate:      0.001,
    sampling_hz:     1 / 60,
    range_min:       0,
    range_max:       3.0,
    resolution:      0.01,
  },
});

// ─── CalibrationState ─────────────────────────────────────────────────────────

const CalibrationState = Object.freeze({
  CALIBRATED:           'CALIBRATED',
  CALIBRATION_DUE:      'CALIBRATION_DUE',
  OUT_OF_CALIBRATION:   'OUT_OF_CALIBRATION',
});

// ─── SensorStatus ─────────────────────────────────────────────────────────────

const SensorStatus = Object.freeze({
  ONLINE:   'ONLINE',
  OFFLINE:  'OFFLINE',
  FAULT:    'FAULT',
  STANDBY:  'STANDBY',
  DISABLED: 'DISABLED',
});

// ─── VirtualSensorRegistry ────────────────────────────────────────────────────

class VirtualSensorRegistry {
  constructor() {
    // sensor_id → sensor definition object
    this._sensors = new Map();
    // cage_id → sensor_id[]
    this._byCage  = new Map();
  }

  /**
   * Register a virtual sensor.
   *
   * @param {object} def  Sensor definition (see schema below)
   * @returns {VirtualSensorRegistry} (chainable)
   *
   * Required fields: sensor_id, device_id, site_id, cage_id, parameter
   * Optional:        unit, sampling_interval_s, depth_m, status,
   *                  calibration_state, bias, drift_per_day
   */
  registerSensor(def) {
    if (!def.sensor_id)  throw new Error('registerSensor: sensor_id is required.');
    if (!def.device_id)  throw new Error('registerSensor: device_id is required.');
    if (!def.site_id)    throw new Error('registerSensor: site_id is required.');
    if (!def.cage_id)    throw new Error('registerSensor: cage_id is required.');
    if (!def.parameter)  throw new Error('registerSensor: parameter is required.');

    const spec = SENSOR_SPECS[def.parameter] || {};

    const entry = {
      sensor_id:           def.sensor_id,
      device_id:           def.device_id,
      site_id:             def.site_id,
      cage_id:             def.cage_id,
      parameter:           def.parameter,
      unit:                def.unit       ?? spec.unit       ?? null,
      physical_field:      spec.physical_field ?? def.parameter,
      noise_std:           def.noise_std  ?? spec.noise_std  ?? 0.01,
      bias:                def.bias       ?? 0,
      bias_range:          def.bias_range ?? spec.bias_range ?? [0, 0],
      drift_per_day:       def.drift_per_day ?? spec.drift_rate ?? 0,
      sampling_interval_s: def.sampling_interval_s ?? Math.round(1 / (spec.sampling_hz ?? (1/60))),
      depth_m:             def.depth_m    ?? null,
      range_min:           spec.range_min ?? null,
      range_max:           spec.range_max ?? null,
      resolution:          spec.resolution ?? 0.01,
      status:              def.status ?? SensorStatus.ONLINE,
      calibration_state:   def.calibration_state ?? CalibrationState.CALIBRATED,
      source:              DataSource.SIMULATION,
      // accumulated drift (updated by engine per-step)
      _accumulated_drift:  0,
      // last reading cache
      last_reading:        null,
    };

    this._sensors.set(entry.sensor_id, entry);

    if (!this._byCage.has(entry.cage_id)) this._byCage.set(entry.cage_id, []);
    this._byCage.get(entry.cage_id).push(entry.sensor_id);

    return this;
  }

  /** Get a sensor definition by ID (returns null if not found). */
  getSensor(sensor_id) {
    return this._sensors.get(sensor_id) || null;
  }

  /** Get all sensor IDs registered for a cage. */
  getSensorIdsForCage(cage_id) {
    return this._byCage.get(cage_id) || [];
  }

  /** Get all sensor definitions for a cage. */
  getSensorsForCage(cage_id) {
    return this.getSensorIdsForCage(cage_id).map(id => this._sensors.get(id));
  }

  /** Return all registered cage IDs. */
  getCageIds() {
    return [...this._byCage.keys()];
  }

  /** Return all sensor IDs. */
  getAllSensorIds() {
    return [...this._sensors.keys()];
  }

  /** Return total registered sensor count. */
  get count() {
    return this._sensors.size;
  }

  /**
   * Update a sensor's status or calibration_state in-place.
   * Used by the FaultInjector and calibration scheduling.
   */
  updateSensor(sensor_id, patch) {
    const sensor = this._sensors.get(sensor_id);
    if (!sensor) throw new Error(`updateSensor: sensor '${sensor_id}' not found.`);
    Object.assign(sensor, patch);
  }
}

module.exports = { VirtualSensorRegistry, SENSOR_SPECS, CalibrationState, SensorStatus };
