/**
 * home.js – Standort-Helfer.
 * Verarbeitet Geodaten ausschließlich lokal.
 * Es werden keine Koordinaten an externe Systeme gesendet.
 */

/** Haversine-Distanz in Metern zwischen zwei Koordinaten. */
export function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Ist Geolocation in dieser Umgebung grundsätzlich nutzbar?
 * Auf file:// lehnen die meisten Browser Geolocation ab.
 */
export function geolocationAvailable() {
  return typeof navigator !== 'undefined'
    && 'geolocation' in navigator
    && location.protocol !== 'file:';
}

export function mapGeoError(err) {
  if (!err) return 'Standort konnte nicht bestimmt werden.';
  switch (err.code) {
    case 1: return 'Standortfreigabe wurde verweigert.';
    case 2: return 'Standort konnte nicht bestimmt werden (Position nicht verfügbar).';
    case 3: return 'Zeitüberschreitung bei der Standortbestimmung.';
    default: return err.message || 'Standort konnte nicht bestimmt werden.';
  }
}

/**
 * Fordert eine aktuelle Position an.
 * @returns {Promise<{lat:number, lng:number, accuracy:number, timestamp:number}>}
 */
export function getCurrentPosition(opts = {}) {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Geolocation wird von diesem Browser nicht unterstützt.'));
      return;
    }
    if (location.protocol === 'file:') {
      reject(new Error('Standort ist bei lokaler Datei nicht verfügbar (Browser-Einschränkung). Öffne die App über eine HTTPS-URL.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        timestamp: pos.timestamp
      }),
      (err) => reject(new Error(mapGeoError(err))),
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 30000,
        ...opts
      }
    );
  });
}

/**
 * Bestimmt den Heimkehrstatus.
 * @returns {'home'|'away'|'unknown'}
 */
export function computeHomeStatus(current, home, radiusMeters) {
  if (!current || !home
      || typeof current.lat !== 'number'
      || typeof home.lat !== 'number') {
    return 'unknown';
  }
  const d = haversineMeters(current.lat, current.lng, home.lat, home.lng);
  return d <= (radiusMeters || 50) ? 'home' : 'away';
}

export function homeStatusLabel(status) {
  switch (status) {
    case 'home': return 'Zuhause';
    case 'away': return 'Nicht zuhause';
    default: return 'Unbekannt';
  }
}
