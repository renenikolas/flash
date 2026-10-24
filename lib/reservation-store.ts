// Reservierungen auf dem Server, damit Web-App und externe Server (API) dieselben Daten sehen.
// Gespeichert in .data/reservations.json – reicht für den Prototyp, ersetzt keine Datenbank.
// Nur serverseitig importieren.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { FLEET_SITES } from './fleet-sites'
import { PARTNER_SITES } from './partner-sites'
import { fleetCompanyForPlate, normalizePlate, type Plan } from './profile'
import {
  activeReservations,
  assignDueBays,
  bayAssignTime,
  bayFor,
  overlaps,
  quickReservation,
  retainedReservations,
  scheduledReservation,
  type StationReservation,
} from './station-reservations'

const FILE = path.join(process.cwd(), '.data', 'reservations.json')

export type NewReservation = {
  stationId: number
  stationName?: string
  stationAddress?: string
  lat?: number
  lng?: number
  chargePoints?: number // Ladepunkte der Station → Anzahl der Bays
  kind: 'quick' | 'scheduled'
  startsAt?: string // ISO, nur bei "scheduled"
  plan?: Plan
  car?: { name?: string; plate: string } | null
  source: 'app' | 'api'
}

export class ReservationError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** Prüft einen JSON-Body (aus App oder API) und macht daraus eine NewReservation. */
export function parseNewReservation(body: unknown, source: NewReservation['source']): NewReservation {
  const b = (body ?? {}) as Record<string, unknown>
  const stationId = b.stationId
  if (typeof stationId !== 'number' || !Number.isInteger(stationId)) throw new ReservationError('stationId (Ganzzahl) fehlt')
  if (b.kind !== 'quick' && b.kind !== 'scheduled') throw new ReservationError('kind muss "quick" oder "scheduled" sein')
  if (b.kind === 'scheduled' && !str(b.startsAt, 40)) throw new ReservationError('startsAt (ISO-Zeit) fehlt für kind "scheduled"')
  if (b.plan !== undefined && b.plan !== 'free' && b.plan !== 'paid') throw new ReservationError('plan muss "free" oder "paid" sein')
  const cp = b.chargePoints
  if (cp !== undefined && (typeof cp !== 'number' || !Number.isInteger(cp) || cp < 1 || cp > 50)) {
    throw new ReservationError('chargePoints muss eine Ganzzahl von 1 bis 50 sein')
  }
  const car = b.car as Record<string, unknown> | null | undefined
  let parsedCar: NewReservation['car'] = null
  if (car) {
    const plate = typeof car.plate === 'string' ? car.plate.trim() : ''
    // Kennzeichen bleiben, wie eingegeben (nur Großbuchstaben, keine eingefügten Striche).
    const normalized = normalizePlate(plate)
    if (!normalized) throw new ReservationError('car.plate ist kein gültiges Kennzeichen')
    parsedCar = { name: str(car.name, 40), plate: normalized }
  }
  return {
    stationId,
    stationName: str(b.stationName, 120),
    stationAddress: str(b.stationAddress, 200),
    lat: num(b.lat),
    lng: num(b.lng),
    chargePoints: cp as number | undefined,
    kind: b.kind,
    startsAt: str(b.startsAt, 40),
    plan: (b.plan as Plan | undefined) ?? 'free',
    car: parsedCar,
    source,
  }
}

/**
 * Baut die Reservierung: Zeitraum, Gebühr, Bay. Ersetzt eine bestehende Reservierung
 * derselben Station. Reine Funktion, damit sie ohne Dateisystem testbar ist.
 */
export function buildReservation(
  input: NewReservation,
  existing: StationReservation[],
  locks: { id: string; name: string }[],
  nowMs = Date.now(),
): StationReservation {
  const site = FLEET_SITES.find((s) => s.id === input.stationId)
  const partner = PARTNER_SITES.find((s) => s.id === input.stationId)
  if (input.stationId < 0 && !site && !partner) throw new ReservationError('Unbekannter Standort', 404)
  if (site) {
    const company = input.car ? fleetCompanyForPlate(input.car.plate) : null
    if (company !== site.company) throw new ReservationError(`Nur für ${site.company}-Flottenfahrzeuge (car.plate fehlt oder passt nicht)`, 403)
  }
  const known = site ?? partner
  const name = known?.name ?? input.stationName
  if (!name) throw new ReservationError('stationName fehlt')

  const base =
    input.kind === 'quick'
      ? quickReservation(input.stationId, name, nowMs)
      : scheduledReservation(input.stationId, name, input.startsAt ?? '', nowMs, input.plan)
  if (typeof base === 'string') throw new ReservationError(base)

  const r: StationReservation = {
    ...base,
    stationAddress: known?.address ?? input.stationAddress,
    lat: known?.lat ?? input.lat,
    lng: known?.lng ?? input.lng,
    car: input.car ? { name: input.car.name ?? 'Auto', plate: input.car.plate } : null,
    source: input.source,
    createdAt: new Date(nowMs).toISOString(),
    chargePoints: input.chargePoints ?? (partner ? partner.plugs.reduce((n, p) => n + p.count, 0) : undefined),
    ...(partner && { perk: partner.perk }),
    // Flotten-Standort: die Firma zahlt, keine Preise.
    ...(site && { fleetCompany: site.company, feeEur: 0, feeBaseEur: 0 }),
  }
  const others = activeReservations(existing, nowMs).filter((x) => x.stationId !== r.stationId)
  // Kapazität: Es gibt so viele Bügel wie Locks – auch noch nicht zugeteilte Termine zählen mit.
  if (locks.length && others.filter((x) => overlaps(x, r)).length >= locks.length) {
    throw new ReservationError('In diesem Zeitraum ist kein Bay mehr frei.', 409)
  }
  // Termin: Bay wird erst 30 min vor Beginn vergeben (Hintergrund-Job, assignDueBays).
  if (bayAssignTime(r) > nowMs) return { ...r, bayAssignAt: new Date(bayAssignTime(r)).toISOString() }
  const bay = bayFor(r, others.filter((x) => x.bay), locks)
  if (!bay) throw new ReservationError('In diesem Zeitraum ist kein Bay mehr frei.', 409)
  return { ...r, bay, bayAssignedAt: new Date(nowMs).toISOString() }
}

// ---------- Datei ----------

async function readAll(): Promise<StationReservation[]> {
  try {
    const raw = JSON.parse(await readFile(FILE, 'utf8'))
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

async function writeAll(list: StationReservation[]) {
  await mkdir(path.dirname(FILE), { recursive: true })
  const tmp = `${FILE}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(list, null, 2))
  await rename(tmp, FILE) // atomar ersetzen
}

// Schreibzugriffe nacheinander, damit sich zwei gleichzeitige Buchungen nicht überschreiben.
let queue: Promise<unknown> = Promise.resolve()
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.catch(() => {})
  return run
}

export async function listReservations() {
  return activeReservations(await readAll())
}

export async function getReservation(stationId: number) {
  return (await listReservations()).find((r) => r.stationId === stationId) ?? null
}

/** Für den Whitelist-Abgleich: auch kürzlich beendete Termine (5 min Nachlauf). */
export async function listReservationsForWhitelist() {
  return retainedReservations(await readAll())
}

export function createReservation(input: NewReservation, locks: { id: string; name: string }[]) {
  return serialized(async () => {
    const all = retainedReservations(await readAll())
    const r = buildReservation(input, all, locks)
    // Abgelaufene bleiben bis Ende des Whitelist-Nachlaufs gespeichert; gleiche Station wird ersetzt.
    await writeAll([...all.filter((x) => x.stationId !== r.stationId), r])
    return r
  })
}

/** Vergibt fällige Bays und speichert sie. Gibt die frisch vergebenen Reservierungen zurück. */
export function assignDueBaysNow(locks: { id: string; name: string }[]) {
  return serialized(async () => {
    const all = retainedReservations(await readAll())
    const { list, assigned } = assignDueBays(all, locks)
    if (assigned.length) await writeAll(list)
    return assigned
  })
}

/** Die stornierte Reservierung, oder null, wenn es keine gab. */
export function cancelReservation(stationId: number) {
  return serialized(async () => {
    const all = retainedReservations(await readAll())
    const cancelled = all.find((x) => x.stationId === stationId) ?? null
    if (cancelled) await writeAll(all.filter((x) => x !== cancelled))
    return cancelled
  })
}
