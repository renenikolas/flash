// Eine Reservierung (pro Station höchstens eine) abrufen oder stornieren.
import { apiAccess, json, preflight } from '@/lib/api-access'
import { cancelReservation, getReservation } from '@/lib/reservation-store'
import { lateCancelRefundEur } from '@/lib/station-reservations'
import { syncWhitelistsSafe } from '@/lib/whitelist-sync'

export const OPTIONS = preflight

async function stationIdOf(ctx: RouteContext<'/api/reservations/[stationId]'>) {
  const id = Number((await ctx.params).stationId)
  return Number.isInteger(id) ? id : null
}

export async function GET(req: Request, ctx: RouteContext<'/api/reservations/[stationId]'>) {
  const { denied } = apiAccess(req)
  if (denied) return denied
  const id = await stationIdOf(ctx)
  if (id === null) return json({ error: 'Ungültige stationId' }, 400)
  const r = await getReservation(id)
  return r ? json({ reservation: r }) : json({ error: 'Keine Reservierung für diese Station' }, 404)
}

export async function DELETE(req: Request, ctx: RouteContext<'/api/reservations/[stationId]'>) {
  const { denied } = apiAccess(req)
  if (denied) return denied
  const id = await stationIdOf(ctx)
  if (id === null) return json({ error: 'Ungültige stationId' }, 400)
  const cancelled = await cancelReservation(id)
  if (!cancelled) return json({ error: 'Keine Reservierung für diese Station' }, 404)
  void syncWhitelistsSafe() // Storno: Bügel wieder für jedes Kennzeichen
  // Termin mit schon zugeteiltem Bay: die Hälfte der Gebühr zurück (Betrag nur angezeigt, keine Zahlung).
  return json({ cancelled: true, refundEur: lateCancelRefundEur(cancelled) })
}
