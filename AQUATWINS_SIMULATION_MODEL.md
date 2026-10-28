# AQUATWINS — Simulation Model Documentation
## Phase 2 — Physical System Simulator

**Version:** 0.2.0  
**Model status:** EXPERIMENTAL  
**Date:** 2025-06  
**Author:** AquaTwins Engineering  

> **⚠ DISCLAIMER:** All models described in this document have status `EXPERIMENTAL`.
> None of the equations below have been calibrated against specific farm data.
> Parameter values are derived from published aquaculture literature for *Salmo salar*
> in the marine phase.  Numbers should not be interpreted as production-validated predictions.

---

## 1. Purpose

The `PhysicalSystemSimulator` is the foundational component of the AquaTwins simulation layer.
Its role is to produce a coherent virtual physical state for one or more aquaculture cages
in the absence of real sensor data.

**What it is:**
- A causal, deterministic simulation of the physical/biological environment inside a sea cage.
- A structured data source for the Virtual Sensor Engine (Phase 3) and Digital Twin Engine (Phase 7).
- A reproducible time-series generator for charts, testing, and demonstration.

**What it is NOT:**
- A Digital Twin Engine (state estimation, data assimilation).
- A Virtual Sensor Engine (sensor noise, dropout, drift, calibration error).
- A scientifically validated predictive model.

All outputs are labelled `source: SIMULATION`.

---

## 2. Architecture Position

```
SCENARIO FORCING
      ↓
EnvironmentalModel
  temperature, DO, pH, salinity, turbidity, flow, ammonia
      ↓
StressModel
  fTemp, fOxy, fDens, fNH3, fpH → f_total
      ↓
GrowthModel (TGC)
  weight_g, SGR
      ↓
MortalityModel
  mortality_rate, population
      ↓
FeedingModel
  daily_feed_kg, FCR
      ↓
PopulationAccounting (Mass Balance)
  population, biomass_kg, accum_dead
      ↓
BehaviorModel
  polarization_index, behavior_state
      ↓
SimulatedPhysicalState (snapshot)
      ↓
Phase 3: VirtualSensorEngine (adds noise, dropouts, drift)
      ↓
Phase 7: DigitalTwinEngine (state estimation, assimilation)
```

---

## 3. Files

| File | Purpose |
|------|---------|
| `src/simulator/PhysicalSystemSimulator.js` | Main simulator class |
| `src/simulator/seededRandom.js` | Mulberry32 deterministic PRNG |
| `src/simulator/scenarios.js` | Scenario definitions and forcing parameters |
| `src/simulator/index.js` | Public module API |
| `tests/test.simulator.js` | 71 unit tests |

---

## 4. Random Number Generation

### Algorithm: Mulberry32

A 32-bit seeded PRNG that passes TestU01 SmallCrush.
Chosen for:
- Full determinism across all Node.js versions.
- Single 32-bit integer state (simple, inspectable).
- No external dependencies.

### Multi-cage seeding

Each cage gets an independent RNG stream derived from the global seed and the cage ID:

```javascript
// djb2 hash of cage_id XOR'd with baseSeed
rng = SeededRandom.forCage(baseSeed, cage_id)
```

This ensures:
- Different cages diverge naturally (not correlated noise).
- Stepping cage A does not alter cage B's RNG state.
- Reproducibility: same `(seed, cage_id)` always produces the same stream.

### Noise control

`noise_scale` parameter (default `1.0`) is a global multiplier applied to all stochastic terms.

- `noise_scale = 0` → fully deterministic (no noise; useful for testing causal relationships).
- `noise_scale = 1.0` → full operational noise.
- Values `> 1.0` are valid for testing edge cases.

---

## 5. Environmental Model

All environmental variables evolve through first-order differential equations,
not through direct value replacement.

### 5.1 Temperature

```
T(t+1) = T(t) + ΔT_scenario + noise

ΔT_scenario = (T_target - T_current) × transition_rate
T_target    = seasonal_baseline  OR  scenario_override

seasonal_T(day) = T_mean + T_amp × sin(2π/365 × day − phase)
```

**Parameters (ENV constants):**

| Constant | Value | Note |
|----------|-------|------|
| `SEASONAL_T_MEAN` | 12.5 °C | Annual mean |
| `SEASONAL_T_AMP` | 3.0 °C | Seasonal amplitude |
| `SEASONAL_T_PHASE` | 1.57 rad (≈π/2) | Phase offset |
| `ENV_TRANSITION_RATE` | 0.12 | Fraction of gap per day |

**Model status:** EXPERIMENTAL. Parameters based on Northern/Chilean salmon farming latitude estimates. Not calibrated.

---

### 5.2 Dissolved Oxygen (DO)

Causal model combining:
1. **O₂ saturation at current temperature** (simplified Henry's law proxy)
2. **Fish respiratory demand** (Q10 temperature scaling, biomass-density-dependent)
3. **Flow-driven resupply** (incoming water at DO saturation)
4. **Scenario forcing** (gradual offset)
5. **Algae bloom effect** (net negative for strong blooms)

```
DO_sat(T) = A − B × T          (García & Gordon, 1992 simplified; valid 0–25°C, ~33 PSU)
A = 14.62, B = 0.3815

O2_demand = O2_BASE × Q10^((T−T_ref)/10) × density  [mg/L/day]
O2_resupply = (flow_m3_day / vol) × (DO_sat − DO_current)

DO(t+1) = DO(t) + DO_resupply − O2_demand×0.01 + DO_forcing×0.15 + noise
```

> **ASSUMPTION:** Incoming water is assumed to be at `DO_sat`. The model ignores stratification, cage-internal hydraulics, and boundary layer effects. This is a significant simplification.

---

### 5.3 Ammonia (NH₃)

```
NH3(t+1) = NH3(t)
           + excretion_rate × 0.0002   (scaled to daily balance)
           − NH3(t) × dilution_rate × (flow / FLOW_BASE)
           + NH3_forcing                (scenario)
           + noise

excretion_rate = NH3_BASE × density × feedingActivity
dilution_rate  = 0.15  (fraction/day)
```

> **ASSUMPTION:** Total ammonia (TAN) is modelled, not free NH₃. Free NH₃ fraction depends on pH and temperature (pKa) — this transformation is NOT currently implemented. The model treats the output as a proxy for total ammonia nitrogen, not directly as NH₃ toxicity.

---

### 5.4 pH

```
CO2_acidification = O2_demand × 0.001 × 0.04
algae_pH_effect   = algae_bloom_density × 0.015
pH_seasonal       = PH_BASELINE + 0.04 × sin(2π/365 × day)
pH_target         = pH_seasonal + algae_pH_effect

pH(t+1) = pH(t) + (pH_target − pH) × 0.12 − CO2_acidification + noise
```

> **ASSUMPTION:** Highly simplified. Real pH dynamics involve bicarbonate buffering, CO₂ partial pressure, alkalinity, and temperature. This model is a first-order proxy only.

---

### 5.5 Salinity, Turbidity, Flow

All three use first-order lag toward scenario-defined targets:

```
X(t+1) = X(t) + (X_target − X(t)) × rate + noise
```

| Variable | Baseline | Rate |
|----------|----------|------|
| Salinity | 33.1 PSU | 0.036/day |
| Turbidity | 2.2 NTU | 0.06/day |
| Flow | 1185 L/min | 0.048/day |

---

## 6. Stress Model

Five multiplicative stress factors produce a combined `f_total`:

```
f_total = fTemp × fOxy × fDens × fNH3 × fpH
```

`f_total ∈ (0, 1]`:
- `1.0` = optimal conditions, no stress
- `0.0` = lethal conditions (fish cannot survive)

### 6.1 Temperature stress — fTemp(T)

Gaussian shape centered on `T_OPT`:

```
fTemp(T) = exp(−0.5 × ((T − T_OPT) / T_SIGMA)²)
T_OPT   = 14.0 °C
T_SIGMA = 4.5 °C
```

*Reference: Johansson et al. (2014), Salmo salar thermal growth model.*

---

### 6.2 Oxygen stress — fOxy(DO)

Three-regime step function:

```
DO ≤ DO_LETHAL (1.5 mg/L)  → f = 0       (lethal)
DO ≤ DO_CRIT   (4.0 mg/L)  → f = 0.05–0.23 (severe stress)
DO > DO_CRIT               → f = DO / (DO + DO_HS)   (Michaelis-Menten; DO_HS = 3.5)
```

*Reference: Thorarensen & Farrell (2011); Tran-Duy et al. (2012).*

---

### 6.3 Density stress — fDens(D)

Linear degradation above optimal density:

```
D ≤ D_OPT (25 kg/m³) → f = 1
D ≥ D_MAX (65 kg/m³) → f = 0.05
otherwise             → f = 1 − 0.95 × (D − D_OPT) / (D_MAX − D_OPT)
```

*Reference: Martins et al. (2011).*

---

### 6.4 Ammonia stress — fNH3(a)

```
a ≤ NH3_SUB (0.012 mg/L) → f = 1
a ≥ NH3_LET (0.050 mg/L) → f = 0
otherwise                 → f = 1 − (a − NH3_SUB) / (NH3_LET − NH3_SUB)
```

*Reference: Randall & Tsui (2002).*  
> **NOTE:** As noted above, this model uses TAN as a proxy. Production use requires TAN → NH₃ speciation.

---

### 6.5 pH stress — fpH(pH)

```
pH ≤ PH_MIN (6.2) or ≥ PH_MAX (9.6) → f = 0.1
pH ∈ [PH_LO (7.0), PH_HI (8.8)]     → f = 1.0
outside optimal but within range      → linear interpolation
```

*Reference: Fivelstad et al. (2003).*

---

## 7. Growth Model (TGC)

Thermal Growth Coefficient model for *Salmo salar*:

```
cbrt_new = cbrt(W) + TGC_eff × T / 1000   (per day)
W_new    = cbrt_new³

W must not fall below 99.9% of W_prev (fish don't lose weight in one day)
```

Effective TGC is stress-adjusted:

```
TGC_eff = TGC × f_total + TGC_MIN × (1 − f_total)
TGC     = 2.85  (baseline; Johansson et al., 2014)
TGC_MIN = 0.8   (stressed growth floor)
```

**SGR calculation:**
```
SGR = 100 × ln(W_new / W_old)   (%/day)
```

**Days to harvest:**
```
days = (cbrt(W_harvest) − cbrt(W_current)) / (TGC_eff × T / 1000)
W_harvest = 5000 g
```

---

## 8. Mortality Model

```
mu_stress = 0.003 × (1 − f_total)
           + 0.007  [if DO < DO_CRIT]
           + 0.001 × (NH3 − NH3_SUB) / (NH3_LET − NH3_SUB)  [if NH3 > NH3_SUB]

mu_daily = clamp(MU_BASE + mu_stress, 0, 0.15)
MU_BASE  = 0.0002  (~7.3%/year baseline mortality)

population(t+1) = population(t) × (1 − mu_daily)
```

---

## 9. Feeding Model

Feed intake rate scales with body weight (larger fish eat less relative to body weight)
and is suppressed by stress:

```
FI_rate_max = max(0.006, 0.016 − 0.00018 × √W)   (fraction of body weight/day)
FI_rate     = FI_rate_max × max(0.08, f_total)

daily_feed_kg = population × W_g × FI_rate / 1000

FCR = (daily_feed_kg / 1000) / Δbiomass_t
    → capped at 5.0 when Δbiomass ≤ 0.0001 t/day
```

---

## 10. Population Accounting (Mass Balance)

Every step enforces explicit mass balance:

```
population(t+1) = population(t) × (1 − mu_daily)
accum_dead      = Σ dead_today
accum_feed_kg   = Σ daily_feed_kg
biomass_kg      = population × weight_g / 1000
```

The mass balance is deterministic. No fish appear or disappear without an explicit cause.

**Known gap:** Stocking events, harvest events, and sampling events are not yet wired into
the simulator (Phase 19 — Event Engine). The mass balance will be extended then.

---

## 11. Behavior Model

Polarization index (proxy for school cohesion):

```
polarization = clamp(f_total × (1 − density / (D_MAX × 2)), 0, 1)
```

Behavior is classified into labeled states based on DO, temperature, density, and active scenario:

| State | Condition |
|-------|-----------|
| `PIPING_CRITICAL` | DO < 2.5 mg/L |
| `PIPING_ACUTE` | DO < 4.0 mg/L |
| `O2_SEEKING` | DO < 5.5 mg/L |
| `THERMAL_STRESS` | T > 20°C |
| `COLD_INHIBITION` | T < 6°C |
| `REDUCED_ACTIVITY` | T < 9°C |
| `LAMINAR_CROWDING` | density > 35 kg/m³ |
| `ANTIPARASITE` | scenario = lice |
| `NEUROTOXIC_STRESS` | scenario = ammonia |
| `POLARIZED_SCHOOL` | polarization > 0.68 |
| `MODERATE_SCHOOL` | polarization > 0.42 |
| `DISPERSED_SCHOOL` | all others |

> **NOTE:** The behavior model is a proxy for visualization. It is not a validated fish
> behavior model. The Boids visualization in the frontend should be labelled as
> "Population behavior visualization — SIMULATION" in the UI (Phase 18).

---

## 12. Scenarios

Eight formal scenarios are implemented.

| Key | Name | Duration | Key forcing |
|-----|------|----------|-------------|
| `normal` | Condiciones Nominales | ∞ | Baseline; no overrides |
| `heatwave` | Ola de Calor | 14 days | T → 21.4°C, NH₃↑, flow↓ |
| `hypoxia` | Hipoxia Aguda | 7 days | DO forcing −4.5, flow 0.5× |
| `algae` | Bloom Algal | 10 days | Algae 8.0, turbidity +27 NTU |
| `storm` | Tormenta | 3 days | T→8.6°C, turbidity +42, flow 0.3× |
| `ammonia` | Pico de Amonio | 5 days | NH₃ forcing 0.006 mg/L/day |
| `cold` | Agua Fría | 21 days | T→6.0°C, DO↑, growth↓ |
| `lice` | Piojo de Mar | 30 days | Chronic; NH₃↑, DO↓0.5 |

All scenarios modify **physical forcing parameters**, not displayed sensor values.
They drive the causal models (temperature model, DO model, etc.) which then compute
the resulting physical state through the equations above.

---

## 13. Simulation Clock

- The simulator does not have a wall-clock.
- `sim_day` is a monotonic integer per cage, incremented by `stepCage()`.
- Multiple cages can be at different `sim_day` values (independent clocks).
- The `generateHistory(cage_id, N)` method runs N steps to pre-seed charts.
- On server startup, 90 days of history are pre-seeded for each active cage.

---

## 14. Reproducibility Guarantees

| Guarantee | Status |
|-----------|--------|
| Same seed → same sequence | ✅ Verified (test suite) |
| `resetCage()` restores initial state | ✅ Verified (test suite) |
| Different cage IDs → independent RNG streams | ✅ Verified (test suite) |
| `noise_scale=0` → fully deterministic | ✅ Verified (test suite) |
| Cross-platform (Windows/macOS/Linux) | ✅ Mulberry32 uses only `Math.imul` + bit ops |

---

## 15. Known Limitations and Technical Debt

| ID | Description | Severity | Planned fix |
|----|-------------|----------|-------------|
| SIM-01 | TAN used as NH₃ proxy; pH/temperature speciation not implemented | Medium | Phase 7 (Twin Core) or later |
| SIM-02 | pH model is highly simplified; no bicarbonate buffering | Medium | Phase 7 |
| SIM-03 | DO model assumes incoming water at full saturation | Medium | Phase 7 |
| SIM-04 | No stocking / harvest / sampling events in mass balance | Low (demo) | Phase 19 |
| SIM-05 | Single-cage volume assumed constant; no cage rotation model | Low | Phase 17 |
| SIM-06 | Behavior model is a proxy; not validated against fish telemetry | Low | Phase 17 |
| SIM-07 | Scenario recovery (chronic=true) not yet implemented | Low | Phase 16 |
| SIM-08 | No CO₂ model (relevant for recirculating systems) | Low | Phase 7 if needed |
| SIM-09 | `TGC = 2.85` not site-calibrated | High | Must be configurable per cohort |

---

## 16. References

All references listed below informed parameter choices. None constitute validation of this specific model implementation.

| Parameter area | Reference |
|----------------|-----------|
| TGC growth | Johansson et al. (2014). *"A mechanistic model for individual fish growth."* |
| TGC | Dumas et al. (2007). *"Comparison of TGC models."* Aquaculture. |
| DO dynamics | Tran-Duy et al. (2012). *"O₂ demand of Atlantic salmon."* |
| DO dynamics | Thorarensen & Farrell (2011). *"Critical swimming speed of Atlantic salmon."* |
| Density stress | Martins et al. (2011). *"Welfare indicators for farmed Atlantic salmon."* |
| NH₃ stress | Randall & Tsui (2002). *"Ammonia toxicity in fish."* Mar. Pollut. Bull. |
| pH stress | Fivelstad et al. (2003). *"Reduced pH reduces growth and welfare."* |
| O₂ solubility | García & Gordon (1992). *"Oxygen solubility in seawater."* L&O. |
| Behavior | Marras et al. (2012, 2015). *"Schooling behavior and collective motion."* |

---

## 17. Test Coverage

**File:** `tests/test.simulator.js`

| Section | Tests |
|---------|-------|
| SeededRandom — uniformity, determinism, normal distribution, fork, forCage | 9 |
| Scenarios — catalogue, structure, causal signatures | 11 |
| PhysicalSystemSimulator — construction, registration, errors | 8 |
| stepCage — output shape, required fields, source provenance | 8 |
| Physical range validity over 100 days | 8 |
| Determinism — identical seeds, cross-30-day, different seeds | 4 |
| Multi-cage independence — RNG isolation, stepAll, independent clocks | 4 |
| Scenario injection — causal effects, countdown, reset | 8 |
| generateHistory, resetCage, reproducibility | 5 |
| Causal relationships — cold growth, hypoxia DO, temperature solubility | 4 |
| ENV constants — immutability, Henry's law direction | 3 |
| **TOTAL** | **71** |

All 71 tests pass. Phase 1 regression: 107 tests pass.

---

## 18. Phase Gate — Phase 2 Complete

**Checklist:**

- [x] `PhysicalSystemSimulator.js` — causal simulator with 11-step model chain
- [x] `seededRandom.js` — Mulberry32 PRNG, reproducible per cage
- [x] `scenarios.js` — 8 formal scenarios with causal chain documentation
- [x] `simulator/index.js` — public API
- [x] `routes/twin.js` — updated to use PhysicalSystemSimulator (replaces Math.random())
- [x] `tests/test.simulator.js` — 71 unit tests, all passing
- [x] Phase 1 regression — 107 tests, all passing
- [x] Determinism verified by test
- [x] Multi-cage independence verified by test
- [x] Scenario causal effects verified by test (temperature, DO, ammonia, growth)
- [x] `AQUATWINS_SIMULATION_MODEL.md` — this document

**Known limitations documented:** See Section 15.  
**Next phase:** Phase 3 — Virtual Sensor Engine.
