import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export type Bay = {
  id: string
  name: string
  lat: number
  lng: number
  goingelectric_id: number | null
  lock_id: string | null
  status: 'free' | 'held'
  held_by_me: boolean
  reservation_id: string | null
  expires_at: string | null
  server_now: string
}

let client: SupabaseClient | null = null

/** Browser-Client mit Publishable Key, oder null, wenn Supabase nicht konfiguriert ist. */
export function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) return null
  return (client ??= createClient(url, key))
}

/** Jeder Browser ist ein anonymer Gast; die Sitzung bleibt im localStorage. */
export async function ensureGuest(sb: SupabaseClient) {
  const { data } = await sb.auth.getSession()
  if (data.session) return data.session
  const { data: signedIn, error } = await sb.auth.signInAnonymously()
  if (error) throw error
  return signedIn.session
}

/** Übersetzt die RPC-Fehlercodes aus der Migration in Klartext. */
export function rpcErrorText(message: string) {
  const map: Record<string, string> = {
    bay_taken: 'Stellplatz ist schon reserviert.',
    bay_not_found: 'Stellplatz nicht gefunden.',
    reservation_not_found: 'Keine laufende eigene Reservierung gefunden.',
    not_authenticated: 'Nicht angemeldet.',
    request_id_conflict: 'Anfrage-ID gehört einem anderen Gast.',
    invalid_minutes: 'Ungültige Dauer.',
  }
  return map[message] ?? message
}
