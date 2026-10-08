/**
 * consequences.js – Konsequenzsystem.
 * - Konsequenzen sind geplante Anpassungen, keine Bestrafung.
 * - Alle Änderungen sind begrenzt und transparent.
 * - Kein Auslösen gesundheitlich bedenklicher Zustände.
 */

import { getState, save } from './state.js';
import { createEvent } from './events.js';
import { shiftBedtimeEarlier, shiftReturnEarlier } from './rules.js';
import { currentWakeTime } from './night.js';

export function listConsequences(includeFinished = true) {
  const s = getState();
  return s.consequences
    .filter((c) => includeFinished || c.status === 'active')
    .sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
}

export function activeConsequences() {
  return listConsequences(false);
}

/**
 * Erzeugt ein Konsequenz-Objekt (noch nicht angewendet).
 */
export function createConsequence(type, oldValue, newValue, durationDays, reason) {
  const start = new Date();
  const end = new Date(start.getTime() + durationDays * 86400000);
  return {
    id: `cons_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    type,
    oldValue,
    newValue,
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    durationDays,
    reason,
    status: 'active'
  };
}

/**
 * Wendet eine Konsequenz an:
 * - speichert sie
 * - setzt ggf. den aktuellen Wert in config
 * - erzeugt ein Event
 */
export function applyConsequence(consequence) {
  const s = getState();
  s.consequences.push(consequence);

  switch (consequence.type) {
    case 'earlier_bedtime':
      s.config.currentBedtime = consequence.newValue;
      break;
    case 'earlier_return_time':
      s.config.currentReturnTime = consequence.newValue;
      break;
    case 'reduced_free_time':
    case 'extra_task':
    case 'stricter_routine':
    case 'custom':
    default:
      // reine Info-Konsequenz, kein Zeitwert
      break;
  }

  s.status.lastConsequence = {
    type: consequence.type,
    newValue: consequence.newValue,
    startDate: consequence.startDate,
    endDate: consequence.endDate
  };

  const evt = createEvent('consequence_started', {
    type: consequence.type,
    oldValue: consequence.oldValue,
    newValue: consequence.newValue,
    durationDays: consequence.durationDays,
    reason: consequence.reason
  }, 'system');
  s.events.push(evt);

  save();
  return consequence;
}

/**
 * Beendet alle abgelaufenen Konsequenzen und stellt Werte zurück.
 * @returns {boolean} true, wenn etwas geändert wurde
 */
export function expireConsequences() {
  const s = getState();
  const now = Date.now();
  let changed = false;

  for (const c of s.consequences) {
    if (c.status !== 'active') continue;
    if (new Date(c.endDate).getTime() <= now) {
      c.status = 'finished';
      changed = true;

      if (c.type === 'earlier_bedtime' && s.config.currentBedtime === c.newValue) {
        s.config.currentBedtime = c.oldValue;
      }
      if (c.type === 'earlier_return_time' && s.config.currentReturnTime === c.newValue) {
        s.config.currentReturnTime = c.oldValue;
      }

      s.events.push(createEvent('consequence_finished', {
        type: c.type, id: c.id
      }, 'system'));
    }
  }

  if (changed) save();
  return changed;
}

export function checkConsequenceExpiry() {
  try {
    return expireConsequences();
  } catch (e) {
    console.warn('[consequences] expiry failed', e);
    return false;
  }
}

/**
 * Erzeugt automatisch Konsequenzen, wenn Schwellwerte überschritten werden.
 * Wird nach jeder abgeschlossenen Nacht aufgerufen.
 * @returns {Array} erzeugte Konsequenzen
 */
export function maybeGenerateConsequences(nightSnapshot, evaluation) {
  const s = getState();
  const rules = s.config.consequenceRules;
  if (!rules.enabled) return [];

  const created = [];
  const confirmed = (nightSnapshot.confirmedViolations || []).length;
  const lateReturns = (nightSnapshot.events || [])
    .filter((e) => e.type === 'late_return').length;

  // Schlafenszeit anpassen
  if (confirmed >= rules.triggerThreshold) {
    const exists = s.consequences.find(
      (c) => c.type === 'earlier_bedtime' && c.status === 'active'
    );
    if (!exists) {
      const wake = currentWakeTime(s.config);
      const shift = shiftBedtimeEarlier(
        s.config.currentBedtime,
        wake,
        rules.bedtimeShiftMinutes,
        rules.minSleepDurationMinutes
      );
      if (shift.ok && shift.bedtime !== s.config.currentBedtime) {
        const cons = createConsequence(
          'earlier_bedtime',
          s.config.currentBedtime,
          shift.bedtime,
          rules.durationDays,
          `${confirmed} bestätigte Verletzungen`
        );
        applyConsequence(cons);
        created.push(cons);
      }
    }
  }

  // Heimkehrzeit anpassen
  if (lateReturns >= rules.triggerThreshold) {
    const exists = s.consequences.find(
      (c) => c.type === 'earlier_return_time' && c.status === 'active'
    );
    if (!exists) {
      const shift = shiftReturnEarlier(
        s.config.currentReturnTime,
        rules.returnShiftMinutes,
        s.config.currentBedtime
      );
      if (shift.ok && shift.returnTime !== s.config.currentReturnTime) {
        const cons = createConsequence(
          'earlier_return_time',
          s.config.currentReturnTime,
          shift.returnTime,
          rules.durationDays,
          `${lateReturns} verspätete Heimkehr(en)`
        );
        applyConsequence(cons);
        created.push(cons);
      }
    }
  }

  return created;
}
