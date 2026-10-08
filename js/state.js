/**
 * state.js – Zentraler App-State.
 * - Hält das komplette Datenmodell
 * - Persistiert automatisch über storage.js
 * - Benachrichtigt Listener bei Änderungen
 * - Unterstützt silent saves, debounced saves, und Schema-Migration
 */

import { storage } from './storage.js';

const KEY = 'state';
export const APP_VERSION = '1.1.0';
export const SCHEMA_VERSION = 1;

let state = defaultState();
const listeners = new Set();
let saveTimer = null;

/* ---------- Utility ---------- */

export function deepClone(obj) {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(obj); } catch {}
  }
  return JSON.parse(JSON.stringify(obj));
}

/* ---------- Default State ---------- */

export function defaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    system: {
      version: APP_VERSION,
      setupCompleted: false,
      lastError: null,
      lastDbAccess: null
    },
    config: {
      name: '',
      weekdayWakeTime: '06:30',
      weekendWakeTime: '08:30',
      weekdayInitialBedtime: '22:30',
      weekendInitialBedtime: '23:30',
      currentBedtime: '22:30',
      currentLongTermBedtime: '22:30',
      desiredReturnTime: '21:30',
      currentReturnTime: '21:30',
      homeLocation: null,
      homeRadius: 50,
      pointsRules: {
        goodNightBase: 10,
        goodNightIncrement: 2,
        goodNightMax: 20,
        violationTiers: [
          { max: 1, points: -5 },
          { max: 3, points: -10 },
          { max: 5, points: -15 },
          { max: Infinity, points: -20 }
        ]
      },
      streakRules: {
        resetOnViolation: true,
        freezeEnabled: false,
        freezePerWeek: 1
      },
      consequenceRules: {
        enabled: true,
        triggerThreshold: 2,
        durationDays: 2,
        bedtimeShiftMinutes: 15,
        returnShiftMinutes: 15,
        maxBedtimeShiftMinutes: 60,
        maxReturnShiftMinutes: 60,
        minSleepDurationMinutes: 420
      },
      notifications: {
        enabled: false,
        beforeBedtime: true,
        beforeReturn: true,
        reminder: false,
        consequenceStart: true,
        consequenceEnd: true,
        nightFinished: true,
        leadMinutes: 30
      },
      privacy: {
        sendLocationToAI: false,
        storeLocationHistory: false
      },
      ai: {
        enabled: false,
        endpoint: '',
        apiKey: '',
        model: ''
      },
      ui: {
        theme: 'dark',
        accent: 'violet',
        fontScale: 1,
        language: 'de',
        timeFormat: '24h'
      }
    },
    status: {
      totalPoints: 0,
      currentStreak: 0,
      bestStreak: 0,
      totalNights: 0,
      totalViolations: 0,
      totalLateReturns: 0,
      lastNight: null,
      lastDecision: null,
      lastConsequence: null,
      lastEvaluation: null,
      lastError: null,
      freezeUsedThisWeek: 0,
      lastFreezeWeek: null
    },
    night: {
      active: false,
      startTime: null,
      plannedBedtime: null,
      plannedWakeTime: null,
      plannedReturnTime: null,
      actualReturnTime: null,
      latenessMinutes: 0,
      returnStatus: 'unknown',
      note: '',
      events: [],
      possibleViolations: [],
      confirmedViolations: []
    },
    history: [],
    events: [],
    consequences: []
  };
}

/* ---------- Accessors ---------- */

export function getState() {
  return state;
}

export function setState(patch) {
  for (const k of Object.keys(patch)) {
    const v = patch[k];
    if (
      v && typeof v === 'object' && !Array.isArray(v) &&
      state[k] && typeof state[k] === 'object' && !Array.isArray(state[k])
    ) {
      Object.assign(state[k], v);
    } else {
      state[k] = v;
    }
  }
  save();
}

/* ---------- Persistence ---------- */

function persist() {
  try {
    storage.set(KEY, state);
    state.system.lastDbAccess = new Date().toISOString();
  } catch (e) {
    console.error('[state] persist failed', e);
    state.system.lastError = String((e && e.message) || e);
  }
}

/**
 * Speichert sofort und emittiert Listener.
 * @param {{silent?:boolean}} opts – silent=true unterdrückt Listener (kein Re-Render)
 */
export function save(opts = {}) {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  persist();
  if (!opts.silent) emit();
}

/** Erzwingt sofortiges Speichern (Alias für save()). */
export function saveNow(opts = {}) {
  return save(opts);
}

/**
 * Debounced speichern. Mehrere Aufrufe innerhalb von 150 ms werden
 * zusammengefasst – nützlich für schnelles Tippen in Formularen.
 */
export function scheduleSave(delay = 150) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persist();
    emit();
  }, delay);
}

/** Wenn ein Prozess abbricht, aber die letzten Werte sichern soll. */
export function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    persist();
    emit();
  }
}

/* ---------- Listeners ---------- */

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) {
    try { fn(state); } catch (e) { console.error('[state] listener error', e); }
  }
}

/* ---------- Load / Reset ---------- */

export function loadState() {
  try {
    const loaded = storage.get(KEY);
    if (loaded && typeof loaded === 'object') {
      const migrated = migrate(loaded);
      state = mergeDeep(defaultState(), migrated);
    }
    state.system.version = APP_VERSION;
    state.schemaVersion = SCHEMA_VERSION;
  } catch (e) {
    console.error('[state] load failed', e);
    state = defaultState();
  }
  return state;
}

export function resetState() {
  state = defaultState();
  storage.remove(KEY);
}

/* ---------- Migration ---------- */

/**
 * Wendet Schema-Updates an, um alte State-Versionen auf die
 * aktuelle Struktur zu bringen.
 * Bei zukünftigen Schema-Änderungen (SCHEMA_VERSION++) hier ergänzen.
 */
function migrate(oldState) {
  if (!oldState || typeof oldState !== 'object') return oldState;
  const v = oldState.schemaVersion || 0;
  let s = oldState;

  // v0 → v1: nichts zu tun, aktuelle Struktur ist bereits vorhanden.
  // Zukünftig:
  // if (v < 2) { s = migrateV1toV2(s); }
  // if (v < 3) { s = migrateV2toV3(s); }

  s.schemaVersion = SCHEMA_VERSION;
  return s;
}

/* ---------- Errors ---------- */

export function logError(err) {
  const msg = typeof err === 'string' ? err : (err && err.message) || 'Unbekannter Fehler';
  state.status.lastError = msg;
  state.system.lastError = msg;
  try { console.warn('[error]', err); } catch {}
  save({ silent: true });
}

/* ---------- Helpers ---------- */

function mergeDeep(target, src) {
  if (Array.isArray(target) || Array.isArray(src)) return src === undefined ? target : src;
  if (typeof target !== 'object' || target === null) return src === undefined ? target : src;
  if (typeof src !== 'object' || src === null) return src === undefined ? target : src;
  const out = { ...target };
  for (const k of Object.keys(src)) {
    if (
      src[k] && typeof src[k] === 'object' && !Array.isArray(src[k]) &&
      target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])
    ) {
      out[k] = mergeDeep(target[k], src[k]);
    } else {
      out[k] = src[k];
    }
  }
  return out;
}
