/**
 * OceanoTech Digital Twin Dashboard v2.0 - Type Definitions
 * Provides TypeScript definitions for better IDE support
 */

// ═══════════════════════════════════════════════════════════════
// Configuration Types
// ═══════════════════════════════════════════════════════════════

export interface ModelConfig {
  TGC: number;
  TGC_MIN: number;
  T_OPT: number;
  T_SIGMA: number;
  DO_HS: number;
  DO_CRIT: number;
  DO_LETHAL: number;
  DO_PIPE: number;
  NH3_SUB: number;
  NH3_LET: number;
  PH_LO: number;
  PH_HI: number;
  PH_MIN: number;
  PH_MAX: number;
  D_OPT: number;
  D_MAX: number;
  MU_BASE: number;
  FCR_BASE: number;
  HARVEST_W: number;
  VOL: number;
}

export interface BoidsConfig {
  N_DOTS: number;
  BL_MIN: number;
  BL_MAX: number;
  R_SEP_MULT: number;
  R_ALN_MULT: number;
  R_COH_MULT: number;
  MAX_FORCE: number;
  DAMPING: number;
}

export interface SimConfig {
  MAX_HIST: number;
  INITIAL_W: number;
  INITIAL_N: number;
  START_DATE: string;
  MAX_DT: number;
  PRESEED_DAYS: number;
}

export interface PerfConfig {
  CANVAS_RESIZE_DEBOUNCE: number;
  ALERT_CHECK_INTERVAL: number;
  MAX_ALERTS: number;
  RENDER_THROTTLE: number;
}

export interface SensorNoise {
  temperature: number;
  do: number;
  salinity: number;
  pH: number;
  ammonia: number;
  turbidity: number;
  flow: number;
}

export interface Config {
  MODEL: Readonly<ModelConfig>;
  BOIDS: Readonly<BoidsConfig>;
  SIM: Readonly<SimConfig>;
  PERF: Readonly<PerfConfig>;
  SENSOR_NOISE: Readonly<SensorNoise>;
}

// ═══════════════════════════════════════════════════════════════
// State Types
// ═══════════════════════════════════════════════════════════════

export interface SensorData {
  temperature: number;
  do: number;
  salinity: number;
  pH: number;
  ammonia: number;
  turbidity: number;
  flow: number;
}

export interface SimulationState {
  day: number;
  W: number;
  N: number;
  biomass: number;
  accumFeed: number;
  accumDead: number;
  paused: boolean;
  speed: number;
  startDate: Date;
}

export interface ScenarioState {
  active: string;
  daysLeft: number;
}

export interface StressFactors {
  ft: number;
  fo: number;
  fd: number;
  fa: number;
  fp: number;
  total: number;
}

export interface SimulationResult {
  W: number;
  N: number;
  biomass: number;
  SGR: number;
  FCR: number;
  mu_daily: number;
  dead: number;
  stress: StressFactors;
  dens: number;
  feed_kg: number;
  TGC_eff: number;
  cbrt_old: number;
  cbrt_new: number;
}

export interface HistoryEntry {
  day: number;
  W: number;
  N: number;
  biomass: number;
  SGR: number;
  FCR: number;
  mu: number;
  stress: number;
  dens: number;
  feed: number;
  sens: SensorData;
}

export interface AppState {
  simulation: SimulationState;
  sensors: {
    current: SensorData;
    target: SensorData;
  };
  scenario: ScenarioState;
  history: HistoryEntry[];
  lastResult: SimulationResult | null;
}

// ═══════════════════════════════════════════════════════════════
// Boids Types
// ═══════════════════════════════════════════════════════════════

export interface Boid {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  hi: number;
}

export interface Forces {
  fx: number;
  fy: number;
}

// ═══════════════════════════════════════════════════════════════
// Logger Types
// ═══════════════════════════════════════════════════════════════

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: any[];
}

export interface Logger {
  enabled: boolean;
  level: LogLevel;
  history: LogEntry[];
  maxHistory: number;
  debug(...args: any[]): void;
  info(...args: any[]): void;
  warn(...args: any[]): void;
  error(...args: any[]): void;
  getHistory(): LogEntry[];
  clear(): void;
}

// ═══════════════════════════════════════════════════════════════
// Error Handler Types
// ═══════════════════════════════════════════════════════════════

export interface ErrorEntry {
  timestamp: number;
  context: string;
  message: string;
  stack?: string;
}

export interface ErrorHandler {
  errors: ErrorEntry[];
  maxErrors: number;
  handle(error: Error | string, context?: string): void;
  isCritical(context: string): boolean;
  showUserError(context: string, error: Error | string): void;
  getErrors(): ErrorEntry[];
  clear(): void;
}

// ═══════════════════════════════════════════════════════════════
// Utility Types
// ═══════════════════════════════════════════════════════════════

export interface Utils {
  clamp(value: number, min: number, max: number): number;
  safeNumber(value: any, fallback?: number): number;
  debounce<T extends (...args: any[]) => any>(func: T, wait: number): T;
  throttle<T extends (...args: any[]) => any>(func: T, limit: number): T;
  getElement(id: string): HTMLElement | null;
  getCanvasContext(canvas: HTMLCanvasElement | null, type?: string): CanvasRenderingContext2D | null;
  formatNumber(num: number, decimals?: number): string;
  formatLocale(num: number, locale?: string): string;
}

// ═══════════════════════════════════════════════════════════════
// Validator Types
// ═══════════════════════════════════════════════════════════════

export interface CanvasDimensions {
  width: number;
  height: number;
}

export interface Validator {
  validateSensorData(data: Partial<SensorData>): SensorData;
  validateSimState(state: Partial<SimulationState>): SimulationState;
  validateCanvasDimensions(width: number, height: number): CanvasDimensions;
}

// ═══════════════════════════════════════════════════════════════
// State Manager Types
// ═══════════════════════════════════════════════════════════════

export type StateListener = (path: string, value: any) => void;
export type Unsubscribe = () => void;

export interface StateManager {
  state: AppState;
  listeners: Set<StateListener>;
  getState(): AppState;
  updateState(path: string, value: any): void;
  subscribe(listener: StateListener): Unsubscribe;
  notifyListeners(path: string, value: any): void;
  pushHistory(entry: HistoryEntry): void;
}

// ═══════════════════════════════════════════════════════════════
// Math Models Types
// ═══════════════════════════════════════════════════════════════

export interface MathModels {
  fTemp(T: number): number;
  fOxy(DO: number): number;
  fDens(D: number): number;
  fNH3(a: number): number;
  fpH(pH: number): number;
  calculateStress(sensors: SensorData, density: number): StressFactors;
}

// ═══════════════════════════════════════════════════════════════
// Simulation Engine Types
// ═══════════════════════════════════════════════════════════════

export interface SimulationEngine {
  step(state: Partial<SimulationState>, sensors: SensorData): SimulationResult;
}

// ═══════════════════════════════════════════════════════════════
// Boids System Types
// ═══════════════════════════════════════════════════════════════

export interface BoidsSystem {
  dots: Boid[];
  polarizationIndex: number;
  initialized: boolean;
  init(canvasWidth: number, canvasHeight: number): void;
  update(
    canvasWidth: number,
    canvasHeight: number,
    sensors: SensorData,
    simState: SimulationState,
    scenario: string
  ): void;
  reset(): void;
}

// ═══════════════════════════════════════════════════════════════
// Rendering Engine Types
// ═══════════════════════════════════════════════════════════════

export interface CanvasRefs {
  tank: HTMLCanvasElement | null;
  bio: HTMLCanvasElement | null;
  sgr: HTMLCanvasElement | null;
}

export interface RenderingEngine {
  canvases: CanvasRefs;
  lastRenderTime: number;
  init(): void;
  renderTank(sensors: SensorData, simState: SimulationState, scenario: string): void;
  render(): void;
}

// ═══════════════════════════════════════════════════════════════
// Global Window Interface
// ═══════════════════════════════════════════════════════════════

export interface OceanoTechGlobal {
  Logger: Logger;
  ErrorHandler: ErrorHandler;
  StateManager: StateManager;
  CONFIG: Readonly<Config>;
  Utils: Utils;
}

declare global {
  interface Window {
    OceanoTech: OceanoTechGlobal;
  }
}

// ═══════════════════════════════════════════════════════════════
// Module Exports
// ═══════════════════════════════════════════════════════════════

export const CONFIG: Readonly<Config>;
export const Utils: Utils;
export const Logger: Logger;
export const ErrorHandler: ErrorHandler;
export const Validator: Validator;
export const StateManager: StateManager;
export const MathModels: MathModels;
export const SimulationEngine: SimulationEngine;
export const BoidsSystem: BoidsSystem;
export const RenderingEngine: RenderingEngine;

export function init(): void;

// Made with Bob
