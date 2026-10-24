import { describe, expect, test } from 'vitest'
import { lookupFleetCode } from '../lib/fleet'

describe('Flotten-Code', () => {
  test.each(['FLOTTE 1', 'flotte 1', 'FLOTTE1', ' Flotte-1 '])('%s → BMW i7', (code) => {
    expect(lookupFleetCode(code)).toEqual({ name: 'BMW i7', plate: 'T-UM-2026', company: 'TUM' })
  })

  test.each(['', 'FLOTTE 2', 'FLOTTE'])('unbekannt: %s', (code) => {
    expect(lookupFleetCode(code)).toBeNull()
  })
})
