/**
 * scenarios.js
 * AquaTwins — Scenario definitions for PhysicalSystemSimulator.
 *
 * A scenario modifies the UNDERLYING SIMULATED PHYSICAL STATE,
 * not merely frontend display values.
 *
 * Each scenario defines:
 *   - target environmental overrides (the "forcing" values)
 *   - transition rate (how fast conditions move toward target)
 *   - duration in simulation days
 *   - causal description for explainability
 *
 * IMPORTANT: These are simulation inputs, not sensor readings.
 * Scenarios drive the EnvironmentalModel, which then computes
 * the actual physical state (including DO dynamics, ammonia, etc.)
 * through causal equations — not direct value replacement.
 */

'use strict';

/**
 * Scenario parameter overrides.
 * Each field can be null (= no override; use baseline dynamics).
 *
 * @typedef {object} ScenarioDefinition
 * @property {string}  name
 * @property {string}  description
 * @property {number|null} temperature_target    Forced ambient temperature (°C)
 * @property {number|null} temperature_rate      °C/day approach rate (null = 2.0)
 * @property {number|null} flow_multiplier       Multiply baseline flow by this factor
 * @property {number|null} turbidity_add         Add to baseline turbidity (NTU)
 * @property {number|null} salinity_target       Force salinity toward this value (PSU)
 * @property {number|null} ammonia_forcing_rate  Extra NH₃ production rate (mg/L/day)
 * @property {number|null} algae_bloom_density   Chlorophyll proxy (mg/L); drives pH/DO dynamics
 * @property {number|null} do_forcing            Directly reduce DO (mg/L); models O₂ depletion event
 * @property {number}      duration_days         Scenario active duration
 * @property {boolean}     chronic               If true, scenario resets to normal gradually after duration
 * @property {string[]}    causal_chain          Explainability chain
 */

const SCENARIOS = Object.freeze({

  normal: {
    name:        'Condiciones Nominales',
    description: 'Baseline conditions for Salmo salar marine phase.',
    temperature_target:   null,   // use seasonal baseline
    temperature_rate:     null,
    flow_multiplier:      1.0,
    turbidity_add:        0,
    salinity_target:      null,
    ammonia_forcing_rate: 0,
    algae_bloom_density:  0,
    do_forcing:           0,
    duration_days:        99999,
    chronic:              false,
    causal_chain: ['Baseline conditions', 'No stress forcing applied'],
  },

  heatwave: {
    name:        'Ola de Calor',
    description: 'Sustained high-temperature event reducing growth and increasing hypoxia risk.',
    temperature_target:   21.4,
    temperature_rate:     1.5,    // °C/day
    flow_multiplier:      0.85,   // reduced flow in warm water
    turbidity_add:        1.5,
    salinity_target:      33.7,   // slight evaporative concentration
    ammonia_forcing_rate: 0.0008, // higher metabolic ammonia at high T
    algae_bloom_density:  0.5,
    do_forcing:           0,      // DO drops due to temperature (modelled causally)
    duration_days:        14,
    chronic:              false,
    causal_chain: [
      'High temperature increases metabolic rate',
      'O₂ solubility decreases (Henry\'s law)',
      'DO deficit develops',
      'Stress index rises → growth suppression',
      'Ammonia excretion rate increases',
      'Feed intake suppressed',
    ],
  },

  hypoxia: {
    name:        'Hipoxia Aguda',
    description: 'Acute DO deficit — piping and mortality risk.',
    temperature_target:   13.2,
    temperature_rate:     0.5,
    flow_multiplier:      0.50,   // flow interruption driving hypoxia
    turbidity_add:        2.5,
    salinity_target:      null,
    ammonia_forcing_rate: 0.0005,
    algae_bloom_density:  0,
    do_forcing:           -4.5,   // Strong direct DO reduction (mg/L)
    duration_days:        7,
    chronic:              false,
    causal_chain: [
      'Flow failure or algae respiration',
      'DO crashes below 4 mg/L',
      'Fish exhibit piping behaviour',
      'Severe growth suppression',
      'Acute mortality risk',
    ],
  },

  algae: {
    name:        'Bloom Algal',
    description: 'Algal bloom causing pH spike and daytime O₂ supersaturation / night-time hypoxia.',
    temperature_target:   16.6,
    temperature_rate:     1.0,
    flow_multiplier:      0.80,
    turbidity_add:        27.0,   // high turbidity from bloom
    salinity_target:      null,
    ammonia_forcing_rate: 0.0003,
    algae_bloom_density:  8.0,    // drives pH/DO oscillation
    do_forcing:           0,      // modelled through algae dynamics
    duration_days:        10,
    chronic:              false,
    causal_chain: [
      'Algal bloom increases turbidity',
      'Photosynthesis drives daytime pH spike',
      'Night-time O₂ depletion from respiration',
      'pH > 9 causes ammonia toxicity increase',
      'Light attenuation stresses fish',
    ],
  },

  storm: {
    name:        'Tormenta',
    description: 'Storm event: temperature drop, mixing, turbidity spike, flow disruption.',
    temperature_target:   8.6,
    temperature_rate:     3.0,    // rapid cooling
    flow_multiplier:      0.30,   // infrastructure disruption
    turbidity_add:        42.0,   // wave mixing / sediment resuspension
    salinity_target:      31.7,   // freshwater input from rain
    ammonia_forcing_rate: 0,
    algae_bloom_density:  0,
    do_forcing:           2.0,    // mixing increases surface DO
    duration_days:        3,
    chronic:              false,
    causal_chain: [
      'Wind and waves cause cage movement',
      'Turbidity spike from sediment',
      'Temperature drop from cold mixing',
      'Salinity dilution from rainfall',
      'Short acute stress, recovery expected',
    ],
  },

  ammonia: {
    name:        'Pico de Amonio',
    description: 'Ammonia spike from overfeeding or system failure.',
    temperature_target:   13.1,
    temperature_rate:     0.5,
    flow_multiplier:      0.85,   // reduced flushing
    turbidity_add:        1.2,
    salinity_target:      null,
    ammonia_forcing_rate: 0.006,  // high NH₃ input rate (mg/L/day)
    algae_bloom_density:  0,
    do_forcing:           -0.8,
    duration_days:        5,
    chronic:              false,
    causal_chain: [
      'Excess feed accumulation or system fault',
      'NH₃ builds above 0.012 mg/L sub-lethal threshold',
      'Neurotoxic stress causes erratic swimming',
      'Growth strongly suppressed',
      'Acute mortality risk if >0.050 mg/L',
    ],
  },

  cold: {
    name:        'Agua Fría',
    description: 'Sustained cold-water event reducing metabolic rate and growth.',
    temperature_target:   6.0,
    temperature_rate:     0.8,
    flow_multiplier:      1.0,
    turbidity_add:        0,
    salinity_target:      34.1,   // cold water usually higher salinity
    ammonia_forcing_rate: 0,
    algae_bloom_density:  0,
    do_forcing:           2.5,    // cold water holds more O₂
    duration_days:        21,
    chronic:              false,
    causal_chain: [
      'Cold water reduces enzyme kinetics',
      'Growth rate falls (TGC suppressed)',
      'DO improves (higher solubility)',
      'Feed intake drops significantly',
      'Extended time to harvest',
    ],
  },

  lice: {
    name:        'Piojo de Mar',
    description: 'Sea lice infestation causing chronic stress and behavior change.',
    temperature_target:   12.5,
    temperature_rate:     0.5,
    flow_multiplier:      0.95,
    turbidity_add:        1.7,
    salinity_target:      null,
    ammonia_forcing_rate: 0.0004, // lice increase mucus/metabolic waste
    algae_bloom_density:  0,
    do_forcing:           -0.5,
    duration_days:        30,
    chronic:              true,   // chronic — fades slowly after duration
    causal_chain: [
      'Ectoparasite causes skin and gill damage',
      'Chronic immune activation increases cortisol',
      'Feed conversion efficiency decreases',
      'Erratic swimming reduces school cohesion',
      'Gradual reduction in growth rate',
    ],
  },

});

/**
 * Returns the scenario definition for the given key.
 * Falls back to 'normal' if key is unknown.
 *
 * @param {string} key
 * @returns {object}
 */
function getScenario(key) {
  return SCENARIOS[key] || SCENARIOS.normal;
}

/**
 * Returns all scenario keys.
 * @returns {string[]}
 */
function listScenarios() {
  return Object.keys(SCENARIOS);
}

module.exports = { SCENARIOS, getScenario, listScenarios };
