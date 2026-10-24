import { describe, expect, test } from 'vitest'
import { normalizeChargepoints } from '../lib/goingelectric'

// Aufbau wie die GoingElectric-Antwort: fehlende Texte kommen als `false`, URLs ohne Schema.
const sample = {
  status: 'ok',
  startkey: 500,
  chargelocations: [
    {
      ge_id: 12345,
      name: 'Alexanderplatz',
      address: { city: 'Berlin', country: 'Deutschland', postcode: '10178', street: 'Alexanderstraße 1' },
      coordinates: { lat: 52.5219, lng: 13.4132 },
      chargepoints: [
        { type: 'Typ2', power: 22, count: 2 },
        { type: 'CCS', power: 150, count: 1 },
      ],
      network: false,
      operator: 'Stromnetz Berlin',
      url: '//www.goingelectric.de/stromtankstellen/Deutschland/Berlin/Alexanderplatz/12345/',
      fault_report: false,
      verified: true,
    },
    { clustered: true, clusterCount: 7, coordinates: { lat: 52.5, lng: 13.4 } },
    { ge_id: 2, name: false, address: { city: false, postcode: false, street: false }, coordinates: { lat: 'x', lng: 1 }, chargepoints: [] },
    {
      ge_id: 3,
      name: false,
      address: {},
      coordinates: { lat: 52.51, lng: 13.39 },
      chargepoints: [{ type: 'Schuko', power: 3.7, count: 1 }],
      url: 'javascript:alert(1)',
      fault_report: { created: 1700000000, description: 'defekt' },
    },
  ],
}

describe('normalizeChargepoints', () => {
  const { stations, clusters, truncated } = normalizeChargepoints(sample)

  test('übernimmt Ladeorte und überspringt Cluster und Einträge ohne gültige Koordinaten', () => {
    expect(stations.map((s) => s.id)).toEqual([12345, 3])
    expect(clusters).toBe(1)
    expect(truncated).toBe(true)
  })

  test('normalisiert Felder', () => {
    expect(stations[0]).toEqual({
      id: 12345,
      name: 'Alexanderplatz',
      lat: 52.5219,
      lng: 13.4132,
      address: 'Alexanderstraße 1, 10178 Berlin',
      operator: 'Stromnetz Berlin',
      network: null,
      plugs: [
        { type: 'Typ2', powerKw: 22, count: 2 },
        { type: 'CCS', powerKw: 150, count: 1 },
      ],
      maxPowerKw: 150,
      url: 'https://www.goingelectric.de/stromtankstellen/Deutschland/Berlin/Alexanderplatz/12345/',
      faultReport: false,
    })
  })

  test('false → Fallbacks, gefährliche URLs werden verworfen, Störung erkannt', () => {
    expect(stations[1]).toMatchObject({ name: 'Ladestation', address: '', url: null, faultReport: true, maxPowerKw: 3.7 })
  })

  test('kein startkey → nicht gekürzt; leere Liste ist ok', () => {
    expect(normalizeChargepoints({ status: 'ok', chargelocations: [], startkey: false })).toEqual({ stations: [], clusters: 0, truncated: false })
  })

  test('Fehlerstatus wirft', () => {
    expect(() => normalizeChargepoints({ status: 'error' })).toThrow(/error/)
  })
})
