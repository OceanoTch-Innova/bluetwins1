/**
 * index.js
 * AquaTwins — Simulator layer public API.
 *
 * Usage:
 *   const { PhysicalSystemSimulator, getScenario, SeededRandom } = require('./simulator');
 */

'use strict';

const { PhysicalSystemSimulator, ENV } = require('./PhysicalSystemSimulator');
const { SeededRandom }                  = require('./seededRandom');
const { SCENARIOS, getScenario, listScenarios } = require('./scenarios');

module.exports = {
  PhysicalSystemSimulator,
  ENV,
  SeededRandom,
  SCENARIOS,
  getScenario,
  listScenarios,
};
