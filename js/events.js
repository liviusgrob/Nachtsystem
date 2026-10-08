/**
 * events.js – Einheitliches Ereignissystem.
 * Ereignisse sind reine Datenobjekte ohne Seiteneffekte.
 */

export const EVENT_TYPES = [
  'late_return',
  'bedtime_delayed',
  'night_started',
  'night_finished',
  'focus_changed',
  'manual_adjustment',
  'setup_changed',
  'consequence_started',
  'consequence_finished'
];

export const EVENT_STATUS = ['event', 'possibleViolation', 'confirmedViolation'];

let counter = 0;

/**
 * Erzeugt ein Ereignisobjekt.
 * @param {string} type  einer aus EVENT_TYPES
 * @param {object} data  freie Zusatzdaten
 * @param {string} source Herkunft: 'app' | 'user' | 'home' | 'system' | 'test'
 * @param {string} status 'event' | 'possibleViolation' | 'confirmedViolation'
 */
export function createEvent(type, data = {}, source = 'app', status = 'event') {
  if (!EVENT_TYPES.includes(type)) {
    console.warn('[events] unknown type', type);
  }
  return {
    id: `evt_${Date.now()}_${counter++}`,
    type,
    timestamp: new Date().toISOString(),
    data,
    source,
    status
  };
}

export function promoteToConfirmed(event) {
  if (!event) return event;
  event.status = 'confirmedViolation';
  return event;
}
