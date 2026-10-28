/**
 * seedData.js
 * AquaTwins — Reference seed data for the domain model.
 *
 * Defines the initial Farm → Site → Cage → Cohort hierarchy
 * used by the demo/simulation. This replaces the hardcoded
 * 'SITE01'/'CAGE07' strings scattered throughout the codebase.
 *
 * To add new sites or cages, extend the arrays below.
 * The rest of the system reads from this registry.
 */

'use strict';

const { createFarm, createSite, createCage, createCohort, createDevice, createSensor } = require('./entities');
const { DataSource } = require('./provenance');
const { MODEL_CONFIG } = require('./modelConfig');

// ─── Farm ─────────────────────────────────────────────────────────────────────

const DEMO_FARM = createFarm({
  farm_id: 'FARM01',
  name:    'OceanoTech Demo Farm',
  company: 'OceanoTech Innova',
  country: 'Chile',
  region:  'Los Lagos',
  species: 'Salmo salar',
});

// ─── Sites ────────────────────────────────────────────────────────────────────

const DEMO_SITES = [
  createSite({
    site_id:    'SITE01',
    farm_id:    'FARM01',
    name:       'Sitio Sur — Lago Rupanco',
    latitude:   -40.820,
    longitude:  -72.465,
    depth_m:    22,
    cage_count: 3,
  }),
  createSite({
    site_id:    'SITE02',
    farm_id:    'FARM01',
    name:       'Sitio Norte — Canal Chacao',
    latitude:   -41.778,
    longitude:  -73.518,
    depth_m:    30,
    cage_count: 2,
  }),
];

// ─── Cages ────────────────────────────────────────────────────────────────────

const DEMO_CAGES = [
  // SITE01 cages
  createCage({
    cage_id:    'CAGE07',
    site_id:    'SITE01',
    name:       'Jaula 07 — Norte',
    type:       'circular_net_pen',
    diameter_m: 40,
    depth_m:    20,
    volume_m3:  MODEL_CONFIG.DEFAULT_CAGE_VOL_M3,
    status:     'ACTIVE',
  }),
  createCage({
    cage_id:    'CAGE08',
    site_id:    'SITE01',
    name:       'Jaula 08 — Sur',
    type:       'circular_net_pen',
    diameter_m: 40,
    depth_m:    20,
    volume_m3:  MODEL_CONFIG.DEFAULT_CAGE_VOL_M3,
    status:     'ACTIVE',
  }),
  createCage({
    cage_id:    'CAGE09',
    site_id:    'SITE01',
    name:       'Jaula 09 — Este',
    type:       'circular_net_pen',
    diameter_m: 32,
    depth_m:    18,
    volume_m3:  1450,
    status:     'FALLOW',
  }),
  // SITE02 cages
  createCage({
    cage_id:    'CAGE01',
    site_id:    'SITE02',
    name:       'Jaula 01 — Poniente',
    type:       'circular_net_pen',
    diameter_m: 50,
    depth_m:    25,
    volume_m3:  2450,
    status:     'ACTIVE',
  }),
  createCage({
    cage_id:    'CAGE02',
    site_id:    'SITE02',
    name:       'Jaula 02 — Oriente',
    type:       'circular_net_pen',
    diameter_m: 50,
    depth_m:    25,
    volume_m3:  2450,
    status:     'ACTIVE',
  }),
];

// ─── Cohorts ─────────────────────────────────────────────────────────────────

const DEMO_COHORTS = [
  createCohort({
    cohort_id:        '2026-A',
    cage_id:          'CAGE07',
    site_id:          'SITE01',
    species:          'Salmo salar',
    strain:           'AquaGen',
    stocking_date:    '2026-01-15',
    expected_harvest: '2027-07-01',
    initial_count:    50000,
    initial_weight_g: 80,
    status:           'ACTIVE',
  }),
  createCohort({
    cohort_id:        '2026-B',
    cage_id:          'CAGE08',
    site_id:          'SITE01',
    species:          'Salmo salar',
    strain:           'Benchmark',
    stocking_date:    '2026-03-01',
    expected_harvest: '2027-09-15',
    initial_count:    48000,
    initial_weight_g: 95,
    status:           'ACTIVE',
  }),
  createCohort({
    cohort_id:        '2025-X',
    cage_id:          'CAGE01',
    site_id:          'SITE02',
    species:          'Salmo salar',
    strain:           'SalmoBreed',
    stocking_date:    '2025-11-10',
    expected_harvest: '2027-04-30',
    initial_count:    62000,
    initial_weight_g: 70,
    status:           'ACTIVE',
  }),
];

// ─── Virtual Devices (one multi-parameter probe per active cage) ──────────────

const DEMO_DEVICES = [
  {
    device_id:   'V-DEVICE-SITE01-C07',
    site_id:     'SITE01',
    cage_id:     'CAGE07',
    name:        'Sonda Multiparámetro — CAGE07',
    type:        'MULTI_PARAMETER_PROBE',
    device_kind: 'VIRTUAL',
    status:      'ACTIVE',
  },
  {
    device_id:   'V-DEVICE-SITE01-C08',
    site_id:     'SITE01',
    cage_id:     'CAGE08',
    name:        'Sonda Multiparámetro — CAGE08',
    type:        'MULTI_PARAMETER_PROBE',
    device_kind: 'VIRTUAL',
    status:      'ACTIVE',
  },
  {
    device_id:   'V-DEVICE-SITE02-C01',
    site_id:     'SITE02',
    cage_id:     'CAGE01',
    name:        'Sonda Multiparámetro — CAGE01',
    type:        'MULTI_PARAMETER_PROBE',
    device_kind: 'VIRTUAL',
    status:      'ACTIVE',
  },
].map(d => createDevice(d));

// ─── Virtual Sensors (one channel per parameter per device) ──────────────────

function buildSensorsForDevice(device_id, ranges) {
  const params = [
    { param: 'dissolved_oxygen',  unit: 'mg/L', suffix: 'DO'  },
    { param: 'temperature',       unit: '°C',   suffix: 'TMP' },
    { param: 'salinity',          unit: 'PSU',  suffix: 'SAL' },
    { param: 'pH',                unit: null,   suffix: 'PH'  },
    { param: 'ammonia',           unit: 'mg/L', suffix: 'NH3' },
    { param: 'turbidity',         unit: 'NTU',  suffix: 'TRB' },
    { param: 'flow',              unit: 'L/min',suffix: 'FLW' },
  ];
  return params.map(p => createSensor({
    sensor_id: `V-${p.suffix}-${device_id}`,
    device_id,
    parameter:   p.param,
    unit:        p.unit,
    range_min:   MODEL_CONFIG.PARAMETER_RANGES[p.param]?.min,
    range_max:   MODEL_CONFIG.PARAMETER_RANGES[p.param]?.max,
    source:      DataSource.SIMULATION,
    status:      'ACTIVE',
  }));
}

const DEMO_SENSORS = [
  ...buildSensorsForDevice('V-DEVICE-SITE01-C07'),
  ...buildSensorsForDevice('V-DEVICE-SITE01-C08'),
  ...buildSensorsForDevice('V-DEVICE-SITE02-C01'),
];

// ─── Lookup helpers ───────────────────────────────────────────────────────────

/**
 * Find a cage by twin_id (e.g. 'DT-SITE01-CAGE07').
 */
function getCageByTwinId(twin_id) {
  return DEMO_CAGES.find(c => c.twin_id === twin_id) || null;
}

/**
 * Get all cages for a given site.
 */
function getCagesBySite(site_id) {
  return DEMO_CAGES.filter(c => c.site_id === site_id);
}

/**
 * Get the active cohort for a given cage.
 */
function getActiveCohort(cage_id) {
  return DEMO_COHORTS.find(c => c.cage_id === cage_id && c.status === 'ACTIVE') || null;
}

/**
 * Get devices for a cage.
 */
function getDevicesForCage(cage_id) {
  return DEMO_DEVICES.filter(d => d.cage_id === cage_id);
}

/**
 * Get all sensor channels for a cage.
 */
function getSensorsForCage(cage_id) {
  const deviceIds = getDevicesForCage(cage_id).map(d => d.device_id);
  return DEMO_SENSORS.filter(s => deviceIds.includes(s.device_id));
}

// ─── Default twin (backward-compatible alias) ─────────────────────────────────

/**
 * The canonical default twin used by the existing UI.
 * Previously hardcoded everywhere as 'DT-SITE01-CAGE07'.
 */
const DEFAULT_TWIN_ID = 'DT-SITE01-CAGE07';
const DEFAULT_CAGE_ID = 'CAGE07';
const DEFAULT_SITE_ID = 'SITE01';
const DEFAULT_COHORT_ID = '2026-A';

module.exports = {
  DEMO_FARM,
  DEMO_SITES,
  DEMO_CAGES,
  DEMO_COHORTS,
  DEMO_DEVICES,
  DEMO_SENSORS,
  getCageByTwinId,
  getCagesBySite,
  getActiveCohort,
  getDevicesForCage,
  getSensorsForCage,
  DEFAULT_TWIN_ID,
  DEFAULT_CAGE_ID,
  DEFAULT_SITE_ID,
  DEFAULT_COHORT_ID,
};
