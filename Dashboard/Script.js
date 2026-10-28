/* ════════════════════════════════════════════════════════════════
   OceanoTech Innova · script.js v2.0 - ROBUST EDITION
   Enhanced with: Error Handling, Performance Optimization, Modular Architecture
   ════════════════════════════════════════════════════════════════ */

'use strict';

/* ═══════════════════════════════════════════════════════════════
   § 0  CONFIGURATION & CONSTANTS
   ═══════════════════════════════════════════════════════════════ */

const CONFIG = Object.freeze({
  // Mathematical Model Parameters
  MODEL: {
    TGC: 2.85,
    TGC_MIN: 0.40,
    T_OPT: 14.0,
    T_SIGMA: 4.5,
    DO_HS: 3.5,
    DO_CRIT: 4.0,
    DO_LETHAL: 2.5,
    DO_PIPE: 5.5,
    NH3_SUB: 0.012,
    NH3_LET: 0.050,
    PH_LO: 7.0,
    PH_HI: 8.0,
    PH_MIN: 6.5,
    PH_MAX: 8.5,
    D_OPT: 20,
    D_MAX: 45,
    MU_BASE: 0.0003,
    FCR_BASE: 1.15,
    HARVEST_W: 5000,
    VOL: 2000,
  },

  // Boids Parameters
  BOIDS: {
    N_DOTS: 180,
    BL_MIN: 5,
    BL_MAX: 22,
    R_SEP_MULT: 3.2,
    R_ALN_MULT: 7.5,
    R_COH_MULT: 15.0,
    MAX_FORCE: 0.14,
    DAMPING: 0.91,
  },

  // Simulation Parameters
  SIM: {
    MAX_HIST: 600,
    INITIAL_W: 80,
    INITIAL_N: 50000,
    START_DATE: '2025-01-15',
    MAX_DT: 0.25,
    PRESEED_DAYS: 90,
  },

  // Performance Parameters
  PERF: {
    CANVAS_RESIZE_DEBOUNCE: 150,
    ALERT_CHECK_INTERVAL: 5000,
    MAX_ALERTS: 14,
    RENDER_THROTTLE: 16, // ~60fps
  },

  // Sensor Noise Levels
  SENSOR_NOISE: {
    temperature: 0.11,
    do: 0.065,
    salinity: 0.038,
    pH: 0.011,
    ammonia: 0.00075,
    turbidity: 0.16,
    flow: 16,
  },
});

/* ═══════════════════════════════════════════════════════════════
   § 1  UTILITY FUNCTIONS & HELPERS
   ═══════════════════════════════════════════════════════════════ */

const Utils = {
  /**
   * Clamp a value between min and max
   */
  clamp: (value, min, max) => Math.max(min, Math.min(max, value)),

  /**
   * Safe number parsing with fallback
   */
  safeNumber: (value, fallback = 0) => {
    const num = Number(value);
    return isFinite(num) ? num : fallback;
  },

  /**
   * Debounce function execution
   */
  debounce: (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  /**
   * Throttle function execution
   */
  throttle: (func, limit) => {
    let inThrottle;
    return function(...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  },

  /**
   * Safe DOM element getter
   */
  getElement: (id) => {
    const el = document.getElementById(id);
    if (!el) {
      Logger.warn(`Element not found: ${id}`);
    }
    return el;
  },

  /**
   * Safe canvas context getter
   */
  getCanvasContext: (canvas, type = '2d') => {
    try {
      if (!canvas) return null;
      const ctx = canvas.getContext(type);
      if (!ctx) {
        Logger.error(`Failed to get ${type} context`);
      }
      return ctx;
    } catch (error) {
      Logger.error('Canvas context error:', error);
      return null;
    }
  },

  /**
   * Format number for display
   */
  formatNumber: (num, decimals = 0) => {
    try {
      return num.toFixed(decimals);
    } catch {
      return '0';
    }
  },

  /**
   * Format number with locale
   */
  formatLocale: (num, locale = 'es-CL') => {
    try {
      return Math.round(num).toLocaleString(locale);
    } catch {
      return Math.round(num).toString();
    }
  },
};

/* ═══════════════════════════════════════════════════════════════
   § 2  LOGGING SYSTEM
   ═══════════════════════════════════════════════════════════════ */

const Logger = {
  enabled: true,
  level: 'info', // 'debug', 'info', 'warn', 'error'
  history: [],
  maxHistory: 100,

  _log(level, ...args) {
    if (!this.enabled) return;
    
    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    if (levels[level] < levels[this.level]) return;

    const timestamp = new Date().toISOString();
    const entry = { timestamp, level, message: args };
    
    this.history.push(entry);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    console[level] || console.log(prefix, ...args);
  },

  debug(...args) { this._log('debug', ...args); },
  info(...args) { this._log('info', ...args); },
  warn(...args) { this._log('warn', ...args); },
  error(...args) { this._log('error', ...args); },

  getHistory() { return [...this.history]; },
  clear() { this.history = []; },
};

/* ═══════════════════════════════════════════════════════════════
   § 3  ERROR HANDLER
   ═══════════════════════════════════════════════════════════════ */

const ErrorHandler = {
  errors: [],
  maxErrors: 50,

  handle(error, context = 'Unknown') {
    Logger.error(`Error in ${context}:`, error);
    
    this.errors.push({
      timestamp: Date.now(),
      context,
      message: error.message || String(error),
      stack: error.stack,
    });

    if (this.errors.length > this.maxErrors) {
      this.errors.shift();
    }

    // Show user-friendly error in UI if critical
    if (this.isCritical(context)) {
      this.showUserError(context, error);
    }
  },

  isCritical(context) {
    const critical = ['Simulation', 'Rendering', 'StateManager'];
    return critical.some(c => context.includes(c));
  },

  showUserError(context, error) {
    const msg = `Error en ${context}. La aplicación continuará funcionando.`;
    console.error(msg, error);
    // Could show a toast notification here
  },

  getErrors() { return [...this.errors]; },
  clear() { this.errors = []; },
};

/* ═══════════════════════════════════════════════════════════════
   § 4  VALIDATION LAYER
   ═══════════════════════════════════════════════════════════════ */

const Validator = {
  /**
   * Validate sensor data
   */
  validateSensorData(data) {
    const schema = {
      temperature: { min: 0, max: 30 },
      do: { min: 0, max: 15 },
      salinity: { min: 25, max: 40 },
      pH: { min: 6, max: 10 },
      ammonia: { min: 0, max: 0.1 },
      turbidity: { min: 0, max: 100 },
      flow: { min: 0, max: 3000 },
    };

    const validated = {};
    for (const [key, limits] of Object.entries(schema)) {
      if (data[key] === undefined) {
        Logger.warn(`Missing sensor data: ${key}`);
        validated[key] = (limits.min + limits.max) / 2;
      } else {
        validated[key] = Utils.clamp(
          Utils.safeNumber(data[key], limits.min),
          limits.min,
          limits.max
        );
      }
    }
    return validated;
  },

  /**
   * Validate simulation state
   */
  validateSimState(state) {
    return {
      W: Utils.clamp(Utils.safeNumber(state.W, 80), 1, 10000),
      N: Utils.clamp(Utils.safeNumber(state.N, 50000), 0, 100000),
      biomass: Utils.clamp(Utils.safeNumber(state.biomass, 4), 0, 1000),
      day: Math.max(0, Math.floor(Utils.safeNumber(state.day, 0))),
    };
  },

  /**
   * Validate canvas dimensions
   */
  validateCanvasDimensions(width, height) {
    const minSize = 10;
    const maxSize = 4096;
    return {
      width: Utils.clamp(Math.floor(width), minSize, maxSize),
      height: Utils.clamp(Math.floor(height), minSize, maxSize),
    };
  },
};

/* ═══════════════════════════════════════════════════════════════
   § 5  STATE MANAGER
   ═══════════════════════════════════════════════════════════════ */

const StateManager = {
  state: {
    simulation: {
      day: 0,
      W: CONFIG.SIM.INITIAL_W,
      N: CONFIG.SIM.INITIAL_N,
      biomass: CONFIG.SIM.INITIAL_W * CONFIG.SIM.INITIAL_N / 1e6,
      accumFeed: 0,
      accumDead: 0,
      paused: false,
      speed: 1,
      startDate: new Date(CONFIG.SIM.START_DATE),
    },
    sensors: {
      current: {
        temperature: 12.4,
        do: 8.4,
        salinity: 33.1,
        pH: 7.84,
        ammonia: 0.008,
        turbidity: 2.2,
        flow: 1185,
      },
      target: {
        temperature: 12.4,
        do: 8.4,
        salinity: 33.1,
        pH: 7.84,
        ammonia: 0.008,
        turbidity: 2.2,
        flow: 1185,
      },
    },
    scenario: {
      active: 'normal',
      daysLeft: 9999,
    },
    history: [],
    lastResult: null,
  },

  listeners: new Set(),

  /**
   * Get current state (immutable)
   */
  getState() {
    return JSON.parse(JSON.stringify(this.state));
  },

  /**
   * Update state safely
   */
  updateState(path, value) {
    try {
      const keys = path.split('.');
      let target = this.state;
      
      for (let i = 0; i < keys.length - 1; i++) {
        if (!target[keys[i]]) {
          target[keys[i]] = {};
        }
        target = target[keys[i]];
      }
      
      target[keys[keys.length - 1]] = value;
      this.notifyListeners(path, value);
    } catch (error) {
      ErrorHandler.handle(error, 'StateManager.updateState');
    }
  },

  /**
   * Subscribe to state changes
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },

  /**
   * Notify all listeners
   */
  notifyListeners(path, value) {
    this.listeners.forEach(listener => {
      try {
        listener(path, value);
      } catch (error) {
        ErrorHandler.handle(error, 'StateManager.listener');
      }
    });
  },

  /**
   * Push to history with size limit
   */
  pushHistory(entry) {
    this.state.history.push(entry);
    if (this.state.history.length > CONFIG.SIM.MAX_HIST) {
      this.state.history.shift();
    }
  },
};

/* ═══════════════════════════════════════════════════════════════
   § 6  MATHEMATICAL MODELS
   ═══════════════════════════════════════════════════════════════ */

const MathModels = {
  /**
   * Temperature stress function (Gaussian)
   */
  fTemp(T) {
    try {
      const { T_OPT, T_SIGMA } = CONFIG.MODEL;
      return Math.exp(-0.5 * Math.pow((T - T_OPT) / T_SIGMA, 2));
    } catch (error) {
      ErrorHandler.handle(error, 'MathModels.fTemp');
      return 0.5;
    }
  },

  /**
   * Oxygen stress function (Michaelis-Menten)
   */
  fOxy(DO) {
    try {
      const { DO_LETHAL, DO_CRIT, DO_HS } = CONFIG.MODEL;
      if (DO <= DO_LETHAL) return 0;
      if (DO <= DO_CRIT) {
        return 0.05 + 0.18 * (DO - DO_LETHAL) / (DO_CRIT - DO_LETHAL);
      }
      return DO / (DO + DO_HS);
    } catch (error) {
      ErrorHandler.handle(error, 'MathModels.fOxy');
      return 0.5;
    }
  },

  /**
   * Density stress function
   */
  fDens(D) {
    try {
      const { D_OPT, D_MAX } = CONFIG.MODEL;
      if (D <= D_OPT) return 1;
      if (D >= D_MAX) return 0.05;
      return 1 - 0.95 * (D - D_OPT) / (D_MAX - D_OPT);
    } catch (error) {
      ErrorHandler.handle(error, 'MathModels.fDens');
      return 0.5;
    }
  },

  /**
   * Ammonia stress function
   */
  fNH3(a) {
    try {
      const { NH3_SUB, NH3_LET } = CONFIG.MODEL;
      if (a <= NH3_SUB) return 1;
      if (a >= NH3_LET) return 0;
      return 1 - (a - NH3_SUB) / (NH3_LET - NH3_SUB);
    } catch (error) {
      ErrorHandler.handle(error, 'MathModels.fNH3');
      return 0.5;
    }
  },

  /**
   * pH stress function
   */
  fpH(pH) {
    try {
      const { PH_MIN, PH_MAX, PH_LO, PH_HI } = CONFIG.MODEL;
      if (pH <= PH_MIN || pH >= PH_MAX) return 0.1;
      if (pH >= PH_LO && pH <= PH_HI) return 1.0;
      return pH < PH_LO
        ? 0.1 + 0.9 * (pH - PH_MIN) / (PH_LO - PH_MIN)
        : 1.0 - 0.9 * (pH - PH_HI) / (PH_MAX - PH_HI);
    } catch (error) {
      ErrorHandler.handle(error, 'MathModels.fpH');
      return 0.5;
    }
  },

  /**
   * Calculate all stress factors
   */
  calculateStress(sensors, density) {
    try {
      const ft = this.fTemp(sensors.temperature);
      const fo = this.fOxy(sensors.do);
      const fd = this.fDens(density);
      const fa = this.fNH3(sensors.ammonia);
      const fp = this.fpH(sensors.pH);
      const total = ft * fo * fd * fa * fp;

      return { ft, fo, fd, fa, fp, total: Utils.clamp(total, 0, 1) };
    } catch (error) {
      ErrorHandler.handle(error, 'MathModels.calculateStress');
      return { ft: 0.5, fo: 0.5, fd: 0.5, fa: 0.5, fp: 0.5, total: 0.5 };
    }
  },
};

/* ═══════════════════════════════════════════════════════════════
   § 7  SIMULATION ENGINE
   ═══════════════════════════════════════════════════════════════ */

const SimulationEngine = {
  /**
   * Execute one simulation step
   */
  step(state, sensors) {
    try {
      // Validate inputs
      state = Validator.validateSimState(state);
      sensors = Validator.validateSensorData(sensors);

      const { VOL, TGC, TGC_MIN, MU_BASE, DO_CRIT } = CONFIG.MODEL;
      
      // Calculate density
      const density = (state.N * state.W / 1e6) / VOL * 1000;
      
      // Calculate stress factors
      const stress = MathModels.calculateStress(sensors, density);
      const f = stress.total;

      // TGC modified by stress
      const TGC_eff = TGC * f + TGC_MIN * (1 - f);
      const cbrt_old = Math.cbrt(state.W);
      const cbrt_new = cbrt_old + TGC_eff * sensors.temperature / 1000;
      const W_new = Math.max(cbrt_new ** 3, state.W * 0.999);
      const SGR = 100 * Math.log(W_new / state.W);

      // Mortality
      const mu_stress = 0.003 * (1 - f) + (sensors.do < DO_CRIT ? 0.007 : 0);
      const mu_daily = MU_BASE + mu_stress;
      const N_new = state.N * (1 - mu_daily);
      const dead = state.N - N_new;

      const biomass = N_new * W_new / 1e6;

      // Feed consumption & FCR
      const FI_rate = Math.max(0.006, 0.016 - 0.00018 * Math.sqrt(W_new));
      const feed_kg = N_new * W_new * FI_rate * Math.max(0.08, f) / 1000;
      const dBio = biomass - (state.N * state.W / 1e6);
      const FCR = dBio > 0.00001 ? (feed_kg / 1000) / dBio : CONFIG.MODEL.FCR_BASE;

      return {
        W: W_new,
        N: N_new,
        biomass,
        SGR,
        FCR: Math.min(FCR, 5),
        mu_daily,
        dead,
        stress,
        dens: density,
        feed_kg,
        TGC_eff,
        cbrt_old,
        cbrt_new,
      };
    } catch (error) {
      ErrorHandler.handle(error, 'SimulationEngine.step');
      // Return safe fallback state
      return {
        W: state.W,
        N: state.N,
        biomass: state.biomass,
        SGR: 0,
        FCR: 1.5,
        mu_daily: 0.0003,
        dead: 0,
        stress: { ft: 0.5, fo: 0.5, fd: 0.5, fa: 0.5, fp: 0.5, total: 0.5 },
        dens: 20,
        feed_kg: 0,
        TGC_eff: 1,
        cbrt_old: Math.cbrt(state.W),
        cbrt_new: Math.cbrt(state.W),
      };
    }
  },
};

/* ═══════════════════════════════════════════════════════════════
   § 8  BOIDS SYSTEM (Continued in next message due to length)
   ═══════════════════════════════════════════════════════════════ */

// [Boids implementation continues...]

// Made with Bob

const BoidsSystem = {
  dots: [],
  polarizationIndex: 0,
  initialized: false,

  /**
   * Initialize boids
   */
  init(canvasWidth, canvasHeight) {
    try {
      const dims = Validator.validateCanvasDimensions(canvasWidth, canvasHeight);
      this.dots = [];
      const cx = dims.width / 2;
      const cy_init = dims.height * 0.42;
      const { N_DOTS } = CONFIG.BOIDS;

      for (let i = 0; i < N_DOTS; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() ** 0.5 * Math.min(dims.width, dims.height) * 0.3;
        const swim_a = a + Math.PI / 2;
        
        this.dots.push({
          x: cx + Math.cos(a) * r,
          y: cy_init + Math.sin(a) * r * 0.55,
          vx: Math.cos(swim_a) * 0.6,
          vy: Math.sin(swim_a) * 0.25,
          phase: Math.random() * Math.PI * 2,
          hi: (Math.random() - 0.5) * 0.08,
        });
      }
      
      this.initialized = true;
      Logger.debug(`Boids initialized: ${N_DOTS} agents`);
    } catch (error) {
      ErrorHandler.handle(error, 'BoidsSystem.init');
      this.dots = [];
      this.initialized = false;
    }
  },

  /**
   * Update boids positions and behaviors
   */
  update(canvasWidth, canvasHeight, sensors, simState, scenario) {
    try {
      if (!this.initialized || this.dots.length === 0) {
        this.init(canvasWidth, canvasHeight);
        return;
      }

      const dims = Validator.validateCanvasDimensions(canvasWidth, canvasHeight);
      const W = dims.width;
      const H = dims.height;
      
      const DO = Utils.safeNumber(sensors.do, 8);
      const T = Utils.safeNumber(sensors.temperature, 12);
      const dens_kg = Utils.safeNumber(simState.biomass, 4) * 1000 / CONFIG.MODEL.VOL;
      const health = simState.lastResult?.stress?.total || 0.85;
      const t_now = performance.now() * 0.001;

      // Calculate body length in pixels
      const FL_cm = Math.pow(Math.max(simState.W, 1) / 1.1, 1/3) * 10;
      const pxm = W / 40;
      const BL = Utils.clamp(FL_cm / 100 * pxm, CONFIG.BOIDS.BL_MIN, CONFIG.BOIDS.BL_MAX);

      // Interaction radii
      const R_SEP = BL * CONFIG.BOIDS.R_SEP_MULT;
      const R_ALN = BL * CONFIG.BOIDS.R_ALN_MULT;
      const R_COH = BL * CONFIG.BOIDS.R_COH_MULT;

      // Preferred depth
      let yp = this._calculatePreferredDepth(H, DO, T);

      // School tightness and rheotaxis
      const school_tight = Math.max(0.1, health * (dens_kg > 30 ? 0.7 : 1.0));
      const rheotaxis_str = Math.max(0.05, health * (dens_kg > 25 ? 1.4 : 1.0) * 0.38);

      // Maximum speed
      const MAX_SPD = this._calculateMaxSpeed(T, DO, scenario);

      const cx = W / 2;
      const cy = H / 2;
      const MAX_F = CONFIG.BOIDS.MAX_FORCE;

      // Calculate forces
      const acc = new Float32Array(this.dots.length * 2);

      for (let i = 0; i < this.dots.length; i++) {
        const forces = this._calculateForces(i, R_SEP, R_ALN, R_COH, school_tight, MAX_F, MAX_SPD);
        
        // Add rheotaxis
        const rdx = this.dots[i].x - cx;
        const rdy = this.dots[i].y - cy;
        const rr = Math.hypot(rdx, rdy) + 0.001;
        forces.fx += (-rdy / rr) * MAX_F * rheotaxis_str;
        forces.fy += (rdx / rr) * MAX_F * rheotaxis_str;

        // Depth preference
        const dy_pref = yp - this.dots[i].y;
        const hypoxia_pull = DO < CONFIG.MODEL.DO_PIPE ? 4.5 * (CONFIG.MODEL.DO_PIPE - DO) / CONFIG.MODEL.DO_PIPE : 1.0;
        forces.fy += dy_pref * 0.007 * hypoxia_pull;

        // Wall avoidance
        this._applyWallAvoidance(forces, i, W, H, BL, MAX_F);

        // Scenario-specific behaviors
        this._applyScenarioBehaviors(forces, i, scenario, T, DO, t_now, MAX_F);

        // Biological noise
        const diel = 0.75 + 0.25 * Math.sin(this.dots[i].phase + t_now * 0.05);
        const noise_amp = (0.18 + (1 - health) * 0.55) * MAX_F * diel;
        forces.fx += (Math.random() - 0.5) * noise_amp * 2.2;
        forces.fy += (Math.random() - 0.5) * noise_amp * 0.85;

        acc[i * 2] = forces.fx;
        acc[i * 2 + 1] = forces.fy;
      }

      // Apply accelerations
      this._applyAccelerations(acc, MAX_SPD, W, H);

    } catch (error) {
      ErrorHandler.handle(error, 'BoidsSystem.update');
    }
  },

  _calculatePreferredDepth(H, DO, T) {
    const { DO_LETHAL, DO_CRIT, DO_PIPE } = CONFIG.MODEL;
    let yp = H * 0.42;
    
    if (DO < DO_LETHAL) yp = H * 0.03;
    else if (DO < DO_CRIT) yp = H * (0.03 + 0.12 * (DO - DO_LETHAL) / (DO_CRIT - DO_LETHAL));
    else if (DO < DO_PIPE) yp = H * (0.15 + 0.27 * (DO - DO_CRIT) / (DO_PIPE - DO_CRIT));
    
    if (T > 16) yp = Math.min(H * 0.82, yp + H * 0.07 * (T - 16));
    if (T < 7) yp = H * 0.38;
    
    return Utils.clamp(yp, H * 0.03, H * 0.88);
  },

  _calculateMaxSpeed(T, DO, scenario) {
    const T_spd = T < 5 ? 0.12 : T < 8 ? 0.3 + 0.4 * (T - 5) / 3 : T <= 18 ? 0.7 + 0.3 * (T - 8) / 10 : Math.max(0.3, 1.0 - 0.14 * (T - 18));
    const DO_spd = DO < 3 ? 0.08 : DO < 5 ? 0.1 + 0.55 * (DO - 3) / 2 : 1.0;
    const scn_spd = scenario === 'heatwave' ? 1.45 : scenario === 'ammonia' ? 1.35 : scenario === 'storm' ? 1.2 : 1.0;
    return Math.max(0.15, 2.4 * T_spd * DO_spd * scn_spd);
  },

  _calculateForces(i, R_SEP, R_ALN, R_COH, school_tight, MAX_F, MAX_SPD) {
    const fi = this.dots[i];
    let sx = 0, sy = 0, ns = 0;
    let ax = 0, ay = 0, na = 0;
    let px = 0, py = 0, nc = 0;

    for (let j = 0; j < this.dots.length; j++) {
      if (i === j) continue;
      const fj = this.dots[j];
      const dx = fj.x - fi.x;
      const dy = fj.y - fi.y;
      const d = Math.sqrt(dx * dx + dy * dy) + 0.001;

      if (d < R_SEP) {
        sx -= dx / d;
        sy -= dy / d;
        ns++;
      }
      if (d < R_ALN) {
        const vs = Math.hypot(fj.vx, fj.vy) + 0.001;
        ax += fj.vx / vs;
        ay += fj.vy / vs;
        na++;
      }
      if (d < R_COH) {
        px += fj.x;
        py += fj.y;
        nc++;
      }
    }

    let fx = 0, fy = 0;

    // Separation
    if (ns > 0) {
      const m = Math.hypot(sx, sy);
      if (m > 0) {
        fx += sx / m * MAX_F * 1.8;
        fy += sy / m * MAX_F * 1.8;
      }
    }

    // Alignment
    if (na > 0) {
      ax /= na;
      ay /= na;
      fx += (ax * MAX_SPD - fi.vx) * 0.18 * school_tight;
      fy += (ay * MAX_SPD - fi.vy) * 0.18 * school_tight;
    }

    // Cohesion
    if (nc > 0) {
      const tx = px / nc - fi.x;
      const ty = py / nc - fi.y;
      const d = Math.hypot(tx, ty);
      if (d > R_COH * 0.25) {
        fx += tx / d * MAX_F * 0.75 * school_tight;
        fy += ty / d * MAX_F * 0.75 * school_tight;
      }
    }

    return { fx, fy };
  },

  _applyWallAvoidance(forces, i, W, H, BL, MAX_F) {
    const wm = BL * 3.5;
    const fi = this.dots[i];
    
    if (fi.x < wm) forces.fx += MAX_F * 2.8 * (wm - fi.x) / wm;
    if (fi.x > W - wm) forces.fx -= MAX_F * 2.8 * (fi.x - (W - wm)) / wm;
    if (fi.y < 4) forces.fy += MAX_F * 3.2;
    if (fi.y > H - 5) forces.fy -= MAX_F * 3.0;
  },

  _applyScenarioBehaviors(forces, i, scenario, T, DO, t_now, MAX_F) {
    const fi = this.dots[i];
    
    if (scenario === 'lice' && Math.random() < 0.0008) {
      fi.vy -= 7 + Math.random() * 6;
    }
    if (scenario === 'ammonia' && Math.random() < 0.014) {
      forces.fx += (Math.random() - 0.5) * MAX_F * 5;
      forces.fy += (Math.random() - 0.5) * MAX_F * 3;
    }
    if (T > 18) {
      forces.fx += (Math.random() - 0.5) * MAX_F * (T - 17) * 1.5;
      forces.fy += (Math.random() - 0.5) * MAX_F * (T - 17) * 0.7;
    }
    if (scenario === 'storm') {
      const turb_noise = Math.sin(t_now * 3.1 + fi.phase) * MAX_F * 1.2;
      forces.fx += turb_noise;
      forces.fy += Math.cos(t_now * 2.7 + fi.phase) * MAX_F * 0.9;
    }
  },

  _applyAccelerations(acc, MAX_SPD, W, H) {
    let sumVx = 0, sumVy = 0;

    this.dots.forEach((f, i) => {
      f.vx = f.vx * CONFIG.BOIDS.DAMPING + acc[i * 2] * (1 - CONFIG.BOIDS.DAMPING);
      f.vy = f.vy * CONFIG.BOIDS.DAMPING + acc[i * 2 + 1] * (1 - CONFIG.BOIDS.DAMPING);

      const spd = Math.hypot(f.vx, f.vy);
      if (spd > MAX_SPD) {
        f.vx *= MAX_SPD / spd;
        f.vy *= MAX_SPD / spd;
      }

      f.x += f.vx;
      f.y += f.vy;
      f.x = Utils.clamp(f.x, 3, W - 3);
      f.y = Utils.clamp(f.y, 3, H - 3);

      if (spd > 0.05) {
        sumVx += f.vx / spd;
        sumVy += f.vy / spd;
      }
    });

    this.polarizationIndex = Math.hypot(sumVx, sumVy) / this.dots.length;
  },

  reset() {
    this.dots = [];
    this.initialized = false;
    this.polarizationIndex = 0;
  },
};

/* ═══════════════════════════════════════════════════════════════
   § 9  RENDERING ENGINE
   ═══════════════════════════════════════════════════════════════ */

const RenderingEngine = {
  canvases: {},
  lastRenderTime: 0,

  /**
   * Initialize canvas references
   */
  init() {
    try {
      this.canvases = {
        tank: Utils.getElement('tankCanvas'),
        bio: Utils.getElement('bioChart'),
        sgr: Utils.getElement('sgrChart'),
      };
      Logger.info('Rendering engine initialized');
    } catch (error) {
      ErrorHandler.handle(error, 'RenderingEngine.init');
    }
  },

  /**
   * Render tank with boids
   */
  renderTank(sensors, simState, scenario) {
    try {
      const canvas = this.canvases.tank;
      if (!canvas) return;

      const ctx = Utils.getCanvasContext(canvas);
      if (!ctx) return;

      const W = canvas.width;
      const H = canvas.height;
      if (W < 10 || H < 10) return;

      // Update boids
      BoidsSystem.update(W, H, sensors, simState, scenario);

      const DO = sensors.do;
      const T = sensors.temperature;
      const turb = sensors.turbidity;
      const health = simState.lastResult?.stress?.total || 0.85;

      // Clear and draw background
      this._drawTankBackground(ctx, W, H, T, DO, turb);

      // Draw boids
      this._drawBoids(ctx, simState.W, health);

      // Draw histogram
      this._drawHistogram(ctx, W, H);

      // Draw overlays
      this._drawOverlays(ctx, W, H, DO, T);

    } catch (error) {
      ErrorHandler.handle(error, 'RenderingEngine.renderTank');
    }
  },

  _drawTankBackground(ctx, W, H, T, DO, turb) {
    // Gradient background
    const warmR = Utils.clamp((T - 8) / 14 * 40, 0, 40);
    const wg = ctx.createLinearGradient(0, 0, 0, H);
    wg.addColorStop(0, `rgba(${12 + warmR}, ${28 + warmR / 2}, 85, 1)`);
    wg.addColorStop(0.55, `rgba(${7 + warmR / 2}, 17, 62, 1)`);
    wg.addColorStop(1, 'rgba(4, 10, 38, 1)');
    ctx.fillStyle = wg;
    ctx.fillRect(0, 0, W, H);

    // Hypoxic layer
    if (DO < 6) {
      const hyp_h = H * Math.max(0, (6 - DO) / 6 * 0.35);
      const hg = ctx.createLinearGradient(0, H - hyp_h, 0, H);
      hg.addColorStop(0, 'rgba(70, 15, 0, 0)');
      hg.addColorStop(1, `rgba(80, 20, 0, ${(6 - DO) / 6 * 0.55})`);
      ctx.fillStyle = hg;
      ctx.fillRect(0, H - hyp_h, W, hyp_h);
    }

    // Turbidity
    ctx.fillStyle = `rgba(75, 58, 18, ${Math.min(0.62, turb / 50 * 0.75)})`;
    ctx.fillRect(0, 0, W, H);

    // Net mesh
    ctx.strokeStyle = 'rgba(0, 200, 225, 0.06)';
    ctx.lineWidth = 0.7;
    for (let x = 22; x < W; x += 22) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 18; y < H; y += 18) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
  },

  _drawBoids(ctx, W_fish, health) {
    const dot_r = Utils.clamp(Math.pow(W_fish / 800, 1/3) * 1.5, 1.6, 3.2);
    
    BoidsSystem.dots.forEach(f => {
      const h_ind = Utils.clamp(health + f.hi, 0, 1);
      const hue = Math.round(h_ind * 135);
      const sat = 88;
      const lig = 42 + h_ind * 12;

      if (h_ind < 0.35) {
        ctx.shadowBlur = 4.5;
        ctx.shadowColor = `hsl(${hue},${sat}%,58%)`;
      }

      ctx.beginPath();
      ctx.arc(f.x, f.y, dot_r, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${hue},${sat}%,${lig}%,0.92)`;
      ctx.fill();
    });
    ctx.shadowBlur = 0;
  },

  _drawHistogram(ctx, W, H) {
    const BANDS = 16;
    const hist = new Uint16Array(BANDS);
    const histX = W - 20;
    
    BoidsSystem.dots.forEach(f => {
      const b = Math.min(BANDS - 1, Math.floor(f.y / (H / BANDS)));
      hist[b]++;
    });
    
    const maxH = Math.max(1, ...hist);
    ctx.fillStyle = 'rgba(0,200,220,0.25)';
    for (let b = 0; b < BANDS; b++) {
      const bh = H / BANDS;
      const bw = (hist[b] / maxH) * 18;
      ctx.fillRect(histX, b * bh + 1, bw, bh - 2);
    }
    
    ctx.strokeStyle = 'rgba(0,200,220,0.2)';
    ctx.lineWidth = 1;
    ctx.strokeRect(histX - 1, 0, 21, H);
  },

  _drawOverlays(ctx, W, H, DO, T) {
    // Piping line
    if (DO < CONFIG.MODEL.DO_PIPE) {
      const pipe_y = H * (0.03 + 0.18 * (DO / CONFIG.MODEL.DO_PIPE));
      ctx.strokeStyle = `rgba(255, 140, 0, ${(CONFIG.MODEL.DO_PIPE - DO) / CONFIG.MODEL.DO_PIPE * 0.7})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(0, pipe_y);
      ctx.lineTo(W - 20, pipe_y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,140,0,0.6)';
      ctx.font = '7px IBM Plex Mono';
      ctx.fillText('PIPING', 6, pipe_y - 3);
    }

    // Depth scale
    ctx.fillStyle = 'rgba(0,200,220,0.4)';
    ctx.font = '7px IBM Plex Mono';
    ctx.textAlign = 'left';
    for (let d = 0; d <= 20; d += 5) {
      const yy = 2 + (H - 4) * (d / 20);
      ctx.fillText(`${d}m`, 3, yy + 3);
    }

    // DO and T display
    ctx.fillStyle = DO < CONFIG.MODEL.DO_CRIT ? 'rgba(255,80,40,.85)' : DO < 6 ? 'rgba(240,165,0,.8)' : 'rgba(0,200,220,.6)';
    ctx.font = '8px IBM Plex Mono';
    ctx.fillText(`DO: ${DO.toFixed(1)} mg/L`, 25, H - 11);
    ctx.fillStyle = 'rgba(0,200,220,.55)';
    ctx.fillText(`T: ${T.toFixed(1)}°C`, W - 90, H - 11);

    // Border
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#00c8d8';
    ctx.strokeStyle = 'rgba(0,205,225,0.65)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);
    ctx.shadowBlur = 0;
  },

  /**
   * Throttled render function
   */
  render: Utils.throttle(function() {
    const state = StateManager.getState();
    this.renderTank(
      state.sensors.current,
      state.simulation,
      state.scenario.active
    );
  }, CONFIG.PERF.RENDER_THROTTLE),
};

/* ═══════════════════════════════════════════════════════════════
   § 10  INITIALIZATION & MAIN LOOP
   ═══════════════════════════════════════════════════════════════ */

function init() {
  try {
    Logger.info('Initializing OceanoTech Digital Twin Dashboard v2.0');
    
    // Initialize systems
    RenderingEngine.init();
    
    // Set up canvas resize handler
    const tankCanvas = Utils.getElement('tankCanvas');
    if (tankCanvas) {
      const resizeHandler = Utils.debounce(() => {
        tankCanvas.width = tankCanvas.clientWidth;
        BoidsSystem.reset();
      }, CONFIG.PERF.CANVAS_RESIZE_DEBOUNCE);
      
      window.addEventListener('resize', resizeHandler);
    }

    Logger.info('Dashboard initialized successfully');
  } catch (error) {
    ErrorHandler.handle(error, 'init');
  }
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Export for debugging
window.OceanoTech = {
  Logger,
  ErrorHandler,
  StateManager,
  CONFIG,
  Utils,
};
