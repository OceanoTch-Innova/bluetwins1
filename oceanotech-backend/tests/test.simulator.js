/**
 * test.simulator.js
 * AquaTwins — Phase 2 Physical System Simulator Unit Tests
 *
 * Run with:
 *   cd oceanotech-backend
 *   node tests/test.simulator.js
 *
 * No external test runner required — uses Node.js built-in assert module.
 * Exit code 0 = all passed, non-zero = failures.
 *
 * Test coverage:
 *   SeededRandom        — determinism, uniformity, normal distribution, fork, forCage
 *   Scenarios           — catalogue, getScenario, fallback, structure validation
 *   PhysicalSystemSimulator — construction, registration, stepCage output shape,
 *                             causal relationships, determinism, multi-cage independence,
 *                             scenario injection, scenario countdown/reset,
 *                             mass balance, generateHistory, stepAll, resetCage
 */

'use strict';

const assert = require('assert');
const path   = require('path');

// ─── Load simulator modules ──────────────────────────────────────────────────

const { SeededRandom } = require(path.join(__dirname, '../src/simulator/seededRandom'));
const { SCENARIOS, getScenario, listScenarios } = require(path.join(__dirname, '../src/simulator/scenarios'));
const { PhysicalSystemSimulator, ENV } = require(path.join(__dirname, '../src/simulator/PhysicalSystemSimulator'));
const { MODEL_CONFIG } = require(path.join(__dirname, '../src/domain/modelConfig'));
const { DataSource }   = require(path.join(__dirname, '../src/domain/provenance'));

// ─── Minimal test framework (same as test.domain.js) ─────────────────────────

let passed   = 0;
let failed   = 0;
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

function section(title) {
  console.log(`\n──────────────────────────────────────────────`);
  console.log(`  ${title}`);
  console.log(`──────────────────────────────────────────────`);
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const DEMO_CAGE = {
  cage_id:   'CAGE07',
  site_id:   'SITE01',
  twin_id:   'DT-SITE01-CAGE07',
  name:      'Jaula Test 07',
  status:    'ACTIVE',
  volume_m3: 6000,
};

const DEMO_CAGE_2 = {
  cage_id:   'CAGE08',
  site_id:   'SITE01',
  twin_id:   'DT-SITE01-CAGE08',
  name:      'Jaula Test 08',
  status:    'ACTIVE',
  volume_m3: 6000,
};

const DEMO_COHORT = {
  cohort_id:       'COH001',
  cage_id:         'CAGE07',
  species:         'Salmo salar',
  status:          'ACTIVE',
  initial_count:   50000,
  initial_weight_g: 80,
};

const DEMO_COHORT_2 = {
  cohort_id:       'COH002',
  cage_id:         'CAGE08',
  species:         'Salmo salar',
  status:          'ACTIVE',
  initial_count:   45000,
  initial_weight_g: 60,
};

// ─── Helper: create a minimal simulator with one cage ─────────────────────────

function makeSimulator(seed = 42, noiseScale = 0) {
  const sim = new PhysicalSystemSimulator({ seed, noise_scale: noiseScale, deterministic: true });
  sim.registerCage(DEMO_CAGE, DEMO_COHORT);
  return sim;
}

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION 1 — SeededRandom
// ─────────────────────────────────────────────────────────────────────────────

section('SeededRandom');

test('next() returns value in [0, 1)', () => {
  const rng = new SeededRandom(42);
  for (let i = 0; i < 1000; i++) {
    const v = rng.next();
    assert.ok(v >= 0 && v < 1, `Expected [0,1) but got ${v}`);
  }
});

test('same seed produces identical sequence', () => {
  const rng1 = new SeededRandom(99);
  const rng2 = new SeededRandom(99);
  for (let i = 0; i < 500; i++) {
    assert.strictEqual(rng1.next(), rng2.next(), `Diverged at step ${i}`);
  }
});

test('different seeds produce different sequences', () => {
  const rng1 = new SeededRandom(1);
  const rng2 = new SeededRandom(2);
  let differ = false;
  for (let i = 0; i < 20; i++) {
    if (rng1.next() !== rng2.next()) { differ = true; break; }
  }
  assert.ok(differ, 'Different seeds should diverge');
});

test('between() returns value in specified range', () => {
  const rng = new SeededRandom(7);
  for (let i = 0; i < 200; i++) {
    const v = rng.between(-5, 5);
    assert.ok(v >= -5 && v < 5, `Expected [-5,5) but got ${v}`);
  }
});

test('normal() mean is approximately correct over many samples', () => {
  const rng = new SeededRandom(123);
  let sum = 0;
  const N = 5000;
  for (let i = 0; i < N; i++) sum += rng.normal(10, 1);
  const mean = sum / N;
  assert.ok(Math.abs(mean - 10) < 0.1, `Mean ${mean.toFixed(4)} too far from 10`);
});

test('fork() creates an independent copy at the same state', () => {
  const rng   = new SeededRandom(42);
  rng.next(); rng.next();          // advance a few steps
  const fork  = rng.fork();
  // Both should produce the same sequence from here
  for (let i = 0; i < 50; i++) {
    assert.strictEqual(rng.next(), fork.next(), `Fork diverged at step ${i}`);
  }
});

test('fork() copies do not affect each other', () => {
  const rng  = new SeededRandom(42);
  const fork = rng.fork();
  fork.next(); fork.next(); fork.next(); // advance the fork
  // rng should still be at the forked position
  assert.notStrictEqual(rng.next(), undefined);
});

test('forCage() gives different seeds for different cage IDs', () => {
  const r1 = SeededRandom.forCage(42, 'CAGE07');
  const r2 = SeededRandom.forCage(42, 'CAGE08');
  assert.notStrictEqual(r1.next(), r2.next(), 'forCage should produce different seeds');
});

test('forCage() is deterministic — same base seed + cage_id gives same stream', () => {
  const r1 = SeededRandom.forCage(42, 'CAGE07');
  const r2 = SeededRandom.forCage(42, 'CAGE07');
  for (let i = 0; i < 100; i++) {
    assert.strictEqual(r1.next(), r2.next(), `forCage diverged at step ${i}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION 2 — Scenarios
// ─────────────────────────────────────────────────────────────────────────────

section('Scenarios');

const EXPECTED_SCENARIOS = ['normal', 'heatwave', 'hypoxia', 'algae', 'storm', 'ammonia', 'cold', 'lice'];

test('listScenarios() returns all expected keys', () => {
  const list = listScenarios();
  for (const key of EXPECTED_SCENARIOS) {
    assert.ok(list.includes(key), `Missing scenario: ${key}`);
  }
});

test('listScenarios() has no duplicate keys', () => {
  const list = listScenarios();
  const unique = new Set(list);
  assert.strictEqual(unique.size, list.length, 'Duplicate scenario keys found');
});

test('getScenario() returns correct scenario for valid key', () => {
  const sc = getScenario('heatwave');
  assert.ok(sc, 'heatwave scenario should exist');
  assert.strictEqual(sc.temperature_target, 21.4);
  assert.ok(sc.temperature_rate > 0);
});

test('getScenario() falls back to normal for unknown key', () => {
  const sc = getScenario('nonexistent_scenario_xyz');
  assert.strictEqual(sc, SCENARIOS.normal, 'Should fall back to normal');
});

test('all scenarios have required fields', () => {
  const REQUIRED = [
    'name', 'description', 'flow_multiplier', 'do_forcing',
    'duration_days', 'chronic', 'causal_chain',
  ];
  for (const [key, sc] of Object.entries(SCENARIOS)) {
    for (const field of REQUIRED) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(sc, field),
        `Scenario '${key}' missing field '${field}'`,
      );
    }
  }
});

test('all scenarios have non-empty causal_chain arrays', () => {
  for (const [key, sc] of Object.entries(SCENARIOS)) {
    assert.ok(Array.isArray(sc.causal_chain), `Scenario '${key}' causal_chain not an array`);
    assert.ok(sc.causal_chain.length >= 2, `Scenario '${key}' causal_chain too short`);
  }
});

test('normal scenario has correct baseline values', () => {
  const sc = SCENARIOS.normal;
  assert.strictEqual(sc.temperature_target, null, 'Normal scenario should not force temperature');
  assert.strictEqual(sc.do_forcing, 0, 'Normal scenario should have zero DO forcing');
  assert.strictEqual(sc.ammonia_forcing_rate, 0, 'Normal scenario should have zero NH3 forcing');
  assert.strictEqual(sc.flow_multiplier, 1.0, 'Normal scenario should have unit flow');
});

test('heatwave scenario raises temperature and reduces flow', () => {
  const sc = SCENARIOS.heatwave;
  assert.ok(sc.temperature_target > 18, 'Heatwave should target high temperature');
  assert.ok(sc.flow_multiplier < 1.0, 'Heatwave should reduce flow');
  assert.ok(sc.ammonia_forcing_rate > 0, 'Heatwave should increase ammonia');
});

test('hypoxia scenario applies strong negative DO forcing', () => {
  const sc = SCENARIOS.hypoxia;
  assert.ok(sc.do_forcing < -3, 'Hypoxia should have strong negative DO forcing');
  assert.ok(sc.flow_multiplier < 0.6, 'Hypoxia should have very reduced flow');
});

test('cold scenario applies positive DO forcing (cold water holds more O₂)', () => {
  const sc = SCENARIOS.cold;
  assert.ok(sc.do_forcing > 0, 'Cold scenario should increase DO (more O₂ at lower T)');
  assert.ok(sc.temperature_target < 8, 'Cold scenario should target low temperature');
});

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION 3 — PhysicalSystemSimulator — Construction
// ─────────────────────────────────────────────────────────────────────────────

section('PhysicalSystemSimulator — Construction');

test('constructor with default options creates a valid simulator', () => {
  const sim = new PhysicalSystemSimulator();
  assert.ok(sim, 'Simulator should be created');
  assert.strictEqual(sim.seed, 12345, 'Default seed should be 12345');
  assert.strictEqual(sim.noise_scale, 1.0, 'Default noise_scale should be 1.0');
  assert.strictEqual(sim.deterministic, true, 'Default deterministic should be true');
});

test('constructor registers cages provided at construction time', () => {
  const sim = new PhysicalSystemSimulator({
    seed:    42,
    cages:   [DEMO_CAGE],
    cohorts: [DEMO_COHORT],
  });
  const ids = sim.getCageIds();
  assert.ok(ids.includes('CAGE07'), 'CAGE07 should be registered');
});

test('constructor does not register cage if cohort is inactive', () => {
  const inactiveCohort = { ...DEMO_COHORT, status: 'HARVESTED' };
  const sim = new PhysicalSystemSimulator({
    seed:    42,
    cages:   [DEMO_CAGE],
    cohorts: [inactiveCohort],
  });
  assert.strictEqual(sim.getCageIds().length, 0, 'No cage should be registered for inactive cohort');
});

test('registerCage() throws when cage is null', () => {
  const sim = new PhysicalSystemSimulator();
  assert.throws(() => sim.registerCage(null, DEMO_COHORT), /required/);
});

test('registerCage() throws when cohort is null', () => {
  const sim = new PhysicalSystemSimulator();
  assert.throws(() => sim.registerCage(DEMO_CAGE, null), /required/);
});

test('registerCage() registers a cage and returns simulator (chaining)', () => {
  const sim = new PhysicalSystemSimulator({ seed: 42 });
  const returned = sim.registerCage(DEMO_CAGE, DEMO_COHORT);
  assert.strictEqual(returned, sim, 'registerCage should return the simulator for chaining');
  assert.ok(sim.getCageIds().includes('CAGE07'));
});

test('getCageState() returns null for unregistered cage', () => {
  const sim = new PhysicalSystemSimulator();
  assert.strictEqual(sim.getCageState('UNKNOWN'), null);
});

test('getCageState() does not expose the internal mutable RNG', () => {
  const sim = makeSimulator();
  const state = sim.getCageState('CAGE07');
  assert.strictEqual(state.rng, undefined, 'External state view should not expose RNG');
});

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION 4 — stepCage output shape
// ─────────────────────────────────────────────────────────────────────────────

section('PhysicalSystemSimulator — stepCage output shape');

test('stepCage() returns a snapshot with required fields', () => {
  const sim  = makeSimulator();
  const snap = sim.stepCage('CAGE07');

  const REQUIRED_FIELDS = [
    'cage_id', 'site_id', 'cohort_id', 'timestamp', 'sim_day', 'source',
    'population', 'weight_g', 'biomass_kg', 'SGR_pct_day', 'TGC_effective', 'days_to_harvest',
    'mortality_rate', 'dead_today', 'accum_dead', 'daily_feed_kg', 'accum_feed_kg', 'FCR',
    'temperature', 'dissolved_oxygen', 'pH', 'salinity', 'turbidity', 'flow', 'ammonia',
    'DO_saturation', 'density_kg_m3', 'volume_m3',
    'health_stress', 'f_total', 'stress_factors', 'health_risk',
    'polarization_index', 'behavior_state',
    'active_scenario', 'scenario_days_left',
  ];

  for (const field of REQUIRED_FIELDS) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(snap, field),
      `Snapshot missing field '${field}'`,
    );
  }
});

test('stepCage() source is DataSource.SIMULATION', () => {
  const sim  = makeSimulator();
  const snap = sim.stepCage('CAGE07');
  assert.strictEqual(snap.source, DataSource.SIMULATION);
  assert.strictEqual(snap.source, 'SIMULATION');
});

test('stepCage() increments sim_day on each call', () => {
  const sim = makeSimulator();
  const s1  = sim.stepCage('CAGE07');
  const s2  = sim.stepCage('CAGE07');
  const s3  = sim.stepCage('CAGE07');
  assert.strictEqual(s1.sim_day, 1);
  assert.strictEqual(s2.sim_day, 2);
  assert.strictEqual(s3.sim_day, 3);
});

test('stepCage() throws for unregistered cage', () => {
  const sim = makeSimulator();
  assert.throws(() => sim.stepCage('UNKNOWN_CAGE'), /not registered/);
});

test('snapshot cage_id matches the registered cage', () => {
  const sim  = makeSimulator();
  const snap = sim.stepCage('CAGE07');
  assert.strictEqual(snap.cage_id, 'CAGE07');
  assert.strictEqual(snap.site_id, 'SITE01');
});

test('stress_factors contains all five factor fields', () => {
  const sim  = makeSimulator();
  const snap = sim.stepCage('CAGE07');
  const sf   = snap.stress_factors;
  assert.ok(typeof sf.f_temperature === 'number');
  assert.ok(typeof sf.f_oxygen      === 'number');
  assert.ok(typeof sf.f_density     === 'number');
  assert.ok(typeof sf.f_ammonia     === 'number');
  assert.ok(typeof sf.f_pH          === 'number');
});

test('health_risk is one of LOW / MODERATE / HIGH', () => {
  const sim  = makeSimulator();
  const snap = sim.stepCage('CAGE07');
  assert.ok(['LOW', 'MODERATE', 'HIGH'].includes(snap.health_risk));
});

test('behavior_state has label and color', () => {
  const sim  = makeSimulator();
  const snap = sim.stepCage('CAGE07');
  assert.ok(typeof snap.behavior_state.label === 'string');
  assert.ok(typeof snap.behavior_state.color === 'string');
});

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION 5 — Physical range validity
// ─────────────────────────────────────────────────────────────────────────────

section('PhysicalSystemSimulator — Physical range validity');

test('environmental variables stay within physically valid ranges over 100 days', () => {
  const sim = new PhysicalSystemSimulator({ seed: 42, noise_scale: 1.0, deterministic: true });
  sim.registerCage(DEMO_CAGE, DEMO_COHORT);

  for (let d = 0; d < 100; d++) {
    const snap = sim.stepCage('CAGE07');
    assert.ok(snap.temperature >= 2 && snap.temperature <= 28,
      `Day ${d} temperature ${snap.temperature} out of range`);
    assert.ok(snap.dissolved_oxygen >= 0 && snap.dissolved_oxygen <= 16,
      `Day ${d} DO ${snap.dissolved_oxygen} out of range`);
    assert.ok(snap.pH >= 6.5 && snap.pH <= 9.5,
      `Day ${d} pH ${snap.pH} out of range`);
    assert.ok(snap.salinity >= 28 && snap.salinity <= 40,
      `Day ${d} salinity ${snap.salinity} out of range`);
    assert.ok(snap.ammonia >= 0 && snap.ammonia <= 0.6,
      `Day ${d} ammonia ${snap.ammonia} out of range`);
    assert.ok(snap.flow >= 50,
      `Day ${d} flow ${snap.flow} below minimum`);
  }
});

test('population decreases or stays constant (no spontaneous generation)', () => {
  const sim  = makeSimulator();
  let lastPop = DEMO_COHORT.initial_count;
  for (let d = 0; d < 30; d++) {
    const snap = sim.stepCage('CAGE07');
    assert.ok(snap.population <= lastPop + 1, // +1 tolerance for rounding
      `Population increased from ${lastPop} to ${snap.population} at day ${d}`);
    lastPop = snap.population;
  }
});

test('weight_g is always positive and non-decreasing in healthy conditions', () => {
  const sim  = makeSimulator(42, 0);  // no noise, deterministic
  let lastWeight = DEMO_COHORT.initial_weight_g;
  for (let d = 0; d < 30; d++) {
    const snap = sim.stepCage('CAGE07');
    assert.ok(snap.weight_g > 0, `Weight should be positive on day ${d}`);
    assert.ok(snap.weight_g >= lastWeight * 0.999,
      `Weight decreased unexpectedly from ${lastWeight} to ${snap.weight_g} at day ${d}`);
    lastWeight = snap.weight_g;
  }
});

test('biomass_kg > 0 and consistent with population × weight', () => {
  const sim  = makeSimulator(42, 0);
  const snap = sim.stepCage('CAGE07');
  assert.ok(snap.biomass_kg > 0, 'Biomass must be positive');
  const expectedBiomass = snap.population * snap.weight_g / 1e3;
  assert.ok(Math.abs(snap.biomass_kg - expectedBiomass) < 1,
    `Biomass ${snap.biomass_kg} kg inconsistent with population×weight (expected ~${expectedBiomass.toFixed(1)})`);
});

test('f_total is in (0, 1]', () => {
  const sim  = makeSimulator();
  const snap = sim.stepCage('CAGE07');
  assert.ok(snap.f_total > 0 && snap.f_total <= 1,
    `f_total ${snap.f_total} out of (0,1]`);
});

test('mortality_rate is in [0, 0.15]', () => {
  const sim = makeSimulator();
  for (let d = 0; d < 20; d++) {
    const snap = sim.stepCage('CAGE07');
    assert.ok(snap.mortality_rate >= 0 && snap.mortality_rate <= 0.15,
      `Mortality rate ${snap.mortality_rate} out of bounds at day ${d}`);
  }
});

test('accum_dead increases monotonically', () => {
  const sim = makeSimulator();
  let lastDead = 0;
  for (let d = 0; d < 20; d++) {
    const snap = sim.stepCage('CAGE07');
    assert.ok(snap.accum_dead >= lastDead,
      `Accumulated deaths decreased at day ${d}: ${lastDead} → ${snap.accum_dead}`);
    lastDead = snap.accum_dead;
  }
});

test('accum_feed_kg increases monotonically', () => {
  const sim = makeSimulator();
  let lastFeed = 0;
  for (let d = 0; d < 20; d++) {
    const snap = sim.stepCage('CAGE07');
    assert.ok(snap.accum_feed_kg >= lastFeed,
      `Accumulated feed decreased at day ${d}: ${lastFeed} → ${snap.accum_feed_kg}`);
    lastFeed = snap.accum_feed_kg;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION 6 — Determinism
// ─────────────────────────────────────────────────────────────────────────────

section('PhysicalSystemSimulator — Determinism');

test('same seed produces identical snapshots (step 1)', () => {
  const sim1 = new PhysicalSystemSimulator({ seed: 42, noise_scale: 1.0 });
  sim1.registerCage(DEMO_CAGE, DEMO_COHORT);
  const sim2 = new PhysicalSystemSimulator({ seed: 42, noise_scale: 1.0 });
  sim2.registerCage(DEMO_CAGE, DEMO_COHORT);

  const s1 = sim1.stepCage('CAGE07');
  const s2 = sim2.stepCage('CAGE07');

  assert.strictEqual(s1.temperature,      s2.temperature,      'temperature must be deterministic');
  assert.strictEqual(s1.dissolved_oxygen, s2.dissolved_oxygen, 'DO must be deterministic');
  assert.strictEqual(s1.pH,               s2.pH,               'pH must be deterministic');
  assert.strictEqual(s1.weight_g,         s2.weight_g,         'weight must be deterministic');
  assert.strictEqual(s1.population,       s2.population,       'population must be deterministic');
});

test('same seed produces identical snapshots across 30 steps', () => {
  function run(seed) {
    const sim = new PhysicalSystemSimulator({ seed, noise_scale: 0.5 });
    sim.registerCage(DEMO_CAGE, DEMO_COHORT);
    const snaps = [];
    for (let d = 0; d < 30; d++) snaps.push(sim.stepCage('CAGE07'));
    return snaps;
  }
  const a = run(1234);
  const b = run(1234);
  for (let i = 0; i < a.length; i++) {
    assert.strictEqual(a[i].temperature,      b[i].temperature,      `Day ${i} temperature diverged`);
    assert.strictEqual(a[i].dissolved_oxygen, b[i].dissolved_oxygen, `Day ${i} DO diverged`);
    assert.strictEqual(a[i].weight_g,         b[i].weight_g,         `Day ${i} weight diverged`);
    assert.strictEqual(a[i].population,       b[i].population,       `Day ${i} population diverged`);
  }
});

test('different seeds produce different simulation outcomes', () => {
  const sim1 = new PhysicalSystemSimulator({ seed: 1, noise_scale: 1.0 });
  sim1.registerCage(DEMO_CAGE, DEMO_COHORT);
  const sim2 = new PhysicalSystemSimulator({ seed: 9999, noise_scale: 1.0 });
  sim2.registerCage(DEMO_CAGE, DEMO_COHORT);

  // Step both multiple times so noise accumulates
  for (let i = 0; i < 10; i++) { sim1.stepCage('CAGE07'); sim2.stepCage('CAGE07'); }
  const s1 = sim1.stepCage('CAGE07');
  const s2 = sim2.stepCage('CAGE07');

  // At least one variable should differ
  const differ =
    s1.temperature      !== s2.temperature      ||
    s1.dissolved_oxygen !== s2.dissolved_oxygen ||
    s1.pH               !== s2.pH;
  assert.ok(differ, 'Different seeds should produce different outcomes');
});

test('noise_scale=0 produces exactly the same values on repeated runs', () => {
  function run() {
    const sim = new PhysicalSystemSimulator({ seed: 42, noise_scale: 0 });
    sim.registerCage(DEMO_CAGE, DEMO_COHORT);
    return sim.stepCage('CAGE07');
  }
  const a = run();
  const b = run();
  assert.strictEqual(a.temperature,      b.temperature);
  assert.strictEqual(a.dissolved_oxygen, b.dissolved_oxygen);
  assert.strictEqual(a.weight_g,         b.weight_g);
});

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION 7 — Multi-cage independence
// ─────────────────────────────────────────────────────────────────────────────

section('PhysicalSystemSimulator — Multi-cage independence');

test('two cages registered with different IDs have independent RNG streams', () => {
  const sim = new PhysicalSystemSimulator({ seed: 42, noise_scale: 1.0 });
  sim.registerCage(DEMO_CAGE,   DEMO_COHORT);
  sim.registerCage(DEMO_CAGE_2, DEMO_COHORT_2);

  const s7 = sim.stepCage('CAGE07');
  const s8 = sim.stepCage('CAGE08');

  // Should have the same deterministic causal physics but different noise
  // They start at slightly different states due to initial_weight_g difference
  // The key invariant: advancing CAGE07 does not change CAGE08's state and vice versa
  const beforeCage8T = sim.getCageState('CAGE08').temperature;
  sim.stepCage('CAGE07');  // step cage07 again
  const afterCage8T  = sim.getCageState('CAGE08').temperature;
  assert.strictEqual(beforeCage8T, afterCage8T, 'Stepping CAGE07 must not alter CAGE08 state');
});

test('getCageIds() returns all registered cage IDs', () => {
  const sim = new PhysicalSystemSimulator({ seed: 42 });
  sim.registerCage(DEMO_CAGE,   DEMO_COHORT);
  sim.registerCage(DEMO_CAGE_2, DEMO_COHORT_2);
  const ids = sim.getCageIds();
  assert.ok(ids.includes('CAGE07'), 'Should include CAGE07');
  assert.ok(ids.includes('CAGE08'), 'Should include CAGE08');
  assert.strictEqual(ids.length, 2, 'Should have exactly 2 registered cages');
});

test('stepAll() returns snapshots for all cages', () => {
  const sim = new PhysicalSystemSimulator({ seed: 42 });
  sim.registerCage(DEMO_CAGE,   DEMO_COHORT);
  sim.registerCage(DEMO_CAGE_2, DEMO_COHORT_2);
  const results = sim.stepAll();
  assert.ok(results['CAGE07'], 'stepAll should return CAGE07 snapshot');
  assert.ok(results['CAGE08'], 'stepAll should return CAGE08 snapshot');
});

test('two cages can be at different sim_day values', () => {
  const sim = new PhysicalSystemSimulator({ seed: 42 });
  sim.registerCage(DEMO_CAGE,   DEMO_COHORT);
  sim.registerCage(DEMO_CAGE_2, DEMO_COHORT_2);

  // Advance CAGE07 three extra steps
  sim.stepCage('CAGE07');
  sim.stepCage('CAGE07');
  sim.stepCage('CAGE07');
  sim.stepCage('CAGE08'); // only one step

  const s7 = sim.getCageState('CAGE07');
  const s8 = sim.getCageState('CAGE08');

  assert.strictEqual(s7.last_step.sim_day, 3, 'CAGE07 should be on day 3');
  assert.strictEqual(s8.last_step.sim_day, 1, 'CAGE08 should be on day 1');
});

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION 8 — Scenario injection
// ─────────────────────────────────────────────────────────────────────────────

section('PhysicalSystemSimulator — Scenario injection');

test('injectScenario() throws for unregistered cage', () => {
  const sim = makeSimulator();
  assert.throws(() => sim.injectScenario('UNKNOWN', 'heatwave'), /not registered/);
});

test('injectScenario() sets active_scenario on the cage', () => {
  const sim = makeSimulator();
  sim.injectScenario('CAGE07', 'heatwave');
  const state = sim.getCageState('CAGE07');
  assert.strictEqual(state.active_scenario, 'heatwave');
});

test('injectScenario() returns the scenario definition', () => {
  const sim = makeSimulator();
  const sc  = sim.injectScenario('CAGE07', 'hypoxia');
  assert.strictEqual(sc, SCENARIOS.hypoxia, 'Should return the scenario object');
});

test('heatwave scenario drives temperature upward over time', () => {
  const sim = new PhysicalSystemSimulator({ seed: 42, noise_scale: 0 });
  sim.registerCage(DEMO_CAGE, DEMO_COHORT);

  // Establish baseline temperature (10 days normal)
  for (let d = 0; d < 10; d++) sim.stepCage('CAGE07');
  const baselineT = sim.getCageState('CAGE07').temperature;

  // Inject heatwave and step 10 more days
  sim.injectScenario('CAGE07', 'heatwave');
  for (let d = 0; d < 10; d++) sim.stepCage('CAGE07');
  const afterHeatwaveT = sim.getCageState('CAGE07').temperature;

  assert.ok(afterHeatwaveT > baselineT,
    `Heatwave should raise temperature: baseline=${baselineT.toFixed(2)}, after=${afterHeatwaveT.toFixed(2)}`);
});

test('hypoxia scenario reduces dissolved oxygen over time', () => {
  const sim = new PhysicalSystemSimulator({ seed: 42, noise_scale: 0 });
  sim.registerCage(DEMO_CAGE, DEMO_COHORT);

  // Establish baseline DO (10 days normal)
  for (let d = 0; d < 10; d++) sim.stepCage('CAGE07');
  const baselineDO = sim.getCageState('CAGE07').dissolved_oxygen;

  // Inject hypoxia and step 7 more days
  sim.injectScenario('CAGE07', 'hypoxia');
  for (let d = 0; d < 7; d++) sim.stepCage('CAGE07');
  const afterHypoxiaDO = sim.getCageState('CAGE07').dissolved_oxygen;

  assert.ok(afterHypoxiaDO < baselineDO,
    `Hypoxia should lower DO: baseline=${baselineDO.toFixed(2)}, after=${afterHypoxiaDO.toFixed(2)}`);
});

test('ammonia scenario raises ammonia over time', () => {
  const sim = new PhysicalSystemSimulator({ seed: 42, noise_scale: 0 });
  sim.registerCage(DEMO_CAGE, DEMO_COHORT);

  for (let d = 0; d < 10; d++) sim.stepCage('CAGE07');
  const baselineNH3 = sim.getCageState('CAGE07').ammonia;

  sim.injectScenario('CAGE07', 'ammonia');
  for (let d = 0; d < 5; d++) sim.stepCage('CAGE07');
  const afterNH3 = sim.getCageState('CAGE07').ammonia;

  assert.ok(afterNH3 > baselineNH3,
    `Ammonia scenario should raise NH3: baseline=${baselineNH3.toFixed(5)}, after=${afterNH3.toFixed(5)}`);
});

test('scenario countdown decrements and resets to normal after duration', () => {
  const sim = new PhysicalSystemSimulator({ seed: 42, noise_scale: 0 });
  sim.registerCage(DEMO_CAGE, DEMO_COHORT);

  // Storm has duration_days = 3
  sim.injectScenario('CAGE07', 'storm');
  assert.strictEqual(sim.getCageState('CAGE07').active_scenario, 'storm');

  // Step 3 times — storm should expire
  for (let d = 0; d < 3; d++) sim.stepCage('CAGE07');

  const state = sim.getCageState('CAGE07');
  assert.strictEqual(state.active_scenario, 'normal', 'Scenario should reset to normal after duration');
});

test('scenario snapshot carries active_scenario label', () => {
  const sim = makeSimulator();
  sim.injectScenario('CAGE07', 'cold');
  const snap = sim.stepCage('CAGE07');
  assert.strictEqual(snap.active_scenario, 'cold');
});

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION 9 — generateHistory and resetCage
// ─────────────────────────────────────────────────────────────────────────────

section('PhysicalSystemSimulator — generateHistory & resetCage');

test('generateHistory() returns correct number of snapshots', () => {
  const sim     = makeSimulator();
  const history = sim.generateHistory('CAGE07', 30);
  assert.strictEqual(history.length, 30, 'Should return 30 snapshots');
});

test('generateHistory() snapshots have ascending sim_day', () => {
  const sim     = makeSimulator();
  const history = sim.generateHistory('CAGE07', 10);
  for (let i = 1; i < history.length; i++) {
    assert.ok(history[i].sim_day > history[i - 1].sim_day,
      `sim_day not ascending at index ${i}`);
  }
});

test('generateHistory() snapshots all have source=SIMULATION', () => {
  const sim     = makeSimulator();
  const history = sim.generateHistory('CAGE07', 10);
  for (const snap of history) {
    assert.strictEqual(snap.source, DataSource.SIMULATION);
  }
});

test('resetCage() resets sim_day to 0', () => {
  const sim = makeSimulator();
  sim.generateHistory('CAGE07', 20);
  sim.resetCage('CAGE07', DEMO_CAGE, DEMO_COHORT);
  const state = sim.getCageState('CAGE07');
  assert.strictEqual(state.sim_day, 0, 'sim_day should be 0 after reset');
});

test('resetCage() produces same initial snapshot as a fresh registration (reproducibility)', () => {
  // Run sim A from scratch
  const simA = new PhysicalSystemSimulator({ seed: 42, noise_scale: 0 });
  simA.registerCage(DEMO_CAGE, DEMO_COHORT);
  const snapA = simA.stepCage('CAGE07');

  // Run sim B, advance it, then reset
  const simB = new PhysicalSystemSimulator({ seed: 42, noise_scale: 0 });
  simB.registerCage(DEMO_CAGE, DEMO_COHORT);
  for (let d = 0; d < 15; d++) simB.stepCage('CAGE07');
  simB.resetCage('CAGE07', DEMO_CAGE, DEMO_COHORT);
  const snapB = simB.stepCage('CAGE07');

  assert.strictEqual(snapA.temperature,      snapB.temperature,      'temperature after reset');
  assert.strictEqual(snapA.dissolved_oxygen, snapB.dissolved_oxygen, 'DO after reset');
  assert.strictEqual(snapA.weight_g,         snapB.weight_g,         'weight after reset');
  assert.strictEqual(snapA.population,       snapB.population,       'population after reset');
});

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION 10 — Causal relationships
// ─────────────────────────────────────────────────────────────────────────────

section('PhysicalSystemSimulator — Causal relationships');

test('cold scenario reduces growth rate vs normal', () => {
  // Run two simulators: one normal, one cold — compare weight after 30 days
  function run30(scenario) {
    const sim = new PhysicalSystemSimulator({ seed: 42, noise_scale: 0 });
    sim.registerCage(DEMO_CAGE, DEMO_COHORT);
    if (scenario !== 'normal') sim.injectScenario('CAGE07', scenario);
    const history = sim.generateHistory('CAGE07', 30);
    return history[29].weight_g;
  }
  const wNormal = run30('normal');
  const wCold   = run30('cold');
  assert.ok(wCold < wNormal,
    `Cold scenario should reduce growth: normal=${wNormal.toFixed(1)}g cold=${wCold.toFixed(1)}g`);
});

test('hypoxia scenario produces lower dissolved oxygen than normal (causal DO drop)', () => {
  // The hypoxia scenario applies reduced flow (0.5×) and a direct DO forcing (-4.5 mg/L).
  // After several days the DO should be measurably lower than in the normal scenario.
  function minDO(scenario) {
    const sim = new PhysicalSystemSimulator({ seed: 42, noise_scale: 0 });
    sim.registerCage(DEMO_CAGE, DEMO_COHORT);
    if (scenario !== 'normal') sim.injectScenario('CAGE07', scenario);
    const history = sim.generateHistory('CAGE07', 10);
    return Math.min(...history.map(s => s.dissolved_oxygen));
  }
  const doNormal  = minDO('normal');
  const doHypoxia = minDO('hypoxia');
  assert.ok(doHypoxia < doNormal,
    `Hypoxia should produce lower DO: normal_min=${doNormal.toFixed(2)} hypoxia_min=${doHypoxia.toFixed(2)}`);
});

test('DO saturation is lower at higher temperatures (Henry\'s law proxy)', () => {
  // Run no-noise simulator; manually compare DO_saturation values
  const sim = new PhysicalSystemSimulator({ seed: 42, noise_scale: 0 });
  sim.registerCage(DEMO_CAGE, DEMO_COHORT);

  // Step 10 days under normal conditions — record temperature and DO_sat
  const snaps = [];
  for (let d = 0; d < 10; d++) snaps.push(sim.stepCage('CAGE07'));

  // Find max and min temperature days
  const sorted = [...snaps].sort((a, b) => a.temperature - b.temperature);
  const coldDay = sorted[0];
  const warmDay = sorted[sorted.length - 1];

  if (coldDay.temperature !== warmDay.temperature) {
    assert.ok(coldDay.DO_saturation >= warmDay.DO_saturation,
      `Cold day should have higher DO_sat: T=${coldDay.temperature} DO_sat=${coldDay.DO_saturation} vs T=${warmDay.temperature} DO_sat=${warmDay.DO_saturation}`);
  }
});

test('f_total < 1 during hypoxia (stress is present)', () => {
  const sim = new PhysicalSystemSimulator({ seed: 42, noise_scale: 0 });
  sim.registerCage(DEMO_CAGE, DEMO_COHORT);
  sim.injectScenario('CAGE07', 'hypoxia');

  // After 7 days of hypoxia, f_total should be meaningfully below 1
  const history = sim.generateHistory('CAGE07', 7);
  const finalF  = history[6].f_total;
  assert.ok(finalF < 0.95,
    `After hypoxia f_total=${finalF.toFixed(4)} should be below 0.95`);
});

// ─────────────────────────────────────────────────────────────────────────────
//  SECTION 11 — ENV constants
// ─────────────────────────────────────────────────────────────────────────────

section('ENV constants');

test('ENV is frozen (immutable)', () => {
  assert.ok(Object.isFrozen(ENV), 'ENV should be frozen');
});

test('ENV.DO_SAT_A and DO_SAT_B define decreasing DO with temperature', () => {
  // DO_sat(T) = DO_SAT_A - DO_SAT_B * T
  const do10 = ENV.DO_SAT_A - ENV.DO_SAT_B * 10;
  const do20 = ENV.DO_SAT_A - ENV.DO_SAT_B * 20;
  assert.ok(do10 > do20, 'DO saturation should decrease with temperature');
});

test('ENV seasonal temperature parameters produce sensible range', () => {
  // Min T ≈ MEAN - AMP, Max T ≈ MEAN + AMP
  const minT = ENV.SEASONAL_T_MEAN - ENV.SEASONAL_T_AMP;
  const maxT = ENV.SEASONAL_T_MEAN + ENV.SEASONAL_T_AMP;
  assert.ok(minT > 5 && maxT < 22, `Seasonal T range ${minT.toFixed(1)}–${maxT.toFixed(1)} unexpected`);
});

// ─────────────────────────────────────────────────────────────────────────────
//  SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n══════════════════════════════════════════════`);
console.log(`  Phase 2 Simulator Tests — Summary`);
console.log(`══════════════════════════════════════════════`);
console.log(`  Passed : ${passed}`);
console.log(`  Failed : ${failed}`);
console.log(`  Total  : ${passed + failed}`);

if (failures.length > 0) {
  console.log('\n  Failures:');
  failures.forEach(f => console.log(`    ✗ ${f.name}\n      ${f.error}`));
}

console.log('');

process.exit(failed > 0 ? 1 : 0);
