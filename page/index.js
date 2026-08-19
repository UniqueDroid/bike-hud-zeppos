import * as hmUI from '@zos/ui'
import { Geolocation, Vibrator } from '@zos/sensor'
import { setPageBrightTime } from '@zos/display'
import { getDeviceInfo } from '@zos/device'
import { px } from '@zos/utils'

// Der urspruengliche Entwurf ging von einem Geolocation-Sensor mit
// direktem res.speed-Feld aus (@zeppos/sensor, res.speed in onChange) -
// das gibt's in der echten Zepp OS API nicht. Geolocation liefert nur
// getLatitude()/getLongitude()/getStatus(), onChange() feuert ohne
// Payload. Geschwindigkeit/Distanz muessen selbst aus aufeinanderfolgenden
// Fixes berechnet werden (Haversine-Distanz / vergangene Zeit).
// War vorher ein Modul-Top-Level-Aufruf, der VOR Page()/build() lief -
// fehlte die Permission data:os.device.info (genau das war der Fall,
// im app.json ursprünglich nur device:os.geolocation deklariert), ist
// das gesamte Modul schon beim Laden gecrasht. Selbst "renderUI() zuerst
// in build()" half dagegen nicht, weil der Crash noch VOR build() lag.
// Jetzt in build() selbst, mit Fallback auf die bekannte PikeW-Aufloesung.
// Bekannte Screen-Groesse als Fallback, falls getDeviceInfo() aus
// irgendeinem Grund fehlschlaegt - PikeW/Bip Max: 432x514.
const FALLBACK_W = 432
const FALLBACK_H = 514
let W = FALLBACK_W
let H = FALLBACK_H

const COLOR = {
  bg: 0x000000,
  dim: 0x777777,
  dim2: 0x666666,
  speed: 0x00ff66,
  distance: 0x00e5ff,
  avg: 0xffb300,
}

const MIN_FIX_INTERVAL_MS = 800 // GPS-Fixes koennen schneller kommen als sinnvoll ist
const MIN_MOVE_M = 2 // unter dieser Distanz zwischen zwei Fixes: als Stillstand werten (GPS-Jitter)
const MILESTONE_KM = 5

function toRad(deg) {
  return (deg * Math.PI) / 180
}

// Distanz zwischen zwei Punkten in Metern (Erdradius 6371 km).
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

Page({
  state: {
    speedVal: null,
    distVal: null,
    avgVal: null,
    timeVal: null,
    statusVal: null,

    geo: null,
    vibrator: null,
    onGeoChange: null,

    startTime: 0,
    totalDistanceM: 0,
    currentSpeedKmh: 0,
    lastFix: null, // { lat, lon, t }
    timerInterval: null,
    lastMilestoneKm: 0,
  },

  build() {
    // getDeviceInfo() braucht data:os.device.info - die fehlte in
    // app.json (nur device:os.geolocation war deklariert), und da W/H
    // vorher ein Modul-Top-Level-Aufruf waren, ist das ganze Modul schon
    // beim Laden gecrasht, weit VOR build()/renderUI(). Jetzt hier drin,
    // defensiv, mit Fallback auf die bekannte PikeW-Aufloesung.
    try {
      const info = getDeviceInfo()
      W = info.width
      H = info.height
    } catch (e) {
      // W/H bleiben auf FALLBACK_W/FALLBACK_H
    }

    // renderUI() danach als erstes eigenes Widget-Erzeugen: Jans erstes
    // Testfoto zeigte nur den Statusbalken oben, sonst nichts - jede
    // riskante API vor der UI kann die ganze Seite mitreissen, wenn sie
    // wirft. Gleiche Lehre wie beim SystemInfo-Speicherplatz-Bug.
    this.renderUI()

    try {
      setPageBrightTime({ brightTime: 60 * 60 * 1000 })
    } catch (e) {
      // kosmetisch - Display schaltet dann halt normal ab, kein Blocker
    }

    this.state.startTime = Date.now()
    this.startClockTimer()

    try {
      this.state.geo = new Geolocation()
      this.state.vibrator = new Vibrator()
      this.startSensors()
    } catch (e) {
      this.state.statusVal.setProperty(hmUI.prop.TEXT, 'GPS nicht verfügbar')
    }
  },

  renderUI() {
    const M = px(20)

    // Jan: die Fahrzeit-Zeile war oben vom Statusbalken (App-Name+Uhrzeit)
    // angeschnitten - gleiches Muster wie beim Titel im Nuki-Projekt.
    // Beide Zeilen ein Stueck tiefer.
    this.state.timeVal = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 0,
      y: px(48),
      w: W,
      h: px(38),
      color: COLOR.dim,
      text_size: px(30),
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text: '00:00:00',
    })

    this.state.statusVal = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 0,
      y: px(88),
      w: W,
      h: px(28),
      color: COLOR.dim2,
      text_size: px(22),
      align_h: hmUI.align.CENTER_H,
      text: 'Suche GPS…',
    })

    this.state.speedVal = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 0,
      y: px(150),
      w: W,
      h: px(150),
      color: COLOR.speed,
      text_size: px(120),
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text: '0.0',
    })

    hmUI.createWidget(hmUI.widget.TEXT, {
      x: 0,
      y: px(300),
      w: W,
      h: px(24),
      color: COLOR.dim2,
      text_size: px(20),
      align_h: hmUI.align.CENTER_H,
      text: 'KM/H',
    })

    const colW = W / 2 - M * 1.5

    hmUI.createWidget(hmUI.widget.TEXT, {
      x: M,
      y: px(360),
      w: colW,
      h: px(20),
      color: COLOR.dim,
      text_size: px(18),
      align_h: hmUI.align.CENTER_H,
      text: 'DISTANZ',
    })
    this.state.distVal = hmUI.createWidget(hmUI.widget.TEXT, {
      x: M,
      y: px(384),
      w: colW,
      h: px(52),
      color: COLOR.distance,
      text_size: px(42),
      align_h: hmUI.align.CENTER_H,
      text: '0.00',
    })

    hmUI.createWidget(hmUI.widget.TEXT, {
      x: W - M - colW,
      y: px(360),
      w: colW,
      h: px(20),
      color: COLOR.dim,
      text_size: px(18),
      align_h: hmUI.align.CENTER_H,
      text: 'SCHNITT',
    })
    this.state.avgVal = hmUI.createWidget(hmUI.widget.TEXT, {
      x: W - M - colW,
      y: px(384),
      w: colW,
      h: px(52),
      color: COLOR.avg,
      text_size: px(42),
      align_h: hmUI.align.CENTER_H,
      text: '0.0',
    })
  },

  startSensors() {
    // Wrapper faengt Fehler pro Callback ab, statt dass ein einzelner
    // Fehlerhafter Fix den ganzen Listener (bzw. den setInterval-artigen
    // Callback-Mechanismus dahinter) lahmlegt - selbe Lehre wie bei
    // SystemInfos readDisk()-Bug.
    this.state.onGeoChange = () => {
      try {
        this.handleGeoChange()
      } catch (e) {
        this.state.statusVal.setProperty(hmUI.prop.TEXT, 'GPS-Fehler')
      }
    }
    this.state.geo.start()
    this.state.geo.onChange(this.state.onGeoChange)
  },

  handleGeoChange() {
    if (this.state.geo.getStatus() !== 'A') {
      this.state.statusVal.setProperty(hmUI.prop.TEXT, 'Suche GPS…')
      return
    }

    const lat = this.state.geo.getLatitude({ format: 'DD' })
    const lon = this.state.geo.getLongitude({ format: 'DD' })
    if (typeof lat !== 'number' || typeof lon !== 'number') return

    const now = Date.now()
    const prev = this.state.lastFix

    if (!prev) {
      this.state.lastFix = { lat, lon, t: now }
      this.state.statusVal.setProperty(hmUI.prop.TEXT, 'GPS aktiv')
      return
    }

    const dtMs = now - prev.t
    if (dtMs < MIN_FIX_INTERVAL_MS) return

    const distM = haversineMeters(prev.lat, prev.lon, lat, lon)
    this.state.lastFix = { lat, lon, t: now }
    this.state.statusVal.setProperty(hmUI.prop.TEXT, 'GPS aktiv')

    if (distM < MIN_MOVE_M) {
      // Stillstand/Jitter - Geschwindigkeit auf 0, aber nicht als
      // gefahrene Distanz mitzaehlen.
      this.state.currentSpeedKmh = 0
      this.state.speedVal.setProperty(hmUI.prop.TEXT, '0.0')
      return
    }

    const speedKmh = distM / 1000 / (dtMs / 1000 / 3600)
    this.state.currentSpeedKmh = speedKmh
    this.state.speedVal.setProperty(hmUI.prop.TEXT, speedKmh.toFixed(1))

    this.state.totalDistanceM += distM
    const totalKm = this.state.totalDistanceM / 1000
    this.state.distVal.setProperty(hmUI.prop.TEXT, totalKm.toFixed(2))

    const tripHours = (now - this.state.startTime) / 1000 / 3600
    if (tripHours > 0) {
      this.state.avgVal.setProperty(hmUI.prop.TEXT, (totalKm / tripHours).toFixed(1))
    }

    // Haptischer Impuls alle 5 km.
    const wholeKm = Math.floor(totalKm / MILESTONE_KM) * MILESTONE_KM
    if (wholeKm > 0 && wholeKm !== this.state.lastMilestoneKm) {
      this.state.lastMilestoneKm = wholeKm
      this.state.vibrator.start()
    }
  },

  startClockTimer() {
    this.state.timerInterval = setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - this.state.startTime) / 1000)
      const h = String(Math.floor(elapsedSec / 3600)).padStart(2, '0')
      const m = String(Math.floor((elapsedSec % 3600) / 60)).padStart(2, '0')
      const s = String(elapsedSec % 60).padStart(2, '0')
      this.state.timeVal.setProperty(hmUI.prop.TEXT, `${h}:${m}:${s}`)
    }, 1000)
  },

  onDestroy() {
    if (this.state.timerInterval) clearInterval(this.state.timerInterval)
    if (this.state.geo) {
      if (this.state.onGeoChange) this.state.geo.offChange(this.state.onGeoChange)
      this.state.geo.stop()
    }
    if (this.state.vibrator) this.state.vibrator.stop()
  },
})
