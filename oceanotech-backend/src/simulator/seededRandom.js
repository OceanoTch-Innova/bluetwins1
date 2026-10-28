/**
 * seededRandom.js
 * AquaTwins — Deterministic pseudo-random number generator.
 *
 * Uses the Mulberry32 algorithm: fast, 32-bit seeded PRNG.
 * Gives reproducible results across all Node.js versions.
 *
 * Usage:
 *   const { SeededRandom } = require('./seededRandom');
 *   const rng = new SeededRandom(42);
 *   rng.next();        // 0–1 uniform float
 *   rng.normal(0, 1);  // Gaussian float
 *   rng.between(-0.5, 0.5); // uniform in [min, max]
 */

'use strict';

class SeededRandom {
  /**
   * @param {number} seed  Integer seed. Same seed → same sequence.
   */
  constructor(seed) {
    this._state = (seed | 0) >>> 0;  // ensure unsigned 32-bit integer
  }

  /**
   * Returns next uniform float in [0, 1).
   * Mulberry32 algorithm — passes TestU01 SmallCrush.
   */
  next() {
    let t = (this._state += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Returns a uniform float in [min, max).
   */
  between(min, max) {
    return min + this.next() * (max - min);
  }

  /**
   * Returns a Gaussian (normal) random via Box-Muller.
   * @param {number} mean
   * @param {number} stddev
   */
  normal(mean = 0, stddev = 1) {
    // Box-Muller transform
    const u1 = Math.max(Number.EPSILON, this.next());
    const u2 = this.next();
    const z  = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + stddev * z;
  }

  /**
   * Clone this PRNG at its current state.
   * Useful for branching deterministic runs.
   */
  fork() {
    const copy = new SeededRandom(0);
    copy._state = this._state;
    return copy;
  }

  /**
   * Returns a new SeededRandom seeded by combining a base seed with a cage identifier.
   * Ensures each cage in a multi-cage simulation has its own independent RNG stream.
   *
   * @param {number} baseSeed
   * @param {string} cageId
   */
  static forCage(baseSeed, cageId) {
    // Simple djb2 hash of cageId, XOR'd with baseSeed
    let hash = 5381;
    for (let i = 0; i < cageId.length; i++) {
      hash = ((hash << 5) + hash) ^ cageId.charCodeAt(i);
    }
    return new SeededRandom((baseSeed ^ (hash >>> 0)) >>> 0);
  }
}

module.exports = { SeededRandom };
