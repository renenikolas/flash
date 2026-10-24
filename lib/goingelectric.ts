import { GE_CHARGEPOINTS_URL, TIMEOUT_MS } from './checks.mjs'

export type Plug = { type: string; powerKw: number; count: number }
export type Station = {
  id: number
  name: string
  lat: number
  lng: number
  address: string
  operator: string | null
  network: string | null
  plugs: Plug[]
  maxPowerKw: number
  url: string | null
  faultReport: boolean
}
export type StationList = { stations: Station[]; clusters: number; truncated: boolean }
export type BBox = { sw_lat: number; sw_lng: number; ne_lat: number; ne_lng: number }

// GoingElectric liefert `false` statt null für fehlende Texte.
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v))

function stationUrl(v: unknown) {
  const u = text(v)
  if (!u) return null
  const abs = u.startsWith('//') ? `https:${u}` : u
  return /^https?:\/\//.test(abs) ? abs : null
}

/** Macht aus der GoingElectric-Antwort eine kleine, stabile Struktur für die Karte. */
export function normalizeChargepoints(body: unknown): StationList {
  const b = (body ?? {}) as { status?: unknown; chargelocations?: unknown; startkey?: unknown }
  if (b.status !== 'ok') throw new Error(`GoingElectric-Antwortstatus "${String(b.status)}"`)
  const items = Array.isArray(b.chargelocations) ? b.chargelocations : []
  const stations: Station[] = []
  let clusters = 0
  for (const raw of items as Record<string, any>[]) {
    if (raw?.clustered) {
      clusters++
      continue
    }
    const lat = num(raw?.coordinates?.lat)
    const lng = num(raw?.coordinates?.lng)
    const id = num(raw?.ge_id)
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(id)) continue
    const plugs: Plug[] = (Array.isArray(raw.chargepoints) ? raw.chargepoints : [])
      .map((c: any) => ({ type: text(c?.type) ?? 'unbekannt', powerKw: num(c?.power) || 0, count: num(c?.count) || 1 }))
    const a = raw.address ?? {}
    stations.push({
      id,
      name: text(raw.name) ?? 'Ladestation',
      lat,
      lng,
      address: [text(a.street), [text(a.postcode), text(a.city)].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      operator: text(raw.operator),
      network: text(raw.network),
      plugs,
      maxPowerKw: Math.max(0, ...plugs.map((p) => p.powerKw)),
      url: stationUrl(raw.url),
      faultReport: Boolean(raw.fault_report),
    })
  }
  return { stations, clusters, truncated: Boolean(b.startkey) }
}

/** Ruft GoingElectric für einen Kartenausschnitt auf. Keine Speicherung, kein Cache. */
export async function fetchChargepoints(bbox: BBox, filters: { plugs?: string; minPower?: number }, key: string) {
  const params = new URLSearchParams({
    key,
    sw_lat: String(bbox.sw_lat),
    sw_lng: String(bbox.sw_lng),
    ne_lat: String(bbox.ne_lat),
    ne_lng: String(bbox.ne_lng),
  })
  if (filters.plugs) params.set('plugs', filters.plugs)
  if (filters.minPower) params.set('min_power', String(filters.minPower))
  const res = await fetch(`${GE_CHARGEPOINTS_URL}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`GoingElectric antwortet mit HTTP ${res.status}`)
  return normalizeChargepoints(await res.json())
}
