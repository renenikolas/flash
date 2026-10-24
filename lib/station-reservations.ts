// Reservierungen für Ladesäulen aus GoingElectric: Zeiträume, Gebühren, Bay-Vergabe.
// Gespeichert werden sie auf dem Server (lib/reservation-store.ts).
import type { Plan } from './profile'

export const QUICK_MINUTES = 15
// Ein Termin gilt für eine Uhrzeit; so lange wird der Platz danach freigehalten.
export const HOLD_MINUTES = 15
export const MAX_DAYS_AHEAD = 30

// ---------- Gebühren ----------
// Kurzreservierung: kostenlos, Stornieren immer kostenlos.
// No-Show: wer nicht innerhalb der 15 min kommt, zahlt 2 € – außer bei Trust Factor über 70.
// Termin: Reservierungsgebühr nach Uhrzeit (lokale Zeit des Termins).
// Paid Plan: 50 % auf alles, also auch No-Show nur 1 €.
export const NO_SHOW_FEE_EUR = 2
export const PAID_DISCOUNT = 0.5
export const NO_SHOW_WAIVED_ABOVE_TRUST = 70

// Eigene Gebühren je Station (Stationen ohne Eintrag: Standardtarif unten).
// Jonas Cafe (-2): nur 20–8 Uhr 2 €, tagsüber kostenlos.
export const STATION_FEES: Record<number, { from: number; to: number; eur: number; label: string }> = {
  [-2]: { from: 20, to: 8, eur: 2, label: '20–8 Uhr' },
}

/** 22–6 Uhr: 3 €, 13–17 Uhr: 5 €, sonst 7 € – außer die Station hat einen eigenen Tarif. */
export function reservationFeeEur(startMs: number, stationId?: number) {
  const h = new Date(startMs).getHours()
  const own = stationId === undefined ? undefined : STATION_FEES[stationId]
  if (own) return (own.from > own.to ? h >= own.from || h < own.to : h >= own.from && h < own.to) ? own.eur : 0
  if (h >= 22 || h < 6) return 3
  if (h >= 13 && h < 17) return 5
  return 7
}

/** Preis nach Plan: auf dem Paid Plan 50 % Rabatt. */
export function applyPlan(baseEur: number, plan: Plan) {
  return plan === 'paid' ? baseEur * (1 - PAID_DISCOUNT) : baseEur
}

/** No-Show-Gebühr ohne Rabatt; 0 ab Trust Factor über 70. Mit applyPlan auf den Plan umrechnen. */
export function noShowBaseEur(trustFactor: number) {
  return trustFactor > NO_SHOW_WAIVED_ABOVE_TRUST ? 0 : NO_SHOW_FEE_EUR
}

export function noShowFeeEur(trustFactor: number, plan: Plan = 'free') {
  return applyPlan(noShowBaseEur(trustFactor), plan)
}

const eurWhole = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const eurCents = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })
/** "7 €", aber "3,50 €" */
export const formatEur = (v: number) => (Number.isInteger(v) ? eurWhole : eurCents).format(v)

export type Bay = { name: string; lockId: string | null; lockName: string | null; number?: number; total?: number }

export type StationReservation = {
  stationId: number
  stationName: string
  stationAddress?: string
  lat?: number
  lng?: number
  kind: 'quick' | 'scheduled'
  startsAt: string // ISO
  endsAt: string // ISO
  bay?: Bay // wird beim Buchen vergeben (assignBay)
  feeEur?: number // Reservierungsgebühr nach Rabatt; Kurzreservierung 0
  feeBaseEur?: number // ohne Rabatt, zum Durchstreichen
  plan?: Plan // Plan beim Buchen
  fleetCompany?: string // Flotten-Standort: ohne Preise
  perk?: string // Vorteil des Partner-Standorts, z. B. Rabatt im Café
  car?: { name: string; plate: string } | null // Auto beim Buchen
  source?: 'app' | 'api' // über die Web-App oder die externe API gebucht
  createdAt?: string // ISO
  chargePoints?: number // Ladepunkte der Station = Anzahl der Bays in der Grafik
  bayAssignAt?: string // ISO: Termin bekommt seinen Bay erst zu diesem Zeitpunkt (30 min vorher)
  bayAssignedAt?: string // ISO: wann der Bay feststand (für die Benachrichtigung)
}

// Termine bekommen ihren Bay erst 30 Minuten vor Beginn.
export const BAY_ASSIGN_BEFORE_MINUTES = 30

/** Zeitpunkt, ab dem der Bay vergeben wird: Kurzreservierung sofort, Termin 30 min vor Beginn. */
export function bayAssignTime(r: StationReservation) {
  return r.kind === 'quick' ? Date.parse(r.startsAt) : Date.parse(r.startsAt) - BAY_ASSIGN_BEFORE_MINUTES * 60_000
}

/**
 * Bay für eine Reservierung: Bügel (Lock) wie bei assignBay, Anzahl der Bays = Ladepunkte der Station.
 * `others` sind die übrigen Reservierungen; nur die mit Bay belegen einen Bügel.
 */
export function bayFor(r: StationReservation, others: StationReservation[], locks: { id: string; name: string }[]): Bay | null {
  const bay = assignBay(r, others, locks)
  if (!bay) return null
  const total = r.chargePoints ?? bay.total ?? 1
  const number = Math.min(bay.number ?? 1, total)
  return { ...bay, name: `Bay ${number}`, number, total }
}

// Storno nach der Bay-Zuteilung (aus dem Popup "Schaffst du es noch?"): die Hälfte der Gebühr zurück.
export const LATE_CANCEL_REFUND_SHARE = 0.5

/** Erstattung beim Storno eines Termins, dessen Bay schon feststeht; sonst null (keine Regel). */
export function lateCancelRefundEur(r: StationReservation) {
  if (r.kind !== 'scheduled' || !r.bay || !r.bayAssignAt) return null
  return Math.round((r.feeEur ?? 0) * LATE_CANCEL_REFUND_SHARE * 100) / 100
}

/**
 * Vergibt fällige Bays (Termine ab 30 min vor Beginn). Gibt die neue Liste und die
 * frisch vergebenen Reservierungen zurück. Reservierungen, für die kein Bügel frei ist, bleiben offen.
 */
export function assignDueBays(list: StationReservation[], locks: { id: string; name: string }[], nowMs = Date.now()) {
  const assigned: StationReservation[] = []
  const next = [...list]
  for (let i = 0; i < next.length; i++) {
    const r = next[i]
    if (r.bay || Date.parse(r.endsAt) <= nowMs || bayAssignTime(r) > nowMs) continue
    const bay = bayFor(r, next.filter((x, j) => j !== i && x.bay), locks)
    if (!bay) continue
    next[i] = { ...r, bay, bayAssignedAt: new Date(nowMs).toISOString() }
    assigned.push(next[i])
  }
  return { list: next, assigned }
}

export const overlaps = (a: StationReservation, b: StationReservation) =>
  Date.parse(a.startsAt) < Date.parse(b.endsAt) && Date.parse(b.startsAt) < Date.parse(a.endsAt)

/**
 * Vergibt einen Bay: der erste Ecurious-Lock, der im gewünschten Zeitraum nicht schon
 * durch eine eigene Reservierung belegt ist. Ohne Locks gibt es "Bay 1" ohne Bügel.
 * null = alle Bays in dem Zeitraum belegt.
 */
export function assignBay(
  r: StationReservation,
  existing: StationReservation[],
  locks: { id: string; name: string }[],
): Bay | null {
  if (!locks.length) return { name: 'Bay 1', lockId: null, lockName: null, number: 1, total: 1 }
  const taken = new Set(existing.filter((x) => x.stationId !== r.stationId && overlaps(x, r)).map((x) => x.bay?.lockId))
  const i = locks.findIndex((l) => !taken.has(l.id))
  return i === -1 ? null : { name: `Bay ${i + 1}`, lockId: locks[i].id, lockName: locks[i].name, number: i + 1, total: locks.length }
}

// ---------- Whitelist-Fenster ----------
// Im Reservierungszeitraum steht nur das Kennzeichen der Reservierung auf der Whitelist des Bügels.
// Kurzreservierung: genau der Zeitraum. Termin: 5 min davor bis 5 min danach.
export const WHITELIST_BUFFER_MINUTES = 5

export function whitelistWindow(r: StationReservation) {
  const buffer = r.kind === 'scheduled' ? WHITELIST_BUFFER_MINUTES * 60_000 : 0
  return { from: Date.parse(r.startsAt) - buffer, to: Date.parse(r.endsAt) + buffer }
}

/** Reservierungen, deren Whitelist-Fenster noch nicht vorbei ist (inkl. Nachlauf). */
export function retainedReservations(list: StationReservation[], nowMs = Date.now()) {
  return list.filter((r) => whitelistWindow(r).to > nowMs)
}

/** Kennzeichen so, wie die Kamera es liefert: ohne Bindestriche und Leerzeichen ("M-AB 12" → "MAB12"). */
export const toLockPlate = (plate: string) => plate.toUpperCase().replace(/[\s-]+/g, '')

/**
 * Soll-Whitelist je Bügel: Kennzeichen aller Reservierungen, deren Fenster gerade läuft.
 * Bügel ohne laufendes Fenster fehlen in der Map → dort gilt wieder "jedes Kennzeichen" (Wildcard).
 */
export function desiredWhitelists(list: StationReservation[], nowMs = Date.now()) {
  const out = new Map<string, string[]>()
  for (const r of list) {
    const { from, to } = whitelistWindow(r)
    const lockId = r.bay?.lockId
    if (!lockId || !r.car?.plate || nowMs < from || nowMs >= to) continue
    const plates = out.get(lockId) ?? []
    const plate = toLockPlate(r.car.plate)
    if (!plates.includes(plate)) plates.push(plate)
    out.set(lockId, plates)
  }
  return out
}

/** Nummer des Bays und Anzahl aller Bays am Standort; für ältere Reservierungen aus dem Namen ("Bay 2"). */
export function bayPosition(bay: Bay | undefined) {
  const number = bay?.number ?? Number(bay?.name.match(/\d+/)?.[0] ?? 1)
  return { number, total: Math.max(bay?.total ?? 2, number) }
}

/** Die nächste laufende oder kommende Reservierung. */
export function nextReservation(list: StationReservation[], nowMs = Date.now()) {
  return activeReservations(list, nowMs).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0] ?? null
}

export function isRunning(r: StationReservation, nowMs = Date.now()) {
  return Date.parse(r.startsAt) <= nowMs && nowMs < Date.parse(r.endsAt)
}

export function quickReservation(stationId: number, stationName: string, nowMs = Date.now()): StationReservation {
  return {
    stationId,
    stationName,
    kind: 'quick',
    feeEur: 0,
    startsAt: new Date(nowMs).toISOString(),
    endsAt: new Date(nowMs + QUICK_MINUTES * 60_000).toISOString(),
  }
}

/**
 * Termin-Reservierung aus einem <input type="datetime-local">-Wert (lokale Zeit).
 * Gibt einen Fehlertext zurück, wenn der Termin ungültig ist.
 */
export function scheduledReservation(
  stationId: number,
  stationName: string,
  localDateTime: string,
  nowMs = Date.now(),
  plan: Plan = 'free',
): StationReservation | string {
  const start = new Date(localDateTime).getTime()
  if (!localDateTime || Number.isNaN(start)) return 'Bitte Datum und Uhrzeit wählen.'
  if (start < nowMs) return 'Der Termin liegt in der Vergangenheit.'
  if (start > nowMs + MAX_DAYS_AHEAD * 86_400_000) return `Höchstens ${MAX_DAYS_AHEAD} Tage im Voraus.`
  return {
    stationId,
    stationName,
    kind: 'scheduled',
    feeEur: applyPlan(reservationFeeEur(start, stationId), plan),
    feeBaseEur: reservationFeeEur(start, stationId),
    plan,
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + HOLD_MINUTES * 60_000).toISOString(),
  }
}

/** Abgelaufene Reservierungen fallen weg. */
export function activeReservations(list: StationReservation[], nowMs = Date.now()) {
  return list.filter((r) => Date.parse(r.endsAt) > nowMs)
}

const dateFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })
const timeFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' })

/** "13:30" */
export const formatTime = (iso: string) => timeFmt.format(new Date(iso))

/** Kurzreservierung "heute bis 14:45", Termin "heute um 18:00" bzw. "Sa., 25.10. um 18:00" */
export function formatSlot(r: StationReservation, nowMs = Date.now()) {
  const start = new Date(r.startsAt)
  const day = start.toDateString() === new Date(nowMs).toDateString() ? 'heute' : dateFmt.format(start)
  return r.kind === 'quick' ? `${day} bis ${timeFmt.format(new Date(r.endsAt))}` : `${day} um ${timeFmt.format(start)}`
}

/** Wert für <input type="datetime-local"> in lokaler Zeit, auf 5 min gerundet. */
export function toLocalInput(ms: number) {
  const d = new Date(Math.ceil(ms / 300_000) * 300_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
