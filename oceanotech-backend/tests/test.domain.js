
/**
 * test.domain.js
 * AquaTwins — Phase 1 Domain Model Unit Tests
 *
 * Run with:
 *   cd oceanotech-backend
 *   node tests/test.domain.js
 *
 * No external test runner required — uses Node.js built-in assert module.
 * Exit code 0 = all passed, non-zero = failures.
 */

'use strict';

const assert = require('assert');
const path   = require('path');

// ─── Load domain modules ─────────────────────────────────────────────────────

const {
  MODEL_CONFIG,
} = require(path.join(__dirname, '../src/domain/modelConfig'));

const {
  DataSource, StateType, TwinMode, QualityStatus, ModelStatus,
} = require(path.join(__dirname, '../src/domain/provenance'));

const {
  createFarm, createSite, createCage, createCohort,
  createDevice, createSensor, createReading,
  createEvent, createFeedingEvent, createMortalityEvent,
  createSamplingEvent, createHarvestEvent,
  createObservedState, createEstimatedState,
  createPredictedState, createTwinState,
  createPrediction, createScenario, createAlert, createModelVersion,
} = require(path.join(__dirname, '../src/domain/entities'));

const {
  DEMO_FARM, DEMO_SITES, DEMO_CAGES, DEMO_COHORTS,
  DEMO_DEVICES, DEMO_SENSORS,
  getCageByTwinId, getCagesBySite, getActiveCohort,
  getDevicesForCage, getSensorsForCage,
  DEFAULT_TWIN_ID, DEFAULT_CAGE_ID, DEFAULT_SITE_ID, DEFAULT_COHORT_ID,
} = require(path.join(__dirname, '../src/domain/seedData'));

// ─── Minimal test framework ───────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${err.message}`);
    failed++;
    failures.push({ name, error: err.message });
  }
}

function suite(name, fn) {
  console.log(`\n── ${name} ──────────────────────────────────────────────`);
  fn();
}

// ─── Test Suites ─────────────────────────────────────────────────────────────

suite('MODEL_CONFIG — shared constants', () => {
  test('exports a frozen object', () => {
    assert.ok(Object.isFrozen(MODEL_CONFIG));
  });
  test('TGC is 2.85 (Salmo salar marine phase)', () => {
    assert.strictEqual(MODEL_CONFIG.TGC, 2.85);
  });
  test('T_OPT is 14.0°C', () => {
    assert.strictEqual(MODEL_CONFIG.T_OPT, 14.0);
  });
  test('DO_CRIT is 4.0 mg/L', () => {
    assert.strictEqual(MODEL_CONFIG.DO_CRIT, 4.0);
  });
  test('DO_LETHAL is less than DO_CRIT', () => {
    assert.ok(MODEL_CONFIG.DO_LETHAL < MODEL_CONFIG.DO_CRIT);
  });
  test('NH3_SUB is less than NH3_LET', () => {
    assert.ok(MODEL_CONFIG.NH3_SUB < MODEL_CONFIG.NH3_LET);
  });
  test('PH_LO is within PH_MIN..PH_MAX', () => {
    assert.ok(MODEL_CONFIG.PH_LO > MODEL_CONFIG.PH_MIN);
    assert.ok(MODEL_CONFIG.PH_LO < MODEL_CONFIG.PH_MAX);
  });
  test('PARAMETER_RANGES includes dissolved_oxygen', () => {
    assert.ok('dissolved_oxygen' in MODEL_CONFIG.PARAMETER_RANGES);
  });
  test('PARAMETER_RANGES has min < max for each parameter', () => {
    for (const [param, rule] of Object.entries(MODEL_CONFIG.PARAMETER_RANGES)) {
      assert.ok(rule.min < rule.max, `${param}: min(${rule.min}) must be < max(${rule.max})`);
    }
  });
  test('SENSOR_NOISE is frozen and has temperature key', () => {
    assert.ok(Object.isFrozen(MODEL_CONFIG.SENSOR_NOISE));
    assert.ok('temperature' in MODEL_CONFIG.SENSOR_NOISE);
  });
  test('DEFAULT_CAGE_VOL_M3 is a positive number', () => {
    assert.ok(MODEL_CONFIG.DEFAULT_CAGE_VOL_M3 > 0);
  });
});

suite('Provenance — enums', () => {
  test('DataSource.SIMULATION equals "SIMULATION"', () => {
    assert.strictEqual(DataSource.SIMULATION, 'SIMULATION');
  });
  test('DataSource contains ESTIMATED and PREDICTED', () => {
    assert.ok('ESTIMATED' in DataSource);
    assert.ok('PREDICTED' in DataSource);
  });
  test('TwinMode contains SIMULATION, HYBRID, LIVE, OFFLINE, DEGRADED', () => {
    ['SIMULATION', 'HYBRID', 'LIVE', 'OFFLINE', 'DEGRADED'].forEach(m => {
      assert.ok(m in TwinMode, `TwinMode missing: ${m}`);
    });
  });
  test('QualityStatus contains VALID, INVALID, SIMULATED', () => {
    ['VALID', 'INVALID', 'SIMULATED'].forEach(s => {
      assert.ok(s in QualityStatus, `QualityStatus missing: ${s}`);
    });
  });
  test('ModelStatus defaults to EXPERIMENTAL for new models', () => {
    assert.strictEqual(ModelStatus.EXPERIMENTAL, 'EXPERIMENTAL');
  });
  test('ModelStatus does not have a numeric "VALIDATED = 1" pattern (must be strings)', () => {
    for (const v of Object.values(ModelStatus)) {
      assert.strictEqual(typeof v, 'string');
    }
  });
  test('StateType has OBSERVED, ESTIMATED, PREDICTED, SIMULATED', () => {
    ['OBSERVED', 'ESTIMATED', 'PREDICTED', 'SIMULATED'].forEach(t => {
      assert.ok(t in StateType, `StateType missing: ${t}`);
    });
  });
});

suite('createFarm', () => {
  test('creates a valid farm with required fields', () => {
    const f = createFarm({ farm_id: 'F1', name: 'Test Farm' });
    assert.strictEqual(f.farm_id, 'F1');
    assert.strictEqual(f.name, 'Test Farm');
    assert.strictEqual(f.species, 'Salmo salar');
    assert.ok(f.created_at);
  });
  test('throws if farm_id is missing', () => {
    assert.throws(() => createFarm({ name: 'No ID' }), /farm_id/);
  });
  test('throws if name is missing', () => {
    assert.throws(() => createFarm({ farm_id: 'F1' }), /name/);
  });
  test('accepts optional fields', () => {
    const f = createFarm({ farm_id: 'F2', name: 'Farm', company: 'Acme', country: 'CL' });
    assert.strictEqual(f.company, 'Acme');
    assert.strictEqual(f.country, 'CL');
  });
});

suite('createSite', () => {
  test('creates a valid site', () => {
    const s = createSite({ site_id: 'S1', farm_id: 'F1', name: 'Site A' });
    assert.strictEqual(s.site_id, 'S1');
    assert.strictEqual(s.farm_id, 'F1');
    assert.strictEqual(s.cage_count, 0);
  });
  test('throws if site_id is missing', () => {
    assert.throws(() => createSite({ farm_id: 'F1', name: 'X' }), /site_id/);
  });
  test('throws if farm_id is missing', () => {
    assert.throws(() => createSite({ site_id: 'S1', name: 'X' }), /farm_id/);
  });
  test('latitude and longitude default to null', () => {
    const s = createSite({ site_id: 'S2', farm_id: 'F1', name: 'X' });
    assert.strictEqual(s.latitude, null);
    assert.strictEqual(s.longitude, null);
  });
});

suite('createCage', () => {
  test('creates cage with generated twin_id', () => {
    const c = createCage({ cage_id: 'C07', site_id: 'SITE01' });
    assert.strictEqual(c.twin_id, 'DT-SITE01-C07');
  });
  test('respects an explicit twin_id', () => {
    const c = createCage({ cage_id: 'C07', site_id: 'SITE01', twin_id: 'CUSTOM-TWIN' });
    assert.strictEqual(c.twin_id, 'CUSTOM-TWIN');
  });
  test('status defaults to ACTIVE', () => {
    const c = createCage({ cage_id: 'C1', site_id: 'S1' });
    assert.strictEqual(c.status, 'ACTIVE');
  });
  test('throws if cage_id is missing', () => {
    assert.throws(() => createCage({ site_id: 'S1' }), /cage_id/);
  });
  test('throws if site_id is missing', () => {
    assert.throws(() => createCage({ cage_id: 'C1' }), /site_id/);
  });
  test('volume_m3 defaults to null when not provided', () => {
    const c = createCage({ cage_id: 'C1', site_id: 'S1' });
    assert.strictEqual(c.volume_m3, null);
  });
});

suite('createCohort', () => {
  test('creates a valid cohort', () => {
    const c = createCohort({ cohort_id: '2026-A', cage_id: 'CAGE07', site_id: 'SITE01' });
    assert.strictEqual(c.cohort_id, '2026-A');
    assert.strictEqual(c.status, 'ACTIVE');
    assert.strictEqual(c.species, 'Salmo salar');
  });
  test('throws if cohort_id is missing', () => {
    assert.throws(() => createCohort({ cage_id: 'C1', site_id: 'S1' }), /cohort_id/);
  });
  test('initial values default to null', () => {
    const c = createCohort({ cohort_id: 'X', cage_id: 'C1', site_id: 'S1' });
    assert.strictEqual(c.initial_count, null);
    assert.strictEqual(c.initial_weight_g, null);
  });
});

suite('createDevice', () => {
  test('creates a VIRTUAL device by default', () => {
    const d = createDevice({ device_id: 'D1', site_id: 'S1', cage_id: 'C1' });
    assert.strictEqual(d.device_kind, 'VIRTUAL');
    assert.strictEqual(d.status, 'ACTIVE');
  });
  test('accepts PHYSICAL device kind', () => {
    const d = createDevice({ device_id: 'D2', site_id: 'S1', cage_id: 'C1', device_kind: 'PHYSICAL' });
    assert.strictEqual(d.device_kind, 'PHYSICAL');
  });
  test('throws if device_id is missing', () => {
    assert.throws(() => createDevice({ site_id: 'S1', cage_id: 'C1' }), /device_id/);
  });
});

suite('createSensor', () => {
  test('creates a sensor with SIMULATION source by default', () => {
    const s = createSensor({ sensor_id: 'SN1', device_id: 'D1', parameter: 'temperature' });
    assert.strictEqual(s.source, DataSource.SIMULATION);
  });
  test('throws if sensor_id is missing', () => {
    assert.throws(() => createSensor({ device_id: 'D1', parameter: 'temperature' }), /sensor_id/);
  });
  test('throws if parameter is missing', () => {
    assert.throws(() => createSensor({ sensor_id: 'SN1', device_id: 'D1' }), /parameter/);
  });
});

suite('createReading', () => {
  test('creates a valid reading with provenance', () => {
    const r = createReading({
      reading_id: 'R1', device_id: 'D1', parameter: 'dissolved_oxygen',
      value: 8.5, unit: 'mg/L', source: DataSource.SIMULATION,
    });
    assert.strictEqual(r.value, 8.5);
    assert.strictEqual(r.source, 'SIMULATION');
    assert.deepStrictEqual(r.validation_errors, []);
  });
  test('coerces value to Number', () => {
    const r = createReading({ reading_id: 'R2', device_id: 'D1', parameter: 'pH', value: '7.8' });
    assert.strictEqual(typeof r.value, 'number');
    assert.strictEqual(r.value, 7.8);
  });
  test('throws if value is missing', () => {
    assert.throws(() => createReading({ reading_id: 'R3', device_id: 'D1', parameter: 'pH' }), /value/);
  });
  test('defaults quality_status to SIMULATED', () => {
    const r = createReading({ reading_id: 'R4', device_id: 'D1', parameter: 'pH', value: 7.5 });
    assert.strictEqual(r.quality_status, QualityStatus.SIMULATED);
  });
});

suite('Event family', () => {
  test('createEvent produces an event with required fields', () => {
    const e = createEvent({ event_id: 'E1', cage_id: 'CAGE07', event_type: 'MORTALITY' });
    assert.strictEqual(e.event_type, 'MORTALITY');
    assert.strictEqual(e.source, DataSource.MANUAL);
    assert.deepStrictEqual(e.metadata, {});
  });
  test('createFeedingEvent sets event_type to FEEDING', () => {
    const e = createFeedingEvent({ event_id: 'E2', cage_id: 'CAGE07', feed_kg: 120 });
    assert.strictEqual(e.event_type, 'FEEDING');
    assert.strictEqual(e.feed_kg, 120);
  });
  test('createMortalityEvent sets event_type to MORTALITY', () => {
    const e = createMortalityEvent({ event_id: 'E3', cage_id: 'CAGE07', fish_count: 15, cause: 'HYPOXIA' });
    assert.strictEqual(e.event_type, 'MORTALITY');
    assert.strictEqual(e.cause, 'HYPOXIA');
  });
  test('createSamplingEvent sets event_type to SAMPLING', () => {
    const e = createSamplingEvent({ event_id: 'E4', cage_id: 'CAGE07', fish_sampled: 50, avg_weight_g: 412 });
    assert.strictEqual(e.event_type, 'SAMPLING');
    assert.strictEqual(e.avg_weight_g, 412);
  });
  test('createHarvestEvent sets event_type to HARVEST', () => {
    const e = createHarvestEvent({ event_id: 'E5', cage_id: 'CAGE07', fish_count: 49500, total_kg: 247.5 });
    assert.strictEqual(e.event_type, 'HARVEST');
    assert.strictEqual(e.partial, false);
  });
  test('createEvent throws if event_id is missing', () => {
    assert.throws(() => createEvent({ cage_id: 'C1', event_type: 'FEEDING' }), /event_id/);
  });
  test('createEvent throws if event_type is missing', () => {
    assert.throws(() => createEvent({ event_id: 'E6', cage_id: 'C1' }), /event_type/);
  });
});

suite('ObservedState', () => {
  test('createObservedState has state_type OBSERVED', () => {
    const s = createObservedState({ temperature: 12.5, dissolved_oxygen: 8.2, source: DataSource.SIMULATION });
    assert.strictEqual(s.state_type, StateType.OBSERVED);
  });
  test('each parameter has value, unit, source, quality', () => {
    const s = createObservedState({ temperature: 12.5, temperature_q: 97, source: DataSource.SIMULATION });
    assert.strictEqual(s.temperature.value, 12.5);
    assert.strictEqual(s.temperature.unit, '°C');
    assert.strictEqual(s.temperature.source, DataSource.SIMULATION);
    assert.strictEqual(s.temperature.quality, 97);
  });
  test('source defaults to SIMULATION', () => {
    const s = createObservedState({ temperature: 10 });
    assert.strictEqual(s.source, DataSource.SIMULATION);
    assert.strictEqual(s.temperature.source, DataSource.SIMULATION);
  });
  test('missing parameters produce null values (not undefined)', () => {
    const s = createObservedState({});
    assert.strictEqual(s.temperature.value, null);
  });
});

suite('EstimatedState', () => {
  test('createEstimatedState has state_type ESTIMATED', () => {
    const s = createEstimatedState({ biomass_t: 186.4 });
    assert.strictEqual(s.state_type, StateType.ESTIMATED);
  });
  test('biomass_t has source ESTIMATED', () => {
    const s = createEstimatedState({ biomass_t: 186.4, biomass_method: 'TGC_model', biomass_confidence: 0.91 });
    assert.strictEqual(s.biomass_t.source, DataSource.ESTIMATED);
    assert.strictEqual(s.biomass_t.method, 'TGC_model');
    assert.strictEqual(s.biomass_t.confidence, 0.91);
  });
  test('missing values produce null (not undefined)', () => {
    const s = createEstimatedState({});
    assert.strictEqual(s.biomass_t, null);
  });
});

suite('PredictedState', () => {
  test('createPredictedState requires horizon_h', () => {
    assert.throws(() => createPredictedState({}), /horizon_h/);
  });
  test('has state_type PREDICTED', () => {
    const s = createPredictedState({ horizon_h: 6 });
    assert.strictEqual(s.state_type, StateType.PREDICTED);
  });
  test('dissolved_oxygen has source PREDICTED and correct horizon', () => {
    const s = createPredictedState({ horizon_h: 6, dissolved_oxygen: 7.9 });
    assert.strictEqual(s.dissolved_oxygen.source, DataSource.PREDICTED);
    assert.strictEqual(s.dissolved_oxygen.horizon_h, 6);
  });
  test('predicted values from different horizons remain distinct', () => {
    const s6  = createPredictedState({ horizon_h: 6,   dissolved_oxygen: 7.9 });
    const s24 = createPredictedState({ horizon_h: 24,  dissolved_oxygen: 7.5 });
    assert.notStrictEqual(s6.dissolved_oxygen.value, s24.dissolved_oxygen.value);
    assert.notStrictEqual(s6.horizon_h, s24.horizon_h);
  });
});

suite('TwinState', () => {
  test('requires twin_id, cage_id, site_id', () => {
    assert.throws(() => createTwinState({ cage_id: 'C1', site_id: 'S1' }), /twin_id/);
    assert.throws(() => createTwinState({ twin_id: 'DT-S1-C1', site_id: 'S1' }), /cage_id/);
    assert.throws(() => createTwinState({ twin_id: 'DT-S1-C1', cage_id: 'C1' }), /site_id/);
  });
  test('mode defaults to SIMULATION', () => {
    const t = createTwinState({ twin_id: 'DT-S1-C1', cage_id: 'C1', site_id: 'S1' });
    assert.strictEqual(t.mode, TwinMode.SIMULATION);
  });
  test('state_version defaults to 0', () => {
    const t = createTwinState({ twin_id: 'DT-S1-C1', cage_id: 'C1', site_id: 'S1' });
    assert.strictEqual(t.state_version, 0);
  });
  test('observed_state, estimated_state, predicted_states are all null/empty by default', () => {
    const t = createTwinState({ twin_id: 'DT-S1-C1', cage_id: 'C1', site_id: 'S1' });
    assert.strictEqual(t.observed_state, null);
    assert.strictEqual(t.estimated_state, null);
    assert.deepStrictEqual(t.predicted_states, []);
  });
  test('twin state does not mix with simulation Sim{} object', () => {
    // TwinState has a formal structure and does not reference window.Sim
    const t = createTwinState({ twin_id: 'DT-S1-C1', cage_id: 'C1', site_id: 'S1' });
    assert.ok(!('day' in t), 'TwinState must not have a "day" field (that is Sim state)');
    assert.ok(!('accumFeed' in t), 'TwinState must not have "accumFeed"');
  });
  test('accepts observed/estimated/predicted layers together', () => {
    const observed  = createObservedState({ temperature: 12.5, source: DataSource.SIMULATION });
    const estimated = createEstimatedState({ biomass_t: 186 });
    const predicted = createPredictedState({ horizon_h: 6, dissolved_oxygen: 7.8 });
    const t = createTwinState({
      twin_id: 'DT-S1-C1', cage_id: 'C1', site_id: 'S1',
      observed_state:   observed,
      estimated_state:  estimated,
      predicted_states: [predicted],
    });
    assert.strictEqual(t.observed_state.state_type, StateType.OBSERVED);
    assert.strictEqual(t.estimated_state.state_type, StateType.ESTIMATED);
    assert.strictEqual(t.predicted_states[0].state_type, StateType.PREDICTED);
    // All three are different objects
    assert.notStrictEqual(t.observed_state, t.estimated_state);
    assert.notStrictEqual(t.observed_state, t.predicted_states[0]);
  });
});

suite('createPrediction', () => {
  test('creates a stored prediction record', () => {
    const p = createPrediction({ prediction_id: 'P1', twin_id: 'DT-S1-C1', horizon_h: 24 });
    assert.strictEqual(p.source, DataSource.PREDICTED);
    assert.strictEqual(p.horizon_h, 24);
  });
  test('throws if prediction_id is missing', () => {
    assert.throws(() => createPrediction({ twin_id: 'X' }), /prediction_id/);
  });
});

suite('createScenario', () => {
  test('creates scenario in DRAFT status by default', () => {
    const s = createScenario({ scenario_id: 'SC1', name: 'Heatwave' });
    assert.strictEqual(s.status, 'DRAFT');
  });
  test('parameter overrides default to null', () => {
    const s = createScenario({ scenario_id: 'SC1', name: 'X' });
    assert.strictEqual(s.parameters.temperature, null);
  });
  test('throws if name is missing', () => {
    assert.throws(() => createScenario({ scenario_id: 'SC1' }), /name/);
  });
});

suite('createAlert', () => {
  test('creates alert with required fields', () => {
    const a = createAlert({
      alert_id: 'A1', cage_id: 'CAGE07', alert_type: 'THRESHOLD',
      message: 'O2 below 4.0 mg/L',
    });
    assert.strictEqual(a.severity, 'MEDIUM');
    assert.strictEqual(a.acknowledged, false);
    assert.deepStrictEqual(a.drivers, []);
  });
  test('throws if alert_id is missing', () => {
    assert.throws(() => createAlert({ cage_id: 'C1', alert_type: 'THRESHOLD', message: 'X' }), /alert_id/);
  });
  test('throws if message is missing', () => {
    assert.throws(() => createAlert({ alert_id: 'A1', cage_id: 'C1', alert_type: 'THRESHOLD' }), /message/);
  });
});

suite('createModelVersion', () => {
  test('status defaults to EXPERIMENTAL', () => {
    const m = createModelVersion({ model_id: 'TGC-1', name: 'TGC', version: '1.0' });
    assert.strictEqual(m.status, ModelStatus.EXPERIMENTAL);
  });
  test('throws if model_id is missing', () => {
    assert.throws(() => createModelVersion({ name: 'TGC', version: '1' }), /model_id/);
  });
  test('metrics defaults to empty object', () => {
    const m = createModelVersion({ model_id: 'M1', name: 'X', version: '1' });
    assert.deepStrictEqual(m.metrics, {});
  });
});

suite('Seed Data — Farm hierarchy', () => {
  test('DEMO_FARM has farm_id FARM01', () => {
    assert.strictEqual(DEMO_FARM.farm_id, 'FARM01');
  });
  test('DEMO_SITES has at least 2 sites', () => {
    assert.ok(DEMO_SITES.length >= 2);
  });
  test('all sites reference FARM01', () => {
    DEMO_SITES.forEach(s => assert.strictEqual(s.farm_id, 'FARM01'));
  });
  test('DEMO_CAGES has at least 2 active cages', () => {
    const active = DEMO_CAGES.filter(c => c.status === 'ACTIVE');
    assert.ok(active.length >= 2);
  });
  test('each cage has a unique twin_id', () => {
    const ids = DEMO_CAGES.map(c => c.twin_id);
    const unique = new Set(ids);
    assert.strictEqual(ids.length, unique.size, 'twin_ids must be unique');
  });
  test('twin_id format is DT-{SITE_ID}-{CAGE_ID}', () => {
    DEMO_CAGES.forEach(c => {
      assert.ok(c.twin_id.startsWith('DT-'), `${c.twin_id} should start with DT-`);
      assert.ok(c.twin_id.includes(c.site_id), `${c.twin_id} should include site_id`);
      assert.ok(c.twin_id.includes(c.cage_id), `${c.twin_id} should include cage_id`);
    });
  });
  test('DEMO_COHORTS has at least one active cohort', () => {
    const active = DEMO_COHORTS.filter(c => c.status === 'ACTIVE');
    assert.ok(active.length >= 1);
  });
  test('all cohorts reference a cage in DEMO_CAGES', () => {
    const cageIds = new Set(DEMO_CAGES.map(c => c.cage_id));
    DEMO_COHORTS.forEach(c => {
      assert.ok(cageIds.has(c.cage_id), `cohort ${c.cohort_id} cage_id ${c.cage_id} not in DEMO_CAGES`);
    });
  });
  test('DEMO_DEVICES — each device references a cage in DEMO_CAGES', () => {
    const cageIds = new Set(DEMO_CAGES.map(c => c.cage_id));
    DEMO_DEVICES.forEach(d => {
      assert.ok(cageIds.has(d.cage_id), `device ${d.device_id} cage_id ${d.cage_id} not in DEMO_CAGES`);
    });
  });
  test('DEMO_SENSORS — each sensor references a device in DEMO_DEVICES', () => {
    const deviceIds = new Set(DEMO_DEVICES.map(d => d.device_id));
    DEMO_SENSORS.forEach(s => {
      assert.ok(deviceIds.has(s.device_id), `sensor ${s.sensor_id} device_id ${s.device_id} not in DEMO_DEVICES`);
    });
  });
  test('DEMO_SENSORS includes dissolved_oxygen for default cage', () => {
    const doSensors = DEMO_SENSORS.filter(s => s.parameter === 'dissolved_oxygen');
    assert.ok(doSensors.length >= 1, 'must have at least one DO sensor');
  });
});

suite('Seed Data — Lookup helpers', () => {
  test('getCageByTwinId returns CAGE07 for default twin_id', () => {
    const cage = getCageByTwinId(DEFAULT_TWIN_ID);
    assert.ok(cage, 'should find cage for default twin_id');
    assert.strictEqual(cage.cage_id, DEFAULT_CAGE_ID);
    assert.strictEqual(cage.site_id, DEFAULT_SITE_ID);
  });
  test('getCageByTwinId returns null for unknown twin_id', () => {
    const cage = getCageByTwinId('DT-UNKNOWN-X99');
    assert.strictEqual(cage, null);
  });
  test('getCagesBySite returns only cages for that site', () => {
    const cages = getCagesBySite('SITE01');
    cages.forEach(c => assert.strictEqual(c.site_id, 'SITE01'));
  });
  test('getCagesBySite returns empty array for unknown site', () => {
    const cages = getCagesBySite('SITE_X');
    assert.deepStrictEqual(cages, []);
  });
  test('getActiveCohort returns the active cohort for CAGE07', () => {
    const cohort = getActiveCohort('CAGE07');
    assert.ok(cohort, 'should have active cohort for CAGE07');
    assert.strictEqual(cohort.status, 'ACTIVE');
    assert.strictEqual(cohort.cage_id, 'CAGE07');
  });
  test('getActiveCohort returns null for fallow cage', () => {
    const cohort = getActiveCohort('CAGE09');
    assert.strictEqual(cohort, null);
  });
  test('getDevicesForCage returns devices for CAGE07', () => {
    const devices = getDevicesForCage('CAGE07');
    assert.ok(devices.length >= 1);
    devices.forEach(d => assert.strictEqual(d.cage_id, 'CAGE07'));
  });
  test('getSensorsForCage returns sensors for CAGE07', () => {
    const sensors = getSensorsForCage('CAGE07');
    assert.ok(sensors.length >= 7, 'should have 7 sensor channels for CAGE07');
  });
  test('DEFAULT_TWIN_ID is DT-SITE01-CAGE07', () => {
    assert.strictEqual(DEFAULT_TWIN_ID, 'DT-SITE01-CAGE07');
  });
  test('DEFAULT_CAGE_ID is CAGE07 (backward-compatible)', () => {
    assert.strictEqual(DEFAULT_CAGE_ID, 'CAGE07');
  });
  test('DEFAULT_SITE_ID is SITE01 (backward-compatible)', () => {
    assert.strictEqual(DEFAULT_SITE_ID, 'SITE01');
  });
});

suite('Separation of concerns — TwinState vs SimulationState', () => {
  test('TwinState has no day counter (that belongs to simulator)', () => {
    const t = createTwinState({ twin_id: 'X', cage_id: 'C', site_id: 'S' });
    assert.ok(!('day' in t));
  });
  test('TwinState has no accumFeed or accumDead fields', () => {
    const t = createTwinState({ twin_id: 'X', cage_id: 'C', site_id: 'S' });
    assert.ok(!('accumFeed' in t));
    assert.ok(!('accumDead' in t));
  });
  test('ObservedState is distinct from EstimatedState', () => {
    const obs = createObservedState({ temperature: 12.5 });
    const est = createEstimatedState({ biomass_t: 186 });
    assert.notStrictEqual(obs.state_type, est.state_type);
    assert.strictEqual(obs.state_type, StateType.OBSERVED);
    assert.strictEqual(est.state_type, StateType.ESTIMATED);
  });
  test('PredictedState is distinct from EstimatedState', () => {
    const est  = createEstimatedState({ biomass_t: 186 });
    const pred = createPredictedState({ horizon_h: 24 });
    assert.notStrictEqual(est.state_type, pred.state_type);
  });
  test('Every data source tag is a string, not a boolean or number', () => {
    for (const v of Object.values(DataSource)) {
      assert.strictEqual(typeof v, 'string');
    }
  });
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════════════════════');
console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);

if (failures.length > 0) {
  console.log('\n  Failures:');
  failures.forEach(f => console.log(`    ✗ ${f.name}: ${f.error}`));
}

console.log('═══════════════════════════════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);
