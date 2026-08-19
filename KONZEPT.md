# ZeppOS Bike HUD Mini-App

Ein kontraststarkes, minimalistisches GPS-Bike-HUD für Amazfit Smartwatches (Zepp OS).

## Features
- **High-Contrast AMOLED Layout:** Reines Schwarz mit Neon-Grün (`#00FF66`), Cyan (`#00E5FF`) und Amber (`#FFB300`).
- **Live-GPS Speed:** Auswertung in km/h mit automatischer Filterung von Stillstands-Drift.
- **Trip-Tracking:** Fahrzeit, Gesamtdistanz und Durchschnittsgeschwindigkeit.
- **Haptischer Meilenstein-Alarm:** Kurze Vibration alle 5 km.
- **Always-On Wake Lock:** Display bleibt während der Fahrt dauerhaft an.

## Projektstruktur
```
bike-hud/
├── app.json
├── app.js
├── package.json
├── README.md
└── page/
    └── index.js
```

## Bauen und Installieren
1. Zepp CLI installieren (falls noch nicht geschehen):
   ```bash
   npm install -g @zeppos/zepp-cli
   ```
2. Im Projektordner Abhängigkeiten auflösen:
   ```bash
   npm install
   ```
3. App kompilieren / Vorschau auf Device oder Simulator starten:
   ```bash
   zepp build
   zepp preview
   ```
