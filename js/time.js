/**
 * time.js – Zeit-Helfer
 * Reine Funktionen ohne Abhängigkeiten.
 */

export function parseTime(str) {
  if (typeof str !== 'string') return null;
  const m = str.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return { h: +m[1], m: +m[2], minutes: (+m[1]) * 60 + (+m[2]) };
}

export function isValidTime(str) {
  return parseTime(str) !== null;
}

export function toMinutes(str) {
  const t = parseTime(str);
  return t ? t.minutes : null;
}

export function fromMinutes(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h < 10 ? '0' : ''}${h}:${mm < 10 ? '0' : ''}${mm}`;
}

export function formatTime(str) {
  const t = parseTime(str);
  if (!t) return str || '—';
  return `${t.h < 10 ? '0' : ''}${t.h}:${t.m < 10 ? '0' : ''}${t.m}`;
}

/** Minuten-Differenz von a nach b, über Mitternacht wenn nötig. */
export function diffMinutes(a, b) {
  let d = b - a;
  if (d < 0) d += 1440;
  return d;
}

export function nowMinutes(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes();
}

export function isOvernight(bedtime, waketime) {
  const b = toMinutes(bedtime);
  const w = toMinutes(waketime);
  if (b == null || w == null) return false;
  return b > w;
}

/** Schlafdauer in Minuten zwischen Schlafens- und Aufstehzeit. */
export function sleepDurationMinutes(bedtime, waketime) {
  const b = toMinutes(bedtime);
  const w = toMinutes(waketime);
  if (b == null || w == null) return 0;
  return diffMinutes(b, w);
}

export function isWeekend(date = new Date()) {
  const d = date.getDay();
  return d === 0 || d === 6;
}

export function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatDateDE(isoOrDate) {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateTimeDE(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}
