/**
 * ui.js – Alle Views, Navigation und Handler.
 * Diese Datei kennt alle anderen Module und rendert die App.
 */

import { getState, save, subscribe } from './state.js';
import { storage } from './storage.js';
import {
  formatTime, formatDateDE, formatDateTimeDE, isValidTime,
  toMinutes, sleepDurationMinutes, isWeekend
} from './time.js';
import {
  getCurrentPosition, computeHomeStatus, homeStatusLabel, geolocationAvailable
} from './home.js';
import {
  startNight, finishNight, registerLateReturn, registerBedtimeDelayed,
  currentWakeTime
} from './night.js';
import {
  activeConsequences, listConsequences, createConsequence, applyConsequence,
  expireConsequences
} from './consequences.js';
import { applyNightEvaluation } from './evaluation.js';
import {
  notificationsSupported, notificationPermission, requestNotificationPermission,
  swSupported
} from './notifications.js';
import { createEvent } from './events.js';
import { runTest } from './testmode.js';

const NAV_ITEMS = [
  { route: 'dashboard', label: 'Start',  icon: icon('home') },
  { route: 'night',     label: 'Nacht',  icon: icon('moon') },
  { route: 'home',      label: 'Heim',   icon: icon('pin') },
  { route: 'points',    label: 'Punkte', icon: icon('star') },
  { route: 'more',      label: 'Mehr',   icon: icon('more') }
];

const ROUTES = [
  'dashboard', 'night', 'home', 'points', 'more',
  'setup', 'history', 'consequences', 'settings', 'status', 'privacy', 'test'
];

let root, toastEl, modalRoot;
let setupState = null;

/* ---------------- Icons ---------------- */

function icon(name) {
  switch (name) {
    case 'home': return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>`;
    case 'moon': return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14a8 8 0 1 1-9-12 6 6 0 0 0 9 12z"/></svg>`;
    case 'pin':  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/></svg>`;
    case 'star': return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 2.6 6.2L21 10l-5 4.4L17.3 21 12 17.6 6.7 21 8 14.4 3 10l6.4-.8z"/></svg>`;
    case 'more': return `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>`;
  }
  return '';
}

/* ---------------- Helpers ---------------- */

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatClock(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function formatDuration(min) {
  if (!min || min < 0) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h} h ${m < 10 ? '0' : ''}${m} min`;
}

function dayGreeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Nacht';
  if (h < 11) return 'Morgen';
  if (h < 17) return 'Tag';
  return 'Abend';
}

function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear()
    && d.getMonth() === n.getMonth()
    && d.getDate() === n.getDate();
}

function decisionLabel(d) {
  if (d === 'good_night') return 'Gute Nacht';
  if (d === 'violation') return 'Regelverletzung';
  if (d === 'mixed') return 'Gemischt';
  return d || '—';
}

function eventLabel(t) {
  const m = {
    late_return: 'Verspätete Heimkehr',
    bedtime_delayed: 'Schlafenszeit verzögert',
    night_started: 'Nacht gestartet',
    night_finished: 'Nacht beendet',
    focus_changed: 'Fokus geändert',
    manual_adjustment: 'Manuelle Anpassung',
    setup_changed: 'Einrichtung geändert',
    consequence_started: 'Konsequenz gestartet',
    consequence_finished: 'Konsequenz beendet'
  };
  return m[t] || t;
}

function eventStatusLabel(s) {
  return { event: 'Ereignis', possibleViolation: 'Möglicher Verstoß', confirmedViolation: 'Bestätigt' }[s] || s;
}

function statusChipClass(s) {
  if (s === 'confirmedViolation') return 'bad';
  if (s === 'possibleViolation') return 'warn';
  return 'info';
}

function consequenceTypeLabel(t) {
  return ({
    earlier_bedtime: 'Frühere Schlafenszeit',
    earlier_return_time: 'Frühere Heimkehrzeit',
    reduced_free_time: 'Reduzierte Freizeit',
    extra_task: 'Zusätzliche Aufgabe',
    stricter_routine: 'Strengere Abendroutine',
    custom: 'Individuelle Konsequenz'
  })[t] || t;
}

function deriveDayStatus(s) {
  const a = s.status.lastEvaluation;
  if (!a) return { title: 'Bereit', line: 'Noch keine Auswertung vorhanden.' };
  if (a.decision === 'good_night') return { title: 'Alles im grünen Bereich', line: a.reason || a.message || '' };
  if (a.decision === 'mixed')      return { title: 'Beobachten', line: a.reason || a.message || '' };
  return { title: 'Verstoß erkannt', line: a.reason || a.message || '' };
}

function setNested(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

export function toast(msg, ms = 2400) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.remove('show'), ms);
}

export function openModal(html, after) {
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.innerHTML = `<div class="modal">${html}</div>`;
  bd.addEventListener('click', (e) => { if (e.target === bd) closeModal(); });
  modalRoot.appendChild(bd);
  if (after) after(bd.querySelector('.modal'));
}

export function closeModal() {
  if (modalRoot) modalRoot.innerHTML = '';
}

/* ---------------- Init / Router ---------------- */

export function initUI() {
  root = document.getElementById('app');
  toastEl = document.getElementById('toast');
  modalRoot = document.getElementById('modal-root');
  window.addEventListener('hashchange', () => renderRoute(currentRoute()));
}

export function currentRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  if (ROUTES.includes(h)) return h;
  return getState().system.setupCompleted ? 'dashboard' : 'setup';
}

export function navigate(route) {
  if (!ROUTES.includes(route)) route = 'dashboard';
  if (location.hash === `#/${route}`) {
    renderRoute(route);
  } else {
    location.hash = `#/${route}`;
  }
}

export function renderRoute(route) {
  if (!root) return;
  const s = getState();

  if (!s.system.setupCompleted && route !== 'setup') {
    if (location.hash !== '#/setup') { location.hash = '#/setup'; return; }
    route = 'setup';
  }
  if (s.system.setupCompleted && route === 'setup') route = 'dashboard';

  let html = '';
  switch (route) {
    case 'setup':        html = renderSetup(); break;
    case 'dashboard':    html = renderDashboard(); break;
    case 'night':        html = renderNightView(); break;
    case 'home':         html = renderHomeView(); break;
    case 'points':       html = renderPointsView(); break;
    case 'more':         html = renderMoreView(); break;
    case 'history':      html = renderHistoryView(); break;
    case 'consequences': html = renderConsequencesView(); break;
    case 'settings':     html = renderSettingsView(); break;
    case 'status':       html = renderStatusView(); break;
    case 'privacy':      html = renderPrivacyView(); break;
    case 'test':         html = renderTestView(); break;
    default:             html = renderDashboard();
  }

  const showNav = route !== 'setup';
  root.innerHTML = html + (showNav ? renderNav(route) : '');
  root.classList.toggle('no-nav', !showNav);
  attachHandlers(route);
}

/* ---------------- Nav ---------------- */

function renderNav(active) {
  return `<nav class="nav">${
    NAV_ITEMS.map((item) => {
      const isActive = active === item.route
        || (item.route === 'more'
            && ['history','consequences','settings','status','privacy','test'].includes(active));
      return `<button class="nav-btn ${isActive ? 'active' : ''}" data-nav="${item.route}">
        ${item.icon}<span>${item.label}</span>
      </button>`;
    }).join('')
  }</nav>`;
}

/* ---------------- Dashboard ---------------- */

function renderDashboard() {
  const s = getState();
  const name = s.config.name || 'Nutzer';
  const st = deriveDayStatus(s);
  const wake = currentWakeTime(s.config);
  const plannedBed = s.night.active ? s.night.plannedBedtime : s.config.currentBedtime;
  const dur = sleepDurationMinutes(plannedBed, wake);
  const activeCons = activeConsequences();
  const todays = (s.night.events || []).filter((e) => isToday(e.timestamp));

  return `
    <header class="app-header">
      <h1>Guten ${dayGreeting()}, ${esc(name)}</h1>
      <div class="sub">${formatDateDE(new Date())} · Nachtsystem</div>
    </header>
    <div class="view">
      <div class="hero">
        <h2>${esc(st.title)}</h2>
        <div class="status-line">${esc(st.line)}</div>
        <div class="hero-times">
          <div><div class="hero-time-label">Nachtruhe</div><div class="hero-time-value">${formatTime(plannedBed)}</div></div>
          <div><div class="hero-time-label">Heimkehr</div><div class="hero-time-value">${formatTime(s.config.currentReturnTime)}</div></div>
        </div>
      </div>

      <div class="grid-3">
        <div class="stat"><div class="label">Streak</div><div class="value">${s.status.currentStreak}</div><div class="hint">Nächte</div></div>
        <div class="stat"><div class="label">Best</div><div class="value">${s.status.bestStreak}</div><div class="hint">Rekord</div></div>
        <div class="stat"><div class="label">Punkte</div><div class="value">${s.status.totalPoints}</div><div class="hint">Gesamt</div></div>
      </div>

      <div class="section-title">Heute</div>
      <div class="card tight">
        <div class="row"><div><div class="t">Schlafdauer geplant</div><div class="s">Aufstehen ${formatTime(wake)}</div></div><div class="v">${formatDuration(dur)}</div></div>
        <div class="row"><div><div class="t">Nachtruhe</div><div class="s">${s.night.active ? `Aktiv seit ${formatClock(s.night.startTime)}` : 'Noch nicht aktiv'}</div></div><div class="v ${s.night.active ? 'text-good' : 'text-dim'}">${s.night.active ? 'Aktiv' : 'Inaktiv'}</div></div>
        <div class="row"><div><div class="t">Heimkehrstatus</div><div class="s">Letzte Prüfung</div></div><div class="v">${homeStatusLabel(s.night.returnStatus)}</div></div>
      </div>

      ${activeCons.length ? `<div class="section-title">Aktive Konsequenzen</div>${activeCons.map(consequenceCard).join('')}` : ''}

      <div class="section-title">Heutige Ereignisse</div>
      ${todays.length === 0
        ? `<div class="card tight text-mute fs-14">Keine Ereignisse heute.</div>`
        : todays.slice(-6).reverse().map((e) => `
            <div class="card tight">
              <div class="row" style="border:none;padding:0;">
                <div><div class="t">${esc(eventLabel(e.type))}</div><div class="s">${formatClock(e.timestamp)} · ${esc(e.source || 'app')}</div></div>
                <span class="chip ${statusChipClass(e.status)}">${esc(eventStatusLabel(e.status))}</span>
              </div>
            </div>`).join('')}

      <div class="section-title">Letzte Bewertung</div>
      <div class="card tight">
        ${s.status.lastEvaluation
          ? `<div class="row" style="border:none;">
              <div>
                <div class="t">${esc(decisionLabel(s.status.lastEvaluation.decision))}</div>
                <div class="s">${esc(s.status.lastEvaluation.reason || '')}</div>
              </div>
              <div class="v ${s.status.lastEvaluation.points_change >= 0 ? 'text-good' : 'text-bad'}">${s.status.lastEvaluation.points_change >= 0 ? '+' : ''}${s.status.lastEvaluation.points_change}</div>
            </div>`
          : `<div class="text-mute fs-14">Noch keine Bewertung.</div>`}
      </div>
    </div>`;
}

function consequenceCard(c) {
  const type = consequenceTypeLabel(c.type);
  const range = `${formatDateDE(c.startDate)} – ${formatDateDE(c.endDate)}`;
  const value = c.newValue ? `${c.oldValue} → ${c.newValue}` : '';
  const finished = c.status !== 'active';
  return `
    <div class="card tight">
      <div class="row" style="border:none;">
        <div>
          <div class="t">${esc(type)}</div>
          <div class="s">${esc(range)} · ${esc(c.reason || '')}</div>
          ${value ? `<div class="s">${esc(value)}</div>` : ''}
        </div>
        <span class="chip ${finished ? '' : 'warn'}">${finished ? 'Beendet' : 'Aktiv'}</span>
      </div>
    </div>`;
}

/* ---------------- Setup ---------------- */

function ensureSetupState() {
  if (!setupState) {
    setupState = {
      step: 0,
      data: {
        name: '',
        weekdayWakeTime: '06:30',
        weekendWakeTime: '08:30',
        weekdayInitialBedtime: '22:30',
        weekendInitialBedtime: '23:30',
        desiredReturnTime: '21:30',
        homeLocation: null,
        homeRadius: 50,
        locationSkipped: false
      },
      errors: {}
    };
  }
  return setupState;
}

function renderSetup() {
  const st = ensureSetupState();
  const steps = [renderSetupName, renderSetupWake, renderSetupBedtime, renderSetupReturn, renderSetupHome];
  const total = steps.length;
  const body = steps[st.step](st);
  const progress = `<div class="setup-progress">${
    steps.map((_, i) => `<div class="dot ${i <= st.step ? 'done' : ''}"></div>`).join('')
  }</div>`;

  return `
    <div class="view" style="padding-top: calc(var(--safe-top) + 24px); padding-bottom: 140px;">
      ${progress}${body}
    </div>
    <div class="setup-footer">
      ${st.step > 0 ? `<button class="btn ghost" data-setup="back" style="max-width:110px;">Zurück</button>` : ''}
      <button class="btn primary" data-setup="next">${st.step === total - 1 ? 'Einrichtung abschließen' : 'Weiter'}</button>
    </div>`;
}

function renderSetupName(st) {
  return `
    <h1 class="setup-title">Wie heißt du?</h1>
    <p class="setup-sub">Damit wir dich persönlich begrüßen können. Die Angabe bleibt lokal.</p>
    <div class="field ${st.errors.name ? 'invalid' : ''}">
      <label>Name</label>
      <input type="text" autocomplete="given-name" placeholder="z. B. Max" value="${esc(st.data.name)}" data-setup-field="name">
      <div class="error">${esc(st.errors.name || '')}</div>
    </div>`;
}

function renderSetupWake(st) {
  return `
    <h1 class="setup-title">Aufstehzeiten</h1>
    <p class="setup-sub">Wann stehst du normalerweise auf?</p>
    <div class="field ${st.errors.weekdayWakeTime ? 'invalid' : ''}">
      <label>Unter der Woche</label>
      <input type="time" value="${esc(st.data.weekdayWakeTime)}" data-setup-field="weekdayWakeTime">
      <div class="error">${esc(st.errors.weekdayWakeTime || '')}</div>
    </div>
    <div class="field ${st.errors.weekendWakeTime ? 'invalid' : ''}">
      <label>Am Wochenende</label>
      <input type="time" value="${esc(st.data.weekendWakeTime)}" data-setup-field="weekendWakeTime">
      <div class="error">${esc(st.errors.weekendWakeTime || '')}</div>
    </div>`;
}

function renderSetupBedtime(st) {
  return `
    <h1 class="setup-title">Schlafenszeiten</h1>
    <p class="setup-sub">Deine geplanten Schlafenszeiten. Sie können später angepasst werden.</p>
    <div class="field ${st.errors.weekdayInitialBedtime ? 'invalid' : ''}">
      <label>Unter der Woche</label>
      <input type="time" value="${esc(st.data.weekdayInitialBedtime)}" data-setup-field="weekdayInitialBedtime">
      <div class="error">${esc(st.errors.weekdayInitialBedtime || '')}</div>
    </div>
    <div class="field ${st.errors.weekendInitialBedtime ? 'invalid' : ''}">
      <label>Am Wochenende</label>
      <input type="time" value="${esc(st.data.weekendInitialBedtime)}" data-setup-field="weekendInitialBedtime">
      <div class="error">${esc(st.errors.weekendInitialBedtime || '')}</div>
    </div>
    <div class="card tight text-mute fs-13">
      Die Aufstehzeit wird berücksichtigt – das System achtet auf ausreichende Schlafdauer.
    </div>`;
}

function renderSetupReturn(st) {
  return `
    <h1 class="setup-title">Heimkehrzeit</h1>
    <p class="setup-sub">Zu welcher Uhrzeit möchtest du spätestens zuhause sein?</p>
    <div class="field ${st.errors.desiredReturnTime ? 'invalid' : ''}">
      <label>Heimkehrzeit</label>
      <input type="time" value="${esc(st.data.desiredReturnTime)}" data-setup-field="desiredReturnTime">
      <div class="error">${esc(st.errors.desiredReturnTime || '')}</div>
    </div>`;
}

function renderSetupHome(st) {
  const d = st.data;
  const loc = d.homeLocation;
  const status = geolocationAvailable()
    ? 'Standort verfügbar'
    : 'Standort bei lokaler Datei nicht verfügbar';
  return `
    <h1 class="setup-title">Heimat &amp; Radius</h1>
    <p class="setup-sub">Damit das System feststellen kann, ob du zuhause bist. Die Koordinaten bleiben lokal.</p>
    <div class="card tight">
      <div class="row">
        <div>
          <div class="t">Heimatstandort</div>
          <div class="s">${loc ? `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}` : 'Noch nicht festgelegt'}</div>
        </div>
        <button class="btn small" data-setup="locate" style="width:auto;padding:8px 12px;">Ermitteln</button>
      </div>
      <div class="text-mute fs-12 mt-8">${esc(status)}</div>
      ${st.errors.location ? `<div class="error" style="display:block;">${esc(st.errors.location)}</div>` : ''}
      ${!d.homeLocation && d.locationSkipped
        ? `<div class="text-warn fs-12 mt-8">Standort übersprungen. Heimkehrstatus bleibt „unbekannt".</div>`
        : ''}
    </div>
    <div class="field ${st.errors.homeRadius ? 'invalid' : ''}">
      <label>Heimradius (Meter)</label>
      <input type="number" min="10" max="1000" step="5" value="${esc(String(d.homeRadius))}" data-setup-field="homeRadius">
      <div class="hint">Standard: 50 Meter</div>
      <div class="error">${esc(st.errors.homeRadius || '')}</div>
    </div>
    ${!d.homeLocation
      ? `<button class="btn ghost" data-setup="skip-location">Standort später festlegen</button>`
      : ''}`;
}

function validateSetupStep(st) {
  const err = {};
  const d = st.data;
  if (st.step === 0) {
    if (!d.name || !d.name.trim()) err.name = 'Name ist erforderlich.';
  } else if (st.step === 1) {
    if (!isValidTime(d.weekdayWakeTime)) err.weekdayWakeTime = 'Ungültige Uhrzeit (HH:MM).';
    if (!isValidTime(d.weekendWakeTime)) err.weekendWakeTime = 'Ungültige Uhrzeit (HH:MM).';
  } else if (st.step === 2) {
    if (!isValidTime(d.weekdayInitialBedtime)) err.weekdayInitialBedtime = 'Ungültige Uhrzeit (HH:MM).';
    if (!isValidTime(d.weekendInitialBedtime)) err.weekendInitialBedtime = 'Ungültige Uhrzeit (HH:MM).';
    if (isValidTime(d.weekdayInitialBedtime) && isValidTime(d.weekdayWakeTime)) {
      const dur = sleepDurationMinutes(d.weekdayInitialBedtime, d.weekdayWakeTime);
      if (dur < 360) err.weekdayInitialBedtime = 'Schlafdauer unter 6 Stunden erscheint ungesund.';
    }
  } else if (st.step === 3) {
    if (!isValidTime(d.desiredReturnTime)) err.desiredReturnTime = 'Ungültige Uhrzeit (HH:MM).';
  } else if (st.step === 4) {
    if (typeof d.homeRadius !== 'number' || d.homeRadius < 10 || d.homeRadius > 1000) {
      err.homeRadius = 'Radius zwischen 10 und 1000 Metern.';
    }
  }
  return err;
}

function finalizeSetup(st) {
  const s = getState();
  s.system.setupCompleted = true;
  s.config.name = st.data.name.trim();
  s.config.weekdayWakeTime = st.data.weekdayWakeTime;
  s.config.weekendWakeTime = st.data.weekendWakeTime;
  s.config.weekdayInitialBedtime = st.data.weekdayInitialBedtime;
  s.config.weekendInitialBedtime = st.data.weekendInitialBedtime;
  s.config.currentBedtime = st.data.weekdayInitialBedtime;
  s.config.currentLongTermBedtime = st.data.weekdayInitialBedtime;
  s.config.desiredReturnTime = st.data.desiredReturnTime;
  s.config.currentReturnTime = st.data.desiredReturnTime;
  s.config.homeLocation = st.data.homeLocation;
  s.config.homeRadius = st.data.homeRadius;

  s.events.push(createEvent('setup_changed', { initial: true }, 'user'));
  save();

  setupState = null;
  toast('Einrichtung abgeschlossen.');
  navigate('dashboard');
}

/* ---------------- Night ---------------- */

function renderNightView() {
  const s = getState();
  const n = s.night;
  const wake = currentWakeTime(s.config);
  const plannedBed = n.active ? n.plannedBedtime : s.config.currentBedtime;
  const dur = sleepDurationMinutes(plannedBed, wake);
  return `
    <header class="app-header">
      <h1>Nachtruhe</h1>
      <div class="sub">${n.active ? 'Nacht aktiv' : 'Keine aktive Nacht'}</div>
    </header>
    <div class="view">
      <button class="night-toggle ${n.active ? 'active' : ''}" data-action="toggle-night">
        <h3>${n.active ? '🌙 Nacht läuft' : '☾ Nacht starten'}</h3>
        <p>${n.active ? `Gestartet um ${formatClock(n.startTime)}` : 'Tippen, um die Nachtruhe zu beginnen.'}</p>
      </button>

      <div class="card tight">
        <div class="row"><div><div class="t">Geplante Schlafenszeit</div><div class="s">Aus Einstellungen</div></div><div class="v">${formatTime(plannedBed)}</div></div>
        <div class="row"><div><div class="t">Geplante Aufstehzeit</div><div class="s">${isWeekend() ? 'Wochenende' : 'Unter der Woche'}</div></div><div class="v">${formatTime(wake)}</div></div>
        <div class="row"><div><div class="t">Geplante Schlafdauer</div><div class="s">Mindestens 7 Stunden empfohlen</div></div><div class="v">${formatDuration(dur)}</div></div>
      </div>

      <div class="section-title">Tatsächliche Schlafenszeit</div>
      <div class="card tight">
        <div class="text-mute fs-13 mb-0">
          Diese App kann nicht feststellen, wann du tatsächlich einschläfst.
          Trage hier manuell ein.
        </div>
        <div class="field mt-16" style="margin-bottom:0;">
          <label>Tatsächliche Schlafenszeit</label>
          <input type="time" data-action="actual-bedtime" value="">
        </div>
        <div class="text-mute fs-12 mt-8">
          Bei deutlicher Abweichung wird ein Ereignis erzeugt.
        </div>
      </div>

      ${n.active ? `
        <div class="section-title">Nacht-Ereignisse</div>
        ${n.events.length === 0
          ? `<div class="card tight text-mute fs-14">Noch keine Ereignisse.</div>`
          : n.events.slice().reverse().map((e) => `
              <div class="card tight">
                <div class="row" style="border:none;padding:0;">
                  <div><div class="t">${esc(eventLabel(e.type))}</div><div class="s">${formatClock(e.timestamp)}</div></div>
                  <span class="chip ${statusChipClass(e.status)}">${esc(eventStatusLabel(e.status))}</span>
                </div>
              </div>`).join('')}
      ` : ''}
    </div>`;
}

/* ---------------- Home ---------------- */

function renderHomeView() {
  const s = getState();
  const hasHome = !!s.config.homeLocation;
  const status = s.night.returnStatus || 'unknown';
  const planned = s.config.currentReturnTime;
  const statusLine = !hasHome ? 'Kein Heimatstandort hinterlegt.'
    : status === 'home' ? 'Du bist innerhalb des Heimradius.'
    : status === 'away' ? 'Du bist außerhalb des Heimradius.'
    : 'Standortstatus unbekannt.';

  return `
    <header class="app-header">
      <h1>Heimkehr</h1>
      <div class="sub">Status: ${homeStatusLabel(status)}</div>
    </header>
    <div class="view">
      <div class="hero">
        <div class="hero-time-label">Geplante Heimkehrzeit</div>
        <div class="hero-time-value">${formatTime(planned)}</div>
        <div class="status-line mt-8">${esc(statusLine)}</div>
      </div>

      <div class="btn-row">
        <button class="btn primary" data-action="check-home">Standort prüfen</button>
        <button class="btn" data-action="im-home">Ich bin zuhause</button>
      </div>

      ${!hasHome
        ? `<div class="card tight mt-16">
            <div class="t" style="font-weight:600;">Heimatstandort festlegen</div>
            <div class="s fs-13">Ohne Standort kann der Heimkehrstatus nur manuell erfasst werden.</div>
            <div class="btn-row mt-16">
              <button class="btn small" data-action="set-home">Aktuellen Standort speichern</button>
            </div>
          </div>`
        : `<div class="section-title">Heimat</div>
          <div class="card tight">
            <div class="row">
              <div>
                <div class="t">Koordinaten</div>
                <div class="s">${s.config.homeLocation.lat.toFixed(5)}, ${s.config.homeLocation.lng.toFixed(5)}</div>
              </div>
            </div>
            <div class="row">
              <div><div class="t">Radius</div><div class="s">Standard 50 Meter</div></div>
              <div class="v">${s.config.homeRadius} m</div>
            </div>
            <div class="btn-row mt-8">
              <button class="btn small" data-action="set-home">Standort neu setzen</button>
            </div>
          </div>`}

      <div class="section-title">Heutige Heimkehr</div>
      <div class="card tight">
        <div class="row"><div><div class="t">Geplant</div></div><div class="v">${formatTime(s.night.plannedReturnTime || planned)}</div></div>
        <div class="row"><div><div class="t">Tatsächlich</div></div><div class="v">${s.night.actualReturnTime ? formatTime(s.night.actualReturnTime) : '—'}</div></div>
        <div class="row"><div><div class="t">Verspätung</div></div><div class="v ${s.night.latenessMinutes > 0 ? 'text-warn' : ''}">${s.night.latenessMinutes > 0 ? `${s.night.latenessMinutes} Min` : '—'}</div></div>
      </div>

      <div class="section-title">Manuell erfassen</div>
      <div class="card tight">
        <div class="field mb-0">
          <label>Tatsächliche Heimkehrzeit</label>
          <input type="time" data-action="actual-return">
        </div>
        <div class="btn-row mt-16">
          <button class="btn small" data-action="save-return">Speichern</button>
        </div>
      </div>

      <div class="card tight text-mute fs-13 mt-16">
        Datenschutz: Der exakte Standort wird ausschließlich lokal verarbeitet.
      </div>
    </div>`;
}

/* ---------------- Points ---------------- */

function renderPointsView() {
  const s = getState();
  const recent = s.history.slice(0, 10);
  return `
    <header class="app-header">
      <h1>Punkte &amp; Streak</h1>
      <div class="sub">Dein Fortschritt im Überblick</div>
    </header>
    <div class="view">
      <div class="grid-2">
        <div class="stat"><div class="label">Punkte</div><div class="value">${s.status.totalPoints}</div><div class="hint">Gesamt</div></div>
        <div class="stat"><div class="label">Streak</div><div class="value">${s.status.currentStreak}</div><div class="hint">Aktuell</div></div>
        <div class="stat"><div class="label">Bestleistung</div><div class="value">${s.status.bestStreak}</div><div class="hint">Nächte</div></div>
        <div class="stat"><div class="label">Nächte gesamt</div><div class="value">${s.status.totalNights}</div><div class="hint">${s.status.totalViolations} Verstöße</div></div>
      </div>

      <div class="section-title">Punkteregeln</div>
      <div class="card tight">
        <div class="row"><div><div class="t">Gute Nacht · Streak 1</div></div><div class="v text-good">+10</div></div>
        <div class="row"><div><div class="t">Streak 2</div></div><div class="v text-good">+12</div></div>
        <div class="row"><div><div class="t">Streak 3</div></div><div class="v text-good">+14</div></div>
        <div class="row"><div><div class="t">Streak 4</div></div><div class="v text-good">+16</div></div>
        <div class="row"><div><div class="t">Streak 5</div></div><div class="v text-good">+18</div></div>
        <div class="row"><div><div class="t">Streak 6+</div></div><div class="v text-good">+20</div></div>
        <div class="row"><div><div class="t">1 Verstoß</div></div><div class="v text-bad">-5</div></div>
        <div class="row"><div><div class="t">2–3 Verstöße</div></div><div class="v text-bad">-10</div></div>
        <div class="row"><div><div class="t">4–5 Verstöße</div></div><div class="v text-bad">-15</div></div>
        <div class="row"><div><div class="t">6+ Verstöße</div></div><div class="v text-bad">-20</div></div>
      </div>

      <div class="section-title">Letzte Nächte</div>
      ${recent.length === 0
        ? `<div class="empty">Noch keine abgeschlossenen Nächte.</div>`
        : recent.map((h) => `
            <div class="card tight">
              <div class="row" style="border:none;padding:0;">
                <div>
                  <div class="t">${formatDateDE(h.date)}</div>
                  <div class="s">${esc(decisionLabel(h.decision))}</div>
                </div>
                <div class="v ${h.pointsChange >= 0 ? 'text-good' : 'text-bad'}">${h.pointsChange >= 0 ? '+' : ''}${h.pointsChange}</div>
              </div>
            </div>`).join('')}
    </div>`;
}

/* ---------------- More / History / Consequences ---------------- */

function renderMoreView() {
  const items = [
    { route: 'history', label: 'Historie' },
    { route: 'consequences', label: 'Konsequenzen' },
    { route: 'settings', label: 'Einstellungen' },
    { route: 'status', label: 'Systemstatus' },
    { route: 'privacy', label: 'Datenschutz' },
    { route: 'test', label: 'Testmodus' }
  ];
  return `
    <header class="app-header">
      <h1>Mehr</h1>
      <div class="sub">Alle Bereiche</div>
    </header>
    <div class="view">
      <div class="sheet-list">
        ${items.map((i) => `
          <button class="sheet-item" data-nav="${i.route}">
            <span>${i.label}</span><span class="arrow">›</span>
          </button>`).join('')}
      </div>
      <div class="card tight text-mute fs-12">
        Version ${esc(getState().system.version)} ·
        ${storage.isPersistent() ? 'Lokale Speicherung aktiv' : 'In-Memory (nicht persistent)'}
      </div>
    </div>`;
}

function renderHistoryView() {
  const items = getState().history;
  return `
    <header class="app-header">
      <h1>Historie</h1>
      <div class="sub">${items.length} abgeschlossene Nächte</div>
    </header>
    <div class="view">
      ${items.length === 0
        ? `<div class="empty">Noch keine abgeschlossenen Nächte.</div>`
        : items.map((h) => {
            const chipClass = h.decision === 'good_night' ? 'good'
                            : h.decision === 'violation' ? 'bad' : 'warn';
            const meta = [
              `Bett ${formatTime(h.plannedBedtime)}`,
              `Auf ${formatTime(h.plannedWakeTime)}`,
              `Heim ${formatTime(h.plannedReturnTime)}`
            ];
            if (h.actualReturnTime) meta.push(`Tats. ${formatTime(h.actualReturnTime)}`);
            if (h.latenessMinutes > 0) meta.push(`+${h.latenessMinutes} Min`);
            if (h.confirmedViolationCount > 0) meta.push(`${h.confirmedViolationCount} Verstoß(e)`);
            meta.push(`Punkte ${h.pointsChange >= 0 ? '+' : ''}${h.pointsChange}`);
            meta.push(`Streak ${h.streakAfter}`);

            return `
              <div class="history-item">
                <div class="history-head">
                  <div class="history-date">${formatDateDE(h.date)}</div>
                  <span class="chip ${chipClass}">${esc(decisionLabel(h.decision))}</span>
                </div>
                <div class="history-meta">
                  ${meta.map((m) => `<span>${esc(m)}</span>`).join('')}
                </div>
                ${h.consequences && h.consequences.length
                  ? `<div class="history-meta"><span>Konsequenz: ${esc(h.consequences.join(', '))}</span></div>`
                  : ''}
              </div>`;
          }).join('')}
    </div>`;
}

function renderConsequencesView() {
  const s = getState();
  const active = s.consequences.filter((c) => c.status === 'active');
  const finished = s.consequences.filter((c) => c.status !== 'active');
  return `
    <header class="app-header">
      <h1>Konsequenzen</h1>
      <div class="sub">Transparente Anpassungen</div>
    </header>
    <div class="view">
      ${active.length === 0
        ? `<div class="card tight text-mute fs-14">Keine aktiven Konsequenzen.</div>`
        : active.map(consequenceCard).join('')}
      ${finished.length
        ? `<div class="section-title">Beendet</div>${finished.slice(0, 8).map(consequenceCard).join('')}`
        : ''}

      <div class="section-title">Manuelle Konsequenz</div>
      <div class="card tight">
        <div class="field">
          <label>Typ</label>
          <select data-cons-field="type">
            <option value="earlier_bedtime">Frühere Schlafenszeit</option>
            <option value="earlier_return_time">Frühere Heimkehrzeit</option>
            <option value="reduced_free_time">Reduzierte Freizeit</option>
            <option value="extra_task">Zusätzliche Aufgabe</option>
            <option value="stricter_routine">Strengere Routine</option>
            <option value="custom">Benutzerdefiniert</option>
          </select>
        </div>
        <div class="field">
          <label>Neuer Wert / Beschreibung</label>
          <input data-cons-field="value" placeholder="z. B. 22:15">
        </div>
        <div class="field">
          <label>Dauer (Tage)</label>
          <input type="number" min="1" max="14" value="2" data-cons-field="days">
        </div>
        <div class="field">
          <label>Grund</label>
          <input data-cons-field="reason" placeholder="optional">
        </div>
        <button class="btn primary" data-action="add-consequence">Konsequenz hinzufügen</button>
      </div>

      <div class="card tight text-mute fs-13">
        Konsequenzen dienen nur der persönlichen Struktur. Keine gesundheitsschädlichen Vorgaben.
      </div>
    </div>`;
}

/* ---------------- Settings ---------------- */

function renderSettingsView() {
  const s = getState();
  const c = s.config;
  const n = c.notifications;
  const ai = c.ai;
  return `
    <header class="app-header">
      <h1>Einstellungen</h1>
      <div class="sub">Konfiguration &amp; Verhalten</div>
    </header>
    <div class="view">
      <div class="section-title">Persönlich</div>
      <div class="card">
        <div class="field mb-0">
          <label>Name</label>
          <input type="text" data-settings-field="name" value="${esc(c.name)}">
        </div>
      </div>

      <div class="section-title">Aufstehzeiten</div>
      <div class="card">
        <div class="field">
          <label>Unter der Woche</label>
          <input type="time" data-settings-field="weekdayWakeTime" value="${esc(c.weekdayWakeTime)}">
        </div>
        <div class="field mb-0">
          <label>Wochenende</label>
          <input type="time" data-settings-field="weekendWakeTime" value="${esc(c.weekendWakeTime)}">
        </div>
      </div>

      <div class="section-title">Schlafenszeiten</div>
      <div class="card">
        <div class="field">
          <label>Aktuell (angewendet)</label>
          <input type="time" data-settings-field="currentBedtime" value="${esc(c.currentBedtime)}">
        </div>
        <div class="field">
          <label>Unter der Woche (Initial)</label>
          <input type="time" data-settings-field="weekdayInitialBedtime" value="${esc(c.weekdayInitialBedtime)}">
        </div>
        <div class="field mb-0">
          <label>Wochenende (Initial)</label>
          <input type="time" data-settings-field="weekendInitialBedtime" value="${esc(c.weekendInitialBedtime)}">
        </div>
      </div>

      <div class="section-title">Heimkehr</div>
      <div class="card">
        <div class="field">
          <label>Aktuelle Heimkehrzeit</label>
          <input type="time" data-settings-field="currentReturnTime" value="${esc(c.currentReturnTime)}">
        </div>
        <div class="field">
          <label>Gewünschte Heimkehrzeit</label>
          <input type="time" data-settings-field="desiredReturnTime" value="${esc(c.desiredReturnTime)}">
        </div>
        <div class="field mb-0">
          <label>Heimradius (Meter)</label>
          <input type="number" min="10" max="1000" data-settings-field="homeRadius" value="${c.homeRadius}">
        </div>
      </div>

      <div class="section-title">Konsequenzen</div>
      <div class="card">
        <div class="toggle-row">
          <div class="info"><div class="t">Automatisch anwenden</div><div class="s">Nach wiederholten Verstößen</div></div>
          <label class="switch"><input type="checkbox" data-settings-field="consequenceRules.enabled" ${c.consequenceRules.enabled ? 'checked' : ''}><div class="track"></div><div class="thumb"></div></label>
        </div>
        <div class="field mt-16">
          <label>Schwelle</label>
          <input type="number" min="1" max="6" data-settings-field="consequenceRules.triggerThreshold" value="${c.consequenceRules.triggerThreshold}">
        </div>
        <div class="field">
          <label>Dauer (Tage)</label>
          <input type="number" min="1" max="14" data-settings-field="consequenceRules.durationDays" value="${c.consequenceRules.durationDays}">
        </div>
        <div class="field">
          <label>Verschiebung Schlafenszeit (Min)</label>
          <input type="number" min="5" max="60" step="5" data-settings-field="consequenceRules.bedtimeShiftMinutes" value="${c.consequenceRules.bedtimeShiftMinutes}">
        </div>
        <div class="field mb-0">
          <label>Verschiebung Heimkehrzeit (Min)</label>
          <input type="number" min="5" max="60" step="5" data-settings-field="consequenceRules.returnShiftMinutes" value="${c.consequenceRules.returnShiftMinutes}">
        </div>
      </div>

      <div class="section-title">Benachrichtigungen</div>
      <div class="card">
        <div class="toggle-row">
          <div class="info">
            <div class="t">Benachrichtigungen aktiv</div>
            <div class="s">${notificationsSupported() ? 'Berechtigung: ' + notificationPermission() : 'Nicht unterstützt'}</div>
          </div>
          <label class="switch"><input type="checkbox" data-settings-field="notifications.enabled" ${n.enabled ? 'checked' : ''} ${!notificationsSupported() ? 'disabled' : ''}><div class="track"></div><div class="thumb"></div></label>
        </div>
        <div class="field mt-16 mb-0">
          <label>Vorlaufzeit (Minuten)</label>
          <input type="number" min="0" max="120" step="5" data-settings-field="notifications.leadMinutes" value="${n.leadMinutes}">
        </div>
      </div>

      <div class="section-title">KI-Auswertung</div>
      <div class="card">
        <div class="toggle-row">
          <div class="info"><div class="t">KI aktivieren</div><div class="s">Ohne KI läuft lokale Auswertung</div></div>
          <label class="switch"><input type="checkbox" data-settings-field="ai.enabled" ${ai.enabled ? 'checked' : ''}><div class="track"></div><div class="thumb"></div></label>
        </div>
        <div class="field mt-16">
          <label>Endpoint-URL</label>
          <input type="url" data-settings-field="ai.endpoint" value="${esc(ai.endpoint)}" placeholder="https://...">
        </div>
        <div class="field">
          <label>API-Key</label>
          <input type="password" data-settings-field="ai.apiKey" value="${esc(ai.apiKey)}" placeholder="optional">
        </div>
        <div class="field mb-0">
          <label>Modell</label>
          <input type="text" data-settings-field="ai.model" value="${esc(ai.model || '')}" placeholder="optional">
        </div>
      </div>

      <div class="section-title">Speichern &amp; Zurücksetzen</div>
      <button class="btn primary" data-action="save-settings">Einstellungen speichern</button>
      <button class="btn mt-8" data-action="reset-options">Zurücksetzen…</button>

      <div class="card tight text-mute fs-12 mt-16">
        Nach Änderungen immer „Einstellungen speichern" tippen.
      </div>
    </div>`;
}

/* ---------------- Status / Privacy / Test ---------------- */

function renderStatusView() {
  const s = getState();
  const geo = geolocationAvailable();
  const notif = notificationsSupported();
  const aiActive = s.config.ai.enabled && s.config.ai.endpoint;
  return `
    <header class="app-header">
      <h1>Systemstatus</h1>
      <div class="sub">Technische Informationen</div>
    </header>
    <div class="view">
      <div class="card">
        <div class="row"><div class="t">App-Version</div><div class="v">${esc(s.system.version)}</div></div>
        <div class="row"><div class="t">Setup abgeschlossen</div><div class="v">${s.system.setupCompleted ? 'Ja' : 'Nein'}</div></div>
        <div class="row"><div class="t">Lokale Speicherung</div><div class="v">${storage.isPersistent() ? 'Persistent' : 'In-Memory'}</div></div>
        <div class="row"><div class="t">Protokoll</div><div class="v">${esc(location.protocol)}</div></div>
        <div class="row"><div class="t">Standort</div><div class="v">${geo ? 'Verfügbar' : 'Nicht verfügbar'}</div></div>
        <div class="row"><div class="t">Benachrichtigungen</div><div class="v">${notif ? `Verfügbar (${notificationPermission()})` : 'Nicht verfügbar'}</div></div>
        <div class="row"><div class="t">Service Worker</div><div class="v">${swSupported() ? 'Unterstützt' : 'Nicht unterstützt'}</div></div>
        <div class="row"><div class="t">KI verbunden</div><div class="v">${aiActive ? 'Ja' : 'Nein'}</div></div>
        <div class="row"><div class="t">Letzter Datenbankzugriff</div><div class="v">${s.system.lastDbAccess ? formatDateTimeDE(s.system.lastDbAccess) : '—'}</div></div>
      </div>

      <div class="section-title">Letzter Fehler</div>
      <div class="card tight">
        <div class="mono fs-12 text-dim">${s.status.lastError ? esc(s.status.lastError) : 'Kein Fehler protokolliert.'}</div>
        ${s.status.lastError ? `<button class="btn small mt-16" data-action="clear-last-error">Fehler verwerfen</button>` : ''}
      </div>

      <div class="section-title">Statistik</div>
      <div class="card">
        <div class="row"><div class="t">Nächte</div><div class="v">${s.status.totalNights}</div></div>
        <div class="row"><div class="t">Verstöße</div><div class="v">${s.status.totalViolations}</div></div>
        <div class="row"><div class="t">Verspätete Heimkehr</div><div class="v">${s.status.totalLateReturns}</div></div>
        <div class="row"><div class="t">Historie Einträge</div><div class="v">${s.history.length}</div></div>
        <div class="row"><div class="t">Ereignisse gesamt</div><div class="v">${s.events.length}</div></div>
      </div>
    </div>`;
}

function renderPrivacyView() {
  return `
    <header class="app-header">
      <h1>Datenschutz</h1>
      <div class="sub">Datensparsamkeit als Grundprinzip</div>
    </header>
    <div class="view">
      <div class="card">
        <div class="card-title">Welche Daten werden lokal gespeichert?</div>
        <div class="fs-14 text-dim">Name, Zeiten, Streak, Punkte, Ereignisse, Historie und Konfiguration. Alles liegt ausschließlich in der lokalen Speicherung deines Browsers (localStorage).</div>
      </div>
      <div class="card">
        <div class="card-title">Wann werden Standortdaten verwendet?</div>
        <div class="fs-14 text-dim">Nur wenn du einen Heimatstandort festlegst oder die Standortprüfung startest. Der aktuelle Standort wird rein lokal mit dem gespeicherten Heimatstandort verglichen.</div>
      </div>
      <div class="card">
        <div class="card-title">Welche Daten gehen an eine KI?</div>
        <div class="fs-14 text-dim">Falls du die KI aktivierst: nur der Heimkehrstatus (home / away / unknown) – niemals die exakten Koordinaten, niemals dein Name und niemals deine Adresse.</div>
      </div>
      <div class="card">
        <div class="card-title">Wie können Daten gelöscht werden?</div>
        <div class="fs-14 text-dim">Über „Einstellungen → Zurücksetzen". Du kannst entweder nur die Einstellungen oder das gesamte Nachtsystem inklusive Historie löschen.</div>
      </div>
    </div>`;
}

function renderTestView() {
  return `
    <header class="app-header">
      <h1>Testmodus</h1>
      <div class="sub">Simulation ohne echte Standortdaten</div>
    </header>
    <div class="view">
      <div class="card tight">
        <div class="btn-row">
          <button class="btn small" data-test="good-night">Gute Nacht</button>
          <button class="btn small" data-test="late-return">Verspätete Heimkehr</button>
        </div>
        <div class="btn-row mt-8">
          <button class="btn small" data-test="late-bedtime">Verspätete Schlafenszeit</button>
          <button class="btn small" data-test="confirm-violation">Verletzung bestätigen</button>
        </div>
        <div class="btn-row mt-8">
          <button class="btn small" data-test="multiple-violations">Mehrere Verstöße</button>
          <button class="btn small" data-test="finish-night">Nacht abschließen</button>
        </div>
        <div class="btn-row mt-8">
          <button class="btn small" data-test="reset-streak">Streak zurücksetzen</button>
          <button class="btn small" data-test="add-points">+10 Punkte</button>
        </div>
        <div class="btn-row mt-8">
          <button class="btn small" data-test="start-consequence">Konsequenz starten</button>
          <button class="btn small" data-test="end-consequence">Konsequenz beenden</button>
        </div>
      </div>

      <div class="section-title">Integrierte Tests</div>
      <button class="btn primary" data-test="run-tests">Alle Tests ausführen</button>
      <div class="card tight mt-16">
        <div id="test-results" class="mono fs-12 text-dim">Noch nicht ausgeführt.</div>
      </div>
    </div>`;
}

/* ---------------- Handlers ---------------- */

function attachHandlers(route) {
  root.querySelectorAll('[data-nav]').forEach((el) => {
    el.addEventListener('click', () => navigate(el.dataset.nav));
  });
  if (route === 'setup') attachSetupHandlers();
  if (route === 'night') attachNightHandlers();
  if (route === 'home') attachHomeHandlers();
  if (route === 'consequences') attachConsequenceHandlers();
  if (route === 'settings') attachSettingsHandlers();
  if (route === 'status') attachStatusHandlers();
  if (route === 'test') attachTestHandlers();
}

function attachSetupHandlers() {
  const st = ensureSetupState();

  root.querySelectorAll('[data-setup-field]').forEach((el) => {
    el.addEventListener('input', () => {
      const k = el.dataset.setupField;
      st.data[k] = el.type === 'number' ? +el.value : el.value;
      st.errors[k] = '';
      const p = el.closest('.field');
      if (p) p.classList.remove('invalid');
    });
  });

  const back = root.querySelector('[data-setup="back"]');
  if (back) back.addEventListener('click', () => { st.step = Math.max(0, st.step - 1); renderRoute('setup'); });

  const skipLoc = root.querySelector('[data-setup="skip-location"]');
  if (skipLoc) skipLoc.addEventListener('click', () => {
    st.data.locationSkipped = true; st.errors.location = ''; renderRoute('setup');
  });

  const locate = root.querySelector('[data-setup="locate"]');
  if (locate) locate.addEventListener('click', () => {
    locate.disabled = true; locate.textContent = '…';
    getCurrentPosition()
      .then((pos) => {
        st.data.homeLocation = { lat: pos.lat, lng: pos.lng };
        st.data.locationSkipped = false; st.errors.location = '';
      })
      .catch((e) => { st.errors.location = e.message || 'Standort konnte nicht ermittelt werden.'; })
      .then(() => renderRoute('setup'));
  });

  const next = root.querySelector('[data-setup="next"]');
  next.addEventListener('click', () => {
    const err = validateSetupStep(st);
    if (Object.keys(err).length > 0) { st.errors = err; renderRoute('setup'); return; }
    st.errors = {};
    if (st.step === 4) finalizeSetup(st);
    else { st.step++; renderRoute('setup'); }
  });
}

function attachNightHandlers() {
  const toggle = root.querySelector('[data-action="toggle-night"]');
  if (toggle) toggle.addEventListener('click', () => {
    const s = getState();
    if (s.night.active) {
      const snap = finishNight('manual');
      if (snap) applyNightEvaluation(snap).catch((e) => console.warn(e));
    } else {
      startNight('manual');
      renderRoute('night');
    }
  });

  const actual = root.querySelector('[data-action="actual-bedtime"]');
  if (actual) actual.addEventListener('change', () => {
    if (!isValidTime(actual.value)) return;
    registerBedtimeDelayed(actual.value, 'manual');
    toast('Schlafenszeit vermerkt.');
    renderRoute('night');
  });
}

function attachHomeHandlers() {
  const check = root.querySelector('[data-action="check-home"]');
  if (check) check.addEventListener('click', () => {
    const s = getState();
    if (!s.config.homeLocation) { toast('Kein Heimatstandort hinterlegt.'); return; }
    check.disabled = true; check.textContent = 'Prüfe…';
    getCurrentPosition()
      .then((pos) => {
        const status = computeHomeStatus(pos, s.config.homeLocation, s.config.homeRadius);
        s.night.returnStatus = status;
        save();
        toast('Status: ' + homeStatusLabel(status));
      })
      .catch((e) => {
        s.night.returnStatus = 'unknown';
        toast(e.message || 'Standort nicht verfügbar.');
      })
      .then(() => renderRoute('home'));
  });

  const imHome = root.querySelector('[data-action="im-home"]');
  if (imHome) imHome.addEventListener('click', () => {
    const s = getState();
    s.night.returnStatus = 'home';
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (s.night.active) registerLateReturn(timeStr, 'home');
    else s.night.actualReturnTime = timeStr;
    save();
    toast('Heimkehr erfasst.');
    renderRoute('home');
  });

  const setHome = root.querySelector('[data-action="set-home"]');
  if (setHome) setHome.addEventListener('click', () => {
    setHome.disabled = true; setHome.textContent = 'Ermittle…';
    getCurrentPosition()
      .then((pos) => {
        const s = getState();
        s.config.homeLocation = { lat: pos.lat, lng: pos.lng };
        save();
        toast('Heimatstandort gespeichert.');
      })
      .catch((e) => toast(e.message || 'Standort nicht verfügbar.'))
      .then(() => renderRoute('home'));
  });

  const saveRet = root.querySelector('[data-action="save-return"]');
  if (saveRet) saveRet.addEventListener('click', () => {
    const input = root.querySelector('[data-action="actual-return"]');
    if (!input || !isValidTime(input.value)) { toast('Bitte gültige Uhrzeit eingeben.'); return; }
    const s = getState();
    if (s.night.active) registerLateReturn(input.value, s.night.returnStatus);
    else s.night.actualReturnTime = input.value;
    save();
    toast('Gespeichert.');
    renderRoute('home');
  });
}

function attachConsequenceHandlers() {
  const btn = root.querySelector('[data-action="add-consequence"]');
  if (btn) btn.addEventListener('click', () => {
    const type = root.querySelector('[data-cons-field="type"]').value;
    const value = root.querySelector('[data-cons-field="value"]').value.trim();
    const days = +root.querySelector('[data-cons-field="days"]').value;
    const reason = root.querySelector('[data-cons-field="reason"]').value.trim();
    const s = getState();
    let oldVal = '', newVal = value;

    if (type === 'earlier_bedtime') {
      if (!isValidTime(value)) { toast('Bitte gültige Uhrzeit (HH:MM).'); return; }
      if (toMinutes(value) >= toMinutes(s.config.currentBedtime)) { toast('Neue Schlafenszeit muss früher sein.'); return; }
      const wake = currentWakeTime(s.config);
      const dur = sleepDurationMinutes(value, wake);
      if (dur < (s.config.consequenceRules.minSleepDurationMinutes || 420)) { toast('Schlafdauer zu kurz.'); return; }
      oldVal = s.config.currentBedtime;
    } else if (type === 'earlier_return_time') {
      if (!isValidTime(value)) { toast('Bitte gültige Uhrzeit (HH:MM).'); return; }
      if (toMinutes(value) >= toMinutes(s.config.currentReturnTime)) { toast('Neue Heimkehrzeit muss früher sein.'); return; }
      oldVal = s.config.currentReturnTime;
    } else if (!value) {
      toast('Bitte eine Beschreibung eingeben.'); return;
    }

    if (!days || days < 1 || days > 14) { toast('Dauer 1–14 Tage.'); return; }

    const cons = createConsequence(type, oldVal, newVal, days, reason || 'Manuell');
    applyConsequence(cons);
    toast('Konsequenz hinzugefügt.');
    renderRoute('consequences');
  });
}

function attachSettingsHandlers() {
  root.querySelectorAll('[data-settings-field]').forEach((el) => {
    el.addEventListener('change', () => {
      const path = el.dataset.settingsField;
      const s = getState();
      const value = el.type === 'checkbox' ? el.checked
                  : el.type === 'number' ? +el.value
                  : el.value;
      setNested(s, path, value);
      save();
    });
  });

  const saveBtn = root.querySelector('[data-action="save-settings"]');
  if (saveBtn) saveBtn.addEventListener('click', () => {
    const s = getState();
    const errors = [];
    if (!s.config.name || !s.config.name.trim()) errors.push('Name fehlt');
    if (!isValidTime(s.config.currentBedtime)) errors.push('Schlafenszeit ungültig');
    if (!isValidTime(s.config.currentReturnTime)) errors.push('Heimkehrzeit ungültig');
    if (isValidTime(s.config.currentBedtime) && isValidTime(s.config.weekdayWakeTime)) {
      const dur = sleepDurationMinutes(s.config.currentBedtime, s.config.weekdayWakeTime);
      if (dur < 360) errors.push('Schlafdauer unter 6 Stunden');
    }
    if (errors.length) { toast('Ungültig: ' + errors.join(', ')); return; }
    save();
    toast('Einstellungen gespeichert.');
  });

  const resetBtn = root.querySelector('[data-action="reset-options"]');
  if (resetBtn) resetBtn.addEventListener('click', openResetModal);
}

function attachStatusHandlers() {
  const clear = root.querySelector('[data-action="clear-last-error"]');
  if (clear) clear.addEventListener('click', () => {
    const s = getState();
    s.status.lastError = null;
    s.system.lastError = null;
    save();
    renderRoute('status');
  });
}

function attachTestHandlers() {
  root.querySelectorAll('[data-test]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.test;
      btn.disabled = true;
      runTest(t)
        .catch((e) => toast('Testfehler: ' + (e.message || e)))
        .then(() => {
          btn.disabled = false;
          if (t !== 'run-tests') renderRoute('test');
        });
    });
  });
}

/* ---------------- Reset Modal ---------------- */

function openResetModal() {
  openModal(
    `<h3>Zurücksetzen</h3><div class="modal-sub">Bitte wähle den Umfang.</div>
     <button class="btn" data-reset="settings">Nur aktuelle Einstellungen zurücksetzen</button>
     <button class="btn bad mt-8" data-reset="all">Gesamtes Nachtsystem zurücksetzen</button>
     <button class="btn ghost mt-8" data-reset="cancel">Abbrechen</button>`,
    (r) => {
      r.querySelector('[data-reset="settings"]').addEventListener('click', () => {
        const s = getState();
        const d = { ...s.config, name: '' };
        s.config = d;
        s.system.setupCompleted = false;
        save();
        closeModal();
        toast('Einstellungen zurückgesetzt.');
        navigate('setup');
      });
      r.querySelector('[data-reset="all"]').addEventListener('click', async () => {
        const { resetState } = await import('./state.js');
        resetState();
        closeModal();
        toast('Alles gelöscht.');
        // Nach Reset neu laden, damit saubere Baseline greift
        location.reload();
      });
      r.querySelector('[data-reset="cancel"]').addEventListener('click', closeModal);
    }
  );
}
