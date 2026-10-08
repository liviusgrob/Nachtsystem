/**
 * night.js – Nachtruhe-Logik.
 * - Startet / beendet Nächte
 * - Registriert verspätete Heimkehr und verzögerte Schlafenszeit
 * - Unterscheidet sauber zwischen geplant und tatsächlich
 */

import { getState, save } from './state.js';
import { createEvent } from './events.js';
import { nowMinutes, toMinutes, isWeekend, todayKey } from './time.js';

/** Aufstehzeit für das gegebene Datum (Woche vs. Wochenende). */
export function currentWakeTime(config, date = new Date()) {
  return isWeekend(date) ? config.weekendWakeTime : config.weekdayWakeTime;
}

/** Schlafenszeit für das gegebene Datum. */
export function plannedBedtimeFor(config, date = new Date()) {
  const base = isWeekend(date)
    ? config.weekendInitialBedtime
    : config.weekdayInitialBedtime;
  return config.currentBedtime || base;
}

/** Liegt der aktuelle Zeitpunkt im Nachtfenster? */
export function isWithinNightWindow(config, date = new Date()) {
  const now = nowMinutes(date);
  const bed = toMinutes(config.currentBedtime);
  const wake = toMinutes(currentWakeTime(config, date));
  if (bed == null || wake == null) return false;
  if (bed > wake) return now >= bed || now < wake;
  return now >= bed && now < wake;
}

/** Startet eine neue Nacht (idempotent bei bereits aktiver Nacht). */
export function startNight(source = 'manual') {
  const s = getState();
  if (s.night.active) return s.night;

  const now = new Date();
  const plannedBedtime = plannedBedtimeFor(s.config, now);
  const plannedWakeTime = currentWakeTime(s.config, now);

  s.night = {
    active: true,
    startTime: now.toISOString(),
    plannedBedtime,
    plannedWakeTime,
    plannedReturnTime: s.config.currentReturnTime,
    actualReturnTime: null,
    latenessMinutes: 0,
    returnStatus: s.night.returnStatus || 'unknown',
    events: [],
    possibleViolations: [],
    confirmedViolations: []
  };

  const evt = createEvent('night_started', {
    plannedBedtime,
    plannedWakeTime,
    plannedReturnTime: s.config.currentReturnTime
  }, source);
  s.night.events.push(evt);
  s.events.push(evt);

  save();
  return s.night;
}

/**
 * Beendet die aktive Nacht.
 * @returns {object|null} Snapshot der beendeten Nacht oder null
 */
export function finishNight(source = 'manual') {
  const s = getState();
  if (!s.night.active) return null;

  const evt = createEvent('night_finished', {
    startTime: s.night.startTime,
    endTime: new Date().toISOString(),
    plannedBedtime: s.night.plannedBedtime,
    plannedWakeTime: s.night.plannedWakeTime,
    actualReturnTime: s.night.actualReturnTime,
    latenessMinutes: s.night.latenessMinutes,
    returnStatus: s.night.returnStatus
  }, source);
  s.night.events.push(evt);
  s.events.push(evt);

  const snapshot = JSON.parse(JSON.stringify(s.night));
  s.night.active = false;
  save();
  return snapshot;
}

/**
 * Wird regelmäßig aufgerufen.
 * - Beendet hängende Nächte nach 14 Stunden automatisch.
 * - Startet automatisch, wenn wir uns im Nachtfenster befinden und
 *   in den letzten 12 Stunden keine Nacht begonnen hat.
 */
export function checkNightAutoStart() {
  const s = getState();
  if (!s.system.setupCompleted) return;

  if (s.night.active) {
    const start = new Date(s.night.startTime).getTime();
    const hours = (Date.now() - start) / 3.6e6;
    if (hours > 14) finishNight('auto');
    return;
  }

  if (isWithinNightWindow(s.config)) {
    const lastNight = s.status.lastNight ? new Date(s.status.lastNight).getTime() : 0;
    const hoursSince = lastNight ? (Date.now() - lastNight) / 3.6e6 : 999;
    if (hoursSince > 12) startNight('auto');
  }
}

/**
 * Registriert eine verspätete Heimkehr als Ereignis (event, nicht Verstoß).
 * @returns {object|null} Event oder null
 */
export function registerLateReturn(actualTime, homeStatus) {
  const s = getState();
  if (!s.night.active) return null;

  const plannedMin = toMinutes(s.night.plannedReturnTime);
  const actualMin = toMinutes(actualTime);
  if (plannedMin == null || actualMin == null) return null;

  let late = actualMin - plannedMin;
  if (late < 0) late += 1440;
  if (late <= 0) return null;

  s.night.actualReturnTime = actualTime;
  s.night.latenessMinutes = late;
  s.night.returnStatus = homeStatus || 'unknown';

  const evt = createEvent('late_return', {
    plannedTime: s.night.plannedReturnTime,
    actualTime,
    latenessMinutes: late,
    homeStatus: homeStatus || 'unknown',
    date: todayKey()
  }, 'home', 'event');

  s.night.events.push(evt);
  s.night.possibleViolations.push(evt);
  s.events.push(evt);
  s.status.totalLateReturns = (s.status.totalLateReturns || 0) + 1;

  save();
  return evt;
}

/**
 * Registriert eine verzögerte Schlafenszeit (nur wenn tatsächlich später als geplant).
 */
export function registerBedtimeDelayed(actualBedtime, source = 'manual') {
  const s = getState();
  const planned = toMinutes(s.night.plannedBedtime || s.config.currentBedtime);
  const actual = toMinutes(actualBedtime);
  if (planned == null || actual == null) return null;

  let late = actual - planned;
  if (late < -720) late += 1440;
  if (late <= 0) return null;

  const evt = createEvent('bedtime_delayed', {
    plannedBedtime: s.night.plannedBedtime || s.config.currentBedtime,
    actualBedtime,
    delayMinutes: late
  }, source, 'event');

  s.night.events.push(evt);
  s.night.possibleViolations.push(evt);
  s.events.push(evt);

  save();
  return evt;
}
