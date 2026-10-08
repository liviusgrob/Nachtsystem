/**
 * rules.js – Reine Regel- und Berechnungslogik.
 * Enthält KEINE UI-, Storage- oder State-Zugriffe.
 * Alles hier ist testbar und deterministisch.
 */

import { toMinutes, fromMinutes, sleepDurationMinutes } from './time.js';

/**
 * Punkte für eine gute Nacht, abhängig vom Streak NACH der Nacht.
 * 1 → +10, 2 → +12, 3 → +14, 4 → +16, 5 → +18, 6+ → +20
 */
export function pointsForGoodNight(streakAfter, rules) {
  const r = rules || {};
  const base = r.goodNightBase != null ? r.goodNightBase : 10;
  const inc  = r.goodNightIncrement != null ? r.goodNightIncrement : 2;
  const max  = r.goodNightMax != null ? r.goodNightMax : 20;
  const n = Math.max(1, streakAfter | 0);
  return Math.min(max, base + (n - 1) * inc);
}

/**
 * Punkte für bestätigte Regelverletzungen.
 * 1 → -5, 2–3 → -10, 4–5 → -15, 6+ → -20
 */
export function pointsForViolations(count, rules) {
  const tiers = (rules && rules.violationTiers) || [
    { max: 1, points: -5 },
    { max: 3, points: -10 },
    { max: 5, points: -15 },
    { max: Infinity, points: -20 }
  ];
  if (!count || count <= 0) return 0;
  for (const t of tiers) {
    if (count <= t.max) return t.points;
  }
  return tiers[tiers.length - 1].points;
}

/**
 * Verschiebt die Schlafenszeit um N Minuten nach vorne (früher).
 * Verweigert, wenn die Mindestschlafdauer unterschritten würde.
 * @returns {{ok:boolean, bedtime:string, reason?:string}}
 */
export function shiftBedtimeEarlier(currentBedtime, wakeTime, shiftMinutes, minSleepMinutes) {
  const cur = toMinutes(currentBedtime);
  const wake = toMinutes(wakeTime);
  if (cur == null || wake == null) {
    return { ok: false, bedtime: currentBedtime, reason: 'Ungültige Zeiten' };
  }
  const newBed = cur - shiftMinutes;
  const dur = sleepDurationMinutes(fromMinutes(newBed), wakeTime);
  if (dur < minSleepMinutes) {
    return { ok: false, bedtime: currentBedtime, reason: 'Mindestschlafdauer würde unterschritten.' };
  }
  return { ok: true, bedtime: fromMinutes(newBed) };
}

/**
 * Verschiebt die Heimkehrzeit um N Minuten früher.
 * Verweigert, wenn die Heimkehrzeit danach nach der Schlafenszeit liegen würde.
 */
export function shiftReturnEarlier(currentReturn, shiftMinutes, bedtime) {
  const cur = toMinutes(currentReturn);
  if (cur == null) return { ok: false, returnTime: currentReturn, reason: 'Ungültige Zeit' };
  const newReturn = cur - shiftMinutes;
  const bed = toMinutes(bedtime);
  if (bed != null && newReturn >= bed) {
    return { ok: false, returnTime: currentReturn, reason: 'Heimkehrzeit würde nach Schlafenszeit liegen.' };
  }
  return { ok: true, returnTime: fromMinutes(newReturn) };
}

/**
 * Verschiebt eine Zeit um N Minuten (positiv = später, negativ = früher).
 */
export function shiftTime(time, deltaMinutes) {
  const t = toMinutes(time);
  if (t == null) return time;
  return fromMinutes(t + deltaMinutes);
}

/**
 * Prüft, ob eine KI-Antwort sicher und gültig ist.
 * Wirft nichts, gibt ein Ergebnisobjekt zurück.
 */
export function validateEvaluation(res, config) {
  const errors = [];
  if (!res || typeof res !== 'object') {
    return { ok: false, errors: ['Antwort ist kein Objekt'] };
  }
  const validDecisions = ['good_night', 'violation', 'mixed'];
  if (!validDecisions.includes(res.decision)) errors.push('decision ungültig');

  const validSeverity = ['none', 'low', 'moderate', 'high'];
  if (!validSeverity.includes(res.severity)) errors.push('severity ungültig');

  if (typeof res.violation_count !== 'number' || res.violation_count < 0) {
    errors.push('violation_count ungültig');
  }
  if (typeof res.points_change !== 'number') errors.push('points_change ungültig');
  if (typeof res.streak_change !== 'number') errors.push('streak_change ungültig');

  const bt = toMinutes(res.next_bedtime);
  const rt = toMinutes(res.next_return_time);
  if (bt == null) errors.push('next_bedtime ungültig');
  if (rt == null) errors.push('next_return_time ungültig');

  if (bt != null && config.weekdayWakeTime) {
    const dur = sleepDurationMinutes(res.next_bedtime, config.weekdayWakeTime);
    const min = (config.consequenceRules && config.consequenceRules.minSleepDurationMinutes) || 420;
    if (dur < min) errors.push('Schlafdauer zu kurz');
  }
  if (rt != null && bt != null && rt >= bt) {
    errors.push('Heimkehrzeit nach Schlafenszeit');
  }
  if (res.points_change > 100 || res.points_change < -100) {
    errors.push('points_change außerhalb des sicheren Bereichs');
  }
  if (Math.abs(res.streak_change) > 1) {
    errors.push('streak_change zu groß');
  }

  return { ok: errors.length === 0, errors };
}
