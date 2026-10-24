import type { NextRequest } from 'next/server'
import { describeError } from '@/lib/checks.mjs'
import { fetchChargepoints } from '@/lib/goingelectric'

// Reicht GoingElectric nur durch: keine Speicherung, keine DB-Kopie, Browser-Cache max. 60 s.
const MAX_SPAN_DEG = 0.5

export async function GET(req: NextRequest) {
  const key = process.env.GOINGELECTRIC_API_KEY
  if (!key) return Response.json({ error: 'GOINGELECTRIC_API_KEY fehlt (siehe .env.example)' }, { status: 503 })

  const q = req.nextUrl.searchParams
  const [sw_lat, sw_lng, ne_lat, ne_lng] = ['sw_lat', 'sw_lng', 'ne_lat', 'ne_lng'].map((k) => Number(q.get(k)))
  const valid =
    [sw_lat, sw_lng, ne_lat, ne_lng].every(Number.isFinite) &&
    Math.abs(sw_lat) <= 90 && Math.abs(ne_lat) <= 90 && sw_lat < ne_lat && sw_lng < ne_lng
  if (!valid) return Response.json({ error: 'sw_lat, sw_lng, ne_lat, ne_lng ungültig' }, { status: 400 })
  if (ne_lat - sw_lat > MAX_SPAN_DEG || ne_lng - sw_lng > MAX_SPAN_DEG) {
    return Response.json({ error: 'Bereich zu groß – bitte weiter hineinzoomen' }, { status: 400 })
  }

  const plugs = q.get('plugs') ?? ''
  const minPower = Number(q.get('min_power') ?? 0)
  if (!/^[\w ,.-]{0,100}$/.test(plugs) || !Number.isFinite(minPower) || minPower < 0) {
    return Response.json({ error: 'plugs oder min_power ungültig' }, { status: 400 })
  }

  try {
    const data = await fetchChargepoints({ sw_lat, sw_lng, ne_lat, ne_lng }, { plugs, minPower }, key)
    return Response.json(
      { ...data, source: { name: 'GoingElectric', url: 'https://www.goingelectric.de/stromtankstellen/' } },
      { headers: { 'Cache-Control': 'private, max-age=60' } },
    )
  } catch (err) {
    return Response.json({ error: describeError(err) }, { status: 502 })
  }
}
