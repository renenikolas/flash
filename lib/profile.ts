// Profil: Plan und Trust Factor. Noch ohne Backend – die Werte kommen aus DEMO_PROFILE.

export type Plan = 'free' | 'paid'

/** Trust Factor als Score von 0 bis 100; ungültige Werte werden begrenzt. */
export function trustScore(score: number) {
  return Math.round(Math.min(100, Math.max(0, Number.isFinite(score) ? score : 0)))
}

export const DEMO_PROFILE = { plan: 'free' as Plan, trustFactor: 50 }

// Demo-Schalter im Profil: Trust Factor hoch (über 70 → keine No-Show-Gebühr) oder Standard (50).
export const HIGH_TRUST_FACTOR = 80
const TRUST_KEY = 'flash-trust'

export function loadTrust(): number {
  try {
    const v = Number(localStorage.getItem(TRUST_KEY))
    return localStorage.getItem(TRUST_KEY) !== null && Number.isFinite(v) ? trustScore(v) : DEMO_PROFILE.trustFactor
  } catch {
    return DEMO_PROFILE.trustFactor
  }
}

const PLAN_KEY = 'flash-plan'

/** Plan aus dem Browser – nur noch zum einmaligen Übernehmen ins Demo-Profil auf dem Server. */
export function loadPlan(): Plan {
  try {
    return localStorage.getItem(PLAN_KEY) === 'paid' ? 'paid' : DEMO_PROFILE.plan
  } catch {
    return DEMO_PROFILE.plan
  }
}

// ---------- Kennzeichen ----------

const PLATE_KEY = 'flash-plate'

/**
 * Prüft ein Kennzeichen und lässt es so, wie es eingegeben wurde – nur in Großbuchstaben und mit
 * einfachen Leerzeichen ("bn  2187" → "BN 2187"). Es werden keine Striche eingefügt.
 * Gibt null zurück, wenn es nicht wie ein Kennzeichen aussieht.
 */
export function normalizePlate(input: string) {
  const p = input.trim().toUpperCase().replace(/\s+/g, ' ')
  if (!/^[A-ZÄÖÜ0-9][A-ZÄÖÜ0-9 -]{0,10}[A-ZÄÖÜ0-9]$/.test(p)) return null
  if (!/[A-ZÄÖÜ]/.test(p) || !/\d/.test(p)) return null // mindestens ein Buchstabe und eine Ziffer
  return p
}

/** Für Vergleiche: "B-AB 1234" und "BAB1234" sind dasselbe Kennzeichen. */
export const samePlate = (a: string, b: string) => a.replace(/[\s-]+/g, '') === b.replace(/[\s-]+/g, '')

// ---------- Autos ----------

export type Car = { id: string; name: string; plate: string; fleet?: boolean; company?: string | null }
export type Garage = { cars: Car[]; activeId: string | null }

const CARS_KEY = 'flash-cars'

/** Beliebte E-Autos als Vorschläge im Eingabefeld; eigene Namen sind auch erlaubt. */
export const CAR_SUGGESTIONS = [
  'Tesla Model 3',
  'Tesla Model Y',
  'VW ID.3',
  'VW ID.4',
  'Skoda Enyaq',
  'Hyundai Ioniq 5',
  'Kia EV6',
  'BMW i4',
  'Mercedes EQA',
  'Renault Zoe',
  'Fiat 500e',
  'BYD Atto 3',
]

/**
 * Prüft ein neues Auto. Gibt das Auto oder einen Fehlertext zurück.
 * Das Kennzeichen darf nicht schon zu einem anderen eigenen Auto gehören.
 */
export function newCar(name: string, plateInput: string, existing: Car[], id: string): Car | string {
  const n = name.trim().replace(/\s+/g, ' ')
  if (!n) return 'Bitte Marke und Modell eingeben.'
  if (n.length > 40) return 'Name ist zu lang (höchstens 40 Zeichen).'
  const plate = normalizePlate(plateInput)
  if (!plate) return 'Bitte ein gültiges Kennzeichen eingeben, z. B. „BN 2187“.'
  if (existing.some((c) => samePlate(c.plate, plate))) return 'Dieses Kennzeichen hast du schon hinterlegt.'
  return { id, name: n, plate }
}

/** Flottenfahrzeug aus /api/fleet übernehmen; dasselbe Fahrzeug nicht doppelt. */
export function fleetCarToCar(
  fleet: { name: string; plate: string; company?: string | null },
  existing: Car[],
  id: string,
): Car | string {
  if (existing.some((c) => samePlate(c.plate, fleet.plate))) return 'Dieses Flottenfahrzeug hast du schon hinzugefügt.'
  return { id, name: fleet.name, plate: fleet.plate, fleet: true, company: fleet.company ?? null }
}

/** Entfernt ein Auto; war es das aktuelle, wird das erste verbleibende aktuell. */
export function removeCar(g: Garage, id: string): Garage {
  const cars = g.cars.filter((c) => c.id !== id)
  return { cars, activeId: g.activeId === id ? (cars[0]?.id ?? null) : g.activeId }
}

export function activeCar(g: Garage) {
  return g.cars.find((c) => c.id === g.activeId) ?? null
}

// Flottenautos, die vor der Firmen-Zuordnung gespeichert wurden, bekommen ihre Firma über das Kennzeichen.
const FLEET_COMPANY_BY_PLATE: Record<string, string> = { 'T-UM-2026': 'TUM' }

export const fleetCompanyForPlate = (plate: string) => FLEET_COMPANY_BY_PLATE[plate] ?? null

export function withFleetCompany(car: Car): Car {
  if (!car.fleet || car.company) return car
  return { ...car, company: FLEET_COMPANY_BY_PLATE[car.plate] ?? null }
}

/** Autos aus dem Browser (nur noch zum Übernehmen ins Demo-Profil); ein früher einzeln gespeichertes Kennzeichen wird zu "Mein Auto". */
export function loadGarage(): Garage {
  try {
    const raw = JSON.parse(localStorage.getItem(CARS_KEY) ?? 'null')
    if (raw && Array.isArray(raw.cars)) return { cars: raw.cars.map(withFleetCompany), activeId: raw.activeId ?? raw.cars[0]?.id ?? null }
    const oldPlate = localStorage.getItem('flash-plate')
    if (oldPlate) return { cars: [{ id: 'car-1', name: 'Mein Auto', plate: oldPlate }], activeId: 'car-1' }
  } catch {
    // ungültige Daten oder kein Speicher
  }
  return { cars: [], activeId: null }
}

