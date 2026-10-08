/**
 * notifications.js – Benachrichtigungen (optional).
 * Nutzt die Web-Notification-API. Kein Push-Server.
 * Ohne Freigabe passiert nichts – sauberer Fallback.
 */

import { getState, save } from './state.js';

export function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function notificationPermission() {
  return notificationsSupported() ? Notification.permission : 'unsupported';
}

/**
 * Fragt die Berechtigung an und speichert das Ergebnis in config.
 * @returns {Promise<'granted'|'denied'|'default'|'unsupported'>}
 */
export async function requestNotificationPermission() {
  if (!notificationsSupported()) return 'unsupported';
  try {
    const p = await Notification.requestPermission();
    const s = getState();
    s.config.notifications.enabled = p === 'granted';
    save();
    return p;
  } catch (e) {
    console.warn('[notifications] permission failed', e);
    return 'denied';
  }
}

/**
 * Zeigt eine Benachrichtigung an, wenn aktiviert und erlaubt.
 * @returns {boolean} true, wenn tatsächlich angezeigt
 */
export function notify(title, body, tag) {
  const s = getState();
  if (!s.config.notifications.enabled) return false;
  if (!notificationsSupported()) return false;
  if (Notification.permission !== 'granted') return false;

  try {
    new Notification(title, {
      body,
      tag,
      icon: 'icons/icon.svg'
    });
    return true;
  } catch (e) {
    console.warn('[notifications] failed', e);
    return false;
  }
}

/**
 * Registriert den Service Worker (PWA).
 * @returns {Promise<ServiceWorkerRegistration|null>}
 */
export async function registerSW() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  if (location.protocol === 'file:') return null;
  try {
    return await navigator.serviceWorker.register('service-worker.js');
  } catch (e) {
    console.warn('[sw] register failed', e);
    return null;
  }
}

export function swSupported() {
  return typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator
    && location.protocol !== 'file:';
}
