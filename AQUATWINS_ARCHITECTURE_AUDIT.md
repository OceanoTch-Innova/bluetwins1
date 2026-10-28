# AQUATWINS — Architecture Audit
## Phase 0 — Complete Repository Analysis

**Date:** 2026-05-25  
**Status:** AUDIT COMPLETE — Ready for Phase 1 implementation  
**Auditor:** AquaTwins Engineering (AI-assisted)

---

## 1. Repository Structure

```
Gemelo digital dashboard 2/
├── index.html                          ← Login page (entry point)
├── assets/
│   └── imagenes/favicon/favicon.ico    ← Favicon
├── Dashboard/                          ← Main application
│   ├── index.html                      ← SPA shell (main app, ~1556 lines)
│   ├── app.js                          ← SPA router + GlobalState + polling (~733 lines)
│   ├── Script.js                       ← Modular engine v2.0 (~1140 lines)
│   ├── Script.d.ts                     ← TypeScript definitions (~363 lines)
│   ├── Style.css                       ← Industrial design system (partial/legacy)
│   ├── tests.html                      ← Browser-based unit test runner
│   ├── README.md                       ← v2.0 documentation
│   └── index.backup-before-spa-*.html ← Backup from SPA migration (2026-05-25)
└── oceanotech-backend/                 ← Node.js backend
    ├── package.json                    ← Express, better-sqlite3, JWT, bcrypt
    ├── .env.example                    ← Environment template
    ├── oceanotech.sqlite               ← SQLite database (live, with WAL)
    ├── src/
    │   ├── server.js                   ← Express app, middleware, route mounting
    │   ├── db.js                       ← SQLite schema (users, refresh_tokens, login_events)
    │   ├── seed.js                     ← Demo user seeder
    │   ├── routes/
    │   │   ├── auth.js                 ← Login/register/refresh/logout/me
    │   │   ├── twin.js                 ← Digital Twin state API (simulation-backed)
    │   │   └── readings.js             ← Sensor readings ingestion & retrieval
    │   ├── middleware/
    │   │   ├── auth.js                 ← JWT Bearer token validation
    │   │   └── rateLimiter.js          ← express-rate-limit (general/login/register)
    │   └── utils/
    │       ├── jwt.js                  ← Sign/verify access + refresh tokens
    │       ├── validators.js           ← Email/password validation
    │       └── recaptcha.js            ← reCAPTCHA hook (disabled by default)
    └── node_modules/                   ← Dependencies installed
```

---

## 2. Technology Stack

### Backend
| Component | Technology | Version |
|-----------|-----------|---------|
| Runtime | Node.js | ≥18 |
| Framework | Express | ^4.19.2 |
| Database | SQLite (better-sqlite3) | ^13.0.3 |
| Auth | JWT (jsonwebtoken) | ^9.0.2 |
| Password hashing | bcrypt | ^5.1.1 |
| Security | helmet | ^7.1.0 |
| Rate limiting | express-rate-limit | ^7.4.0 |
| Validation | express-validator | ^7.2.0 |
| CORS | cors | ^2.8.5 |

### Frontend
| Component | Technology |
|-----------|-----------|
| Architecture | Vanilla JavaScript (no build step, no framework) |
| Rendering | Canvas 2D API |
| Visualization | Custom Boids (fish behavior simulation) |
| State | Custom GlobalState (observer pattern) |
| Routing | Hash-based SPA router |
| Fonts | IBM Plex Mono, IBM Plex Sans (Google Fonts CDN) |
| Charts | Custom canvas rendering (no chart library) |
| Auth storage | localStorage (accessToken + user JSON) |

### Deployment
| Component | Current state |
|-----------|--------------|
| Backend host | localhost:4000 (development only) |
| Frontend host | file:// or localhost:5500 (VS Code Live Server) |
| Database | File-based SQLite (not production-grade for concurrency) |
| TLS | Not configured (development) |
| WebSocket | Not implemented (marked as future) |
| MQTT | Not implemented (marked as future) |

---

## 3. Existing APIs

### Authentication API
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | None | Create user account |
| POST | `/api/auth/login` | None | Login, returns JWT + sets httpOnly cookie |
| POST | `/api/auth/refresh` | Cookie | Renew access token |
| POST | `/api/auth/logout` | Cookie | Revoke refresh token |
| GET | `/api/auth/me` | Bearer JWT | Get current user profile |
| GET | `/api/health` | None | Backend health check |

### Digital Twin API
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/v1/twin/state` | Bearer JWT | Get current twin state (default CAGE07) |
| GET | `/api/v1/twin/state/:twin_id` | Bearer JWT | Get twin state by ID |
| GET | `/api/v1/twin/history/:twin_id` | Bearer JWT | Get readings history (last N) |
| POST | `/api/v1/twin/sync` | Bearer JWT | Submit new observation |

### Readings API
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/v1/readings` | Bearer JWT | Ingest sensor reading(s) |
| GET | `/api/v1/readings` | Bearer JWT | List readings (paginated, filterable) |
| GET | `/api/v1/readings/latest` | Bearer JWT | Latest reading per (device, parameter) |
| GET | `/api/v1/readings/history` | Bearer JWT | Time-series history (filterable) |

### External API (referenced, not implemented)
| Endpoint | Description | Status |
|----------|-------------|--------|
| `http://127.0.0.1:8000/api/sensores/limpios` | FastAPI clean sensor feed | NOT IMPLEMENTED — falls back to demo data |

---

## 4. Current Database Schema

### SQLite (oceanotech.sqlite)
```sql
users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  name            TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    INTEGER,             -- epoch ms
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
)

refresh_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,           -- SHA-256 of token
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  revoked     INTEGER NOT NULL DEFAULT 0
)

login_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL,
  ip          TEXT,
  success     INTEGER NOT NULL,        -- 0/1
  created_at  INTEGER NOT NULL
)
```

**Notable:** The database schema contains only auth-related tables. There are **no domain tables** for sites, cages, cohorts, sensors, readings, or twin state. All domain data is currently held in memory.

### In-Memory Stores (backend)
```javascript
readings_store[]   // in twin.js — max 2000 items
sensorReadings[]   // in readings.js — max 5000 items
```
Both are volatile — lost on server restart.

---

## 5. Existing Simulation Logic

### Physical Model Parameters (identical in frontend and backend)
```javascript
TGC = 2.85           // Thermal Growth Coefficient (marine phase)
TGC_min = 0.40       // TGC under extreme stress
T_opt = 14.0 °C      // Optimal temperature (Gaussian peak)
T_sigma = 4.5        // Gaussian width
DO_hs = 3.5          // Michaelis-Menten O2 half-saturation
DO_crit = 4.0 mg/L   // Critical hypoxia threshold
DO_lethal = 2.5 mg/L // Lethal DO threshold
DO_pipe = 5.5 mg/L   // Piping behaviour onset
NH3_sub = 0.012 mg/L // Sub-lethal ammonia threshold
NH3_let = 0.050 mg/L // Lethal ammonia threshold
pH range [6.5–8.5], optimal [7.0–8.0]
D_opt = 20 kg/m³, D_max = 45 kg/m³
mu_base = 0.0003 /day
FCR_base = 1.15
harvest_w = 5000 g
vol = 2000 m³        // Circular cage Ø40m × 20m depth
```

### Mathematical Models (stress functions)
- **fTemp(T)** — Gaussian: `exp(-0.5 × ((T - T_opt) / T_sigma)²)` [ref: Johansson 2014]
- **fOxy(DO)** — Michaelis-Menten + hypoxia correction [ref: Tran-Duy 2012]
- **fDens(D)** — Linear threshold [ref: Martins 2011]
- **fNH3(a)** — Linear decline [ref: Randall & Tsui 2002]
- **fpH(pH)** — Piecewise linear [ref: Fivelstad 2003]
- **f_total** = fTemp × fOxy × fDens × fNH3 × fpH

### Growth Model (TGC)
```
W(t+1)^(1/3) = W(t)^(1/3) + (TGC_eff × T) / 1000
TGC_eff = TGC × f_total + TGC_min × (1 - f_total)
SGR = 100 × ln(W(t+1) / W(t))  [%/day]
```

### Mortality Model
```
mu_stress = 0.003 × (1 - f_total) + (DO < DO_crit ? 0.007 : 0)
mu_daily = mu_base + mu_stress
N(t+1) = N(t) × (1 - mu_daily)
```

### Feeding Model
```
FI_rate = max(0.006, 0.016 - 0.00018 × sqrt(W))   [fraction of body weight]
feed_kg = N × W × FI_rate × max(0.08, f_total) / 1000
FCR = delta_feed / delta_biomass
```

### Simulation Pre-seeding
On startup, the simulation runs 90 days of history silently to populate charts.

### Initial Conditions
- Population: 50,000 smolts
- Initial weight: 80 g
- Start date: 2025-01-15

---

## 6. Boids Visualization

The Boids system ([`Dashboard/index.html`](Dashboard/index.html)) implements:
- 180 agents representing 50,000 fish (visual representation only, NOT literal count)
- Classical flocking rules: Separation (3.2 BL), Alignment (7.5 BL), Cohesion (15 BL)
- Biological additions:
  - Rheotaxis (counter-current swimming)
  - Depth preference based on DO and temperature
  - Hypoxia piping behavior
  - Scenario-specific behaviors (storm turbulence, ammonia erratic motion, lice escape jumps)
  - Polarization index Φ (Marras et al. 2012, 2015)
- HSL color coding: green (healthy) → red (stressed)
- Bathymetric depth histogram (right sidebar)

**Important:** The boids do NOT represent individual fish — they are a population behavior visualization.

---

## 7. Existing Scenarios

| Name | Temperature | DO | Notes |
|------|-------------|-----|-------|
| normal | 12.5°C | 8.5 | Nominal conditions |
| heatwave | 21.4°C | 6.1 | 14 days |
| hypoxia | 13.2°C | 3.4 | 7 days, critical |
| algae | 16.6°C | 4.7 | pH=9.0, turbidity=29 NTU |
| storm | 8.6°C | 9.9 | Turbidity=44 NTU |
| ammonia | 13.1°C | 7.3 | NH3=0.044 mg/L |
| cold | 6.0°C | 11.0 | 21 days |
| lice | 12.5°C | 7.9 | 30 days, chronic stress |

---

## 8. Frontend Architecture

### SPA Structure
```
index.html (login) → Dashboard/index.html (SPA)
                      ├── #captacion  (Captación & Data Hub view)
                      └── #gemelo     (Digital Twin view)
```

### Module Architecture ([`Dashboard/Script.js`](Dashboard/Script.js))
```
CONFIG               — frozen constants (model, boids, sim, perf, noise)
Utils                — clamp, safeNumber, debounce, throttle, DOM helpers
Logger               — debug/info/warn/error with history
ErrorHandler         — centralized error handling, critical detection
Validator            — sensor data, sim state, canvas dimension validation
StateManager         — centralized state, observer pattern, immutable access
MathModels           — fTemp, fOxy, fDens, fNH3, fpH, calculateStress
SimulationEngine     — one-step TGC/mortality/feeding computation
BoidsSystem          — 180-agent fish behavior simulation
RenderingEngine      — canvas rendering (tank, bio chart, SGR chart)
```

### Application Layer ([`Dashboard/app.js`](Dashboard/app.js))
```
resolveBackendUrl()  — probes both localhost and 127.0.0.1 (Windows IPv4/IPv6)
SENSOR_SCHEMA        — canonical sensor normalization rules
API_CONFIG           — endpoint URLs and poll intervals
GlobalState          — reactive state bus (sensors, twin, route)
normalizeSensorData()— alias resolution + range clamping
AppRouter            — hash-based SPA navigation
updateTwinStatusBar()— updates the Twin Status Bar UI
pollTwinState()      — fetches /api/v1/twin/state every 8 seconds
renderSourceCards()  — renders virtual sensor source cards
renderConnectivity() — renders connectivity status grid
renderSensorRegistry()— renders sensor registry table
renderDataQuality()  — renders data quality bars
CaptacionDashboard   — full Captación view logic (polls + renders)
```

### Inline Script ([`Dashboard/index.html`](Dashboard/index.html) ~lines 636–1553)
```
M{}                  — duplicated model constants (TECHNICAL DEBT)
fTemp/fOxy/fDens/fNH3/fpH — duplicated stress functions (TECHNICAL DEBT)
stressAll()          — combined stress calculation
simStep()            — duplicated simulation step (TECHNICAL DEBT)
Sim{}                — simulation state object
Sensors{}            — current + target + noise sensor state
SCENARIOS{}          — scenario definitions
buildSensorCards()   — creates DOM for 7 sensor cards
updateSensorCards()  — updates DOM values
updateUI()           — DOM update for all KPI/chart elements
renderTank()         — calls boids + canvas drawing
renderBioChart()     — biomass + weight + prediction chart
renderSGRChart()     — SGR bars + FCR line
loop()               — requestAnimationFrame main loop
```

### Polling Intervals
- Captación API poll: 5,000 ms (→ `http://127.0.0.1:8000/api/sensores/limpios`)
- Twin state poll: 8,000 ms (→ backend `/api/v1/twin/state`)
- Render loop: ~60 fps (requestAnimationFrame, throttled at 16 ms)

---

## 9. Authentication Flow

```
Login Page (index.html)
  ↓ POST /api/auth/login { email, password }
  ↓ Returns { accessToken, user{} }
  ↓ Stores accessToken in localStorage (SECURITY NOTE: should be memory/httpOnly)
  ↓ Redirect to Dashboard/index.html

Dashboard (app.js authGuard)
  ↓ Checks localStorage.accessToken on load
  ↓ Redirects to login if missing
  ↓ All API calls use: Authorization: Bearer <accessToken>

Token Refresh
  ↓ Refresh token in httpOnly cookie (handled by POST /api/auth/refresh)
  ↓ NOT YET WIRED to frontend automatic refresh
```

**Security note:** `accessToken` stored in `localStorage` is accessible to JavaScript (XSS risk). The backend correctly uses httpOnly cookie for the refresh token, but the access token should ideally be in memory rather than localStorage. This is a known trade-off for the current development stage.

---

## 10. Existing Tests

### Browser-based Unit Tests ([`Dashboard/tests.html`](Dashboard/tests.html))

**Test Suites:**
```
Math Models (13 tests)
  - fTemp at optimal, cold, hot temperatures
  - fOxy at optimal, critical, lethal DO
  - fDens at optimal and high density
  - fNH3 at safe and elevated levels
  - fpH at optimal and low pH
  - Combined stress calculation

Utils (7 tests)
  - clamp (in range, below min, above max)
  - safeNumber (valid, NaN, Infinity)
  - formatNumber

Validator (6 tests)
  - Sensor data validation (valid, out-of-range, missing)
  - Simulation state validation
  - Canvas dimension validation (valid, invalid)

Simulation (2 tests)
  - Step produces valid output (W, N, SGR, FCR ranges)
  - Handles extreme stress (mortality elevated, stress < 0.5)

State Manager (3 tests)
  - getState returns immutable copy
  - updateState changes value
  - subscribe to state changes
```

**Total:** 31 tests (run in browser, no CI/CD integration)

---

## 11. Data Flow (Current)

```
Browser (rAF loop, ~60fps)
    ↓
stepSensors()          [noisy interpolation toward target scenario values]
    ↓
simStep()              [TGC growth, mortality, feeding]
    ↓
Sim{} state update
    ↓
updateUI()             [DOM updates]
    ↓
renderTank/Charts      [canvas drawing]
    ↓
GlobalState.setTwinSnapshot()  [broadcasts to app.js listeners]

Parallel (every 8s):
    pollTwinState()    [fetch /api/v1/twin/state → backend generates fresh sim state]
                       [feeds sensor data back into GlobalState]
                       [updates source cards, registry, quality bars]

Parallel (every 5s):
    pollCleanSensorApi() [fetch /api/sensores/limpios → falls back to demo data]
                         [feeds into GlobalState.setCleanSensorData()]
```

**Authoritative source:** Frontend simulation (NOT backend). The backend generates its own independent simulation state on each GET request — there is no shared state between frontend and backend simulations.

---

## 12. Identified Technical Debt

### Critical (blocks architecture goals)

| ID | Issue | Location | Impact |
|----|-------|----------|--------|
| TD-01 | **Model constants duplicated** | `index.html` M{} and `Script.js` CONFIG and `routes/twin.js` M{} | Any model parameter change must be made in 3 places |
| TD-02 | **Simulation logic triplicated** | `simStep()` in index.html, `SimulationEngine.step()` in Script.js, `computeSimState()` in twin.js | Divergence risk; backend and frontend will produce different results |
| TD-03 | **No persistent domain storage** | Backend SQLite has only auth tables | All sensor readings and twin states lost on restart |
| TD-04 | **Frontend is authoritative** | `Sim{}` state lives in index.html | Violates target architecture (backend must be authoritative) |
| TD-05 | **accessToken in localStorage** | index.html login, app.js | XSS vulnerability; should use memory or httpOnly cookie |

### Significant (degrades commercial quality)

| ID | Issue | Location | Impact |
|----|-------|----------|--------|
| TD-06 | **No WebSocket** | Both frontend and backend | Real-time updates depend on polling only |
| TD-07 | **Sensor data labeled "Ficticios"** in UI header | `index.html` line 588 | Product credibility issue; needs proper SOURCE labeling |
| TD-08 | **Hardcoded single cage (CAGE07/SITE01)** | Everywhere | Not multi-cage or multi-site capable |
| TD-09 | **No scenario comparison (Baseline vs Scenario)** | Scenarios only modify target sensor values | Users cannot see quantified impact |
| TD-10 | **No uncertainty quantification** | Biomass shown as single deterministic value | Not scientifically honest |
| TD-11 | **No event system** | No structured feeding/mortality/sampling events | Cannot maintain audit trail |
| TD-12 | **No prediction engine** | Only simple harvest date projection | No +6h/+24h/+7d multi-variable forecasts |
| TD-13 | **No health engine** | Health index = f_total × 100 (stress composite only) | Too simplistic; no disease risk, no feeding anomaly detection |
| TD-14 | **CSS duplication** | SPA shell CSS repeated twice in index.html (~50 lines) | DOM bloat, maintenance issue |
| TD-15 | **Inline `<script>` of ~900 lines in index.html** | Dashboard/index.html lines 636–1553 | Untestable, unmaintainable |

### Minor

| ID | Issue | Location | Impact |
|----|-------|----------|--------|
| TD-16 | `window.OceanoTech` debug API exports `StateManager` from Script.js but app.js uses its own `GlobalState` | Multiple files | Two separate state systems running in parallel |
| TD-17 | `setScenario` function uses `document.querySelectorAll('.scbtn')[idx]` with hardcoded index | index.html | Brittle, breaks if button order changes |
| TD-18 | No MQTT infrastructure | Backend/frontend | Required for IoT sensor integration |
| TD-19 | No token refresh auto-retry in frontend | app.js | 401 after 15 min will silently fail API calls |
| TD-20 | `showAddSourceModal()` uses `alert()` | app.js | Placeholder; no real sensor registration flow |
| TD-21 | `Style.css` exists but appears to be a previous design system not used by current app | Dashboard/Style.css | Dead file; confused with inline styles |

---

## 13. What Is Working and Should Be Preserved

| Component | Status | Notes |
|-----------|--------|-------|
| TGC mathematical model | ✅ Working | Scientifically referenced, well-implemented |
| Boids population visualization | ✅ Working | Biologically realistic behaviors |
| Scenario injection system | ✅ Working | 8 scenarios, smooth interpolation |
| Alert system | ✅ Working | Threshold-based, DOM-logged |
| Biomass/SGR/FCR charts | ✅ Working | Canvas-rendered, bezier curves |
| Harvest prediction | ✅ Working | Days to target weight |
| JWT authentication | ✅ Working | Secure, rate-limited, account lockout |
| Data quality bars | ✅ Working | Per-parameter quality scoring |
| Twin Status Bar | ✅ Working | Mode indicator, last sync, confidence |
| SPA routing | ✅ Working | Hash-based, captacion/gemelo views |
| Backend health endpoint | ✅ Working | IPv4/IPv6 dual-bind |
| Sensor registry table | ✅ Working | Shows 7 virtual sensors |
| Stress factor visualization | ✅ Working | 5 bars with real-time values |
| Browser unit tests | ✅ Working | 31 tests, pass/fail runner |
| Error handling system | ✅ Working | try-catch everywhere, graceful degradation |
| Logger system | ✅ Working | 4-level, history, exportable |
| StateManager | ✅ Working | Observer pattern, immutable state |
| GlobalState bus | ✅ Working | Cross-module sensor/twin state sharing |
| Connectivity grid | ✅ Working | Shows backend/MQTT/WebSocket status |

---

## 14. Recommended Target Architecture

```
AQUATWINS PLATFORM

                    PHYSICAL / SIMULATED WORLD
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
         Sensors           Cameras           Events
    (VirtualSensorEngine)  (CV stub)     (EventEngine)
              └────────────────┼────────────────┘
                               ▼
                     DATA INGESTION LAYER
                    (POST /api/v1/readings)
                               ▼
                    DATA VALIDATION PIPELINE
                  (range, rate-of-change, stale,
                   outlier, cross-sensor, drift)
                               ▼
                      DATA QUALITY SCORING
                   (quality_score, quality_status)
                               ▼
                    PERSISTENT STORAGE
                   (SQLite → TimescaleDB)
                               ▼
                      OBSERVED STATE
                               ▼
                    STATE ESTIMATION ENGINE
                  (weighted combination of
                   observed + model + history)
                               ▼
                      DIGITAL TWIN ENGINE
                    (TwinState per cage/cohort)
                               ▼
           ┌───────────────────┼───────────────────┐
           ▼                   ▼                   ▼
    BiomassEngine          HealthEngine       FeedingEngine
    (TGC + mass balance)   (stress + anomaly) (FCR + recommend)
           └───────────────────┼───────────────────┘
                               ▼
                    PREDICTION ENGINE (+6h→+30d)
                               ▼
                    UNCERTAINTY ENGINE (P10/P50/P90)
                               ▼
                     SCENARIO ENGINE
                 (Baseline vs Scenario comparison)
                               ▼
                    DECISION SUPPORT
                (Explainable Alerts + Recommendations)
                               ▼
                       WEBSOCKET BUS
                    (/ws/twin/{twin_id})
                               ▼
                         DASHBOARD
                    (SPA, multiple cages,
                     OBSERVED/ESTIMATED/PREDICTED labels)
```

---

## 15. Domain Model (Target)

### Hierarchy
```
Farm
 └── Site (SITE01)
      └── Cage (CAGE07)
           └── Cohort (2026-A)
                └── Population (N individuals, W avg weight)
```

### Entities to Create

```
Farm           { farm_id, name, location, species, created_at }
Site           { site_id, farm_id, name, lat, lon, depth_m, cage_count }
Cage           { cage_id, site_id, type, diameter_m, depth_m, volume_m3 }
Cohort         { cohort_id, cage_id, species, stocking_date, initial_count, initial_weight_g }
Device         { device_id, site_id, cage_id, type, manufacturer, model, firmware }
Sensor         { sensor_id, device_id, parameter, unit, range_min, range_max, calibration_date }
Reading        { reading_id, sensor_id, cage_id, parameter, value, unit, timestamp,
                 quality_score, quality_status, source, validation_errors[], validation_warnings[] }
Event          { event_id, cage_id, type, timestamp, source, description, metadata{} }
FeedingEvent   { extends Event: feed_kg, feed_type, FCR_target }
MortalityEvent { extends Event: count, cause }
SamplingEvent  { extends Event: fish_count, avg_weight_g, std_weight_g }
HarvestEvent   { extends Event: fish_count, total_kg, avg_weight_g }
TwinState      { twin_id, cage_id, cohort_id, mode, timestamp, state_version,
                 population{}, biomass{}, environment{}, feeding{}, health{},
                 behavior{}, confidence, data_quality, source }
Prediction     { prediction_id, twin_id, model_version, timestamp, horizon,
                 inputs{}, outputs{}, confidence }
Scenario       { scenario_id, twin_id, name, parameters{}, baseline{}, result{} }
Alert          { alert_id, cage_id, type, severity, timestamp, message,
                 root_cause, confidence, recommended_action, acknowledged }
ModelVersion   { model_id, name, version, description, status, trained_at,
                 validated_at, metrics{} }
```

### Twin Identity Pattern
```
DT-{SITE_ID}-{CAGE_ID}   →   DT-SITE01-CAGE07
```

---

## 16. Migration Strategy

### Phase approach

```
PHASE 0  ✅ DONE      — Audit
PHASE 1  → Next       — Domain model (JS objects/classes, backend TypeScript/JS interfaces)
PHASE 2               — PhysicalSystemSimulator (refactor from existing simStep/Sensors)
PHASE 3               — VirtualSensorEngine (wraps simulator with sensor-like output)
PHASE 4               — Data ingestion (extend existing readings.js)
PHASE 5               — Data quality pipeline (extend existing validateReading())
PHASE 6               — Persistent storage (add domain tables to SQLite)
PHASE 7               — Digital Twin Engine (refactor computeSimState into formal engine)
PHASE 8               — Twin synchronization (wire twin state updates)
PHASE 9               — BiomassEngine (extract from simStep, add mass balance)
PHASE 10              — StateEstimationEngine
PHASE 11              — PredictionEngine
PHASE 12              — UncertaintyEngine (Monte Carlo)
PHASE 13              — HealthEngine
PHASE 14              — FeedingEngine
PHASE 15              — AlertEngine (extend existing pushAlert)
PHASE 16              — ScenarioEngine (extend existing SCENARIOS{})
PHASE 17              — Multi-cage support
PHASE 18              — Frontend restructure (new navigation, source labeling)
PHASE 19              — Testing (extend existing tests.html + add API tests)
PHASE 20              — Deployment preparation
```

### Non-destructive migration principles

1. **Preserve all working functionality** — do not remove existing simulation, boids, or UI
2. **Extract → isolate → replace** — move inline code to modules, then replace inline version with module import
3. **Backend-first** — implement each engine server-side; wire frontend later
4. **Feature flags / modes** — use `mode: SIMULATION | HYBRID | LIVE` throughout
5. **Source provenance on every data point** — add `source: 'SIMULATION'` label from day one
6. **SQLite first, TimescaleDB later** — migrate storage schema to support timescale without app changes

---

## 17. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Model divergence (3× duplicated math) | HIGH | HIGH | Extract to single shared module (Phase 1) |
| Memory loss on server restart | HIGH | HIGH | Add persistent SQLite tables (Phase 6) |
| accessToken in localStorage (XSS) | MEDIUM | HIGH | Migrate to httpOnly cookie or memory store |
| Single-cage hardcoding makes multi-cage difficult | HIGH | MEDIUM | Add cage_id as explicit parameter everywhere |
| Frontend simulation diverges from backend twin state | MEDIUM | HIGH | Backend becomes sole authoritative source (Phase 7) |
| No automated CI/CD — tests only run manually in browser | MEDIUM | MEDIUM | Add Node.js test runner (jest or node:test) |
| SQLite WAL mode → concurrent writes safe, but not distributed | LOW | MEDIUM | Document; plan PostgreSQL migration for production |
| Boids O(n²) complexity with 180 agents | LOW | LOW | Already optimized with Float32Array; acceptable at 180 agents |
| Inline script in index.html untestable by test runner | HIGH | MEDIUM | Extract to external .js files (Phase 18) |
| Token refresh not auto-wired | MEDIUM | MEDIUM | Add 401 interceptor in app.js (Phase 18) |

---

## 18. Reuse Map

The following existing components are directly reusable with minimal changes:

| Existing Component | Reuse As |
|-------------------|----------|
| `MathModels` in Script.js | Core of `BiomassEngine` and `HealthEngine` |
| `SimulationEngine.step()` | Core of `PhysicalSystemSimulator` |
| `Sensors{}` + `SCENARIOS{}` | Core of `VirtualSensorEngine` + `ScenarioEngine` |
| `validateReading()` in readings.js | Core of `DataValidationPipeline` |
| `RANGE_RULES` in readings.js | Range validation rules for `DataQualityEngine` |
| `pushAlert()` in index.html | Seed for `AlertEngine` |
| `GlobalState` in app.js | Seed for frontend `TwinStateStore` |
| `BoidsSystem` | Preserve as-is → `BehaviorVisualization` |
| `AppRouter` | Extend with new routes |
| JWT auth infrastructure | Preserve as-is |
| `login_events` table | Preserve as audit log |
| `renderDataQuality()` | Extend with new quality engine output |
| Twin Status Bar | Extend with degraded mode messaging |

---

## 19. Known Limitations of Current Prototype

These limitations must be honestly documented, not silently corrected:

1. **No scientific validation of TGC parameters** — values based on literature ranges, not calibrated to a specific farm or population. Model status: `EXPERIMENTAL`.
2. **Biomass uncertainty is hardcoded** — `uncertainty_t = biomass × 0.034` — not model-derived.
3. **Twin confidence is hardcoded** — `twin_confidence = 0.918` — not computed from data quality.
4. **No real sensor integration** — all data is SIMULATION source.
5. **Single cohort, single cage** — no multi-site capability yet.
6. **FCR calculation** is instantaneous, not cumulative over production cycle properly.
7. **No camera/computer vision** — CV stub only.
8. **No MQTT** — IoT integration is future work.
9. **No WebSocket** — real-time is polling only.
10. **No financial modeling** — harvest value, feed cost, operating cost not implemented.
11. **Harvest date prediction** is simple TGC extrapolation; does not account for seasonal temperature changes.

---

## 20. Phase 1 Implementation Checklist

The following must be done before any Phase 1 code is written:

- [x] Complete repository audit (this document)
- [ ] Create `/oceanotech-backend/src/domain/` directory for domain models
- [ ] Define formal entity classes/schemas for all domain objects listed in Section 15
- [ ] Create `AQUATWINS_DATA_MODEL.md` documenting all entities
- [ ] Create `AQUATWINS_API.md` documenting the target API
- [ ] Create `AQUATWINS_LIMITATIONS.md` for honest capability documentation
- [ ] Extract model constants to a shared `modelConfig.js` (breaks TD-01, TD-02)
- [ ] Add `cage_id` and `site_id` as explicit parameters throughout (breaks TD-08)

---

## Appendix A — File Sizes (estimated)

| File | Lines | Role |
|------|-------|------|
| Dashboard/index.html | ~1,556 | SPA shell + inline simulation logic |
| Dashboard/app.js | ~733 | SPA router + GlobalState + API polling |
| Dashboard/Script.js | ~1,140 | Modular engine v2.0 |
| Dashboard/Script.d.ts | ~363 | TypeScript definitions |
| Dashboard/tests.html | ~497 | Unit test runner (31 tests) |
| Dashboard/Style.css | ~50+ | Legacy design system (unused by current app) |
| oceanotech-backend/src/server.js | ~101 | Express app |
| oceanotech-backend/src/db.js | ~42 | SQLite schema |
| oceanotech-backend/src/routes/auth.js | ~237 | Authentication routes |
| oceanotech-backend/src/routes/twin.js | ~231 | Twin state API |
| oceanotech-backend/src/routes/readings.js | ~234 | Readings API |
| oceanotech-backend/src/middleware/auth.js | ~20 | JWT guard |
| oceanotech-backend/src/middleware/rateLimiter.js | ~29 | Rate limits |
| oceanotech-backend/src/utils/jwt.js | ~34 | JWT sign/verify |
| oceanotech-backend/src/utils/validators.js | ~19 | Email/password |
| oceanotech-backend/src/utils/recaptcha.js | ~38 | reCAPTCHA stub |
| oceanotech-backend/src/seed.js | ~43 | Demo user seeder |

---

## Appendix B — Environment Variables

```bash
# oceanotech-backend/.env.example
PORT=4000
NODE_ENV=development
CORS_ORIGIN=http://localhost:5500
JWT_ACCESS_SECRET=<64-byte random hex>
JWT_REFRESH_SECRET=<64-byte random hex>
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL=7d
MAX_LOGIN_ATTEMPTS=5
LOCKOUT_MINUTES=15
RECAPTCHA_SECRET_KEY=           # empty = disabled
RECAPTCHA_ENABLED=false
```

---

## Appendix C — Demo Credentials

```
URL:      http://localhost:5500  (or file:// path)
Backend:  http://localhost:4000
Email:    demo@oceanotech.com
Password: AquaTwins2025!
```

---

*Document generated as part of AquaTwins Phase 0 — Audit. Do not implement changes until this audit has been reviewed.*  
*Next step: Phase 1 — Domain Model*
