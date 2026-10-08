/**
 * evaluation.js – Zentrale Nachtbewertung.
 *
 * Diese Datei ist die EINZIGE Stelle, an der Punkte, Streak,
 * Historie und Konsequenzen einer abgeschlossenen Nacht
 * angewendet werden. So bleibt die Logik konsistent, egal ob
 * sie über UI, Testmodus oder später über einen Timer läuft.
 */

import { getState, save } from './state.js';
import { evaluateNight } from './ai.js';
import { pointsForGoodNight, pointsForViolations } from './rules.js';
import { maybeGenerateConsequences } from './consequences.js';
import { notify } from './notifications.js';

/** Kurze Typbezeichnung für Konsequenz-Anzeige in der Historie. */
function consequenceLabel(type) {
  return ({
    earlier_bedtime: 'Frühere Schlafenszeit',
    earlier_return_time: 'Frühere Heimkehrzeit',
    reduced_free_time: 'Reduzierte Freizeit',
    extra_task: 'Zusätzliche Aufgabe',
    stricter_routine: 'Strengere Abendroutine',
    custom: 'Individuelle Konsequenz'
  })[type] || type;
}

/**
 * Wendet eine abgeschlossene Nacht vollständig an.
 * - ruft die (lokale oder remote) Auswertung auf
 * - berechnet Punkte & Streak neu (autoritativ)
 * - erzeugt ggf. Konsequenzen
 * - schreibt einen Historieneintrag
 *
 * @param {object} nightSnapshot Snapshot aus finishNight()
 * @returns {Promise<{evaluation:object, entry:object}>}
 */
export async function applyNightEvaluation(nightSnapshot) {
  const s = getState();

  // 1) Auswertung holen (KI oder lokal)
  let evaluation;
  try {
    evaluation = await evaluateNight(nightSnapshot, s.config);
  } catch (e) {
    console.warn('[evaluation] fallback:', e);
    evaluation = {
      decision: 'mixed',
      severity: 'low',
      violation_count: 0,
      points_change: 0,
      streak_change: 0,
      next_bedtime: s.config.currentBedtime,
      next_return_time: s.config.currentReturnTime,
      consequence: 'none',
      reason: 'Auswertung fehlgeschlagen.',
      message: 'Nacht konnte nicht ausgewertet werden.',
      source: 'error'
    };
  }

  // 2) Punkte & Streak autoritativ neu berechnen
  const violationCount = (nightSnapshot.confirmedViolations || []).length;
  let pointsChange = 0;
  let streakAfter = s.status.currentStreak;

  if (evaluation.decision === 'good_night') {
    streakAfter = s.status.currentStreak + 1;
    pointsChange = pointsForGoodNight(streakAfter, s.config.pointsRules);
  } else if (violationCount > 0) {
    streakAfter = 0;
    pointsChange = pointsForViolations(violationCount, s.config.pointsRules);
  } else {
    // mixed ohne bestätigte Verletzung: keine Punkteänderung, Streak bleibt
    pointsChange = 0;
  }

  s.status.totalPoints += pointsChange;
  s.status.currentStreak = streakAfter;
  if (streakAfter > s.status.bestStreak) s.status.bestStreak = streakAfter;
  s.status.totalNights += 1;
  s.status.totalViolations += violationCount;
  s.status.lastNight = new Date().toISOString();
  s.status.lastDecision = evaluation.decision;
  s.status.lastEvaluation = {
    decision: evaluation.decision,
    severity: evaluation.severity,
    violation_count: violationCount,
    points_change: pointsChange,
    reason: evaluation.reason,
    message: evaluation.message,
    source: evaluation.source || 'local',
    at: new Date().toISOString()
  };

  // 3) Konsequenzen automatisch anwenden (regelbasiert, nicht aus KI)
  const consequenceLabels = [];
  try {
    const created = maybeGenerateConsequences(nightSnapshot, evaluation);
    for (const c of created) consequenceLabels.push(consequenceLabel(c.type));
  } catch (e) {
    console.warn('[evaluation] consequences failed:', e);
  }

  // 4) Historieneintrag schreiben
  const entry = {
    id: `h_${Date.now()}`,
    date: new Date().toISOString(),
    plannedBedtime: nightSnapshot.plannedBedtime,
    plannedWakeTime: nightSnapshot.plannedWakeTime,
    plannedReturnTime: nightSnapshot.plannedReturnTime,
    actualReturnTime: nightSnapshot.actualReturnTime,
    latenessMinutes: nightSnapshot.latenessMinutes || 0,
    homeStatus: nightSnapshot.returnStatus || 'unknown',
    events: (nightSnapshot.events || []).map((e) => ({
      type: e.type,
      status: e.status,
      timestamp: e.timestamp
    })),
    possibleViolationCount: (nightSnapshot.possibleViolations || []).length,
    confirmedViolationCount: violationCount,
    pointsChange,
    streakAfter,
    decision: evaluation.decision,
    reason: evaluation.reason,
    message: evaluation.message,
    consequences: consequenceLabels
  };

  s.history.unshift(entry);
  if (s.history.length > 365) s.history.length = 365;

  save();

  // 5) Benachrichtigung (optional)
  try {
    notify('Nacht abgeschlossen', entry.message || entry.reason || '');
  } catch {}

  return { evaluation, entry };
}
