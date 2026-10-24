// Hintergrund-Jobs des Servers, alle 15 s (gestartet in instrumentation.ts):
// 1. Termine bekommen 30 min vor Beginn ihren Bay.
// 2. Ecurious-Whitelists an die Reservierungen anpassen.
import { listLocks } from './ecurious'
import { assignDueBaysNow } from './reservation-store'
import { syncWhitelistsSafe } from './whitelist-sync'

export const TICK_MS = 15_000

async function assignBaysSafe() {
  try {
    const locks = await listLocks()
      .then((l) => l.locks)
      .catch(() => [])
    const assigned = await assignDueBaysNow(locks)
    for (const r of assigned) console.log(`[bays] ${r.stationName}: ${r.bay?.name} (${r.bay?.lockId ?? 'ohne Bügel'})`)
  } catch (err) {
    console.error(`[bays] Vergabe fehlgeschlagen: ${(err as Error).message}`)
  }
}

let running = false
async function tick() {
  if (running) return
  running = true
  try {
    await assignBaysSafe() // zuerst Bays, damit die Whitelist den neuen Bügel schon kennt
    await syncWhitelistsSafe()
  } finally {
    running = false
  }
}

export function startBackgroundJobs() {
  const g = globalThis as { __flashBackgroundTimer?: ReturnType<typeof setInterval> }
  if (g.__flashBackgroundTimer) return // nicht doppelt starten (Hot Reload)
  g.__flashBackgroundTimer = setInterval(tick, TICK_MS)
  void tick()
}
