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
const W = getDeviceInfo().width
const H = getDeviceInfo().height

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
    // renderUI() MUSS zuerst laufen: Jans erstes Testfoto zeigte nur den
    // Statusbalken oben, sonst nichts - build() ist offenbar genau hier
    // gecrasht (vermutlich new Geolocation(), da die GPS-Permission bei
    // der allerersten Installation noch nicht gewaehrt/abgefragt war),
    // bevor auch nur ein einziges eigenes Widget erzeugt wurde. Gleiche
    // Lehre wie beim SystemInfo-Speicherplatz-Bug: eine riskante API
    // niemals vor der UI aufrufen, sonst nimmt ein Crash dort die ganze
    // Seite mit.
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

    this.state.timeVal = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 0,
      y: px(30),
      w: W,
      h: px(30),
      color: COLOR.dim,
      text_size: px(24),
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text: '00:00:00',
    })

    this.state.statusVal = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 0,
      y: px(62),
      w: W,
      h: px(24),
      color: COLOR.dim2,
      text_size: px(18),
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
      h: px(44),
      color: COLOR.distance,
      text_size: px(34),
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
      h: px(44),
      color: COLOR.avg,
      text_size: px(34),
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
