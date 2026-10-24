// Hält die Ecurious-Whitelists passend zu den Reservierungen:
// im Reservierungsfenster nur das Kennzeichen der Reservierung, sonst wieder jedes Kennzeichen ("*").
// Läuft alle 15 s (lib/background.ts) und direkt nach jeder Buchung/Stornierung.
// Nur serverseitig; ändert echte Hardware-Konfiguration, daher nur mit ECURIOUS_COMMANDS_ENABLED=true.
import { ecuriousConfig, getWhitelists, sendCommand } from './ecurious'
import { listReservationsForWhitelist } from './reservation-store'
import { desiredWhitelists } from './station-reservations'

// Meldet Ecurious danach noch den alten Stand, denselben Befehl höchstens alle 2 min wiederholen,
// damit die Hardware nicht alle 15 s denselben Upload bekommt.
export const RESEND_AFTER_MS = 120_000
const lastSent = new Map<string, { want: string; at: number }>()

const same = (a: string[], b: string[]) => [...a].sort().join('\n') === [...b].sort().join('\n')

/** Sendet nur dort einen Whitelist-Befehl, wo Soll und Ist abweichen. */
export async function syncWhitelists(nowMs = Date.now()) {
  if (!ecuriousConfig().commandsEnabled) return { skipped: 'ECURIOUS_COMMANDS_ENABLED=false', changed: [] as string[] }
  const desired = desiredWhitelists(await listReservationsForWhitelist(), nowMs)
  const changed: string[] = []
  for (const lock of await getWhitelists()) {
    const want = desired.get(lock.id) ?? ['*']
    if (lock.whitelist && same(lock.whitelist, want)) continue
    const key = [...want].sort().join('\n')
    const prev = lastSent.get(lock.id)
    if (prev && prev.want === key && nowMs - prev.at < RESEND_AFTER_MS) continue
    lastSent.set(lock.id, { want: key, at: nowMs })
    await sendCommand(lock.id, want[0] === '*' && want.length === 1 ? { action: 'whitelist', wildcard: true } : { action: 'whitelist', plates: want })
    changed.push(`${lock.id}: ${want[0] === '*' ? 'jedes Kennzeichen' : `${want.length} Kennzeichen`}`)
  }
  return { skipped: null, changed }
}

// Nur ein Abgleich gleichzeitig; ein Fehler (z. B. Ecurious kurz weg) wird geloggt, der nächste Lauf versucht es erneut.
let running: Promise<unknown> | null = null
export function syncWhitelistsSafe() {
  running ??= syncWhitelists()
    .then((r) => {
      if (r.changed.length) console.log(`[whitelist] ${r.changed.join(', ')}`)
    })
    .catch((err) => console.error(`[whitelist] Abgleich fehlgeschlagen: ${(err as Error).message}`))
    .finally(() => {
      running = null
    })
  return running
}
