/**
 * testmode.js – Simulation und Tests.
 * Nutzt dieselben Pfade wie der Echtbetrieb (applyNightEvaluation),
 * damit Test und Realität nicht auseinanderlaufen.
 */

import { getState, save } from './state.js';
import { createEvent } from './events.js';
import {
  startNight, finishNight, registerLateReturn, registerBedtimeDelayed,
  currentWakeTime
} from './night.js';
import { applyNightEvaluation } from './evaluation.js';
import { createConsequence, applyConsequence, expireConsequences } from './consequences.js';
import { pointsForGoodNight, pointsForViolations, shiftBedtimeEarlier } from './rules.js';
import { toMinutes, fromMinutes, sleepDurationMinutes } from './time.js';
import { haversineMeters, computeHomeStatus } from './home.js';
import { defaultState } from './state.js';

function shiftTime(time, delta) {
  const t = toMinutes(time);
  if (t == null) return time;
  return fromMinutes(t + delta);
}

/**
 * Öffentliche Test-Dispatcher-Funktion.
 * Wird aus der UI aufgerufen.
 */
export async function runTest(name) {
  switch (name) {
    case 'run-tests':    return runAllTests();
    case 'good-night':   return testGoodNight();
    case 'late-return':  return testLateReturn();
    case 'late-bedtime': return testLateBedtime();
    case 'confirm-violation':   return testConfirmViolation();
    case 'multiple-violations': return testMultipleViolations();
    case 'finish-night': return testFinishNight();
    case 'reset-streak': return testResetStreak();
    case 'add-points':   return testAddPoints();
    case 'start-consequence': return testStartConsequence();
    case 'end-consequence':   return testEndConsequence();
  }
}

async function testGoodNight() {
  if (!getState().night.active) startNight('test');
  const snap = finishNight('test');
  if (snap) await applyNightEvaluation(snap);
}

async function testLateReturn() {
  if (!getState().night.active) startNight('test');
  const s = getState();
  const planned = s.night.plannedReturnTime || s.config.currentReturnTime;
  registerLateReturn(shiftTime(planned, 45), 'away');
}

async function testLateBedtime() {
  if (!getState().night.active) startNight('test');
  const s = getState();
  const planned = s.night.plannedBedtime || s.config.currentBedtime;
  registerBedtimeDelayed(shiftTime(planned, 30), 'test');
}

async function testConfirmViolation() {
  if (!getState().night.active) startNight('test');
  const s = getState();
  if (s.night.possibleViolations.length === 0) {
    const evt = createEvent('late_return', {
      plannedTime: s.night.plannedReturnTime || s.config.currentReturnTime,
      actualTime: null,
      latenessMinutes: 45,
      homeStatus: 'away',
      simulated: true
    }, 'test', 'possibleViolation');
    s.night.possibleViolations.push(evt);
    s.night.events.push(evt);
  }
  s.night.confirmedViolations = s.night.possibleViolations.slice();
  s.night.possibleViolations.forEach((v) => { v.status = 'confirmedViolation'; });
  save();
}

async function testMultipleViolations() {
  if (!getState().night.active) startNight('test');
  const s = getState();
  for (let i = 0; i < 3; i++) {
    const evt = createEvent(
      i === 0 ? 'late_return' : 'bedtime_delayed',
      { simulated: true, index: i, latenessMinutes: 30 + i * 10 },
      'test',
      'confirmedViolation'
    );
    s.night.events.push(evt);
    s.night.possibleViolations.push(evt);
    s.night.confirmedViolations.push(evt);
  }
  save();
}

async function testFinishNight() {
  if (!getState().night.active) startNight('test');
  const snap = finishNight('test');
  if (snap) await applyNightEvaluation(snap);
}

async function testResetStreak() {
  getState().status.currentStreak = 0;
  save();
}

async function testAddPoints() {
  getState().status.totalPoints += 10;
  save();
}

async function testStartConsequence() {
  const s = getState();
  const cons = createConsequence(
    'earlier_bedtime',
    s.config.currentBedtime,
    shiftTime(s.config.currentBedtime, -15),
    2,
    'Test-Konsequenz'
  );
  applyConsequence(cons);
}

async function testEndConsequence() {
  const s = getState();
  const active = s.consequences.find((c) => c.status === 'active');
  if (!active) return;
  active.endDate = new Date(Date.now() - 1000).toISOString();
  expireConsequences();
}

/**
 * Reine Logik-Tests ohne Seiteneffekte.
 * @returns {Promise<string[]>} Zeilen mit ✓/✗
 */
export async function runAllTests() {
  const out = [];
  const ok = (name, cond) => out.push(`${cond ? '✓' : '✗'} ${name}`);

  // Punkte
  ok('Punkte Streak 1 = +10', pointsForGoodNight(1) === 10);
  ok('Punkte Streak 2 = +12', pointsForGoodNight(2) === 12);
  ok('Punkte Streak 6 = +20', pointsForGoodNight(6) === 20);
  ok('Punkte Streak 10 = +20 (Cap)', pointsForGoodNight(10) === 20);
  ok('1 Verstoß = -5',  pointsForViolations(1) === -5);
  ok('3 Verstöße = -10', pointsForViolations(3) === -10);
  ok('5 Verstöße = -15', pointsForViolations(5) === -15);
  ok('8 Verstöße = -20', pointsForViolations(8) === -20);

  // Zeit
  ok('22:30 → 1350', toMinutes('22:30') === 1350);
  ok('1350 → 22:30', fromMinutes(1350) === '22:30');
  ok('Schlafdauer 22:30 → 06:30 = 480', sleepDurationMinutes('22:30', '06:30') === 480);

  // Verschiebung
  const s1 = shiftBedtimeEarlier('22:30', '06:30', 15, 420);
  ok('Verschiebung 15 Min erlaubt', s1.ok && s1.bedtime === '22:15');
  const s2 = shiftBedtimeEarlier('23:00', '06:00', 60, 420);
  ok('Mindestschlafdauer verhindert Extrem', s2.ok === false);

  // Geo
  const d = haversineMeters(52.5, 13.4, 52.5004, 13.4);
  ok('Haversine ~45m', Math.abs(d - 45) < 10);
  ok('Zuhause (Radius 50)', computeHomeStatus({ lat: 52.5, lng: 13.4 }, { lat: 52.5001, lng: 13.4 }, 50) === 'home');
  ok('Weg (Radius 50)', computeHomeStatus({ lat: 52.51, lng: 13.4 }, { lat: 52.5, lng: 13.4 }, 50) === 'away');
  ok('Unbekannt ohne Daten', computeHomeStatus(null, { lat: 0, lng: 0 }, 50) === 'unknown');

  // State
  const s = getState();
  ok('State hat alle Bereiche',
    ['system','config','status','night','history','events','consequences'].every((k) => k in s));

  return out;
}
