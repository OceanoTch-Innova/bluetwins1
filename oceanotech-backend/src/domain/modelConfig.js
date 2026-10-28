/**
 * modelConfig.js
 * AquaTwins — Shared biological model constants for Salmo salar.
 *
 * SINGLE SOURCE OF TRUTH for all mathematical model parameters.
 * Previously these were duplicated in:
 *   - Dashboard/index.html  (const M = {...})
 *   - Dashboard/Script.js   (CONFIG.MODEL)
 *   - src/routes/twin.js    (const M = {...})
 *
 * This module resolves TD-01 (duplicated constants) and TD-02 (divergence risk).
 *
 * Model status: EXPERIMENTAL
 * Parameters are based on published literature for Atlantic Salmon (Salmo salar).
 * They have NOT been calibrated against a specific farm or cohort.
 * Do not present these values as scientifically validated for a specific deployment.
 *
 * References:
 *   - TGC model:     Johansson et al. (2014) · Dumas et al. (2007)
 *   - O₂ stress:     Tran-Duy et al. (2012) · Thorarensen & Farrell (2011)
 *   - Density stress: Martins et al. (2011)
 *   - NH₃ stress:    Randall & Tsui (2002)
 *   - pH stress:     Fivelstad et al. (2003)
 *   - Mortality:     Johansson et al. (2014)
 */

'use strict';

const MODEL_CONFIG = Object.freeze({
  // ── Growth (TGC model) ──────────────────────────────────────────────────────
  TGC:       2.85,   // Thermal Growth Coefficient — marine phase (nominal)
  TGC_MIN:   0.40,   // TGC floor under extreme combined stress
  HARVEST_W: 5000,   // Target harvest weight (g)
  FCR_BASE:  1.15,   // Feed Conversion Ratio baseline

  // ── Temperature stress — Gaussian ──────────────────────────────────────────
  T_OPT:   14.0,     // Optimal temperature (°C) — Gaussian peak
  T_SIGMA:  4.5,     // Gaussian width (°C)

  // ── Dissolved oxygen stress — Michaelis-Menten ─────────────────────────────
  DO_HS:     3.5,    // Half-saturation constant (mg/L)
  DO_CRIT:   4.0,    // Critical hypoxia threshold (mg/L)
  DO_LETHAL: 2.5,    // Lethal DO threshold (mg/L)
  DO_PIPE:   5.5,    // Piping behaviour onset (mg/L)

  // ── Ammonia stress — linear decline ────────────────────────────────────────
  NH3_SUB:  0.012,   // Sub-lethal (un-ionised NH₃) threshold (mg/L)
  NH3_LET:  0.050,   // Lethal threshold (mg/L)

  // ── pH stress — piecewise linear ───────────────────────────────────────────
  PH_LO:  7.0,       // Lower bound of optimal range
  PH_HI:  8.0,       // Upper bound of optimal range
  PH_MIN: 6.5,       // Absolute minimum (below → near-zero growth)
  PH_MAX: 8.5,       // Absolute maximum (above → near-zero growth)

  // ── Density stress — linear threshold ──────────────────────────────────────
  D_OPT:  20,        // Optimal density ceiling (kg/m³)
  D_MAX:  45,        // Density at which growth factor = 0.05

  // ── Mortality ───────────────────────────────────────────────────────────────
  MU_BASE: 0.0003,   // Background daily mortality rate (fraction/day)

  // ── Default cage geometry ──────────────────────────────────────────────────
  // Used only when no cage-specific volume is provided.
  DEFAULT_CAGE_VOL_M3: 2000,  // Circular cage Ø40m × 20m depth

  // ── Sensor noise levels (for simulation) ───────────────────────────────────
  SENSOR_NOISE: Object.freeze({
    temperature: 0.11,
    dissolved_oxygen: 0.065,
    salinity: 0.038,
    pH: 0.011,
    ammonia: 0.00075,
    turbidity: 0.16,
    flow: 16,
  }),

  // ── Valid parameter ranges (for data validation) ───────────────────────────
  PARAMETER_RANGES: Object.freeze({
    temperature:      { min: -2,   max: 35    },
    dissolved_oxygen: { min: 0,    max: 20    },
    salinity:         { min: 0,    max: 45    },
    pH:               { min: 5.5,  max: 10    },
    ammonia:          { min: 0,    max: 0.1   },
    turbidity:        { min: 0,    max: 200   },
    flow:             { min: 0,    max: 5000  },
    chlorophyll:      { min: 0,    max: 100   },
    ORP:              { min: -500, max: 500   },
    CO2:              { min: 0,    max: 5000  },
  }),
});

module.exports = { MODEL_CONFIG };
