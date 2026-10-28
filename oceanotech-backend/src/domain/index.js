/**
 * index.js
 * AquaTwins — Domain layer public API.
 *
 * Import everything domain-related from this single entry point.
 *
 * Usage:
 *   const { createTwinState, TwinMode, DEFAULT_TWIN_ID } = require('./domain');
 */

'use strict';

const entities   = require('./entities');
const provenance = require('./provenance');
const { MODEL_CONFIG } = require('./modelConfig');
const seedData   = require('./seedData');

module.exports = {
  // Entity factories
  ...entities,

  // Provenance enums
  ...provenance,

  // Model configuration
  MODEL_CONFIG,

  // Seed / reference data and helpers
  ...seedData,
};
