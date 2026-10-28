'use strict';

/* ═══════════════════════════════════════════════════════════════
   app.js — AquaTwins SPA Shell + Captación & Data Hub
   v2.1 — Digital Twin Phase 1
   ═══════════════════════════════════════════════════════════════ */

// En Cloudflare, la API vive detrás del mismo origen mediante el Worker (/api/*).
// En desarrollo local conservamos el sondeo de IPv4/IPv6 para el backend Express.
const isLocalFrontend = window.location.protocol === 'file:'
  || ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
const backendCandidates = isLocalFrontend
  ? ['http://localhost:4000', 'http://127.0.0.1:4000']
  : [window.location.origin];
let BACKEND_URL = backendCandidates[0];

async function resolveBackendUrl() {
  for (const base of backendCandidates) {
    try {
      const r = await fetch(base + '/api/health', { signal: AbortSignal.timeout(2000) });
      if (r.ok) { BACKEND_URL = base; return base; }
    } catch { /* try next */ }
  }
  return BACKEND_URL; // best-guess fallback
}

// Run discovery immediately (non-blocking)
resolveBackendUrl();

const SENSOR_SCHEMA = Object.freeze({
  temperature: { min: 0, max: 30, fallback: 12.4 },
  do: { min: 0, max: 15, fallback: 8.4 },
  salinity: { min: 25, max: 40, fallback: 33.1 },
  pH: { min: 6, max: 10, fallback: 7.84 },
  ammonia: { min: 0, max: 0.1, fallback: 0.008 },
  turbidity: { min: 0, max: 100, fallback: 2.2 },
  flow: { min: 0, max: 3000, fallback: 1185 },
});

const API_CONFIG = Object.freeze({
  cleanSensorEndpoint: window.AQUATWIN_SENSOR_API || (isLocalFrontend
    ? 'http://127.0.0.1:8000/api/sensores/limpios'
    : `${window.location.origin}/api/sensores/limpios`),
  // These are getters so they always use the current (resolved) BACKEND_URL
  get twinStateEndpoint()      { return BACKEND_URL + '/api/v1/twin/state'; },
  get readingsLatestEndpoint() { return BACKEND_URL + '/api/v1/readings/latest'; },
  pollMs: 5000,
  twinPollMs: 8000,
});

/* ── AUTH HELPERS ─────────────────────────────────────────────── */

function getAccessToken() {
  return localStorage.getItem('accessToken');
}

function getUser() {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null');
  } catch {
    return null;
  }
}

function doLogout() {
  fetch(`${BACKEND_URL}/api/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  }).catch(() => {});
  localStorage.removeItem('accessToken');
  localStorage.removeItem('user');
  window.location.replace('../index.html');
}
window.doLogout = doLogout;

/* ── AUTH GUARD ───────────────────────────────────────────────── */
(function authGuard() {
  const token = getAccessToken();
  if (!token) {
    window.location.replace('../index.html');
  }
})();

/* ── USER DISPLAY ─────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const user = getUser();
  const el = document.getElementById('sidebarUserName');
  if (el && user) {
    el.textContent = user.name || user.email || 'Usuario';
  } else if (el) {
    el.textContent = 'demo@oceanotech.com';
  }
});

/* ── GLOBAL STATE ─────────────────────────────────────────────── */

const GlobalState = (() => {
  const listeners = new Set();
  const state = {
    route: 'gemelo',
    twinMode: 'SIMULATION',
    sensors: {
      source: 'bootstrap',
      quality: 'empty',
      lastUpdated: null,
      data: normalizeSensorData({}),
      history: [],
    },
    twin: {
      day: 0,
      biomass: 0,
      individualWeight: 0,
      population: 0,
      lastResult: null,
      data_quality: 0.947,
      twin_confidence: 0.918,
      last_sync: null,
    },
  };

  function clone(value) {
    return typeof structuredClone === 'function'
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value));
  }

  function notify(topic, payload) {
    const event = { topic, payload: clone(payload), state: getSnapshot() };
    listeners.forEach((listener) => {
      try { listener(event); } catch (error) { console.error('[GlobalState]', error); }
    });
  }

  function getSnapshot() { return clone(state); }

  function setRoute(route) {
    state.route = route;
    notify('route:changed', { route });
  }

  function setCleanSensorData(payload, source = 'api') {
    const data = normalizeSensorData(payload);
    const sample = {
      source,
      quality: 'ok',
      lastUpdated: new Date().toISOString(),
      data,
    };
    state.sensors.source = sample.source;
    state.sensors.quality = sample.quality;
    state.sensors.lastUpdated = sample.lastUpdated;
    state.sensors.data = sample.data;
    state.sensors.history.push(sample);
    if (state.sensors.history.length > 240) state.sensors.history.shift();
    notify('sensors:updated', state.sensors);
    return clone(state.sensors);
  }

  function getLatestSensorData() { return clone(state.sensors); }

  function setTwinSnapshot(snapshot) {
    state.twin = { ...state.twin, ...clone(snapshot) };
    state.twin.last_sync = new Date().toISOString();
    notify('twin:updated', state.twin);
  }

  function setTwinMode(mode) {
    state.twinMode = mode;
    notify('twin:mode_changed', { mode });
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    getSnapshot, setRoute, setCleanSensorData,
    getLatestSensorData, setTwinSnapshot, setTwinMode, subscribe,
  };
})();

function normalizeSensorData(raw) {
  const aliases = {
    oxygen: 'do', dissolvedOxygen: 'do', oxigeno: 'do', o2: 'do',
    temperatura: 'temperature', salinidad: 'salinity', amonio: 'ammonia',
    nh3: 'ammonia', turbidez: 'turbidity', caudal: 'flow', ph: 'pH',
  };
  const canonical = {};
  Object.entries(raw || {}).forEach(([key, value]) => {
    canonical[aliases[key] || key] = value;
  });
  return Object.fromEntries(Object.entries(SENSOR_SCHEMA).map(([key, rule]) => {
    const value = Number(canonical[key]);
    const safe = Number.isFinite(value) ? value : rule.fallback;
    return [key, Math.max(rule.min, Math.min(rule.max, safe))];
  }));
}

/* ── SPA ROUTER ───────────────────────────────────────────────── */

const AppRouter = (() => {
  const routes = new Set(['captacion', 'gemelo']);

  function currentRoute() {
    const candidate = window.location.hash.replace('#', '').replace('/', '') || 'gemelo';
    return routes.has(candidate) ? candidate : 'gemelo';
  }

  function navigate() {
    const route = currentRoute();
    document.querySelectorAll('[data-route-view]').forEach((view) => {
      view.classList.toggle('active', view.dataset.routeView === route);
      view.setAttribute('aria-hidden', String(view.dataset.routeView !== route));
    });
    document.querySelectorAll('[data-route-link]').forEach((link) => {
      link.classList.toggle('active', link.dataset.routeLink === route);
      link.setAttribute('aria-current', link.dataset.routeLink === route ? 'page' : 'false');
    });
    document.body.dataset.route = route;
    GlobalState.setRoute(route);
  }

  function isRouteActive(route) { return currentRoute() === route; }

  window.addEventListener('hashchange', navigate);
  document.addEventListener('DOMContentLoaded', navigate);

  return { navigate, isRouteActive };
})();

/* ── TWIN STATUS BAR ──────────────────────────────────────────── */

function updateTwinStatusBar(twinData, mode) {
  const modeEl   = document.getElementById('tsbMode');
  const lastSync = document.getElementById('tsbLastSync');
  const quality  = document.getElementById('tsbQuality');
  const conf     = document.getElementById('tsbConfidence');
  const dot      = document.getElementById('tsbPulseDot');

  const m = (mode || 'SIMULATION').toUpperCase();
  if (modeEl) {
    modeEl.textContent = m;
    modeEl.className = 'tsb-mode ' + m.toLowerCase();
  }

  if (dot) {
    dot.style.background = m === 'LIVE' ? 'var(--gr)' : m === 'SIMULATION' ? '#c4b0ff' : m === 'OFFLINE' ? 'var(--rd)' : 'var(--yw)';
    dot.style.boxShadow = `0 0 5px ${dot.style.background}`;
  }

  if (lastSync) {
    const ts = twinData?.last_sync ? new Date(twinData.last_sync).toLocaleTimeString('es-CL') : '—';
    lastSync.textContent = ts;
  }
  if (quality) {
    const q = twinData?.data_quality ? (twinData.data_quality * 100).toFixed(1) + '%' : '94.7%';
    quality.textContent = q;
  }
  if (conf) {
    const c = twinData?.twin_confidence ? (twinData.twin_confidence * 100).toFixed(1) + '%' : '91.8%';
    conf.textContent = c;
  }

  // Sidebar state card
  const statusEl = document.getElementById('globalStateStatus');
  const tsEl     = document.getElementById('globalStateTimestamp');
  const dqEl     = document.getElementById('globalDataQuality');
  if (statusEl) statusEl.textContent = m;
  if (tsEl && twinData?.last_sync) {
    tsEl.textContent = 'Sync: ' + new Date(twinData.last_sync).toLocaleTimeString('es-CL');
  }
  if (dqEl && twinData?.data_quality) {
    const b = dqEl.querySelector('b');
    if (b) b.textContent = (twinData.data_quality * 100).toFixed(1) + '%';
  }
}

/* ── TWIN STATE API POLL ──────────────────────────────────────── */

async function pollTwinState() {
  const token = getAccessToken();
  if (!token) return;

  // Ensure BACKEND_URL is resolved before calling
  await resolveBackendUrl();

  try {
    const response = await fetch(API_CONFIG.twinStateEndpoint, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Twin API ${response.status}`);
    const twin = await response.json();

    GlobalState.setTwinMode(twin.mode || 'SIMULATION');
    updateTwinStatusBar(twin, twin.mode);

    // Feed sensor data from twin observed state into GlobalState
    if (twin.observed_state) {
      const obs = twin.observed_state;
      GlobalState.setCleanSensorData({
        temperature:      obs.temperature?.value,
        do:               obs.dissolved_oxygen?.value,
        salinity:         obs.salinity?.value,
        pH:               obs.pH?.value,
        ammonia:          obs.ammonia?.value,
        turbidity:        obs.turbidity?.value,
        flow:             obs.flow?.value,
      }, 'twin-api');
    }

    // Update sensor registry
    renderSensorRegistry(twin);
    renderDataQuality(twin);
    renderSourceCards(twin);
    renderConnectivity(twin.mode);

    return twin;
  } catch (err) {
    console.warn('[TwinAPI]', err.message);
    updateTwinStatusBar(null, 'OFFLINE');
    renderConnectivity('OFFLINE');
  }
}

/* ── SOURCE CARDS ─────────────────────────────────────────────── */

const SIMULATED_SOURCES = [
  { id: 'DO-SITE01-C07-001',  name: 'O₂ Disuelto',  site: 'SITE01', cage: 'CAGE07', param: 'dissolved_oxygen', unit: 'mg/L',  valueKey: 'do',          status: 'SIMULATION' },
  { id: 'TMP-SITE01-C07-001', name: 'Temperatura',   site: 'SITE01', cage: 'CAGE07', param: 'temperature',      unit: '°C',    valueKey: 'temperature',  status: 'SIMULATION' },
  { id: 'SAL-SITE01-C07-001', name: 'Salinidad',     site: 'SITE01', cage: 'CAGE07', param: 'salinity',         unit: 'PSU',   valueKey: 'salinity',     status: 'SIMULATION' },
  { id: 'PH-SITE01-C07-001',  name: 'pH',            site: 'SITE01', cage: 'CAGE07', param: 'pH',               unit: '',      valueKey: 'pH',           status: 'SIMULATION' },
  { id: 'NH3-SITE01-C07-001', name: 'Amonio NH₃',    site: 'SITE01', cage: 'CAGE07', param: 'ammonia',          unit: 'mg/L',  valueKey: 'ammonia',      status: 'SIMULATION' },
  { id: 'TRB-SITE01-C07-001', name: 'Turbidez',      site: 'SITE01', cage: 'CAGE07', param: 'turbidity',        unit: 'NTU',   valueKey: 'turbidity',    status: 'SIMULATION' },
  { id: 'FLW-SITE01-C07-001', name: 'Caudal',        site: 'SITE01', cage: 'CAGE07', param: 'flow',             unit: 'L/min', valueKey: 'flow',         status: 'SIMULATION' },
];

function renderSourceCards(twin) {
  const wrap = document.getElementById('sourceCardsWrap');
  if (!wrap) return;

  const sensors = GlobalState.getSnapshot().sensors.data;
  const now = new Date().toLocaleTimeString('es-CL');

  wrap.innerHTML = SIMULATED_SOURCES.map(src => {
    const rawVal = sensors[src.valueKey];
    const val = src.valueKey === 'ammonia'
      ? (rawVal * 1000).toFixed(2) + ' µg/L'
      : src.valueKey === 'flow'
        ? Math.round(rawVal) + ' ' + src.unit
        : rawVal?.toFixed(2) + ' ' + src.unit;

    const badgeClass = src.status === 'LIVE' ? 'live' : src.status === 'OFFLINE' ? 'offline' : 'sim';
    const badgeLabel = src.status === 'LIVE' ? 'LIVE' : src.status === 'OFFLINE' ? 'OFFLINE' : 'SIM';

    return `<div class="source-card">
      <div class="source-card-header">
        <span class="source-card-id">${src.id}</span>
        <span class="source-badge ${badgeClass}">${badgeLabel}</span>
      </div>
      <div class="source-card-name">${src.name}</div>
      <div class="source-card-meta">${src.site} · ${src.cage} · Última: ${now}</div>
      <div class="source-card-value">${val}</div>
    </div>`;
  }).join('');
}

function showAddSourceModal() {
  alert('Módulo de registro de fuentes en desarrollo.\nFase 2: permitirá agregar sensores IoT, APIs REST, MQTT y más.');
}
window.showAddSourceModal = showAddSourceModal;

/* ── CONNECTIVITY ─────────────────────────────────────────────── */

function renderConnectivity(mode) {
  const grid = document.getElementById('connectivityGrid');
  if (!grid) return;

  const isOnline = mode !== 'OFFLINE';
  const isLive   = mode === 'LIVE' || mode === 'HYBRID';

  const items = [
    { label: 'Internet',      status: isOnline ? 'ONLINE'     : 'OFFLINE',  cls: isOnline   ? 'ok' : 'err' },
    { label: 'Gateway',       status: isOnline ? 'ONLINE'     : 'OFFLINE',  cls: isOnline   ? 'ok' : 'err' },
    { label: 'MQTT',          status: isLive   ? 'CONECTADO'  : 'N/D',      cls: isLive     ? 'ok' : 'warn' },
    { label: 'REST API',      status: isOnline ? 'HEALTHY'    : 'DOWN',     cls: isOnline   ? 'ok' : 'err' },
    { label: 'Base de datos', status: isOnline ? 'HEALTHY'    : 'DOWN',     cls: isOnline   ? 'ok' : 'err' },
    { label: 'WebSocket',     status: isLive   ? 'CONECTADO'  : 'N/D',      cls: isLive     ? 'ok' : 'warn' },
  ];

  grid.innerHTML = items.map(item => `
    <div class="conn-item">
      <span class="conn-label">${item.label}</span>
      <span class="conn-status ${item.cls}">${item.status}</span>
    </div>
  `).join('');
}

/* ── SENSOR REGISTRY ──────────────────────────────────────────── */

function renderSensorRegistry(twin) {
  const tbody = document.getElementById('sensorRegistryBody');
  if (!tbody) return;

  const sensors = GlobalState.getSnapshot().sensors.data;

  const rows = SIMULATED_SOURCES.map(src => {
    const rawVal = sensors[src.valueKey];
    const val = src.valueKey === 'ammonia'
      ? (rawVal * 1000).toFixed(2)
      : src.valueKey === 'flow'
        ? Math.round(rawVal)
        : rawVal?.toFixed(2);
    const unit = src.valueKey === 'ammonia' ? 'µg/L' : src.unit;

    // Determine status color based on observed_state quality
    let quality = 95;
    let statusBadge = '<span style="color:var(--gr);font-weight:700;font-family:var(--mono);font-size:.72rem;">OK</span>';

    if (twin?.observed_state) {
      const paramMap = { do: 'dissolved_oxygen', temperature: 'temperature', salinity: 'salinity', pH: 'pH', ammonia: 'ammonia', turbidity: 'turbidity', flow: 'flow' };
      const obs = twin.observed_state[paramMap[src.valueKey]];
      if (obs) {
        quality = obs.quality || 95;
        const ok = quality >= 90;
        const warn = quality >= 70;
        statusBadge = ok
          ? `<span style="color:var(--gr);font-weight:700;font-family:var(--mono);font-size:.72rem;">OK</span>`
          : warn
            ? `<span style="color:var(--yw);font-weight:700;font-family:var(--mono);font-size:.72rem;">WARN</span>`
            : `<span style="color:var(--rd);font-weight:700;font-family:var(--mono);font-size:.72rem;">ERR</span>`;
      }
    }

    return `<tr>
      <td style="font-family:var(--mono);font-size:.65rem;color:var(--muted);">${src.id}</td>
      <td>${src.name}</td>
      <td style="font-family:var(--mono);font-weight:700;color:var(--br);">${val}</td>
      <td style="font-family:var(--mono);font-size:.72rem;color:var(--text2);">${unit}</td>
      <td>${statusBadge}</td>
      <td style="font-family:var(--mono);font-size:.72rem;color:var(--br);">${quality}/100</td>
    </tr>`;
  });

  tbody.innerHTML = rows.join('');
}

/* ── DATA QUALITY BARS ────────────────────────────────────────── */

function renderDataQuality(twin) {
  const container = document.getElementById('dqBarsContainer');
  const scoreBig  = document.getElementById('dqScoreBig');
  if (!container) return;

  const observed = twin?.observed_state || {};
  const paramMap = {
    'Temperatura': 'temperature', 'O₂ Disuelto': 'dissolved_oxygen',
    'pH': 'pH', 'Salinidad': 'salinity', 'Turbidez': 'turbidity',
    'Amonio': 'ammonia', 'Caudal': 'flow',
  };

  let totalScore = 0;
  const rows = Object.entries(paramMap).map(([label, key]) => {
    const score = observed[key]?.quality ?? 95;
    totalScore += score;
    const color = score >= 90 ? 'var(--gr)' : score >= 70 ? 'var(--yw)' : 'var(--rd)';
    return `<div class="dq-row">
      <span class="dq-label">${label}</span>
      <div class="dq-trk"><div class="dq-fill" style="width:${score}%;background:${color};"></div></div>
      <span class="dq-val">${score}%</span>
    </div>`;
  });

  container.innerHTML = rows.join('');

  const avg = (totalScore / Object.keys(paramMap).length).toFixed(1);
  if (scoreBig) {
    scoreBig.textContent = avg + '%';
    scoreBig.style.color = parseFloat(avg) >= 90 ? 'var(--gr)' : parseFloat(avg) >= 70 ? 'var(--yw)' : 'var(--rd)';
  }

  // Update global twin confidence
  if (twin?.twin_confidence) {
    const tsbConf = document.getElementById('tsbConfidence');
    if (tsbConf) tsbConf.textContent = (twin.twin_confidence * 100).toFixed(1) + '%';
  }
}

/* ── CAPTACIÓN DASHBOARD ──────────────────────────────────────── */

const CaptacionDashboard = (() => {
  const interop = [
    'Backend FastAPI (Fase 2) publicará lecturas vía REST y MQTT.',
    'GlobalState actúa como bus local entre captación, modelos y simulador TGC.',
    'El gemelo digital consume la última lectura limpia sin reiniciar canvas ni boids.',
    'La capa de API puede reemplazarse por SSE/WebSocket para telemetría continua.',
    'TimescaleDB (Fase 3) almacenará series temporales de sensores y estado del gemelo.',
  ];

  const operativeAlerts = [
    { state: 'green',  cage: 'CAGE-07', event: 'Consumo en rango óptimo',       action: 'Mantener estrategia actual' },
    { state: 'yellow', cage: 'CAGE-11', event: 'Turbidez elevándose',            action: 'Ajustar aireación · monitorear 30 min' },
    { state: 'red',    cage: 'CAGE-03', event: 'Caída de oxígeno puntual',       action: 'Activar protocolo O₂ · reducir alimentación' },
  ];

  function init() {
    bindEvents();
    renderStatic();
    renderFromState(GlobalState.getSnapshot());

    GlobalState.subscribe(({ topic, state }) => {
      if (topic === 'sensors:updated' || topic === 'twin:updated') {
        renderFromState(state);
      }
    });

    pollCleanSensorApi();
    window.setInterval(pollCleanSensorApi, API_CONFIG.pollMs);

    // Poll twin state from backend
    pollTwinState();
    window.setInterval(pollTwinState, API_CONFIG.twinPollMs);

    // Initial static renders
    renderConnectivity('SIMULATION');
  }

  function bindEvents() {
    document.getElementById('capRefresh')?.addEventListener('click', () => {
      pollCleanSensorApi();
      pollTwinState();
    });
    document.getElementById('capHorizon')?.addEventListener('change', () => {
      renderFromState(GlobalState.getSnapshot());
    });
    window.addEventListener('resize', drawPredictiveChart);
  }

  async function pollCleanSensorApi() {
    try {
      const response = await fetch(API_CONFIG.cleanSensorEndpoint, { cache: 'no-store' });
      if (!response.ok) throw new Error(`API ${response.status}`);
      const payload = await response.json();
      GlobalState.setCleanSensorData(payload.data || payload, 'fastapi');
    } catch {
      GlobalState.setCleanSensorData(generateDemoSensorSample(), 'demo-fallback');
    }
  }

  function generateDemoSensorSample() {
    const t = Date.now() / 1000;
    return {
      temperature: 12.8 + Math.sin(t / 40) * 0.6,
      do:          8.1  + Math.cos(t / 33) * 0.35,
      pH:          7.72 + Math.sin(t / 55) * 0.08,
      ammonia:     0.008 + Math.max(0, Math.sin(t / 70)) * 0.004,
      salinity:    33.0  + Math.cos(t / 90) * 0.25,
      turbidity:   3.2   + Math.max(0, Math.sin(t / 45)) * 2.1,
      flow:        1180  + Math.sin(t / 35) * 90,
    };
  }

  function renderStatic() {
    const list = document.getElementById('capInteropList');
    if (list) list.innerHTML = interop.map(item => `<li>${item}</li>`).join('');

    const body = document.getElementById('capAlertsBody');
    if (body) {
      body.innerHTML = operativeAlerts.map(alert => `
        <tr>
          <td><span class="state ${alert.state}">${alert.state.toUpperCase()}</span></td>
          <td style="font-family:var(--mono);font-size:.8rem;">${alert.cage}</td>
          <td>${alert.event}</td>
          <td style="font-size:.82rem;color:var(--text2);">${alert.action}</td>
        </tr>
      `).join('');
    }
  }

  function renderFromState(state) {
    const sensors = state.sensors.data;
    const twin    = state.twin;
    const biomass = twin.biomass || 186.4;
    const fcr     = twin.lastResult?.FCR || 1.21;
    const oxygen  = sensors.do;
    const risk    = calculateRisk(sensors);

    const kpis = [
      { title: 'Biomasa estimada',   value: `${biomass.toFixed(1)} t`,       trend: `Día ${twin.day || 0}` },
      { title: 'FCR acumulado',      value: fcr.toFixed(2),                  trend: fcr <= 1.25 ? 'Eficiente' : 'Revisar ración' },
      { title: 'O₂ Disuelto',        value: `${oxygen.toFixed(2)} mg/L`,     trend: oxygen >= 7 ? 'En rango' : 'Atención' },
      { title: 'Riesgo operativo',   value: risk.label,                      trend: `Índice ${risk.score.toFixed(2)}` },
      { title: 'Calidad de datos',   value: `${(twin.data_quality * 100 || 94.7).toFixed(1)}%`, trend: 'SIMULATION' },
      { title: 'Confianza gemelo',   value: `${(twin.twin_confidence * 100 || 91.8).toFixed(1)}%`, trend: 'Modelo TGC v2.5' },
    ];

    const grid = document.getElementById('capKpiGrid');
    if (grid) {
      grid.innerHTML = kpis.map(kpi => `
        <article class="kpi">
          <h4>${kpi.title}</h4>
          <div class="value">${kpi.value}</div>
          <div class="trend">${kpi.trend}</div>
        </article>
      `).join('');
    }

    renderWater(sensors);
    renderSourceCards(null);
    drawPredictiveChart();
    renderGlobalStateStatus(state.sensors, state.twinMode);
  }

  function renderWater(sensors) {
    const rows = [
      { name: 'Temperatura',    value: `${sensors.temperature.toFixed(1)} °C`,    status: inRange(sensors.temperature, 10, 16) },
      { name: 'O₂ Disuelto',   value: `${sensors.do.toFixed(2)} mg/L`,            status: inRange(sensors.do, 7, 12) },
      { name: 'pH',             value: sensors.pH.toFixed(2),                      status: inRange(sensors.pH, 7, 8) },
      { name: 'Amonio NH₃',    value: `${(sensors.ammonia * 1000).toFixed(1)} µg/L`, status: sensors.ammonia < 0.012 ? 'ok' : sensors.ammonia < 0.03 ? 'warn' : 'critical' },
      { name: 'Turbidez',       value: `${sensors.turbidity.toFixed(1)} NTU`,      status: sensors.turbidity < 5 ? 'ok' : sensors.turbidity < 15 ? 'warn' : 'critical' },
      { name: 'Salinidad',      value: `${sensors.salinity.toFixed(1)} PSU`,       status: inRange(sensors.salinity, 30, 35) },
      { name: 'Caudal',         value: `${sensors.flow.toFixed(0)} L/min`,         status: sensors.flow >= 800 ? 'ok' : sensors.flow >= 400 ? 'warn' : 'critical' },
    ];

    const container = document.getElementById('capWaterMetrics');
    if (container) {
      container.innerHTML = rows.map(row => `
        <div class="metric-item">
          <span>${row.name}</span>
          <strong style="color:${row.status==='ok'?'var(--gr)':row.status==='warn'?'var(--yw)':'var(--rd)'}">${row.value}</strong>
        </div>
      `).join('');
    }

    const hasCritical = rows.some(row => row.status === 'critical');
    const hasWarn     = rows.some(row => row.status === 'warn');
    const badge       = document.getElementById('capWaterBadge');
    if (badge) {
      badge.className  = `badge ${hasCritical ? 'critical' : hasWarn ? 'warn' : 'ok'}`;
      badge.textContent = hasCritical ? 'Crítico' : hasWarn ? 'Atención' : 'Estable';
    }
  }

  function drawPredictiveChart() {
    const canvas = document.getElementById('capPredictiveChart');
    if (!canvas || canvas.offsetWidth === 0) return;
    const ctx    = canvas.getContext('2d');
    const width  = canvas.width = canvas.offsetWidth;
    const height = canvas.height;
    const points = GlobalState.getSnapshot().sensors.history.slice(-24);
    const values = points.length
      ? points.map(p => p.data.do)
      : [7.7, 7.9, 8.1, 8.0, 8.2, 8.4, 8.3, 8.1, 7.9, 8.0];

    const min = Math.min(...values, 5);
    const max = Math.max(...values, 10);

    ctx.clearRect(0, 0, width, height);

    // Grid
    ctx.strokeStyle = 'rgba(0,175,210,.13)';
    ctx.lineWidth   = 1;
    for (let i = 0; i < 5; i++) {
      const y = (height / 4) * i;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }

    // Area fill
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, 'rgba(0,200,220,.18)');
    grad.addColorStop(1, 'rgba(0,200,220,.02)');
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = values.length === 1 ? 0 : (width / (values.length - 1)) * i;
      const y = height - ((v - min) / Math.max(0.1, max - min)) * (height - 20) - 10;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.lineTo(width, height); ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = values.length === 1 ? 0 : (width / (values.length - 1)) * i;
      const y = height - ((v - min) / Math.max(0.1, max - min)) * (height - 20) - 10;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.lineWidth   = 2.4;
    ctx.strokeStyle = '#00c8d8';
    ctx.stroke();

    // Labels
    ctx.fillStyle = 'rgba(0,200,220,.55)';
    ctx.font      = '8px IBM Plex Mono';
    ctx.fillText('O₂ Disuelto — últimas lecturas', 8, 12);

    // Accuracy
    const accuracy = document.getElementById('capAccuracy');
    if (accuracy) accuracy.textContent = '—';
  }

  function renderGlobalStateStatus(sensors, mode) {
    const status    = document.getElementById('globalStateStatus');
    const timestamp = document.getElementById('globalStateTimestamp');
    const m = mode || 'SIMULATION';
    if (status) status.textContent = m;
    if (timestamp && sensors.lastUpdated) {
      timestamp.textContent = 'Sync: ' + new Date(sensors.lastUpdated).toLocaleTimeString('es-CL');
    }
  }

  function inRange(value, min, max) {
    if (value >= min && value <= max) return 'ok';
    if (value >= min * 0.85 && value <= max * 1.15) return 'warn';
    return 'critical';
  }

  function calculateRisk(sensors) {
    const components = [
      sensors.do < 7          ? (7 - sensors.do) / 7 : 0,
      sensors.temperature < 10 ? (10 - sensors.temperature) / 10 : sensors.temperature > 16 ? (sensors.temperature - 16) / 16 : 0,
      sensors.pH < 7           ? (7 - sensors.pH) / 7 : sensors.pH > 8 ? (sensors.pH - 8) / 8 : 0,
      sensors.ammonia > 0.012  ? Math.min(1, (sensors.ammonia - 0.012) / 0.038) : 0,
      sensors.turbidity > 5    ? Math.min(1, (sensors.turbidity - 5) / 25) : 0,
    ];
    const score = Math.max(0, Math.min(1, components.reduce((s, v) => s + v, 0) / components.length));
    return { score, label: score < 0.2 ? 'Bajo' : score < 0.45 ? 'Medio' : 'Alto' };
  }

  document.addEventListener('DOMContentLoaded', init);
  return { init, pollCleanSensorApi };
})();

window.GlobalState         = GlobalState;
window.AppRouter           = AppRouter;
window.CaptacionDashboard  = CaptacionDashboard;
