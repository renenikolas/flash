import { describe, expect, test } from 'vitest'
import { desiredWhitelists, quickReservation, scheduledReservation, type StationReservation, toLockPlate, toLocalInput } from '../lib/station-reservations'

const NOW = new Date(2026, 9, 24, 9, 0).getTime()
const MIN = 60_000
const bay1 = { name: 'Bay 1', lockId: 'lock-0002', lockName: 'Lock 0002' }
const bay2 = { name: 'Bay 2', lockId: 'lock-0003', lockName: 'Lock 0003' }
const withCar = (r: StationReservation, plate: string, bay = bay1): StationReservation => ({ ...r, bay, car: { name: 'Auto', plate } })
const scheduledAt = (startMs: number) => scheduledReservation(1, 'A', toLocalInput(startMs), NOW) as StationReservation

describe('Whitelist im Reservierungszeitraum', () => {
  test('Kennzeichen ohne Trennzeichen, wie von der Kamera', () => {
    expect(toLockPlate('M-AB 12')).toBe('MAB12')
    expect(toLockPlate('T-UM-2026')).toBe('TUM2026')
  })

  test('Kurzreservierung: genau 15 min', () => {
    const r = withCar(quickReservation(1, 'A', NOW), 'M-AB 12')
    expect(desiredWhitelists([r], NOW).get('lock-0002')).toEqual(['MAB12'])
    expect(desiredWhitelists([r], NOW + 14 * MIN).get('lock-0002')).toEqual(['MAB12'])
    expect(desiredWhitelists([r], NOW + 15 * MIN).has('lock-0002')).toBe(false)
  })

  test('Termin: 5 min davor bis 5 min nach dem Ende', () => {
    const start = NOW + 60 * MIN
    const r = withCar(scheduledAt(start), 'B-FL 4711')
    expect(desiredWhitelists([r], start - 6 * MIN).size).toBe(0)
    expect(desiredWhitelists([r], start - 5 * MIN).get('lock-0002')).toEqual(['BFL4711'])
    expect(desiredWhitelists([r], start + 19 * MIN).get('lock-0002')).toEqual(['BFL4711'])
    expect(desiredWhitelists([r], start + 20 * MIN).size).toBe(0) // 15 min Termin + 5 min Nachlauf
  })

  test('je Bügel getrennt; ohne Auto oder Bay keine Whitelist', () => {
    const a = withCar(quickReservation(1, 'A', NOW), 'M-AB 12', bay1)
    const b = withCar(quickReservation(2, 'B', NOW), 'T-UM-2026', bay2)
    const noCar = { ...quickReservation(3, 'C', NOW), bay: bay1 }
    const m = desiredWhitelists([a, b, noCar], NOW)
    expect(Object.fromEntries(m)).toEqual({ 'lock-0002': ['MAB12'], 'lock-0003': ['TUM2026'] })
  })
})
