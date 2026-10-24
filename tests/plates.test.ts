import { describe, expect, test } from 'vitest'
import { toLockView } from '../lib/ecurious'
import { maskPlate, maskPlatesDeep } from '../lib/plates.mjs'
import { parseSse, sanitizeSseMessage } from '../lib/sse.mjs'

describe('maskPlate', () => {
  test.each([
    ['M-AB 1234', 'M-AB***'],
    ['m ab 1234e', 'M AB***'],
    ['B12345', 'B***'],
    ['  B-XY  99 ', 'B-XY***'],
    ['HH-AB123H', 'HH-AB***'],
    ['AB-123-CD', 'AB***'],
    ['ABCDEFG', 'AB***'],
    ['12345', '***'],
    ['SCHWÄB-XY 1', 'SCHWÄB***'],
  ])('%s → %s', (input, expected) => {
    expect(maskPlate(input)).toBe(expected)
  })

  test('leere oder fehlende Werte → null', () => {
    expect(maskPlate('')).toBeNull()
    expect(maskPlate('   ')).toBeNull()
    expect(maskPlate(null)).toBeNull()
    expect(maskPlate(42)).toBeNull()
  })

  test('maskiert verschachtelt, lässt plateType stehen', () => {
    expect(maskPlatesDeep({ lockId: 'x', licensePlate: 'B-FL 4711', plateType: 'standard', nested: { plates: ['M-AB 1', 'B2'] } })).toEqual({
      lockId: 'x',
      licensePlate: 'B-FL***',
      plateType: 'standard',
      nested: { plates: ['M-AB***', 'B***'] },
    })
  })
})

describe('SSE-Weitergabe', () => {
  test('parst Ereignisse, ignoriert Kommentare, hält unvollständigen Rest zurück', () => {
    const { messages, rest } = parseSse(
      ': ping\n\nevent: photo_captured\ndata: {"type":"photo_captured","lockId":"l1","licensePlate":"M-AB 1234"}\n\nevent: status_change\ndata: {"lo',
    )
    expect(messages).toEqual([{ event: 'photo_captured', data: '{"type":"photo_captured","lockId":"l1","licensePlate":"M-AB 1234"}' }])
    expect(rest).toBe('event: status_change\ndata: {"lo')
  })

  test('Kennzeichen im Stream werden maskiert, Nicht-JSON verworfen', () => {
    const out = sanitizeSseMessage({ event: 'photo_captured', data: '{"lockId":"l1","licensePlate":"M-AB 1234"}' })
    expect(out).toBe('event: photo_captured\ndata: {"lockId":"l1","licensePlate":"M-AB***"}\n\n')
    expect(sanitizeSseMessage({ event: 'x', data: 'M-AB 1234' })).toBeNull()
  })
})

describe('Lock-Status-Alter', () => {
  const now = Date.parse('2026-10-24T12:00:00Z')
  const raw = { id: 'l1', status: 'raised', carPresence: 'vacant' }

  test('frisch (≤ 60 s) → Status wird übernommen', () => {
    const v = toLockView({ ...raw, lastSeenAt: '2026-10-24T11:59:30Z' }, now)
    expect(v).toMatchObject({ status: 'raised', carPresence: 'vacant', ageSec: 30, stale: false })
  })

  test('älter als 60 s oder ohne lastSeenAt → unbekannt', () => {
    expect(toLockView({ ...raw, lastSeenAt: '2026-10-24T11:58:59Z' }, now)).toMatchObject({ status: 'unknown', carPresence: 'unknown', stale: true })
    expect(toLockView({ ...raw, lastSeenAt: null }, now)).toMatchObject({ status: 'unknown', ageSec: null, stale: true })
  })
})
