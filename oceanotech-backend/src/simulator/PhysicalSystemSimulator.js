/**
 * PhysicalSystemSimulator.js
 * AquaTwins — Phase 2 Physical System Simulator
 *
 * Models a coherent virtual aquaculture environment where ALL variables
 * influence each other through explicit causal equations.
 *
 * SEPARATION OF CONCERNS:
 *   This module is NOT a Digital Twin Engine.
 *   It is NOT a Virtual Sensor Engine.
 *   It produces a SimulatedPhysicalState — a coherent representation of
 *   what would be happening inside a real cage, IF these conditions existed.
 *
 * The output of this simulator is consumed by:
 *   Phase 3 → VirtualSensorEngine (adds sensor noise, dropouts, calibration drift)
 *   Phase 7 → DigitalTwinEngine   (state estimation, assimilation)
 *
 * Model status: EXPERIMENTAL
 * All parameters are based on published literature for Salmo salar.
 * Not calibrated against specific farm data.
 *
 * Causal chain:
 *   Scenario forcing
 *        ↓
 *   EnvironmentalModel  (temperature, O₂ dynamics, pH, salinity, turbidity, flow)
 *        ↓
 *   StressModel         (fTemp, fOxy, fDens, fNH3, fpH → f_total)
 *        ↓
 *   GrowthModel         (TGC, SGR, individual weight)
 *        ↓
 *   MortalityModel      (base + stress-driven daily mortality)
 *        ↓
 *   FeedingModel        (intake rate, daily feed, FCR)
 *        ↓
 *   PopulationAccounting (N, biomass, mass balance)
 *        ↓
 *   BehaviorModel        (activity, polarization proxy)
 *        ↓
 *   SimulatedPhysicalState (snapshot)
 *
 * References:
 *   TGC growth:      Johansson et al. (2014), Dumas et al. (2007)
 *   O₂ dynamics:    Tran-Duy et al. (2012), Thorarensen & Farrell (2011)
 *   Density stress:  Martins et al. (2011)
 *   NH₃ stress:      Randall & Tsui (2002)
 *   pH stress:       Fivelstad et al. (2003)
 *   O₂ solubility:   García & Gordon (1992) simplified approximation
 *   Boids behavior:  Marras et al. (2012, 2015)
 */

'use strict';

const { MODEL_CONFIG } = require('../domain/modelConfig');
const { DataSource }   = require('../domain/provenance');
const { SeededRandom } = require('./seededRandom');
const { getScenario }  = require('./scenarios');

const C = MODEL_CONFIG;

// ─── Causal constants (not duplicated from modelConfig — these are new) ───────

/**
 * EnvironmentalConstants — govern physical/chemical dynamics.
 * ASSUMPTION: These are order-of-magnitude estimates.
 * None are empirically validated for a specific farm.
 */
const ENV = Object.freeze({
  // O₂ saturation model: sat_DO(T) ≈ A - B*T  (simplified linear fit, mg/L)
  // Based on García & Gordon (1992) for 33 PSU, ~1 atm
  // Valid range: 0–25°C
  DO_SAT_A:    14.62,   // intercept
  DO_SAT_B:    0.3815,  // slope (mg/L per °C)

  // Respiratory O₂ demand by fish (mg O₂ per kg biomass per hour)
  // Scales with temperature via Q10 ≈ 2.3 (ASSUMPTION)
  O2_DEMAND_BASE:  120.0,  // mg O₂ / (kg·h) at 12°C reference
  O2_DEMAND_Q10:     2.3,
  O2_DEMAND_T_REF:  12.0,

  // Ammonia excretion rate (mg NH₃ per kg biomass per day) at reference T
  // ASSUMPTION: linear with feeding activity
  NH3_EXCRETION_BASE: 0.022,  // mg / (kg·h) at 14°C, full feeding
  NH3_DILUTION_RATE:  0.15,   // fraction cleared per day by flow

  // Seasonal temperature baseline: offshore Norwegian/Chilean latitude
  //   T_baseline(day) = T_mean + T_amp * sin(2π/365 * day - phase)
  SEASONAL_T_MEAN:    12.5,   // °C — annual mean
  SEASONAL_T_AMP:      3.0,   // °C — seasonal amplitude
  SEASONAL_T_PHASE:    1.57,  // radians (~π/2: coldest in winter, warmest in summer)

  // Diel dissolved oxygen variation (driven by photosynthesis in baseline)
  // ASSUMPTION: small open-sea cage; photosynthesis contribution minimal
  DIEL_DO_AMP:    0.35,   // mg/L amplitude (max at midday)

  // pH baseline and diel variation
  PH_BASELINE:    7.82,
  DIEL_PH_AMP:    0.06,

  // Salinity baseline (PSU)
  SALINITY_BASE:  33.1,
  SALINITY_NOISE: 0.05,  // daily variation std

  // Baseline flow (L/min)
  FLOW_BASE:    1185,
  FLOW_NOISE:    20,

  // Turbidity baseline (NTU)
  TURBIDITY_BASE:  2.2,
  TURBIDITY_NOISE: 0.2,

  // Transition rate for environmental variables (fraction of gap per day)
  // When a scenario target is set, current moves toward target at this rate
  ENV_TRANSITION_RATE: 0.12,
});

// ─── Stress functions (unified — use MODEL_CONFIG) ───────────────────────────

function fTemp(T) {
  return Math.exp(-0.5 * ((T - C.T_OPT) / C.T_SIGMA) ** 2);
}

function fOxy(DO) {
  if (DO <= C.DO_LETHAL) return 0;
  if (DO <= C.DO_CRIT)   return 0.05 + 0.18 * (DO - C.DO_LETHAL) / (C.DO_CRIT - C.DO_LETHAL);
  return DO / (DO + C.DO_HS);
}

function fDens(D) {
  if (D <= C.D_OPT) return 1;
  if (D >= C.D_MAX) return 0.05;
  return 1 - 0.95 * (D - C.D_OPT) / (C.D_MAX - C.D_OPT);
}

function fNH3(a) {
  if (a <= C.NH3_SUB) return 1;
  if (a >= C.NH3_LET) return 0;
  return 1 - (a - C.NH3_SUB) / (C.NH3_LET - C.NH3_SUB);
}

function fpH(pH) {
  if (pH <= C.PH_MIN || pH >= C.PH_MAX) return 0.1;
  if (pH >= C.PH_LO  && pH <= C.PH_HI)  return 1.0;
  return pH < C.PH_LO
    ? 0.1 + 0.9 * (pH - C.PH_MIN) / (C.PH_LO - C.PH_MIN)
    : 1.0 - 0.9 * (pH - C.PH_HI)  / (C.PH_MAX - C.PH_HI);
}

/**
 * Clamp a number to [min, max].
 */
function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

// ─── Default initial conditions per cohort ────────────────────────────────────

function defaultInitialBioState(cohort, cage) {
  return {
    population:   cohort.initial_count    || 50000,
    weight_g:     cohort.initial_weight_g || 80,
    accum_feed_kg:  0,
    accum_dead:     0,
  };
}

function defaultInitialEnvState() {
  return {
    temperature:      ENV.SEASONAL_T_MEAN,
    dissolved_oxygen: 8.2,
    pH:               ENV.PH_BASELINE,
    salinity:         ENV.SALINITY_BASE,
    turbidity:        ENV.TURBIDITY_BASE,
    flow:             ENV.FLOW_BASE,
    ammonia:          0.008,
    algae_density:    0,
  };
}

// ─── Per-cage simulation state ────────────────────────────────────────────────

/**
 * CageSimState — mutable state for one cage simulation.
 * Stored per cage_id in the simulator's internal map.
 */
function createCageSimState(cage, cohort, rng) {
  const bio = defaultInitialBioState(cohort, cage);
  const env = defaultInitialEnvState();
  return {
    cage_id:   cage.cage_id,
    site_id:   cage.site_id,
    cohort_id: cohort.cohort_id,
    volume_m3: cage.volume_m3 || C.DEFAULT_CAGE_VOL_M3,
    sim_day:   0,
    rng,                        // per-cage seeded RNG

    // Biological state
    population:     bio.population,
    weight_g:       bio.weight_g,
    accum_feed_kg:  bio.accum_feed_kg,
    accum_dead:     bio.accum_dead,

    // Environmental state (physical truth — before sensor noise)
    temperature:      env.temperature,
    dissolved_oxygen: env.dissolved_oxygen,
    pH:               env.pH,
    salinity:         env.salinity,
    turbidity:        env.turbidity,
    flow:             env.flow,
    ammonia:          env.ammonia,
    algae_density:    env.algae_density,

    // Active scenario
    active_scenario:    'normal',
    scenario_days_left: 99999,

    // Last computed outputs (for inspection)
    last_step: null,
  };
}

// ─── PhysicalSystemSimulator ──────────────────────────────────────────────────

class PhysicalSystemSimulator {
  /**
   * @param {object} options
   * @param {number}  [options.seed=12345]         Global seed for reproducibility.
   * @param {number}  [options.noise_scale=1.0]    Multiplier for all sensor noise (0 = no noise).
   * @param {boolean} [options.deterministic=true] Force pure deterministic output.
   * @param {object}  [options.cages]              Map of cage objects from domain.
   * @param {object}  [options.cohorts]            Map of cohort objects from domain.
   */
  constructor(options = {}) {
    this.seed           = options.seed          !== undefined ? options.seed          : 12345;
    this.noise_scale    = options.noise_scale   !== undefined ? options.noise_scale   : 1.0;
    this.deterministic  = options.deterministic !== undefined ? options.deterministic : true;

    // Per-cage mutable state, keyed by cage_id
    this._cageStates = new Map();

    // Global RNG used for anything that isn't cage-specific
    this._globalRng = new SeededRandom(this.seed);

    // Register cages provided at construction time
    if (options.cages && options.cohorts) {
      for (const cage of options.cages) {
        const cohort = options.cohorts.find(ch => ch.cage_id === cage.cage_id && ch.status === 'ACTIVE');
        if (cohort) {
          this.registerCage(cage, cohort);
        }
      }
    }
  }

  // ─── Cage registration ─────────────────────────────────────────────────────

  /**
   * Register a cage + active cohort with the simulator.
   * Each cage gets its own independent RNG stream derived from the global seed.
   *
   * @param {object} cage    - domain Cage entity
   * @param {object} cohort  - domain Cohort entity (must have status=ACTIVE)
   */
  registerCage(cage, cohort) {
    if (!cage || !cohort) throw new Error('registerCage: cage and cohort are required.');
    const rng = SeededRandom.forCage(this.seed, cage.cage_id);
    const state = createCageSimState(cage, cohort, rng);
    this._cageStates.set(cage.cage_id, state);
    return this;
  }

  /**
   * Returns the internal simulation state for a cage (read-only copy).
   */
  getCageState(cage_id) {
    const s = this._cageStates.get(cage_id);
    if (!s) return null;
    // Return a shallow copy of scalar fields (no mutation from outside)
    return { ...s, rng: undefined, last_step: s.last_step ? { ...s.last_step } : null };
  }

  /**
   * Returns all registered cage IDs.
   */
  getCageIds() {
    return [...this._cageStates.keys()];
  }

  // ─── Scenario control ─────────────────────────────────────────────────────

  /**
   * Inject a scenario into a specific cage.
   * The scenario modifies the underlying physical state through causal dynamics,
   * not by directly overwriting displayed sensor values.
   *
   * @param {string} cage_id
   * @param {string} scenario_key   — key from scenarios.js (e.g. 'heatwave')
   */
  injectScenario(cage_id, scenario_key) {
    const state = this._cageStates.get(cage_id);
    if (!state) throw new Error(`injectScenario: cage '${cage_id}' not registered.`);
    const sc = getScenario(scenario_key);
    state.active_scenario    = scenario_key;
    state.scenario_days_left = sc.duration_days;
    return sc;
  }

  // ─── Core simulation step ──────────────────────────────────────────────────

  /**
   * Advance the simulation for a given cage by one day.
   * Returns a SimulatedPhysicalState snapshot.
   *
   * @param {string} cage_id
   * @param {object} [overrides]  Optional external forcing overrides (for testing)
   * @returns {object} SimulatedPhysicalState
   */
  stepCage(cage_id, overrides = {}) {
    const state = this._cageStates.get(cage_id);
    if (!state) throw new Error(`stepCage: cage '${cage_id}' not registered.`);

    const rng = state.rng;
    const sc  = getScenario(state.active_scenario);
    const day = state.sim_day;
    const vol = state.volume_m3;

    // ── 1. ENVIRONMENTAL MODEL ──────────────────────────────────────────────

    // 1a. Temperature: seasonal baseline + scenario forcing + diel noise
    const seasonalT = ENV.SEASONAL_T_MEAN
      + ENV.SEASONAL_T_AMP * Math.sin((day / 365) * 2 * Math.PI - ENV.SEASONAL_T_PHASE);

    let targetT = (sc.temperature_target !== null) ? sc.temperature_target : seasonalT;
    if (overrides.temperature_target !== undefined) targetT = overrides.temperature_target;

    const transRate = (sc.temperature_rate !== null)
      ? sc.temperature_rate / Math.abs(targetT - state.temperature + 0.001)
      : ENV.ENV_TRANSITION_RATE;

    // Move current temperature toward target (first-order lag)
    const tempDelta = (targetT - state.temperature) * Math.min(1, ENV.ENV_TRANSITION_RATE + transRate * 0.05);
    const tempNoise = this.noise_scale > 0
      ? rng.normal(0, C.SENSOR_NOISE.temperature * this.noise_scale * 0.3)
      : 0;
    state.temperature = clamp(
      state.temperature + tempDelta + tempNoise,
      C.PARAMETER_RANGES.temperature.min + 2,
      C.PARAMETER_RANGES.temperature.max - 5,
    );

    // 1b. DO dynamics (causal — depends on temperature, biomass, flow, algae)
    //
    // DO_sat(T, S) ≈ DO_SAT_A - DO_SAT_B * T  (simplified, ~33 PSU)
    // DO_demand = O2_DEMAND_BASE * Q10^((T - T_ref)/10) * (biomass_kg / vol_m3) * (1/24)
    //   = daily demand in mg/L
    // DO_input  = flow * DO_sat / vol  (simplified: flow brings in O₂-saturated water)
    // DO_final  = DO_current + DO_input - DO_demand + DO_forcing
    //
    // ASSUMPTION: flow is in L/min; converted to m³/day: flow * 60 * 24 / 1000
    // ASSUMPTION: incoming water is at DO_sat; model ignores stratification

    const DO_sat = clamp(ENV.DO_SAT_A - ENV.DO_SAT_B * state.temperature, 5, 15);

    const biomass_kg = state.population * state.weight_g / 1e6 * 1000; // tonnes → kg
    const density    = biomass_kg / vol;  // kg/m³

    const Q10_factor = Math.pow(ENV.O2_DEMAND_Q10, (state.temperature - ENV.O2_DEMAND_T_REF) / 10);
    const daily_O2_demand = ENV.O2_DEMAND_BASE * Q10_factor * density / 1000 / 24 * 24;
    // mg O₂ / (kg·h) * factor * (kg/m³) → mg/L/day

    // Flow-based O₂ resupply
    const effectiveFlow = state.flow * (sc.flow_multiplier || 1.0);
    const flow_m3_day   = effectiveFlow * 60 * 24 / 1000;  // L/min → m³/day
    const DO_resupply   = (flow_m3_day / vol) * (DO_sat - state.dissolved_oxygen);
    const DO_resupply_clamped = clamp(DO_resupply, -2, 2);

    // Algae bloom: daytime O₂ production, nighttime consumption
    // ASSUMPTION: net daily effect of a bloom is approximately neutral;
    // strong blooms can cause net negative (more respiration)
    const algaeEffect = sc.algae_bloom_density > 0
      ? (1.5 - sc.algae_bloom_density * 0.3) * 0.05
      : 0;

    const DO_forcing = sc.do_forcing || 0;
    const doDiurnalNoise = this.noise_scale > 0
      ? rng.normal(0, C.SENSOR_NOISE.dissolved_oxygen * this.noise_scale * 0.3)
      : 0;

    state.dissolved_oxygen = clamp(
      state.dissolved_oxygen
        + DO_resupply_clamped
        - daily_O2_demand * 0.01   // daily net change (scaled to 0-1 per step)
        + DO_forcing * 0.15        // scenario forcing applied gradually
        + algaeEffect
        + doDiurnalNoise,
      0.3,
      DO_sat + 0.5,
    );

    // 1c. Ammonia (causal: excretion from fish, dilution by flow, scenario forcing)
    //
    // NH3 produced ∝ biomass * feeding_activity / dilution_by_flow
    // ASSUMPTION: ammonia excretion model is simplified and not species-calibrated

    const feedingActivity = Math.max(0.1, fTemp(state.temperature) * fOxy(state.dissolved_oxygen));
    const NH3_excretion  = ENV.NH3_EXCRETION_BASE * density * feedingActivity;  // mg/L/day (approx)
    const NH3_dilution   = state.ammonia * ENV.NH3_DILUTION_RATE * (effectiveFlow / ENV.FLOW_BASE);
    const NH3_forcing    = sc.ammonia_forcing_rate || 0;
    const NH3_noise      = this.noise_scale > 0
      ? rng.normal(0, C.SENSOR_NOISE.ammonia * this.noise_scale * 0.2)
      : 0;

    state.ammonia = clamp(
      state.ammonia + NH3_excretion * 0.0002 - NH3_dilution + NH3_forcing + NH3_noise,
      0,
      C.PARAMETER_RANGES.ammonia.max,
    );

    // 1d. pH (causal: CO₂ from fish respiration lowers pH; algae bloom raises it)
    //
    // ASSUMPTION: simplified; real pH is complex buffering chemistry
    const CO2_acidification = (daily_O2_demand * 0.001) * 0.04;  // O₂ demand proxy for CO₂ production
    const algaePH_effect    = sc.algae_bloom_density > 0
      ? sc.algae_bloom_density * 0.015
      : 0;
    const pH_seasonal       = ENV.PH_BASELINE + 0.04 * Math.sin((day / 365) * 2 * Math.PI);
    const pH_target         = pH_seasonal + algaePH_effect;
    const pH_approach       = (pH_target - state.pH) * ENV.ENV_TRANSITION_RATE;
    const pH_noise          = this.noise_scale > 0
      ? rng.normal(0, C.SENSOR_NOISE.pH * this.noise_scale * 0.3)
      : 0;

    state.pH = clamp(
      state.pH + pH_approach - CO2_acidification + pH_noise,
      C.PARAMETER_RANGES.pH.min,
      C.PARAMETER_RANGES.pH.max,
    );

    // 1e. Salinity (scenario forcing + slow natural variation)
    const salinityTarget = sc.salinity_target !== null ? sc.salinity_target : ENV.SALINITY_BASE;
    const salinity_noise = this.noise_scale > 0
      ? rng.normal(0, ENV.SALINITY_NOISE * this.noise_scale)
      : 0;
    state.salinity = clamp(
      state.salinity + (salinityTarget - state.salinity) * ENV.ENV_TRANSITION_RATE * 0.3 + salinity_noise,
      C.PARAMETER_RANGES.salinity.min,
      C.PARAMETER_RANGES.salinity.max,
    );

    // 1f. Turbidity (scenario + natural settling)
    const turbidityTarget = ENV.TURBIDITY_BASE + (sc.turbidity_add || 0);
    const turbidity_noise = this.noise_scale > 0
      ? rng.normal(0, ENV.TURBIDITY_NOISE * this.noise_scale)
      : 0;
    state.turbidity = clamp(
      state.turbidity + (turbidityTarget - state.turbidity) * ENV.ENV_TRANSITION_RATE * 0.5 + turbidity_noise,
      0.1,
      C.PARAMETER_RANGES.turbidity.max,
    );

    // 1g. Flow (scenario multiplier applied to baseline)
    const flowTarget  = ENV.FLOW_BASE * (sc.flow_multiplier || 1.0);
    const flow_noise  = this.noise_scale > 0
      ? rng.normal(0, ENV.FLOW_NOISE * this.noise_scale)
      : 0;
    state.flow = clamp(
      state.flow + (flowTarget - state.flow) * ENV.ENV_TRANSITION_RATE * 0.4 + flow_noise,
      50,
      C.PARAMETER_RANGES.flow.max,
    );

    // ── 2. STRESS MODEL ─────────────────────────────────────────────────────

    const ft    = fTemp(state.temperature);
    const fo    = fOxy(state.dissolved_oxygen);
    const fd    = fDens(density);
    const fa    = fNH3(state.ammonia);
    const fp    = fpH(state.pH);
    const f_total = ft * fo * fd * fa * fp;
    const health_stress = 1 - f_total;  // 0 = no stress, 1 = lethal stress

    // ── 3. GROWTH MODEL (TGC) ───────────────────────────────────────────────

    const TGC_eff  = C.TGC * f_total + C.TGC_MIN * (1 - f_total);
    const cbrt_old = Math.cbrt(state.weight_g);
    const cbrt_new = cbrt_old + TGC_eff * Math.max(0.1, state.temperature) / 1000;
    // Weight must not decrease below 99.9% of previous (fish can't shrink significantly in one day)
    const weight_new_g = Math.max(cbrt_new ** 3, state.weight_g * 0.999);
    const SGR_pct_day  = 100 * Math.log(weight_new_g / state.weight_g);

    // ── 4. MORTALITY MODEL ──────────────────────────────────────────────────

    // Base mortality + stress-driven mortality + hypoxia spike
    const mu_stress  = 0.003 * (1 - f_total)
      + (state.dissolved_oxygen < C.DO_CRIT ? 0.007 : 0)
      + (state.ammonia > C.NH3_SUB ? 0.001 * (state.ammonia - C.NH3_SUB) / (C.NH3_LET - C.NH3_SUB) : 0);
    const mu_daily   = clamp(C.MU_BASE + mu_stress, 0, 0.15);  // cap at 15%/day
    const pop_new    = state.population * (1 - mu_daily);
    const dead_today = state.population - pop_new;

    // ── 5. FEEDING MODEL ────────────────────────────────────────────────────

    // Feed intake rate (fraction of body weight per day)
    // Higher weight → lower intake rate; stress reduces intake
    const FI_rate_max = Math.max(0.006, 0.016 - 0.00018 * Math.sqrt(weight_new_g));
    const FI_rate     = FI_rate_max * Math.max(0.08, f_total);  // stress suppresses feeding

    // Daily feed consumption (kg)
    const feed_kg_today = pop_new * weight_new_g * FI_rate / 1000;

    // FCR (instantaneous) — ratio of feed consumed to biomass gained
    const biomass_before = state.population * state.weight_g / 1e6;  // tonnes
    const biomass_after  = pop_new           * weight_new_g   / 1e6;  // tonnes
    const delta_biomass  = biomass_after - biomass_before;            // tonnes
    const FCR = (delta_biomass > 0.0001)
      ? (feed_kg_today / 1000) / delta_biomass
      : C.FCR_BASE;

    // ── 6. POPULATION ACCOUNTING (Mass Balance) ─────────────────────────────

    state.population    = pop_new;
    state.weight_g      = weight_new_g;
    state.accum_feed_kg += feed_kg_today;
    state.accum_dead    += dead_today;

    // ── 7. SCENARIO COUNTDOWN ───────────────────────────────────────────────

    if (state.active_scenario !== 'normal') {
      state.scenario_days_left--;
      if (state.scenario_days_left <= 0) {
        state.active_scenario    = 'normal';
        state.scenario_days_left = 99999;
      }
    }

    // ── 8. BEHAVIOR MODEL (polarization proxy) ───────────────────────────────
    //
    // Polarization index Φ ≈ f_total (healthy school = high polarization)
    // This is a simplified proxy; Boids visualization handles actual rendering
    const polarization     = clamp(f_total * (1 - density / (C.D_MAX * 2)), 0, 1);
    const behavior_state   = _classifyBehavior(
      state.dissolved_oxygen, state.temperature, density,
      state.active_scenario, polarization,
    );

    // ── 9. ADVANCE DAY ──────────────────────────────────────────────────────
    state.sim_day++;

    // ── 10. BUILD SNAPSHOT ──────────────────────────────────────────────────

    const snapshot = {
      // Identity
      site_id:   state.site_id,
      cage_id:   state.cage_id,
      cohort_id: state.cohort_id,
      timestamp: new Date().toISOString(),
      sim_day:   state.sim_day,
      source:    DataSource.SIMULATION,

      // Population & growth
      population:      Math.round(pop_new),
      weight_g:        +weight_new_g.toFixed(2),
      biomass_kg:      +(pop_new * weight_new_g / 1e3).toFixed(1),  // kg (not tonnes)
      SGR_pct_day:     +SGR_pct_day.toFixed(4),
      TGC_effective:   +TGC_eff.toFixed(3),
      days_to_harvest: _daysToHarvest(weight_new_g, state.temperature, f_total),

      // Mortality & feeding
      mortality_rate:  +mu_daily.toFixed(5),
      dead_today:      +dead_today.toFixed(1),
      accum_dead:      +state.accum_dead.toFixed(0),
      daily_feed_kg:   +feed_kg_today.toFixed(1),
      accum_feed_kg:   +state.accum_feed_kg.toFixed(1),
      FCR:             +Math.min(FCR, 5).toFixed(3),

      // Environment (physical truth — no sensor noise yet)
      temperature:      +state.temperature.toFixed(2),
      dissolved_oxygen: +state.dissolved_oxygen.toFixed(2),
      pH:               +state.pH.toFixed(3),
      salinity:         +state.salinity.toFixed(2),
      turbidity:        +state.turbidity.toFixed(2),
      flow:             +state.flow.toFixed(0),
      ammonia:          +state.ammonia.toFixed(5),
      DO_saturation:    +(ENV.DO_SAT_A - ENV.DO_SAT_B * state.temperature).toFixed(2),
      density_kg_m3:    +density.toFixed(2),
      volume_m3:        state.volume_m3,

      // Stress model outputs
      health_stress:    +health_stress.toFixed(4),  // 0 = healthy, 1 = lethal
      f_total:          +f_total.toFixed(4),
      stress_factors: {
        f_temperature: +ft.toFixed(4),
        f_oxygen:      +fo.toFixed(4),
        f_density:     +fd.toFixed(4),
        f_ammonia:     +fa.toFixed(4),
        f_pH:          +fp.toFixed(4),
      },
      health_risk: f_total > 0.80 ? 'LOW' : f_total > 0.55 ? 'MODERATE' : 'HIGH',

      // Behavior
      polarization_index: +polarization.toFixed(3),
      behavior_state,

      // Scenario
      active_scenario:    state.active_scenario,
      scenario_days_left: state.scenario_days_left,
    };

    state.last_step = snapshot;
    return snapshot;
  }

  // ─── Multi-step advance ────────────────────────────────────────────────────

  /**
   * Advance all registered cages by `days` simulation days.
   * Returns an array of the final snapshot for each cage.
   *
   * @param {number} days
   * @returns {object[]}
   */
  stepAll(days = 1) {
    const results = {};
    for (const cage_id of this._cageStates.keys()) {
      let last;
      for (let d = 0; d < days; d++) {
        last = this.stepCage(cage_id);
      }
      results[cage_id] = last;
    }
    return results;
  }

  /**
   * Generate N days of history for a cage starting from current state.
   * Useful for pre-seeding charts and data history on startup.
   *
   * @param {string}  cage_id
   * @param {number}  days
   * @returns {object[]}  Array of daily snapshots
   */
  generateHistory(cage_id, days) {
    const history = [];
    for (let d = 0; d < days; d++) {
      history.push(this.stepCage(cage_id));
    }
    return history;
  }

  /**
   * Reset a cage to its initial conditions (using original cohort data).
   * The RNG state is also reset so runs are fully reproducible.
   *
   * @param {string} cage_id
   * @param {object} cage
   * @param {object} cohort
   */
  resetCage(cage_id, cage, cohort) {
    const rng = SeededRandom.forCage(this.seed, cage_id);
    this._cageStates.set(cage_id, createCageSimState(cage, cohort, rng));
  }
}

// ─── Private helpers ─────────────────────────────────────────────────────────

function _daysToHarvest(weight_g, temperature, f_total) {
  if (weight_g >= C.HARVEST_W) return 0;
  const TGC_eff = C.TGC * f_total + C.TGC_MIN * (1 - f_total);
  const inc     = TGC_eff * Math.max(0.1, temperature) / 1000;
  if (inc <= 0) return 9999;
  const cbrt_rem = Math.cbrt(C.HARVEST_W) - Math.cbrt(weight_g);
  return cbrt_rem <= 0 ? 0 : Math.round(cbrt_rem / inc);
}

function _classifyBehavior(DO, T, density, scenario, polarization) {
  if (DO < 2.5)             return { label: 'PIPING_CRITICAL',   color: '#ff4044' };
  if (DO < 4.0)             return { label: 'PIPING_ACUTE',      color: '#ff6620' };
  if (DO < 5.5)             return { label: 'O2_SEEKING',        color: '#f0a500' };
  if (T > 20)               return { label: 'THERMAL_STRESS',    color: '#ff6020' };
  if (T < 6)                return { label: 'COLD_INHIBITION',   color: '#60c0ff' };
  if (T < 9)                return { label: 'REDUCED_ACTIVITY',  color: '#90d0ff' };
  if (density > 35)         return { label: 'LAMINAR_CROWDING',  color: '#80bfff' };
  if (scenario === 'lice')  return { label: 'ANTIPARASITE',      color: '#f0a500' };
  if (scenario === 'ammonia') return { label: 'NEUROTOXIC_STRESS', color: '#ff6060' };
  if (polarization > 0.68)  return { label: 'POLARIZED_SCHOOL',  color: '#00d97e' };
  if (polarization > 0.42)  return { label: 'MODERATE_SCHOOL',   color: '#80d060' };
  return { label: 'DISPERSED_SCHOOL', color: '#f0a500' };
}

module.exports = { PhysicalSystemSimulator, ENV };
