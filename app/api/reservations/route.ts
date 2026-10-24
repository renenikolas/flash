// Reservierungen auflisten und anlegen – für die Web-App und für externe Server (siehe README "Reservierungs-API").
import { connection } from 'next/server'
import { apiAccess, json, preflight } from '@/lib/api-access'
import { listLocks } from '@/lib/ecurious'
import { createReservation, listReservations, parseNewReservation, ReservationError } from '@/lib/reservation-store'
import { syncWhitelistsSafe } from '@/lib/whitelist-sync'

export const OPTIONS = preflight

export async function GET(req: Request) {
  await connection()
  const { denied } = apiAccess(req)
  if (denied) return denied
  return json({ reservations: await listReservations() })
}

export async function POST(req: Request) {
  const { source, denied } = apiAccess(req)
  if (denied) return denied
  try {
    const input = parseNewReservation(await req.json().catch(() => null), source)
    // Bays sind die Ecurious-Locks; ist Ecurious nicht erreichbar, gibt es "Bay 1" ohne Bügel.
    const locks = await listLocks()
      .then((l) => l.locks)
      .catch(() => [])
    const reservation = await createReservation(input, locks)
    void syncWhitelistsSafe() // Kurzreservierung: Kennzeichen sofort auf die Whitelist
    return json({ reservation }, 201)
  } catch (err) {
    const status = err instanceof ReservationError ? err.status : 500
    return json({ error: (err as Error).message }, status)
  }
}
