// Demo-Profil (Autos, Plan, Trust Factor, gemeldete Bays) – für die Web-App und mit API-Key auch extern.
import { connection } from 'next/server'
import { apiAccess, json, preflight } from '@/lib/api-access'
import { readDemoProfile, updateDemoProfile } from '@/lib/demo-store'

export const OPTIONS = preflight

export async function GET(req: Request) {
  await connection()
  const { denied } = apiAccess(req)
  if (denied) return denied
  const profile = await readDemoProfile()
  return json({ profile, exists: profile !== null })
}

export async function PUT(req: Request) {
  const { denied } = apiAccess(req)
  if (denied) return denied
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return json({ error: 'JSON-Objekt erwartet' }, 400)
  return json({ profile: await updateDemoProfile(body) })
}
