/**
 * app.js – Einstiegspunkt.
 * Lädt State, startet UI, richtet Hintergrundaufgaben ein.
 */

import { loadState, getState, subscribe, logError } from './state.js';
import { initUI, renderRoute, currentRoute } from './ui.js';
import { checkConsequenceExpiry } from './consequences.js';
import { checkNightAutoStart } from './night.js';
import { registerSW } from './notifications.js';

async function boot() {
  try {
    await loadState();
  } catch (e) {
    console.error('load failed', e);
  }

  initUI();

  subscribe(() => {
    try {
      renderRoute(currentRoute());
    } catch (e) {
      logError(e);
    }
  });

  window.addEventListener('error', (e) => logError(e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => logError(e.reason));

  if (!location.hash) {
    location.hash = getState().system.setupCompleted ? '#/dashboard' : '#/setup';
  }

  renderRoute(currentRoute());

  try { checkConsequenceExpiry(); } catch (e) { logError(e); }
  try { checkNightAutoStart(); } catch (e) { logError(e); }

  setInterval(() => {
    try { checkConsequenceExpiry(); } catch (e) { logError(e); }
    try { checkNightAutoStart(); } catch (e) { logError(e); }
  }, 60000);

  registerSW();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
