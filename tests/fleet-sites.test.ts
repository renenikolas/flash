import { describe, expect, test } from 'vitest'
import { fleetSitesFor } from '../lib/fleet-sites'

describe('Flotten-Standorte', () => {
  test('TUM-Flottenauto sieht das Stammgelände', () => {
    expect(fleetSitesFor({ id: 'f', name: 'BMW i7', plate: 'T-UM-2026', fleet: true, company: 'TUM' }).map((s) => s.label)).toEqual(['TUM'])
  })

  test('eigenes Auto, andere Firma oder kein Auto: nichts', () => {
    expect(fleetSitesFor({ id: 'a', name: 'Kia EV6', plate: 'M-EV 6' })).toEqual([])
    expect(fleetSitesFor({ id: 'g', name: 'X', plate: 'X', fleet: true, company: 'ACME' })).toEqual([])
    expect(fleetSitesFor(null)).toEqual([])
  })
})
