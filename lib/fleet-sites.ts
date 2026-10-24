// Firmenstandorte, die nur für Flottenfahrzeuge der jeweiligen Firma auf der Karte erscheinen.
// Reservierungen dort sind für die Fahrer kostenlos, die Firma trägt die Kosten – deshalb ohne Preise.
import type { Car } from './profile'
import type { Station } from './goingelectric'

export type FleetSite = Station & { company: string; label: string }

export const TUM_STAMMGELAENDE: [number, number] = [48.14903, 11.56794]

export const FLEET_SITES: FleetSite[] = [
  {
    id: -1, // negative IDs, damit sie nie mit GoingElectric-IDs kollidieren
    company: 'TUM',
    label: 'TUM',
    name: 'TUM Stammgelände',
    lat: TUM_STAMMGELAENDE[0],
    lng: TUM_STAMMGELAENDE[1],
    address: 'Arcisstraße 21, 80333 München',
    operator: 'Technische Universität München',
    network: null,
    plugs: [],
    maxPowerKw: 0,
    url: null,
    faultReport: false,
  },
]

/** Standorte für das aktuelle Auto: nur bei einem Flottenfahrzeug, nur die eigene Firma. */
export function fleetSitesFor(car: Car | null) {
  if (!car?.fleet || !car.company) return []
  return FLEET_SITES.filter((s) => s.company === car.company)
}

export const isFleetSiteId = (id: number) => id < 0
