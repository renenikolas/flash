// Check gegen die echte Supabase-DB. Ohne NEXT_PUBLIC_SUPABASE_* in .env.local wird er übersprungen.
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { describe, expect, test } from 'vitest'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

async function guest() {
  const client = createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await client.auth.signInAnonymously()
  if (error) throw error
  return client
}

describe.skipIf(!url || !key)('reserve_bay gegen die echte Supabase-DB', () => {
  test('zwei gleichzeitige Reservierungen: genau eine gewinnt', async (ctx) => {
    const [a, b] = await Promise.all([guest(), guest()])
    const { data: bays, error } = await a.rpc('list_bays')
    expect(error).toBeNull()
    const bay = bays?.[0]
    if (!bay) return ctx.skip('kein Stellplatz in der DB (Seed-Migration fehlt?)')
    if (bay.status !== 'free') return ctx.skip('Stellplatz ist gerade reserviert – später erneut versuchen')

    const requestIds = [randomUUID(), randomUUID()]
    const results = await Promise.all(
      [a, b].map((c, i) => c.rpc('reserve_bay', { bay_id: bay.id, minutes: 1, request_id: requestIds[i] })),
    )
    const winners = results.filter((r) => !r.error)
    const losers = results.filter((r) => r.error)
    expect(winners).toHaveLength(1)
    expect(losers[0].error?.message).toBe('bay_taken')

    const i = results.findIndex((r) => !r.error)
    const [winner, loser] = i === 0 ? [a, b] : [b, a]
    const reservationId = winners[0].data.id

    // Idempotent: dieselbe request_id liefert dieselbe Reservierung.
    const again = await winner.rpc('reserve_bay', { bay_id: bay.id, minutes: 1, request_id: requestIds[i] })
    expect(again.data?.id).toBe(reservationId)

    // Fremde Holds lassen sich nicht stornieren, der eigene schon (räumt auch gleich auf).
    expect((await loser.rpc('cancel_reservation', { id: reservationId })).error?.message).toBe('reservation_not_found')
    expect((await winner.rpc('cancel_reservation', { id: reservationId })).data?.status).toBe('cancelled')
  })
})
