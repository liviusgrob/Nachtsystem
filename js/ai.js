/**
 * ai.js – KI-Schnittstelle mit lokalem Fallback.
 *
 * Datenschutz-Grundsatz:
 * Es werden NUR sanitisierte Daten versendet.
 * Keine Koordinaten, kein Name, keine Adresse.
 * Nur 'home' / 'away' / 'unknown' als homeStatus.
 */

import { logError } from './state.js';
import { createEvent } from './events.js';
import { pointsForGoodNight, pointsForViolations, validateEvaluation } from './rules.js';

/**
 * Lokale Auswertung – läuft ohne Netz und ohne KI.
 * Wird immer verwendet, wenn keine KI konfiguriert ist
 * oder wenn die KI-Antwort ungültig war.
 */
export function localEvaluation(nightSnapshot, config) {
  const events = nightSnapshot.events || [];
  const confirmed = nightSnapshot.confirmedViolations || [];

  const lateReturnCount = events.filter((e) => e.type === 'late_return').length;
  const delayedBedtimeCount = events.filter((e) => e.type === 'bedtime_delayed').length;
  const violationCount = confirmed.length;

  let decision = 'good_night';
  let severity = 'none';

  if (violationCount > 0) {
    decision = 'violation';
    severity = violationCount >= 4 ? 'high'
             : violationCount >= 2 ? 'moderate'
             : 'low';
  } else if (lateReturnCount > 0 || delayedBedtimeCount > 0) {
    decision = 'mixed';
    severity = 'low';
  }

  const pointsChange = decision === 'good_night'
    ? pointsForGoodNight(1, config.pointsRules)      // wird in evaluation.js neu berechnet
    : pointsForViolations(violationCount, config.pointsRules);

  const streakChange = decision === 'good_night' ? 1
                     : (violationCount > 0 ? -1 : 0);

  let reason = 'Keine Auffälligkeiten erkannt.';
  if (decision === 'violation') reason = `${violationCount} bestätigte Verletzung(en).`;
  else if (decision === 'mixed') reason = 'Verspätete Ereignisse, aber keine bestätigte Verletzung.';

  return {
    decision,
    severity,
    violation_count: violationCount,
    points_change: pointsChange,
    streak_change: streakChange,
    next_bedtime: config.currentBedtime,
    next_return_time: config.currentReturnTime,
    consequence: 'none',
    reason,
    message: decision === 'good_night'
      ? 'Gute Nacht – weiter so.'
      : decision === 'mixed'
      ? 'Es gab Auffälligkeiten. Beobachten.'
      : 'Es gab bestätigte Verletzungen.'
  };
}

/**
 * Sanitizer: entfernt alles Sensible, bevor etwas an eine KI geht.
 * - keine Koordinaten
 * - kein Name
 * - nur Typ + Zeit + Messwerte der Ereignisse
 */
export function sanitizeForAI(nightSnapshot, config) {
  return {
    planned_bedtime: nightSnapshot.plannedBedtime,
    planned_wake_time: nightSnapshot.plannedWakeTime,
    planned_return_time: nightSnapshot.plannedReturnTime,
    actual_return_time: nightSnapshot.actualReturnTime,
    lateness_minutes: nightSnapshot.latenessMinutes || 0,
    home_status: nightSnapshot.returnStatus || 'unknown',
    events: (nightSnapshot.events || []).map((e) => ({
      type: e.type,
      timestamp: e.timestamp,
      data: sanitizeEventData(e.data)
    })),
    possible_violations: (nightSnapshot.possibleViolations || []).length,
    confirmed_violations: (nightSnapshot.confirmedViolations || []).length,
    points_rules: config.pointsRules
  };
}

function sanitizeEventData(data) {
  if (!data || typeof data !== 'object') return {};
  const allowed = [
    'type', 'plannedTime', 'actualTime', 'latenessMinutes',
    'delayMinutes', 'plannedBedtime', 'actualBedtime', 'homeStatus'
  ];
  const out = {};
  for (const k of allowed) {
    if (k in data) out[k] = data[k];
  }
  return out;
}

async function callRemoteAI(payload, ai) {
  const res = await fetch(ai.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(ai.apiKey ? { 'Authorization': `Bearer ${ai.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: ai.model || undefined,
      input: payload,
      instruction:
        'Analysiere die Nacht. Antworte ausschließlich als JSON mit den Feldern: ' +
        'decision, severity, violation_count, points_change, streak_change, ' +
        'next_bedtime, next_return_time, consequence, reason, message.'
    })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.output || json.result || json;
}

/**
 * Öffentliche Auswertungsfunktion.
 * Nutzt die KI nur, wenn sie aktiviert und konfiguriert ist.
 * Fallback auf lokale Auswertung bei Fehler oder ungültiger Antwort.
 *
 * @returns {Promise<object>} siehe Struktur in localEvaluation
 */
export async function evaluateNight(nightSnapshot, config) {
  const ai = config.ai || {};
  const sanitized = sanitizeForAI(nightSnapshot, config);

  if (ai.enabled && ai.endpoint) {
    try {
      const result = await callRemoteAI(sanitized, ai);
      const check = validateEvaluation(result, config);
      if (!check.ok) {
        console.warn('[ai] ungültige Antwort:', check.errors);
        logError(`KI-Antwort ungültig: ${check.errors.join('; ')}`);
        return { ...localEvaluation(nightSnapshot, config), source: 'local_fallback' };
      }
      return { ...result, source: 'remote' };
    } catch (e) {
      logError(`KI-Auswertung fehlgeschlagen: ${e.message || e}`);
      console.warn('[ai] remote failed', e);
      return { ...localEvaluation(nightSnapshot, config), source: 'local_fallback' };
    }
  }

  return { ...localEvaluation(nightSnapshot, config), source: 'local' };
}
