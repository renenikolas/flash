import { describe, expect, test } from 'vitest'
import { buildReservation, parseNewReservation, ReservationError } from '../lib/reservation-store'
import { assignDueBays } from '../lib/station-reservations'

const NOW = new Date(2026, 9, 24, 9, 0).getTime()
const locks = [
  { id: 'lock-0002', name: 'Lock 0002' },
  { id: 'lock-0003', name: 'Lock 0003' },
]
const err = (fn: () => unknown) => {
  try {
    fn()
  } catch (e) {
    return e instanceof ReservationError ? [e.status, e.message] : e
  }
  return null
}

describe('API-Eingabe', () => {
  test('gültige Kurzreservierung, Kennzeichen wird vereinheitlicht', () => {
    expect(parseNewReservation({ stationId: 5, stationName: 'A', kind: 'quick', car: { plate: 'm ab 12' } }, 'api')).toMatchObject({
      stationId: 5,
      kind: 'quick',
      plan: 'free',
      car: { plate: 'M AB 12' },
      source: 'api',
    })
  })

  test.each([
    [{}, 'stationId'],
    [{ stationId: 1.5, kind: 'quick' }, 'stationId'],
    [{ stationId: 1, kind: 'lang' }, 'kind'],
    [{ stationId: 1, kind: 'scheduled' }, 'startsAt'],
    [{ stationId: 1, kind: 'quick', plan: 'gold' }, 'plan'],
    [{ stationId: 1, kind: 'quick', car: { plate: 'xx' } }, 'car.plate'],
  ])('ungültig: %j', (body, msg) => {
    expect(String((err(() => parseNewReservation(body, 'api')) as [number, string])[1])).toContain(msg)
  })
})

describe('buildReservation', () => {
  const input = (extra: object) => parseNewReservation({ stationId: 5, stationName: 'A', kind: 'quick', ...extra }, 'api')

  test('Termin mit Paid Plan: Gebühr, Quelle, Bay erst 30 min vorher', () => {
    const r = buildReservation(input({ kind: 'scheduled', startsAt: new Date(2026, 9, 24, 14, 0).toISOString(), plan: 'paid' }), [], locks, NOW)
    expect(r).toMatchObject({ feeBaseEur: 5, feeEur: 2.5, source: 'api', bayAssignAt: new Date(2026, 9, 24, 13, 30).toISOString() })
    expect(r.bay).toBeUndefined()
  })

  test('Termin in weniger als 30 min bekommt sofort einen Bay', () => {
    const r = buildReservation(input({ kind: 'scheduled', startsAt: new Date(2026, 9, 24, 9, 20).toISOString() }), [], locks, NOW)
    expect(r.bay?.lockId).toBe('lock-0002')
  })

  test('Bay-Vergabe 30 min vor dem Termin, nicht früher', () => {
    const t = buildReservation(input({ kind: 'scheduled', startsAt: new Date(2026, 9, 24, 14, 0).toISOString(), chargePoints: 3 }), [], locks, NOW)
    const busy = buildReservation(input({ stationId: 7, kind: 'scheduled', startsAt: new Date(2026, 9, 24, 13, 50).toISOString() }), [], locks, NOW)
    const before = assignDueBays([t, busy], locks, new Date(2026, 9, 24, 13, 0).getTime())
    expect(before.assigned).toEqual([])
    const at = assignDueBays([t, busy], locks, new Date(2026, 9, 24, 13, 30).getTime())
    expect(at.assigned.map((x) => [x.stationId, x.bay?.lockId, x.bay?.total])).toEqual([
      [5, 'lock-0002', 3],
      [7, 'lock-0003', 2],
    ])
    expect(at.list.every((x) => x.bay && x.bayAssignedAt)).toBe(true)
  })

  test('Kapazität zählt auch noch nicht zugeteilte Termine', () => {
    const start = new Date(2026, 9, 24, 14, 0).toISOString()
    const a = buildReservation(input({ stationId: 1, kind: 'scheduled', startsAt: start }), [], locks, NOW)
    const b = buildReservation(input({ stationId: 2, kind: 'scheduled', startsAt: start }), [a], locks, NOW)
    expect(err(() => buildReservation(input({ stationId: 3, kind: 'scheduled', startsAt: start }), [a, b], locks, NOW))).toEqual([
      409,
      'In diesem Zeitraum ist kein Bay mehr frei.',
    ])
  })

  test('zweite gleichzeitige Reservierung bekommt Bay 2, dritte keinen', () => {
    const a = buildReservation(input({ stationId: 1 }), [], locks, NOW)
    const b = buildReservation(input({ stationId: 2 }), [a], locks, NOW)
    expect(b.bay?.name).toBe('Bay 2')
    expect(err(() => buildReservation(input({ stationId: 3 }), [a, b], locks, NOW))).toEqual([409, 'In diesem Zeitraum ist kein Bay mehr frei.'])
  })

  test('TUM-Standort nur mit TUM-Flottenkennzeichen, dann ohne Gebühr', () => {
    expect((err(() => buildReservation(input({ stationId: -1, car: { plate: 'M-AB 12' } }), [], locks, NOW)) as [number])[0]).toBe(403)
    const r = buildReservation(input({ stationId: -1, car: { plate: 'T-UM-2026' } }), [], locks, NOW)
    expect(r).toMatchObject({ stationName: 'TUM Stammgelände', fleetCompany: 'TUM', feeEur: 0 })
  })

  test('Termin in der Vergangenheit wird abgelehnt', () => {
    expect(err(() => buildReservation(input({ kind: 'scheduled', startsAt: new Date(NOW - 60_000).toISOString() }), [], locks, NOW))).toEqual([
      400,
      'Der Termin liegt in der Vergangenheit.',
    ])
  })

  test('Bays = Ladepunkte der Station', () => {
    const four = buildReservation(input({ chargePoints: 4 }), [], locks, NOW)
    expect(four.bay).toMatchObject({ name: 'Bay 1', number: 1, total: 4 })
    const a = buildReservation(input({ stationId: 1 }), [], locks, NOW)
    const one = buildReservation(input({ stationId: 2, chargePoints: 1 }), [a], locks, NOW)
    expect(one.bay).toMatchObject({ name: 'Bay 1', number: 1, total: 1, lockId: 'lock-0003' })
    expect(buildReservation(input({}), [], locks, NOW).bay?.total).toBe(2) // ohne Angabe: Anzahl der Bügel
    expect(String((err(() => parseNewReservation({ stationId: 1, kind: 'quick', chargePoints: 0 }, 'api')) as [number, string])[1])).toContain('chargePoints')
  })

  test('Jonas Cafe: buchbar mit Vorteil, normale Gebühr, 2 Ladepunkte', () => {
    const r = buildReservation(input({ stationId: -2, stationName: undefined, kind: 'scheduled', startsAt: new Date(2026, 9, 24, 9, 20).toISOString() }), [], locks, NOW)
    expect(r).toMatchObject({ stationName: 'Jonas Cafe', perk: '50 % auf einen Americano, wenn du hier lädst', feeEur: 7, bay: { total: 2 } })
    expect(r.fleetCompany).toBeUndefined()
    expect((err(() => buildReservation(input({ stationId: -9 }), [], locks, NOW)) as [number])[0]).toBe(404)
  })
})
