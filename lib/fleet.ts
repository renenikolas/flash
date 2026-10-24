// Flottenfahrzeuge: Die Firma gibt einen Code aus, der ein festes Fahrzeug freischaltet.
// Nur serverseitig nutzen (über /api/fleet), damit die Codes nicht im Browser-Bundle landen.

export type FleetCar = { name: string; plate: string; company: string | null }

const FLEET_CODES: Record<string, FleetCar> = {
  FLOTTE1: { name: 'BMW i7', plate: 'T-UM-2026', company: 'TUM' },
}

/** Groß/klein und Leerzeichen egal: "flotte 1" = "FLOTTE 1" = "FLOTTE1". */
export function normalizeFleetCode(code: string) {
  return code.toUpperCase().replace(/[\s-]+/g, '')
}

export function lookupFleetCode(code: string): FleetCar | null {
  return FLEET_CODES[normalizeFleetCode(code)] ?? null
}
