// Partner-Standorte: eigene Ladepunkte, die für alle auf der Karte erscheinen und einen Vorteil bieten.
// Buchbar wie GoingElectric-Stationen (normale Gebühren). Negative IDs ab -2, damit sie nie mit
// GoingElectric-IDs oder Flotten-Standorten (-1) kollidieren.
import type { Station } from './goingelectric'

export type PartnerSite = Station & { label: string; perk: string }

export const PARTNER_SITES: PartnerSite[] = [
  {
    id: -2,
    label: '☕ Jonas Cafe',
    name: 'Jonas Cafe',
    perk: '50 % auf einen Americano, wenn du hier lädst',
    // Testpunkt neben dem TUM Stammgelände
    lat: 48.15005,
    lng: 11.5703,
    address: 'Testpunkt nahe TUM Stammgelände, München',
    operator: 'Jonas Cafe',
    network: null,
    plugs: [{ type: 'Typ2', powerKw: 22, count: 2 }],
    maxPowerKw: 22,
    url: null,
    faultReport: false,
  },
]
