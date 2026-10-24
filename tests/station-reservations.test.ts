import { describe, expect, test } from 'vitest'
import { activeReservations, applyPlan, assignBay, bayPosition, lateCancelRefundEur, formatEur, noShowFeeEur, quickReservation, reservationFeeEur, scheduledReservation, type StationReservation, toLocalInput } from '../lib/station-reservations'

const NOW = new Date('2026-10-24T12:00:00Z').getTime()

describe('Ladesäulen-Reservierung', () => {
  test('Kurzreservierung: 15 min ab jetzt', () => {
    const r = quickReservation(1, 'A', NOW)
    expect(r.kind).toBe('quick')
    expect(Date.parse(r.endsAt) - Date.parse(r.startsAt)).toBe(15 * 60_000)
  })

  test('Termin für eine Uhrzeit, Platz 15 min freigehalten', () => {
    const start = toLocalInput(NOW + 86_400_000)
    const r = scheduledReservation(1, 'A', start, NOW)
    expect(typeof r).toBe('object')
    if (typeof r === 'string') return
    expect(r.kind).toBe('scheduled')
    expect(Date.parse(r.endsAt) - Date.parse(r.startsAt)).toBe(15 * 60_000)
  })

  test.each([
    ['', 'Bitte Datum'],
    [toLocalInput(NOW - 3_600_000), 'Vergangenheit'],
    [toLocalInput(NOW + 31 * 86_400_000), '30 Tage'],
  ])('ungültig: %s', (input, msg) => {
    expect(scheduledReservation(1, 'A', input, NOW)).toContain(msg)
  })

  test('abgelaufene fallen weg', () => {
    const old = quickReservation(1, 'A', NOW - 20 * 60_000)
    const fresh = quickReservation(2, 'B', NOW)
    expect(activeReservations([old, fresh], NOW)).toEqual([fresh])
  })
})

describe('assignBay', () => {
  const locks = [
    { id: 'lock-0002', name: 'Lock 0002' },
    { id: 'lock-0003', name: 'Lock 0003' },
  ]

  test('erster freier Lock', () => {
    expect(assignBay(quickReservation(1, 'A', NOW), [], locks)).toEqual({ name: 'Bay 1', lockId: 'lock-0002', lockName: 'Lock 0002', number: 1, total: 2 })
  })

  test('überlappende eigene Reservierung belegt den Lock', () => {
    const a = { ...quickReservation(1, 'A', NOW), bay: assignBay(quickReservation(1, 'A', NOW), [], locks)! }
    expect(assignBay(quickReservation(2, 'B', NOW), [a], locks)?.lockId).toBe('lock-0003')
    const b = { ...quickReservation(2, 'B', NOW), bay: { name: 'Bay 2', lockId: 'lock-0003', lockName: 'Lock 0003' } }
    expect(assignBay(quickReservation(3, 'C', NOW), [a, b], locks)).toBeNull()
  })

  test('ohne Überschneidung wieder frei, ohne Locks Bay 1', () => {
    const a = { ...quickReservation(1, 'A', NOW), bay: { name: 'Bay 1', lockId: 'lock-0002', lockName: 'Lock 0002' } }
    expect(assignBay(quickReservation(2, 'B', NOW + 3_600_000), [a], locks)?.lockId).toBe('lock-0002')
    expect(assignBay(quickReservation(2, 'B', NOW), [], [])).toEqual({ name: 'Bay 1', lockId: null, lockName: null, number: 1, total: 1 })
  })
})

describe('Gebühren', () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 25, h, m).getTime()

  test.each([
    [22, 0, 3],
    [23, 30, 3],
    [0, 0, 3],
    [5, 59, 3],
    [6, 0, 7],
    [12, 59, 7],
    [13, 0, 5],
    [16, 59, 5],
    [17, 0, 7],
    [21, 59, 7],
  ])('Termin um %i:%i → %i €', (h, m, fee) => {
    expect(reservationFeeEur(at(h, m))).toBe(fee)
  })

  test('No-Show: 2 €, ab Trust Factor über 70 frei', () => {
    expect(noShowFeeEur(50)).toBe(2)
    expect(noShowFeeEur(70)).toBe(2)
    expect(noShowFeeEur(71)).toBe(0)
  })

  test('Kurzreservierung kostenlos, Termin mit Gebühr', () => {
    expect(quickReservation(1, 'A', NOW).feeEur).toBe(0)
    const r = scheduledReservation(1, 'A', toLocalInput(at(14)), at(9))
    expect(typeof r !== 'string' && r.feeEur).toBe(5)
  })

  test('Paid Plan: 50 % auf alles, No-Show 1 €', () => {
    expect([3, 5, 7].map((v) => applyPlan(v, 'paid'))).toEqual([1.5, 2.5, 3.5])
    expect(applyPlan(7, 'free')).toBe(7)
    expect(noShowFeeEur(50, 'paid')).toBe(1)
    expect(noShowFeeEur(71, 'paid')).toBe(0)
    const r = scheduledReservation(1, 'A', toLocalInput(at(14)), at(9), 'paid')
    expect(typeof r !== 'string' && [r.feeBaseEur, r.feeEur, r.plan]).toEqual([5, 2.5, 'paid'])
  })

  test('Euro-Format mit Cent nur wenn nötig', () => {
    expect(formatEur(7).replace(/\s/g, ' ')).toBe('7 €')
    expect(formatEur(3.5).replace(/\s/g, ' ')).toBe('3,50 €')
  })

  test('Bay-Position für die Grafik, auch für ältere Reservierungen', () => {
    expect(bayPosition({ name: 'Bay 2', lockId: 'x', lockName: 'X', number: 2, total: 2 })).toEqual({ number: 2, total: 2 })
    expect(bayPosition({ name: 'Bay 2', lockId: 'x', lockName: 'X' })).toEqual({ number: 2, total: 2 })
    expect(bayPosition(undefined)).toEqual({ number: 1, total: 2 })
  })

  test('Storno nach Bay-Zuteilung: Hälfte zurück', () => {
    const bay = { name: 'Bay 1', lockId: 'lock-0001', lockName: 'Lock 0001' }
    const t = scheduledReservation(1, 'A', toLocalInput(at(14)), at(9), 'paid') as StationReservation
    expect(lateCancelRefundEur({ ...t, bay, bayAssignAt: 'x' })).toBe(1.25) // 2,50 € Gebühr
    expect(lateCancelRefundEur({ ...t, bayAssignAt: 'x' })).toBeNull() // noch kein Bay
    expect(lateCancelRefundEur({ ...quickReservation(1, 'A', NOW), bay })).toBeNull()
  })
})
