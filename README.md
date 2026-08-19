# Bike HUD

A high-contrast, minimalist GPS bike HUD for the **Amazfit Bip Max** (Zepp OS, device code `PikeW`, square display). Big neon speed readout, trip time, distance, average speed, and a haptic pulse every 5&nbsp;km.

Full concept: [`KONZEPT.md`](KONZEPT.md).

## Status (19.08.2026)

First build compiles clean. Not yet installed on a real device - GPS behavior (fix rate, accuracy, cold-start time) is unverified until then.

## About the source

Jan's concept doc came with near-complete boilerplate code already. It assumed a different (older/generic) Zepp OS API surface than what actually exists on-device, so most of the porting work was correcting API calls against the real SDK types (`node_modules/@zeppos/device-types`), not just wiring up the UI:

- **No `res.speed` from the GPS sensor.** The real `Geolocation` class (`@zos/sensor`) only exposes `getLatitude()`/`getLongitude()`/`getStatus()`; `onChange()` fires with no payload at all. Speed and distance are computed manually from consecutive fixes via the haversine formula, not read from a sensor field.
- **Wrong import namespace.** Boilerplate used `@zeppos/ui` / `@zeppos/sensor` / `@zeppos/display` - the real modern SDK namespace is `@zos/*`.
- **Wrong screen-on API.** `setPageBrightScreen({ time })` doesn't exist; the real function is `setPageBrightTime({ brightTime })` from `@zos/display`, in milliseconds, and resets itself automatically when the page is destroyed.
- **Wrong permission string** (`device:os.sensor.geolocation` → `device:os.geolocation`), and `os.sensor.vibrator`/`os.display` aren't real permission codes at all - vibration and screen-on-time don't require a declared permission.
- **Wrong device target.** Boilerplate assumed a round 480px display; the Bip Max is square, 432×514 (`PikeW`, deviceSource `11206915`) - same target setup as [SystemInfo](https://github.com/UniqueDroid/SystemInfo) and [SmartLock](https://github.com/UniqueDroid/Nuki-Smartlock-ZeppOS).
- **Distance/average logic redesigned.** The original derived distance by re-integrating its own (already approximate) speed value once per second - compounding error on top of error. Now distance is summed directly from each GPS fix's haversine delta, and average speed is `total distance / elapsed trip time`, not a running mean of per-second speed samples (which double-weights time spent stationary whenever the >1&nbsp;km/h gate lets a sample through inconsistently).

## Design principles

- **Big and legible over a moving bike, not a dashboard.** One huge number (speed), everything else small and out of the way.
- **No live value invented from an API that doesn't provide it** - GPS on this SDK gives position, not velocity. It's calculated, filtered against GPS jitter (`MIN_MOVE_M`) and fix-rate noise (`MIN_FIX_INTERVAL_MS`), same "measured vs. estimated" honesty principle as [SystemInfo](https://github.com/UniqueDroid/SystemInfo).

## Project structure

```
app.json               # Target "PikeW" (Amazfit Bip Max), permission: device:os.geolocation
app.js                  # App lifecycle
page/index.js             # Everything: UI, GPS handling, haversine calc, trip timer, vibration
assets/logo.svg              # Icon source (circular, per Zepp's store icon spec)
```

## Building

```
npm install
zeus build
```

Sideload-testing via a `zpkd1://` QR code works the same way as in [SmartLock](https://github.com/UniqueDroid/Nuki-Smartlock-ZeppOS) and [SystemInfo](https://github.com/UniqueDroid/SystemInfo) - see those repos for the full mechanism (must point at the inner `.zpk`, not the outer `.zab`; pin jsDelivr URLs to a commit SHA, not `@main`).

## Not implemented yet

- Real-device GPS testing - cold-start fix time, accuracy in motion, and whether `MIN_MOVE_M`/`MIN_FIX_INTERVAL_MS` need tuning are all unverified.
- App Store submission (placeholder `appId` 1008899, not yet registered on console.zepp.com).
