import { describe, expect, test } from 'vitest'
import { activeCar, fleetCarToCar, newCar, withFleetCompany, normalizePlate, removeCar, trustScore } from '../lib/profile'

describe('trustScore', () => {
  test.each([
    [50, 50],
    [0, 0],
    [100, 100],
    [-5, 0],
    [150, 100],
    [NaN, 0],
    [49.6, 50],
  ])('%d → %d', (input, expected) => {
    expect(trustScore(input)).toBe(expected)
  })
})

describe('normalizePlate', () => {
  test.each([
    ['BN 2187', 'BN 2187'],
    ['bn  2187', 'BN 2187'],
    ['b ab 1234', 'B AB 1234'],
    ['M-XY 99', 'M-XY 99'],
    ['MAB12', 'MAB12'],
    ['T-UM-2026', 'T-UM-2026'],
  ])('%s → %s (keine eingefügten Striche)', (input, expected) => {
    expect(normalizePlate(input)).toBe(expected)
  })

  test.each(['', '1234', 'ABCD', 'B-', 'B AB 1234567890', 'B_AB 1'])('ungültig: %s', (input) => {
    expect(normalizePlate(input)).toBeNull()
  })
})

describe('Autos', () => {
  const tesla = { id: 'a', name: 'Tesla Model 3', plate: 'B-FL 4711' }
  const zoe = { id: 'b', name: 'Renault Zoe', plate: 'M-XY 12' }

  test('neues Auto: Name und Kennzeichen werden vereinheitlicht', () => {
    expect(newCar('  VW   ID.3 ', 'b ab 1234', [], 'c')).toEqual({ id: 'c', name: 'VW ID.3', plate: 'B AB 1234' })
  })

  test.each([
    ['', 'B-AB 1', 'Marke'],
    ['VW ID.3', 'xx', 'gültiges Kennzeichen'],
    ['VW ID.3', 'bfl4711', 'schon hinterlegt'],
  ])('ungültig: %s / %s', (name, plate, msg) => {
    expect(newCar(name, plate, [tesla], 'c')).toContain(msg)
  })

  test('aktuelles Auto entfernen → erstes verbleibendes wird aktuell', () => {
    const g = { cars: [tesla, zoe], activeId: 'a' }
    expect(activeCar(g)).toBe(tesla)
    expect(removeCar(g, 'a')).toEqual({ cars: [zoe], activeId: 'b' })
    expect(removeCar({ cars: [zoe], activeId: 'b' }, 'b')).toEqual({ cars: [], activeId: null })
    expect(removeCar(g, 'b').activeId).toBe('a')
  })

  test('Flottenfahrzeug: wird markiert, nicht doppelt', () => {
    const fleet = { name: 'BMW i7', plate: 'T-UM-2026', company: 'TUM' }
    const car = fleetCarToCar(fleet, [tesla], 'f')
    expect(car).toEqual({ id: 'f', name: 'BMW i7', plate: 'T-UM-2026', fleet: true, company: 'TUM' })
    expect(fleetCarToCar(fleet, [tesla, car as never], 'g')).toContain('schon hinzugefügt')
  })

  test('altes Flottenauto ohne Firma bekommt TUM über das Kennzeichen', () => {
    expect(withFleetCompany({ id: 'f', name: 'BMW i7', plate: 'T-UM-2026', fleet: true }).company).toBe('TUM')
    expect(withFleetCompany(tesla)).toBe(tesla)
  })
})
