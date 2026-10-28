# AQUATWINS — Data Model
## Phase 1 — Domain Entities and Relationships

**Version:** 1.0.0  
**Status:** PHASE 1 COMPLETE  
**Date:** 2026-05-25  
**Model status:** EXPERIMENTAL — not calibrated against specific farm data.

---

## 1. Entity Hierarchy

```
Farm
 └── Site (1..*)
      └── Cage (1..*)
           ├── twin_id: DT-{SITE_ID}-{CAGE_ID}
           └── Cohort (0..1 active at a time)
                └── Population (N fish, avg weight W)
```

Every operational entity is anchored to a **Cage**.  
Every Cage has exactly one **Digital Twin Identity** (`twin_id`).

---

## 2. Entities

### Farm
```
farm_id    TEXT  PK   — e.g. "FARM01"
name       TEXT       — human-readable name
company    TEXT       — operating company
country    TEXT       — ISO country code
region     TEXT       — administrative region
species    TEXT       — primary species (default: "Salmo salar")
created_at TEXT       — ISO 8601 timestamp
```

### Site
```
site_id    TEXT  PK   — e.g. "SITE01"
farm_id    TEXT  FK → farms.farm_id
name       TEXT       — geographic name
latitude   REAL       — WGS84 latitude (nullable)
longitude  REAL       — WGS84 longitude (nullable)
depth_m    REAL       — water depth at site (nullable)
cage_count INTEGER    — number of cages
created_at TEXT
```

### Cage
```
cage_id    TEXT  PK (composite with site_id)
site_id    TEXT  FK → sites.site_id
twin_id    TEXT  UNIQUE — format: DT-{SITE_ID}-{CAGE_ID}
name       TEXT
type       TEXT       — "circular_net_pen" | "square_net_pen" | "tank"
diameter_m REAL
depth_m    REAL
volume_m3  REAL       — effective water volume
status     TEXT       — ACTIVE | FALLOW | MAINTENANCE
created_at TEXT
```

**Twin Identity Pattern:**
```
DT-SITE01-CAGE07
  ↑      ↑     ↑
  DT   site_id cage_id
```

### Cohort
```
cohort_id        TEXT  PK  — e.g. "2026-A"
cage_id          TEXT  FK → cages
site_id          TEXT  FK → sites
species          TEXT
strain           TEXT       — genetic strain (nullable)
stocking_date    TEXT       — ISO date
expected_harvest TEXT       — ISO date (nullable)
initial_count    INTEGER    — fish stocked (nullable)
initial_weight_g REAL       — average weight at stocking (nullable)
status           TEXT       — ACTIVE | HARVESTED | TERMINATED
created_at       TEXT
```

A cage may have at most one cohort with `status = ACTIVE` at any time.

### Device
```
device_id        TEXT  PK  — e.g. "V-DEVICE-SITE01-C07"
site_id          TEXT  FK → sites
cage_id          TEXT
name             TEXT
type             TEXT       — "MULTI_PARAMETER_PROBE" | "OXYGEN_METER" | …
manufacturer     TEXT       (nullable)
model            TEXT       (nullable)
firmware_version TEXT       (nullable)
device_kind      TEXT       — VIRTUAL | PHYSICAL
status           TEXT       — ACTIVE | OFFLINE | CALIBRATION | MAINTENANCE
calibrated_at    TEXT       (nullable)
installed_at     TEXT       (nullable)
created_at       TEXT
```

`device_kind = VIRTUAL` means the device is simulated.  
Replacing `VIRTUAL` with `PHYSICAL` (through configuration, not code changes) is the path to Hybrid/Live mode.

### Sensor
```
sensor_id        TEXT  PK  — e.g. "V-DO-V-DEVICE-SITE01-C07"
device_id        TEXT  FK → devices
parameter        TEXT       — see Parameter Registry below
unit             TEXT       (nullable)
range_min        REAL       (nullable)
range_max        REAL       (nullable)
accuracy         TEXT       (nullable)
calibration_date TEXT       (nullable)
status           TEXT       — ACTIVE | INACTIVE | FAULT
source           TEXT       — DataSource enum
created_at       TEXT
```

### Reading
```
reading_id           TEXT  PK  — "R-{timestamp}-{random}"
device_id            TEXT  FK → devices (NOT NULL)
sensor_id            TEXT       (nullable)
site_id              TEXT       (nullable)
cage_id              TEXT       (nullable)
parameter            TEXT  NOT NULL
value                REAL  NOT NULL
unit                 TEXT       (nullable)
timestamp            TEXT  NOT NULL  — ISO 8601 UTC
received_at          TEXT  NOT NULL
source               TEXT  NOT NULL  — DataSource enum
quality_score        REAL       — 0–100 (nullable = not yet scored)
quality_status       TEXT       — QualityStatus enum
validation_errors    TEXT       — JSON array of strings
validation_warnings  TEXT       — JSON array of strings
```

**Indexes:** `(cage_id, parameter, timestamp)`, `(device_id, timestamp)`

Readings are **INSERT-only**. Never updated after write.

### Event (base)
```
event_id    TEXT  PK
cage_id     TEXT  NOT NULL
cohort_id   TEXT       (nullable)
site_id     TEXT       (nullable)
event_type  TEXT  NOT NULL  — see Event Types below
timestamp   TEXT  NOT NULL
source      TEXT  NOT NULL  — DataSource enum
description TEXT       (nullable)
metadata    TEXT       — JSON object (event-specific fields)
created_at  TEXT
```

### Event Subtypes

| event_type | Extra fields in metadata |
|------------|--------------------------|
| `FEEDING` | `feed_kg`, `feed_type`, `fcr_target`, `feeding_rate_pct` |
| `MORTALITY` | `fish_count`, `cause`, `avg_weight_g` |
| `SAMPLING` | `fish_sampled`, `avg_weight_g`, `std_weight_g`, `condition_factor` |
| `HARVEST` | `fish_count`, `total_kg`, `avg_weight_g`, `partial` |
| `STOCKING` | `fish_count`, `avg_weight_g`, `source_site` |
| `TREATMENT` | `substance`, `dose`, `duration_h` |
| `SENSOR_CALIBRATION` | `sensor_id`, `calibrated_by` |
| `EQUIPMENT_FAILURE` | `device_id`, `failure_type` |
| `STORM` | `wind_speed_ms`, `wave_height_m`, `duration_h` |
| `ENV_EVENT` | `description`, `severity` |

### TwinState
```
id               INTEGER  PK (autoincrement)
twin_id          TEXT  NOT NULL
site_id          TEXT  NOT NULL
cage_id          TEXT  NOT NULL
cohort_id        TEXT       (nullable)
mode             TEXT  NOT NULL  — TwinMode enum
state_version    INTEGER  NOT NULL  — increments on each update
timestamp        TEXT  NOT NULL
state_json       TEXT  NOT NULL  — full TwinState as JSON
data_quality     REAL       — 0–1 overall data quality score
twin_confidence  REAL       — 0–1 twin confidence estimate
update_reason    TEXT       — description of what triggered this update
created_at       TEXT
```

**Index:** `(twin_id, timestamp)`

TwinState rows are **INSERT-only**. Each update creates a new row, preserving full history.

### Prediction
```
prediction_id  TEXT  PK
twin_id        TEXT  NOT NULL
cage_id        TEXT       (nullable)
model_version  TEXT
timestamp      TEXT  NOT NULL  — when prediction was made
horizon_h      REAL             — forecast horizon in hours
inputs_json    TEXT             — snapshot of model inputs
outputs_json   TEXT             — predicted values
confidence     REAL             — 0–1
created_at     TEXT
```

### Alert
```
alert_id            TEXT  PK
cage_id             TEXT  NOT NULL
site_id             TEXT       (nullable)
twin_id             TEXT       (nullable)
alert_type          TEXT  NOT NULL  — see Alert Types below
severity            TEXT  NOT NULL  — LOW | MEDIUM | HIGH | CRITICAL
timestamp           TEXT  NOT NULL
message             TEXT  NOT NULL
root_cause          TEXT       (nullable)
confidence          REAL       (nullable)
recommended_action  TEXT       (nullable)
drivers_json        TEXT             — JSON: [{factor, contribution_pct}]
acknowledged        INTEGER    — 0 | 1
acknowledged_at     TEXT       (nullable)
source              TEXT  NOT NULL  — DataSource enum
created_at          TEXT
```

**Alert Types:**
- `THRESHOLD` — a sensor value crossed a predefined limit
- `TREND` — a parameter is moving in a dangerous direction
- `ANOMALY` — sensor behavior is statistically abnormal
- `FORECAST` — a critical condition is predicted within the forecast horizon
- `MODEL_DISAGREEMENT` — observed state differs significantly from model state

### ModelVersion (Model Registry)
```
model_id         TEXT  PK  — e.g. "TGC-V2.5"
name             TEXT  NOT NULL
version          TEXT  NOT NULL
description      TEXT       (nullable)
species          TEXT       — e.g. "Salmo salar"
dataset          TEXT       — description of training/reference data (nullable)
training_date    TEXT       (nullable)
validation_date  TEXT       (nullable)
metrics_json     TEXT             — JSON: {MAE, RMSE, MAPE, Bias, R²}
status           TEXT  NOT NULL  — ModelStatus enum
created_at       TEXT
```

---

## 3. Parameter Registry

All valid sensor parameters, with units and ranges:

| Parameter | Unit | Min | Max | Notes |
|-----------|------|-----|-----|-------|
| `temperature` | °C | -2 | 35 | |
| `dissolved_oxygen` | mg/L | 0 | 20 | |
| `salinity` | PSU | 0 | 45 | |
| `pH` | — | 5.5 | 10 | |
| `ammonia` | mg/L | 0 | 0.1 | Un-ionised NH₃ |
| `turbidity` | NTU | 0 | 200 | |
| `flow` | L/min | 0 | 5000 | |
| `chlorophyll` | µg/L | 0 | 100 | |
| `ORP` | mV | -500 | 500 | Oxidation-Reduction Potential |
| `CO2` | ppm | 0 | 5000 | |

Source: [`oceanotech-backend/src/domain/modelConfig.js`](oceanotech-backend/src/domain/modelConfig.js)

---

## 4. State Layer Separation

The system enforces strict separation between four state types:

```
ObservedState    — what the sensors or simulator actually measured RIGHT NOW
EstimatedState   — what the State Estimation Engine believes to be true
PredictedState   — what the Prediction Engine forecasts for a FUTURE time
TwinState        — the authoritative container combining all three + provenance
```

**Key rule:** These four types must never be merged or confused.

| Layer | `state_type` | Source tag | When created |
|-------|-------------|------------|--------------|
| Observed | `OBSERVED` | `SIMULATION` or `SENSOR` | Each sensor reading |
| Estimated | `ESTIMATED` | `ESTIMATED` | State Estimation Engine run |
| Predicted | `PREDICTED` | `PREDICTED` | Prediction Engine run |
| Twin | *(container)* | all of the above | Each twin update |

### ObservedState structure
```json
{
  "state_type": "OBSERVED",
  "timestamp": "...",
  "source": "SIMULATION",
  "temperature":      { "value": 12.5, "unit": "°C",    "source": "SIMULATION", "quality": 97 },
  "dissolved_oxygen": { "value": 8.21, "unit": "mg/L",  "source": "SIMULATION", "quality": 96 },
  "salinity":         { "value": 33.1, "unit": "PSU",   "source": "SIMULATION", "quality": 98 },
  "pH":               { "value": 7.82, "unit": null,    "source": "SIMULATION", "quality": 95 },
  "ammonia":          { "value": 0.009,"unit": "mg/L",  "source": "SIMULATION", "quality": 94 },
  "turbidity":        { "value": 2.2,  "unit": "NTU",   "source": "SIMULATION", "quality": 93 },
  "flow":             { "value": 1185, "unit": "L/min", "source": "SIMULATION", "quality": 91 }
}
```

### EstimatedState structure
```json
{
  "state_type": "ESTIMATED",
  "timestamp": "...",
  "population_count": { "value": 48210, "unit": "fish", "source": "ESTIMATED", "method": "TGC_mortality", "confidence": 0.88 },
  "biomass_t":        { "value": 186.4, "unit": "t",    "source": "ESTIMATED", "method": "TGC_model",    "confidence": 0.91 },
  "avg_weight_g":     { "value": 3862,  "unit": "g",    "source": "ESTIMATED", "method": "TGC_model",    "confidence": 0.91 },
  "dissolved_oxygen": { "value": 8.19,  "unit": "mg/L", "source": "ESTIMATED", "method": "weighted_correction", "confidence": null }
}
```

### PredictedState structure
```json
{
  "state_type": "PREDICTED",
  "timestamp": "...",
  "horizon_h": 6,
  "dissolved_oxygen": { "value": 8.06, "unit": "mg/L", "source": "PREDICTED", "horizon_h": 6, "confidence": 0.82 },
  "biomass_t":        null,
  "harvest_date":     null,
  "days_to_harvest":  null
}
```

---

## 5. Provenance Enums

### DataSource
```
SIMULATION  — generated by PhysicalSystemSimulator (virtual)
SENSOR      — measured by a physical hardware device
CAMERA      — derived from computer vision pipeline
MANUAL      — entered by a human operator
API         — received from an external REST or MQTT source
ESTIMATED   — computed by the State Estimation Engine
PREDICTED   — forecast by the Prediction Engine
DERIVED     — calculated from other observed values
```

### TwinMode
```
SIMULATION  — all data from PhysicalSystemSimulator (current default)
HYBRID      — mix of real sensors and simulation fill-ins
LIVE        — all data from physical sensors
OFFLINE     — connection lost; using last valid twin state
DEGRADED    — partial data; some sensors unavailable
```

### QualityStatus
```
VALID               — reading passed all validation checks
VALID_WITH_WARNINGS — passed but with advisory warnings
INVALID             — failed one or more validation checks
STALE               — reading is older than the staleness threshold
SIMULATED           — generated by simulation (not a real measurement)
ESTIMATED           — inferred by the estimation engine
```

### ModelStatus
```
EXPERIMENTAL        — not calibrated; parameters from literature only
CALIBRATION_PENDING — calibration data collected but not yet processed
VALIDATED           — calibrated and validated against real data (evidence required)
PRODUCTION          — deployed for operational decisions
DEPRECATED          — superseded by a newer model version
```

**Important:** The TGC model currently deployed has status `EXPERIMENTAL`.  
Never use the word "validated" in the UI or API unless the model status is actually `VALIDATED`.

---

## 6. Seed Data (Demo Configuration)

### Farm hierarchy at startup
```
FARM01 — OceanoTech Demo Farm
  SITE01 — Sitio Sur — Lago Rupanco (-40.82°, -72.47°)
    DT-SITE01-CAGE07 — Jaula 07 Norte  (Ø40m × 20m, 2000 m³) — ACTIVE — Cohort 2026-A
    DT-SITE01-CAGE08 — Jaula 08 Sur    (Ø40m × 20m, 2000 m³) — ACTIVE — Cohort 2026-B
    DT-SITE01-CAGE09 — Jaula 09 Este   (Ø32m × 18m, 1450 m³) — FALLOW
  SITE02 — Sitio Norte — Canal Chacao (-41.78°, -73.52°)
    DT-SITE02-CAGE01 — Jaula 01 Poniente (Ø50m × 25m, 2450 m³) — ACTIVE — Cohort 2025-X
    DT-SITE02-CAGE02 — Jaula 02 Oriente  (Ø50m × 25m, 2450 m³) — ACTIVE — no cohort
```

### Default twin
```
DEFAULT_TWIN_ID   = "DT-SITE01-CAGE07"
DEFAULT_CAGE_ID   = "CAGE07"
DEFAULT_SITE_ID   = "SITE01"
DEFAULT_COHORT_ID = "2026-A"
```

This preserves backward compatibility with all existing frontend code that references `SITE01/CAGE07`.

---

## 7. Mathematical Model Parameters

All model constants are defined in a single location:  
[`oceanotech-backend/src/domain/modelConfig.js`](oceanotech-backend/src/domain/modelConfig.js)

Previously they were duplicated in three places (TD-01). That is now resolved.

| Parameter | Value | Description |
|-----------|-------|-------------|
| `TGC` | 2.85 | Thermal Growth Coefficient (marine phase) |
| `TGC_MIN` | 0.40 | TGC floor under extreme combined stress |
| `T_OPT` | 14.0 °C | Optimal temperature (Gaussian peak) |
| `T_SIGMA` | 4.5 | Gaussian width |
| `DO_HS` | 3.5 mg/L | O₂ Michaelis-Menten half-saturation |
| `DO_CRIT` | 4.0 mg/L | Critical hypoxia threshold |
| `DO_LETHAL` | 2.5 mg/L | Lethal DO threshold |
| `DO_PIPE` | 5.5 mg/L | Piping behaviour onset |
| `NH3_SUB` | 0.012 mg/L | Sub-lethal ammonia (un-ionised) |
| `NH3_LET` | 0.050 mg/L | Lethal ammonia |
| `PH_LO / PH_HI` | 7.0 / 8.0 | Optimal pH range |
| `PH_MIN / PH_MAX` | 6.5 / 8.5 | Absolute pH tolerance |
| `D_OPT` | 20 kg/m³ | Optimal density ceiling |
| `D_MAX` | 45 kg/m³ | Density at 5% growth factor |
| `MU_BASE` | 0.0003 /day | Background daily mortality |
| `HARVEST_W` | 5000 g | Target harvest weight |
| `FCR_BASE` | 1.15 | Baseline Feed Conversion Ratio |

**Status:** EXPERIMENTAL — based on published literature for Atlantic Salmon. Not calibrated against farm data.

---

## 8. Domain Files

| File | Purpose |
|------|---------|
| [`src/domain/modelConfig.js`](oceanotech-backend/src/domain/modelConfig.js) | Shared model constants — single source of truth |
| [`src/domain/provenance.js`](oceanotech-backend/src/domain/provenance.js) | DataSource, TwinMode, QualityStatus, ModelStatus enums |
| [`src/domain/entities.js`](oceanotech-backend/src/domain/entities.js) | Factory functions for all 18 domain entities |
| [`src/domain/seedData.js`](oceanotech-backend/src/domain/seedData.js) | Demo Farm/Site/Cage/Cohort/Device/Sensor hierarchy |
| [`src/domain/index.js`](oceanotech-backend/src/domain/index.js) | Public API — import everything from here |
| [`src/db.js`](oceanotech-backend/src/db.js) | SQLite schema — 16 domain tables + auth tables |
| [`tests/test.domain.js`](oceanotech-backend/tests/test.domain.js) | 107 unit tests for all domain entities |

---

## 9. Known Limitations (Phase 1)

1. **Biomass uncertainty** (`uncertainty_t`) is a placeholder: `biomass × 0.034`. Not model-derived. Will be replaced in Phase 12 (UncertaintyEngine).
2. **Twin confidence** is a placeholder: `0.918`. Will be computed from data quality in Phase 7.
3. **Data quality score** is a placeholder: `0.947`. Will be computed from quality pipeline in Phase 5.
4. The `TwinState` structure accepts `...sim` spread, which temporarily includes legacy simulation fields. These will be removed when the backend DigitalTwinEngine (Phase 7) fully replaces the simulation spread.
5. All data is currently `source: SIMULATION`. No physical sensors are connected.
6. `readings` and `twin_states` tables exist in SQLite but are not yet written to — still in-memory (migration in Phase 6).

---

## 10. Migration Notes

### What changed in Phase 1

| Component | Before | After |
|-----------|--------|-------|
| Model constants | Triplicated in 3 files | Single `modelConfig.js` |
| Cage identity | `'SITE01'` / `'CAGE07'` hardcoded strings | `DEFAULT_SITE_ID`, `DEFAULT_CAGE_ID` from `seedData.js` |
| DB schema | 3 auth tables only | 16 domain tables + 3 auth tables |
| Domain entities | None | 18 entity factories |
| State layers | Mixed in one object | ObservedState / EstimatedState / PredictedState / TwinState are distinct |
| Twin API `/state` | Single hardcoded twin | Supports any registered `twin_id` |
| New API | — | `GET /api/v1/twin/cages` |
| Tests | 31 browser-only tests | +107 Node.js domain unit tests (138 total) |

### Backward compatibility

- Existing frontend continues to work without changes.
- `DEFAULT_TWIN_ID = 'DT-SITE01-CAGE07'` is the same as before.
- The `/api/v1/twin/state` endpoint returns the same shape it did before (plus `state_version`, `cohort_id`, `update_reason`, and structured `predicted_states[]`).
- All auth endpoints unchanged.
- All readings endpoints unchanged.
