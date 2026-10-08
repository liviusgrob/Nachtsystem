/**
 * storage.js – Kapselt die lokale Speicherung.
 * Kann später gegen IndexedDB / Remote ausgetauscht werden,
 * ohne dass sich die Aufrufer ändern müssen.
 *
 * Fallback: In-Memory, wenn localStorage nicht verfügbar ist
 * (z. B. file:// in manchen Browsern).
 */

const PREFIX = 'nachtsystem:';
let memory = {};
let usingMemory = false;
let probed = false;

function probe() {
  if (probed) return !usingMemory;
  probed = true;
  try {
    const k = PREFIX + '__probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    usingMemory = false;
    return true;
  } catch {
    usingMemory = true;
    console.warn('[storage] localStorage nicht verfügbar, nutze In-Memory.');
    return false;
  }
}

export const storage = {
  isPersistent() {
    probe();
    return !usingMemory;
  },

  get(key) {
    probe();
    try {
      if (!usingMemory) {
        const raw = localStorage.getItem(PREFIX + key);
        return raw ? JSON.parse(raw) : null;
      }
    } catch (e) {
      console.warn('[storage] get failed', e);
    }
    return memory[key] ? JSON.parse(JSON.stringify(memory[key])) : null;
  },

  set(key, value) {
    probe();
    try {
      if (!usingMemory) {
        localStorage.setItem(PREFIX + key, JSON.stringify(value));
        return true;
      }
    } catch (e) {
      console.warn('[storage] set failed', e);
    }
    memory[key] = JSON.parse(JSON.stringify(value));
    return true;
  },

  remove(key) {
    probe();
    try {
      if (!usingMemory) localStorage.removeItem(PREFIX + key);
    } catch {}
    delete memory[key];
  },

  clear() {
    probe();
    try {
      if (!usingMemory) {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(PREFIX)) keys.push(k);
        }
        keys.forEach((k) => localStorage.removeItem(k));
      }
    } catch {}
    memory = {};
  }
};
