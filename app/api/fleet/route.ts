// Löst einen Firmencode in ein Flottenfahrzeug auf.
import { lookupFleetCode } from '@/lib/fleet'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const code = typeof body?.code === 'string' ? body.code.slice(0, 40) : ''
  if (!code.trim()) return Response.json({ error: 'Bitte den Firmencode eingeben.' }, { status: 400 })
  const car = lookupFleetCode(code)
  if (!car) return Response.json({ error: 'Unbekannter Firmencode.' }, { status: 404 })
  return Response.json({ car }, { headers: { 'Cache-Control': 'no-store' } })
}
