/**
 * routes/twin.js
 * Digital Twin state API — Phase 2 (PhysicalSystemSimulator-backed).
 *
 * Data now comes from the formal PhysicalSystemSimulator (causal, deterministic).
 * Replaces the previous disconnected Math.random() environment generation.
 *
 * GET  /api/v1/twin/cages              — list all registered twin identities
 * GET  /api/v1/twin/state/:twin_id     — current twin state for any registered cage
 * GET  /api/v1/twin/history/:twin_id   — in-memory snapshot history
 * POST /api/v1/twin/sync               — submit an external observation
 * POST /api/v1/twin/scenario           — inject a scenario into a cage
 * GET  /api/v1/twin/scenarios          — list available scenarios
 */

const express = require('express');
const { requireAuth }  = require('../middleware/auth');
const { DataSource, TwinMode } = require('../domain/provenance');
const {
  createObservedState,
  createEstimatedState,
  createPredictedState,
  createTwinState,
} = require('../domain/entities');
const {
  getCageByTwinId,
  getActiveCohort,
  DEFAULT_TWIN_ID,
  DEMO_CAGES,
  DEMO_COHORTS,
} = require('../domain/seedData');
const { PhysicalSystemSimulator, listScenarios } = require('../simulator');

const router = express.Router();

// ─── Bootstrap PhysicalSystemSimulator ───────────────────────────────────────
//
// One shared simulator instance for the server process.
// Each cage gets its own independent causal RNG stream (seeded deterministically).
// Pre-seeded with 90 days of history so charts have data immediately.

const simulator = new PhysicalSystemSimulator({
  seed:          42,
  noise_scale:   1.0,
  deterministic: true,
  cages:    DEMO_CAGES.filter(c => c.status === 'ACTIVE'),
  cohorts:  DEMO_COHORTS,
});

// Pre-seed 90 days of history for each active cage
for (const cage of DEMO_CAGES.filter(c => c.status === 'ACTIVE')) {
  const cohort = DEMO_COHORTS.find(ch => ch.cage_id === cage.cage_id && ch.status === 'ACTIVE');
  if (cohort) {
    simulator.generateHistory(cage.cage_id, 90);
  }
}

// ─── In-memory readings store (Phase 1) ───────────────────────────────────────

const readings_store = [];
const MAX_READINGS = 2000;

function pushReading(reading) {
  readings_store.push(reading);
  if (readings_store.length > MAX_READINGS) readings_store.shift();
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/twin/cages
 * Returns all registered cage/twin identities.
 */
router.get('/cages', requireAuth, (req, res) => {
  const cages = DEMO_CAGES.map(c => ({
    twin_id:   c.twin_id,
    cage_id:   c.cage_id,
    site_id:   c.site_id,
    name:      c.name,
    status:    c.status,
    volume_m3: c.volume_m3,
  }));
  return res.json({ count: cages.length, cages });
});

/**
 * GET /api/v1/twin/scenarios
 * Returns available scenario keys and names.
 */
router.get('/scenarios', requireAuth, (req, res) => {
  const { SCENARIOS } = require('../simulator/scenarios');
  const list = listScenarios().map(key => ({
    key,
    name:         SCENARIOS[key].name,
    description:  SCENARIOS[key].description,
    duration_days: SCENARIOS[key].duration_days,
    causal_chain: SCENARIOS[key].causal_chain,
  }));
  return res.json({ count: list.length, scenarios: list });
});

/**
 * POST /api/v1/twin/scenario
 * Body: { twin_id, scenario }
 * Injects a scenario into the physical simulator for the given cage.
 */
router.post('/scenario', requireAuth, (req, res) => {
  const { twin_id = DEFAULT_TWIN_ID, scenario = 'normal' } = req.body;
  const cage = getCageByTwinId(twin_id);
  if (!cage) {
    return res.status(404).json({ error: `Twin '${twin_id}' not found.` });
  }
  try {
    const sc = simulator.injectScenario(cage.cage_id, scenario);
    return res.json({
      ok:        true,
      twin_id,
      cage_id:   cage.cage_id,
      scenario,
      name:      sc.name,
      duration_days: sc.duration_days,
      causal_chain:  sc.causal_chain,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/v1/twin/state
 * GET /api/v1/twin/state/:twin_id
 *
 * Returns the current Digital Twin state sourced from the PhysicalSystemSimulator.
 * One simulation step is advanced on each call (the simulator drives the clock).
 */
router.get('/state/:twin_id?', requireAuth, (req, res) => {
  const twin_id = req.params.twin_id || DEFAULT_TWIN_ID;

  const cage = getCageByTwinId(twin_id);
  if (!cage) {
    return res.status(404).json({
      error: `Twin '${twin_id}' not found.`,
      registered_twins: DEMO_CAGES.map(c => c.twin_id),
    });
  }

  const cohort = getActiveCohort(cage.cage_id);

  // Advance the physical simulator by one step to get current state
  // (if the cage has no active cohort it will not be registered)
  let physState = simulator.getCageState(cage.cage_id)?.last_step;
  if (!physState) {
    // Cage not yet registered (fallow or no cohort); return 503
    return res.status(503).json({
      error: `No active simulation for cage '${cage.cage_id}'.`,
      hint:  'Cage may be FALLOW or has no active cohort.',
    });
  }

  // Step the simulator forward by one day
  physState = simulator.stepCage(cage.cage_id);

  // Map PhysicalSystemSimulator output → ObservedState (domain entities)
  const observed = createObservedState({
    timestamp:        new Date().toISOString(),
    source:           DataSource.SIMULATION,
    temperature:      physState.temperature,       temperature_q:     97,
    dissolved_oxygen: physState.dissolved_oxygen,  dissolved_oxygen_q: 96,
    salinity:         physState.salinity,          salinity_q:        98,
    pH:               physState.pH,                pH_q:              95,
    ammonia:          physState.ammonia,           ammonia_q:         94,
    turbidity:        physState.turbidity,         turbidity_q:       93,
    flow:             physState.flow,              flow_q:            91,
  });

  // EstimatedState: model-derived quantities
  const biomass_t = physState.biomass_kg / 1000;  // kg → tonnes
  const estimated = createEstimatedState({
    timestamp:          new Date().toISOString(),
    dissolved_oxygen:   +(physState.dissolved_oxygen * 0.998).toFixed(2),
    do_method:          'weighted_correction',
    biomass_t,
    biomass_method:     'TGC_model',
    biomass_confidence: 0.91,
    population_count:   physState.population,
    avg_weight_g:       physState.weight_g,
  });

  // PredictedStates
  const pred6h = createPredictedState({
    timestamp:        new Date().toISOString(),
    horizon_h:        6,
    dissolved_oxygen: +(physState.dissolved_oxygen - 0.12).toFixed(2),
    do_confidence:    0.82,
  });

  const pred30d = createPredictedState({
    timestamp:          new Date().toISOString(),
    horizon_h:          720,
    biomass_t:          +(biomass_t * 1.15).toFixed(2),
    biomass_confidence: 0.68,
    harvest_date:       new Date(Date.now() + physState.days_to_harvest * 86400000).toISOString().split('T')[0],
    days_to_harvest:    physState.days_to_harvest,
  });

  const twinState = createTwinState({
    twin_id,
    site_id:   cage.site_id,
    cage_id:   cage.cage_id,
    cohort_id: cohort ? cohort.cohort_id : null,
    species:   cohort ? cohort.species : 'Salmo salar',
    mode:      TwinMode.SIMULATION,

    observed_state:   observed,
    estimated_state:  estimated,
    predicted_states: [pred6h, pred30d],

    // Population (from physics)
    population: {
      count:           physState.population,
      mortality_daily: +(physState.mortality_rate * 100).toFixed(4),
      source:          DataSource.SIMULATION,
    },
    // Biomass
    biomass: {
      total_t:       +biomass_t.toFixed(2),
      uncertainty_t: +(biomass_t * 0.034).toFixed(2),  // NOTE: placeholder
      confidence:    0.91,                               // NOTE: placeholder
      density_kg_m3: +physState.density_kg_m3.toFixed(2),
      source:        DataSource.SIMULATION,
    },
    // Growth
    growth: {
      weight_g:        +physState.weight_g.toFixed(0),
      SGR_pct_day:     +physState.SGR_pct_day.toFixed(4),
      TGC_effective:   +physState.TGC_effective.toFixed(3),
      days_to_harvest: physState.days_to_harvest,
      source:          DataSource.SIMULATION,
    },
    // Feeding
    feeding: {
      daily_kg: +physState.daily_feed_kg.toFixed(1),
      FCR_base: +physState.FCR.toFixed(3),
      source:   DataSource.SIMULATION,
    },
    // Health
    health: {
      index:      Math.round(physState.f_total * 100),
      risk_level: physState.health_risk,
      f_total:    +physState.f_total.toFixed(3),
      stress_factors: physState.stress_factors,
      source:     DataSource.SIMULATION,
    },

    data_quality:    0.947,   // NOTE: placeholder
    twin_confidence: 0.918,   // NOTE: placeholder
    last_sync:       new Date().toISOString(),
    update_reason:   `Simulation day ${physState.sim_day} — scenario: ${physState.active_scenario}`,

    // Expose the raw physical state for debugging / VirtualSensorEngine (Phase 3)
    physical_state: physState,
  });

  return res.json(twinState);
});

/**
 * GET /api/v1/twin/history/:twin_id
 * Returns last N twin state snapshots from in-memory store.
 */
router.get('/history/:twin_id?', requireAuth, (req, res) => {
  const twin_id = req.params.twin_id || DEFAULT_TWIN_ID;
  const limit   = Math.min(parseInt(req.query.limit || '100', 10), 500);
  const relevant = readings_store.slice(-limit);
  return res.json({ twin_id, count: relevant.length, readings: relevant });
});

/**
 * POST /api/v1/twin/sync
 * Accept a new observation and update twin state
 */
router.post('/sync', requireAuth, (req, res) => {
  const { twin_id = 'DT-SITE01-CAGE07', observations = {} } = req.body;
  const timestamp = new Date().toISOString();

  pushReading({ twin_id, timestamp, observations });

  return res.json({
    ok: true,
    twin_id,
    timestamp,
    message: 'Observation received. Twin state will update on next poll.',
  });
});

module.exports = { router, pushReading };
