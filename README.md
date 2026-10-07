# Nachtsystem

> Persönliches Schlaf- und Heimkehrsystem als Progressive Web App.
> Rein lokal, offline-fähig, ohne Server, ohne Tracking.

---

## Was ist Nachtsystem?

**Nachtsystem** ist eine mobile Web-App, die dich dabei unterstützt,
feste Schlafens- und Heimkehrzeiten einzuhalten – ruhig, transparent
und ohne Kontrolle.

Die App verwaltet:

- **Schlafenszeiten** (unter der Woche und am Wochenende)
- **Heimkehrzeiten** mit optionalem Standortabgleich
- **Punkte und Streaks** für gute Nächte
- **Ereignisse** wie verspätete Heimkehr oder verzögerte Schlafenszeit
- **Konsequenzen** – als persönliche Regeln, nicht als Bestrafung
- **Historie** aller abgeschlossenen Nächte

Alles läuft **vollständig lokal im Browser**. Kein Backend, kein Tracking,
keine Werbung, keine Analyse.

---

## Funktionen

### Einrichtung
Ein geführter Setup-Assistent fragt beim ersten Start Name, Aufstehzeiten,
Schlafenszeiten, Heimkehrzeit und optional einen Heimatstandort ab.
Alle Eingaben werden validiert.

### Nachtruhe
Echte Zeitlogik erkennt, wann eine Nacht beginnt und endet. Die App
unterscheidet klar zwischen *geplanter* und *tatsächlicher* Schlafenszeit –
sie behauptet nicht, Schlaf messen zu können.

### Heimkehr
Mit gesetztem Heimatstandort und Standortfreigabe stellt die App fest,
ob du zuhause bist (Standard-Radius: 50 m). Ohne Freigabe bleibt der
Status sauber *unbekannt* – ohne automatischen Verstoß.

### Ereignissystem
Alle Vorkommnisse werden als Ereignisse erfasst und in drei Stufen
unterschieden: Ereignis → möglicher Verstoß → bestätigter Verstoß.

### Punkte und Streaks
- Gute Nacht: +10, +12, +14, +16, +18, dann +20 (Cap)
- Bestätigte Verstöße: -5 bis -20 (je nach Anzahl)
- Streak und Bestleistung werden getrennt geführt

### Konsequenzen
Transparente, begrenzte Anpassungen der geplanten Zeiten –
zum Beispiel: „Schlafenszeit für 2 Tage um 15 Minuten vorgezogen".
Konsequenzen werden niemals gesundheitsschädlich, verhindern niemals
ausreichende Schlafdauer und blockieren niemals Notfallfunktionen.

### Historie
Jede abgeschlossene Nacht wird mit geplanten und tatsächlichen Zeiten,
Ereignissen, Punkten, Streak und Konsequenzen gespeichert.

### Datenschutz
- Alle Daten liegen lokal in `localStorage`
- Standortdaten werden nur lokal verarbeitet
- Die genaue Heimatadresse wird niemals an eine KI gesendet
- Vollständige Löschung über die App möglich

### KI-Schnittstelle (optional)
Eine vorbereitete KI-Schnittstelle kann später eine externe API aufrufen.
Bis dahin läuft eine lokale Test-Auswertung. Der Sanitizer entfernt alle
Koordinaten und persönlichen Daten vor jedem Versand.

### Testmodus
Simulation von guten Nächten, verspäteten Heimkehren, Verstößen,
Konsequenzen und Reset-Szenarien – ohne echte Standortdaten.

---

## Technik

- **Vanilla JavaScript** – keine Frameworks, keine Build-Tools
- **Single-File-Architektur** – eine `index.html`
- **localStorage** mit In-Memory-Fallback
- **PWA-fähig** – installierbar auf iOS/Android
- **Mobile-First** – für iPhone optimiert
- **Dark Mode**

---

## Nutzung

### Als PWA (empfohlen)
1. URL auf dem iPhone in Safari öffnen
2. „Zum Home-Bildschirm" hinzufügen
3. Läuft als eigenständige App, offline-fähig

Bei HTTPS funktionieren Standort, Benachrichtigungen und PWA-Installation
vollständig.

### Lokal
1. `index.html` herunterladen
2. Im Browser öffnen
3. Fertig

**Einschränkungen bei lokaler Datei:**
- Standortzugriff in Safari meist blockiert
- Service Worker / PWA-Installation nicht möglich
- `localStorage` kann eingeschränkt sein (Fallback: In-Memory)

---

## Bewusste Einschränkungen

- **Schlaf kann nicht gemessen werden.** Die tatsächliche Schlafenszeit
  wird manuell eingetragen.
- **Benachrichtigungen** funktionieren im Browser nur bei geöffneter Seite.
- **Standort** benötigt HTTPS und Freigabe.
- **Konsequenzen** wirken nur als persönliche Regeln.

Es gibt keine Fake-Funktionen, keine „Coming Soon"-Buttons.

---

## Lizenz

MIT – siehe `LICENSE`.
