// API-Schlüssel (GoingElectric, Ecurious) aus dem Menü der Web-App setzen.
// Antworten enthalten die Schlüssel nie im Klartext.
import { connection } from 'next/server'
import { apiAccess, json, preflight } from '@/lib/api-access'
import { EDITABLE_KEYS, maskedSettings, updateEnvLocal } from '@/lib/env-file'

export const OPTIONS = preflight

export async function GET(req: Request) {
  await connection()
  const { denied } = apiAccess(req)
  if (denied) return denied
  return json({ settings: maskedSettings() })
}

export async function PUT(req: Request) {
  const { denied } = apiAccess(req)
  if (denied) return denied
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return json({ error: 'JSON-Objekt erwartet' }, 400)
  // Nur geänderte, nicht leere Felder übernehmen.
  const updates = Object.fromEntries(
    EDITABLE_KEYS.filter((k) => typeof body[k] === 'string' && body[k].trim()).map((k) => [k, body[k] as string]),
  )
  if (typeof updates.ECURIOUS_BASE_URL === 'string' && !/^https?:\/\/\S+$/.test(updates.ECURIOUS_BASE_URL.trim())) {
    return json({ error: 'ECURIOUS_BASE_URL muss mit http:// oder https:// beginnen' }, 400)
  }
  await updateEnvLocal(updates)
  return json({ settings: maskedSettings(), changed: Object.keys(updates) })
}
