// Zugriff auf die Reservierungs-API.
// - Die eigene Web-App (gleicher Origin) braucht keinen Schlüssel.
// - Andere Server/Websites schicken "Authorization: Bearer <FLASH_API_KEY>".
// CORS ist offen ("*"), weil ohne gültigen Schlüssel ohnehin nichts geht und keine Cookies im Spiel sind.
import { timingSafeEqual } from 'node:crypto'

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '600',
}

export function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' } })
}

export const preflight = () => new Response(null, { status: 204, headers: CORS_HEADERS })

function keyMatches(given: string, expected: string) {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Woher kommt die Anfrage? null = abgelehnt (Antwort steht in `denied`). */
export function apiAccess(req: Request): { source: 'app' | 'api'; denied: null } | { source: null; denied: Response } {
  // Browser setzen Sec-Fetch-Site selbst; Seiten können das nicht fälschen.
  if (req.headers.get('sec-fetch-site') === 'same-origin') return { source: 'app', denied: null }

  const expected = process.env.FLASH_API_KEY ?? ''
  if (!expected) return { source: null, denied: json({ error: 'FLASH_API_KEY ist auf dem Server nicht gesetzt' }, 503) }
  const given = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!given || !keyMatches(given, expected)) {
    return { source: null, denied: json({ error: 'API-Key fehlt oder ist falsch (Header "Authorization: Bearer …")' }, 401) }
  }
  return { source: 'api', denied: null }
}
