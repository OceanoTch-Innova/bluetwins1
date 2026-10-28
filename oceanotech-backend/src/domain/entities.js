/**
 * entities.js
 * AquaTwins — Domain Entity Definitions (Phase 1).
 *
 * Defines factory functions for all core domain entities.
 * These are plain JavaScript objects (no ORM, no class hierarchy).
 * Each factory validates required fields and assigns defaults.
 *
 * Hierarchy:
 *   Farm → Site → Cage → Cohort → Population
 *
 * Twin identity:
 *   DT-{SITE_ID}-{CAGE_ID}
 *
 * Key design rules:
 *   - Every entity has a stable string ID (not a DB integer).
 *   - Every entity records its created_at (ISO timestamp).
 *   - No entity depends on the frontend Sim{} object.
 *   - All relationships are expressed as IDs, not embedded objects.
 */

'use strict';

const { DataSource, StateType, TwinMode, QualityStatus, ModelStatus } = require('./provenance');

// ─── Helpers ────────────────────────────────────────────────────────────────

function nowISO() {
  return new Date().toISOString();
}

function requireField(obj, name) {
  if (obj[name] === undefined || obj[name] === null) {
    throw new Error(`Entity field '${name}' is required.`);
  }
}

// ─── Farm ────────────────────────────────────────────────────────────────────

/**
 * Farm — top-level organisational unit.
 * A company may operate one or more farms.
 *
 * @param {object} props
 * @returns {object}
 */
function createFarm(props) {
  requireField(props, 'farm_id');
  requireField(props, 'name');
  return {
    farm_id:     props.farm_id,
    name:        props.name,
    company:     props.company     || null,
    country:     props.country     || null,
    region:      props.region      || null,
    species:     props.species     || 'Salmo salar',
    created_at:  props.created_at  || nowISO(),
  };
}

// ─── Site ────────────────────────────────────────────────────────────────────

/**
 * Site — a physical geographic location within a farm.
 * A farm may have multiple sites (e.g. different fjords or bays).
 *
 * @param {object} props
 * @returns {object}
 */
function createSite(props) {
  requireField(props, 'site_id');
  requireField(props, 'farm_id');
  requireField(props, 'name');
  return {
    site_id:     props.site_id,
    farm_id:     props.farm_id,
    name:        props.name,
    latitude:    props.latitude    !== undefined ? props.latitude  : null,
    longitude:   props.longitude   !== undefined ? props.longitude : null,
    depth_m:     props.depth_m     !== undefined ? props.depth_m   : null,
    cage_count:  props.cage_count  || 0,
    created_at:  props.created_at  || nowISO(),
  };
}

// ─── Cage ────────────────────────────────────────────────────────────────────

/**
 * Cage — a physical containment unit (net pen) at a site.
 * Each cage has a unique Digital Twin identity: DT-{site_id}-{cage_id}.
 *
 * @param {object} props
 * @returns {object}
 */
function createCage(props) {
  requireField(props, 'cage_id');
  requireField(props, 'site_id');
  const twin_id = props.twin_id || `DT-${props.site_id}-${props.cage_id}`;
  return {
    cage_id:      props.cage_id,
    site_id:      props.site_id,
    twin_id,
    name:         props.name         || props.cage_id,
    type:         props.type         || 'circular_net_pen',
    diameter_m:   props.diameter_m   !== undefined ? props.diameter_m   : null,
    depth_m:      props.depth_m      !== undefined ? props.depth_m      : null,
    // Volume defaults to null; use MODEL_CONFIG.DEFAULT_CAGE_VOL_M3 as fallback
    volume_m3:    props.volume_m3    !== undefined ? props.volume_m3    : null,
    status:       props.status       || 'ACTIVE',     // ACTIVE | FALLOW | MAINTENANCE
    created_at:   props.created_at   || nowISO(),
  };
}

// ─── Cohort ──────────────────────────────────────────────────────────────────

/**
 * Cohort — a population of fish stocked in a cage at a specific time.
 * A cage may have at most one active cohort at a time.
 *
 * @param {object} props
 * @returns {object}
 */
function createCohort(props) {
  requireField(props, 'cohort_id');
  requireField(props, 'cage_id');
  requireField(props, 'site_id');
  return {
    cohort_id:         props.cohort_id,
    cage_id:           props.cage_id,
    site_id:           props.site_id,
    species:           props.species           || 'Salmo salar',
    strain:            props.strain            || null,
    stocking_date:     props.stocking_date     || null,
    expected_harvest:  props.expected_harvest  || null,
    initial_count:     props.initial_count     !== undefined ? props.initial_count    : null,
    initial_weight_g:  props.initial_weight_g  !== undefined ? props.initial_weight_g : null,
    status:            props.status            || 'ACTIVE',  // ACTIVE | HARVESTED | TERMINATED
    created_at:        props.created_at        || nowISO(),
  };
}

// ─── Device ──────────────────────────────────────────────────────────────────

/**
 * Device — a physical or virtual instrument installed at a cage.
 *
 * @param {object} props
 * @returns {object}
 */
function createDevice(props) {
  requireField(props, 'device_id');
  requireField(props, 'site_id');
  requireField(props, 'cage_id');
  return {
    device_id:        props.device_id,
    site_id:          props.site_id,
    cage_id:          props.cage_id,
    name:             props.name             || props.device_id,
    type:             props.type             || 'MULTI_PARAMETER_PROBE',
    manufacturer:     props.manufacturer     || null,
    model:            props.model            || null,
    firmware_version: props.firmware_version || null,
    // 'VIRTUAL' means it is a simulated device; 'PHYSICAL' is a real sensor
    device_kind:      props.device_kind      || 'VIRTUAL',
    status:           props.status           || 'ACTIVE',  // ACTIVE | OFFLINE | CALIBRATION | MAINTENANCE
    calibrated_at:    props.calibrated_at    || null,
    installed_at:     props.installed_at     || null,
    created_at:       props.created_at       || nowISO(),
  };
}

// ─── Sensor ──────────────────────────────────────────────────────────────────

/**
 * Sensor — one measurement channel on a device.
 * A single device may carry multiple sensor channels (e.g. DO + temperature + salinity).
 *
 * @param {object} props
 * @returns {object}
 */
function createSensor(props) {
  requireField(props, 'sensor_id');
  requireField(props, 'device_id');
  requireField(props, 'parameter');
  return {
    sensor_id:        props.sensor_id,
    device_id:        props.device_id,
    parameter:        props.parameter,   // e.g. 'dissolved_oxygen', 'temperature'
    unit:             props.unit         || null,
    range_min:        props.range_min    !== undefined ? props.range_min : null,
    range_max:        props.range_max    !== undefined ? props.range_max : null,
    accuracy:         props.accuracy     || null,
    calibration_date: props.calibration_date || null,
    status:           props.status       || 'ACTIVE',
    source:           props.source       || DataSource.SIMULATION,
    created_at:       props.created_at   || nowISO(),
  };
}

// ─── Reading ─────────────────────────────────────────────────────────────────

/**
 * Reading — a single time-stamped measurement from a sensor.
 * Every reading carries full provenance and quality metadata.
 *
 * @param {object} props
 * @returns {object}
 */
function createReading(props) {
  requireField(props, 'reading_id');
  requireField(props, 'device_id');
  requireField(props, 'parameter');
  if (props.value === undefined || props.value === null) {
    throw new Error("Entity field 'value' is required.");
  }
  return {
    reading_id:          props.reading_id,
    device_id:           props.device_id,
    sensor_id:           props.sensor_id           || null,
    site_id:             props.site_id             || null,
    cage_id:             props.cage_id             || null,
    parameter:           props.parameter,
    value:               Number(props.value),
    unit:                props.unit                || null,
    timestamp:           props.timestamp           || nowISO(),
    received_at:         props.received_at         || nowISO(),
    source:              props.source              || DataSource.SIMULATION,
    quality_score:       props.quality_score       !== undefined ? props.quality_score : null,
    quality_status:      props.quality_status      || QualityStatus.SIMULATED,
    validation_errors:   props.validation_errors   || [],
    validation_warnings: props.validation_warnings || [],
  };
}

// ─── Event (base) ────────────────────────────────────────────────────────────

/**
 * Event — any discrete operational event recorded at a cage.
 *
 * @param {object} props
 * @returns {object}
 */
function createEvent(props) {
  requireField(props, 'event_id');
  requireField(props, 'cage_id');
  requireField(props, 'event_type');
  return {
    event_id:    props.event_id,
    cage_id:     props.cage_id,
    cohort_id:   props.cohort_id   || null,
    site_id:     props.site_id     || null,
    event_type:  props.event_type,  // FEEDING | MORTALITY | SAMPLING | STOCKING | HARVEST | TREATMENT | SENSOR_CAL | EQUIPMENT_FAILURE | STORM | ENV_EVENT
    timestamp:   props.timestamp   || nowISO(),
    source:      props.source      || DataSource.MANUAL,
    description: props.description || null,
    metadata:    props.metadata    || {},
    created_at:  props.created_at  || nowISO(),
  };
}

// ─── FeedingEvent ────────────────────────────────────────────────────────────

function createFeedingEvent(props) {
  const base = createEvent({ ...props, event_type: 'FEEDING' });
  return {
    ...base,
    feed_kg:         props.feed_kg         !== undefined ? props.feed_kg    : null,
    feed_type:       props.feed_type        || null,
    fcr_target:      props.fcr_target       !== undefined ? props.fcr_target : null,
    feeding_rate_pct:props.feeding_rate_pct !== undefined ? props.feeding_rate_pct : null,
  };
}

// ─── MortalityEvent ──────────────────────────────────────────────────────────

function createMortalityEvent(props) {
  const base = createEvent({ ...props, event_type: 'MORTALITY' });
  return {
    ...base,
    fish_count:   props.fish_count !== undefined ? props.fish_count : null,
    cause:        props.cause      || null,   // e.g. 'HYPOXIA', 'DISEASE', 'MECHANICAL', 'UNKNOWN'
    avg_weight_g: props.avg_weight_g !== undefined ? props.avg_weight_g : null,
  };
}

// ─── SamplingEvent ───────────────────────────────────────────────────────────

function createSamplingEvent(props) {
  const base = createEvent({ ...props, event_type: 'SAMPLING' });
  return {
    ...base,
    fish_sampled:   props.fish_sampled   !== undefined ? props.fish_sampled   : null,
    avg_weight_g:   props.avg_weight_g   !== undefined ? props.avg_weight_g   : null,
    std_weight_g:   props.std_weight_g   !== undefined ? props.std_weight_g   : null,
    condition_factor:props.condition_factor !== undefined ? props.condition_factor : null,
  };
}

// ─── HarvestEvent ────────────────────────────────────────────────────────────

function createHarvestEvent(props) {
  const base = createEvent({ ...props, event_type: 'HARVEST' });
  return {
    ...base,
    fish_count:   props.fish_count   !== undefined ? props.fish_count   : null,
    total_kg:     props.total_kg     !== undefined ? props.total_kg     : null,
    avg_weight_g: props.avg_weight_g !== undefined ? props.avg_weight_g : null,
    partial:      props.partial      !== undefined ? props.partial      : false,
  };
}

// ─── ObservedState ───────────────────────────────────────────────────────────

/**
 * ObservedState — environmental and biological measurements as received.
 * Values come from sensors or simulation; they are NOT model outputs.
 *
 * Each parameter is an ObservedValue: { value, unit, source, quality }.
 */
function createObservedValue(value, unit, source, quality) {
  return {
    value:   value !== undefined ? Number(value) : null,
    unit:    unit   || null,
    source:  source || DataSource.SIMULATION,
    quality: quality !== undefined ? Number(quality) : null,
  };
}

function createObservedState(props) {
  return {
    state_type: StateType.OBSERVED,
    timestamp:  props.timestamp  || nowISO(),
    source:     props.source     || DataSource.SIMULATION,
    // Environmental
    temperature:       createObservedValue(props.temperature,       '°C',    props.source, props.temperature_q),
    dissolved_oxygen:  createObservedValue(props.dissolved_oxygen,  'mg/L',  props.source, props.dissolved_oxygen_q),
    salinity:          createObservedValue(props.salinity,          'PSU',   props.source, props.salinity_q),
    pH:                createObservedValue(props.pH,                null,    props.source, props.pH_q),
    ammonia:           createObservedValue(props.ammonia,           'mg/L',  props.source, props.ammonia_q),
    turbidity:         createObservedValue(props.turbidity,         'NTU',   props.source, props.turbidity_q),
    flow:              createObservedValue(props.flow,              'L/min', props.source, props.flow_q),
  };
}

// ─── EstimatedState ──────────────────────────────────────────────────────────

/**
 * EstimatedState — values inferred by the State Estimation Engine.
 * Combines observed data + model prediction + historical state.
 * Each value carries a method label (how it was estimated).
 */
function createEstimatedValue(value, unit, method, confidence) {
  return {
    value:      value !== undefined ? Number(value) : null,
    unit:       unit       || null,
    source:     DataSource.ESTIMATED,
    method:     method     || 'UNKNOWN',
    confidence: confidence !== undefined ? Number(confidence) : null,
  };
}

function createEstimatedState(props) {
  return {
    state_type:        StateType.ESTIMATED,
    timestamp:         props.timestamp         || nowISO(),
    population_count:  props.population_count  !== undefined
      ? createEstimatedValue(props.population_count, 'fish', props.population_method || 'TGC_mortality', props.population_confidence)
      : null,
    biomass_t:         props.biomass_t         !== undefined
      ? createEstimatedValue(props.biomass_t,  't',     props.biomass_method || 'TGC_model', props.biomass_confidence)
      : null,
    avg_weight_g:      props.avg_weight_g      !== undefined
      ? createEstimatedValue(props.avg_weight_g, 'g',   props.weight_method || 'TGC_model', props.weight_confidence)
      : null,
    dissolved_oxygen:  props.dissolved_oxygen  !== undefined
      ? createEstimatedValue(props.dissolved_oxygen, 'mg/L', props.do_method || 'weighted_correction', null)
      : null,
  };
}

// ─── PredictedState ──────────────────────────────────────────────────────────

/**
 * PredictedState — a single forecast horizon output.
 * Prediction is SEPARATE from the current twin state.
 */
function createPredictedValue(value, unit, horizon_h, confidence) {
  return {
    value:      value !== undefined ? Number(value) : null,
    unit:       unit   || null,
    source:     DataSource.PREDICTED,
    horizon_h:  horizon_h  !== undefined ? Number(horizon_h)  : null,
    confidence: confidence !== undefined ? Number(confidence) : null,
  };
}

function createPredictedState(props) {
  requireField(props, 'horizon_h');
  return {
    state_type:        StateType.PREDICTED,
    timestamp:         props.timestamp         || nowISO(),
    horizon_h:         props.horizon_h,
    dissolved_oxygen:  props.dissolved_oxygen  !== undefined
      ? createPredictedValue(props.dissolved_oxygen, 'mg/L', props.horizon_h, props.do_confidence)
      : null,
    biomass_t:         props.biomass_t         !== undefined
      ? createPredictedValue(props.biomass_t, 't', props.horizon_h, props.biomass_confidence)
      : null,
    avg_weight_g:      props.avg_weight_g      !== undefined
      ? createPredictedValue(props.avg_weight_g, 'g', props.horizon_h, props.weight_confidence)
      : null,
    harvest_date:      props.harvest_date      || null,
    days_to_harvest:   props.days_to_harvest   !== undefined ? props.days_to_harvest : null,
  };
}

// ─── TwinState ───────────────────────────────────────────────────────────────

/**
 * TwinState — the authoritative state of a Digital Twin at a point in time.
 *
 * IMPORTANT: TwinState is NOT the same as SimulationState.
 * - SimulationState lives inside the PhysicalSystemSimulator (future Phase 2).
 * - TwinState is the output of the DigitalTwinEngine after processing observations.
 *
 * @param {object} props
 * @returns {object}
 */
function createTwinState(props) {
  requireField(props, 'twin_id');
  requireField(props, 'cage_id');
  requireField(props, 'site_id');
  return {
    twin_id:       props.twin_id,
    site_id:       props.site_id,
    cage_id:       props.cage_id,
    cohort_id:     props.cohort_id   || null,
    species:       props.species     || 'Salmo salar',
    mode:          props.mode        || TwinMode.SIMULATION,

    timestamp:     props.timestamp   || nowISO(),
    // state_version increments with each update; enables audit trail
    state_version: props.state_version !== undefined ? props.state_version : 0,

    // Distinct state layers — do NOT mix them
    observed_state:  props.observed_state  || null,
    estimated_state: props.estimated_state || null,
    predicted_states: props.predicted_states || [],  // array of PredictedState for each horizon

    // Population & biomass (estimated values)
    population: {
      count:          props.population?.count          !== undefined ? props.population.count        : null,
      mortality_daily:props.population?.mortality_daily !== undefined ? props.population.mortality_daily : null,
      source:         props.population?.source         || DataSource.SIMULATION,
    },
    biomass: {
      total_t:        props.biomass?.total_t        !== undefined ? props.biomass.total_t        : null,
      uncertainty_t:  props.biomass?.uncertainty_t  !== undefined ? props.biomass.uncertainty_t  : null,
      confidence:     props.biomass?.confidence     !== undefined ? props.biomass.confidence     : null,
      density_kg_m3:  props.biomass?.density_kg_m3  !== undefined ? props.biomass.density_kg_m3  : null,
      source:         props.biomass?.source         || DataSource.SIMULATION,
    },
    growth: {
      weight_g:        props.growth?.weight_g        !== undefined ? props.growth.weight_g        : null,
      SGR_pct_day:     props.growth?.SGR_pct_day     !== undefined ? props.growth.SGR_pct_day     : null,
      TGC_effective:   props.growth?.TGC_effective   !== undefined ? props.growth.TGC_effective   : null,
      days_to_harvest: props.growth?.days_to_harvest !== undefined ? props.growth.days_to_harvest : null,
      source:          props.growth?.source          || DataSource.SIMULATION,
    },
    feeding: {
      daily_kg: props.feeding?.daily_kg !== undefined ? props.feeding.daily_kg : null,
      FCR_base: props.feeding?.FCR_base !== undefined ? props.feeding.FCR_base : null,
      source:   props.feeding?.source   || DataSource.SIMULATION,
    },
    health: {
      index:      props.health?.index      !== undefined ? props.health.index      : null,
      risk_level: props.health?.risk_level || null,
      f_total:    props.health?.f_total    !== undefined ? props.health.f_total    : null,
      stress_factors: props.health?.stress_factors || null,
      source:     props.health?.source     || DataSource.SIMULATION,
    },

    data_quality:     props.data_quality    !== undefined ? props.data_quality    : null,
    twin_confidence:  props.twin_confidence !== undefined ? props.twin_confidence : null,
    last_sync:        props.last_sync       || nowISO(),

    // Reason for this state update (audit trail)
    update_reason: props.update_reason || null,
  };
}

// ─── Prediction ──────────────────────────────────────────────────────────────

/**
 * Prediction — a stored forecast record, separate from the current TwinState.
 */
function createPrediction(props) {
  requireField(props, 'prediction_id');
  requireField(props, 'twin_id');
  return {
    prediction_id:  props.prediction_id,
    twin_id:        props.twin_id,
    cage_id:        props.cage_id     || null,
    model_version:  props.model_version || 'UNKNOWN',
    timestamp:      props.timestamp   || nowISO(),
    horizon_h:      props.horizon_h,          // e.g. 6, 12, 24, 72, 168 (7d), 720 (30d)
    inputs:         props.inputs      || {},   // snapshot of inputs used
    outputs:        props.outputs     || {},   // predicted values
    confidence:     props.confidence  !== undefined ? props.confidence : null,
    source:         DataSource.PREDICTED,
  };
}

// ─── Scenario ────────────────────────────────────────────────────────────────

/**
 * Scenario — a what-if simulation configuration.
 * Scenarios produce a Baseline vs Scenario comparison.
 * Scenario is NOT the same as a Prediction.
 */
function createScenario(props) {
  requireField(props, 'scenario_id');
  requireField(props, 'name');
  return {
    scenario_id:   props.scenario_id,
    twin_id:       props.twin_id     || null,
    cage_id:       props.cage_id     || null,
    name:          props.name,
    description:   props.description || null,
    // Configurable environmental overrides
    parameters:    props.parameters  || {
      temperature:      null,
      dissolved_oxygen: null,
      pH:               null,
      ammonia:          null,
      turbidity:        null,
      flow:             null,
      salinity:         null,
    },
    duration_days: props.duration_days !== undefined ? props.duration_days : null,
    baseline:      props.baseline    || null,   // TwinState snapshot at scenario start
    result:        props.result      || null,   // Comparison object (populated after run)
    status:        props.status      || 'DRAFT', // DRAFT | RUNNING | COMPLETE
    created_at:    props.created_at  || nowISO(),
  };
}

// ─── Alert ───────────────────────────────────────────────────────────────────

/**
 * Alert — a triggered condition requiring operator attention.
 */
function createAlert(props) {
  requireField(props, 'alert_id');
  requireField(props, 'cage_id');
  requireField(props, 'alert_type');
  requireField(props, 'message');
  return {
    alert_id:           props.alert_id,
    cage_id:            props.cage_id,
    site_id:            props.site_id          || null,
    twin_id:            props.twin_id          || null,
    // THRESHOLD | TREND | ANOMALY | FORECAST | MODEL_DISAGREEMENT
    alert_type:         props.alert_type,
    // LOW | MEDIUM | HIGH | CRITICAL
    severity:           props.severity         || 'MEDIUM',
    timestamp:          props.timestamp        || nowISO(),
    message:            props.message,
    root_cause:         props.root_cause       || null,
    confidence:         props.confidence       !== undefined ? props.confidence : null,
    recommended_action: props.recommended_action || null,
    // Explainability: array of { factor, contribution_pct }
    drivers:            props.drivers          || [],
    acknowledged:       props.acknowledged     !== undefined ? props.acknowledged : false,
    acknowledged_at:    props.acknowledged_at  || null,
    source:             props.source           || DataSource.SIMULATION,
  };
}

// ─── ModelVersion ────────────────────────────────────────────────────────────

/**
 * ModelVersion — entry in the model registry.
 * Status must be EXPERIMENTAL unless validation evidence exists.
 */
function createModelVersion(props) {
  requireField(props, 'model_id');
  requireField(props, 'name');
  requireField(props, 'version');
  return {
    model_id:        props.model_id,
    name:            props.name,
    version:         props.version,
    description:     props.description  || null,
    species:         props.species      || 'Salmo salar',
    dataset:         props.dataset      || null,
    training_date:   props.training_date || null,
    validation_date: props.validation_date || null,
    metrics:         props.metrics      || {},    // MAE, RMSE, MAPE, Bias, R²
    // EXPERIMENTAL | CALIBRATION_PENDING | VALIDATED | PRODUCTION | DEPRECATED
    status:          props.status       || ModelStatus.EXPERIMENTAL,
    created_at:      props.created_at   || nowISO(),
  };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  createFarm,
  createSite,
  createCage,
  createCohort,
  createDevice,
  createSensor,
  createReading,
  createEvent,
  createFeedingEvent,
  createMortalityEvent,
  createSamplingEvent,
  createHarvestEvent,
  createObservedValue,
  createObservedState,
  createEstimatedValue,
  createEstimatedState,
  createPredictedValue,
  createPredictedState,
  createTwinState,
  createPrediction,
  createScenario,
  createAlert,
  createModelVersion,
};
