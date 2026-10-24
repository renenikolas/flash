// API-Smoke-Checks, gemeinsam genutzt von scripts/check-apis.mjs und /api/health.
// Reines JS ohne Abhängigkeiten. Ausgaben enthalten nie Keys und nur maskierte Kennzeichen.
import { maskPlate } from './plates.mjs'
import { parseSse } from './sse.mjs'

export const TIMEOUT_MS = 5000
export const GE_CHARGEPOINTS_URL = 'https://api.goingelectric.de/r1.0/chargepoints/'

/**
 * @typedef {'GoingElectric' | 'Supabase' | 'Ecurious'} ApiGroup
 * @typedef {{ id: string, group: ApiGroup, name: string, ok: boolean, ms: number, detail: string, mock?: boolean }} CheckResult
 * @typedef {Record<string, string | undefined>} Env
 */

/** @param {unknown} err */
export function describeError(err) {
  const e = /** @type {any} */ (err)
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return `Timeout nach ${TIMEOUT_MS} ms`
  const code = e?.cause?.code
  return code ? `${e.message} (${code})` : String(e?.message ?? err)
}

/**
 * @param {string} id @param {ApiGroup} group @param {string} name
 * @param {() => Promise<string>} fn
 * @returns {Promise<CheckResult>}
 */
async function timed(id, group, name, fn) {
  const t0 = performance.now()
  try {
    const detail = await fn()
    return { id, group, name, ok: true, ms: Math.round(performance.now() - t0), detail }
  } catch (err) {
    return { id, group, name, ok: false, ms: Math.round(performance.now() - t0), detail: describeError(err) }
  }
}

/** Kurze Fehlermeldung aus einer Antwort, ohne den Body komplett auszugeben. @param {Response} res */
async function httpError(res) {
  let msg = ''
  try {
    const body = await res.json()
    msg = body?.message ?? body?.msg ?? body?.error_description ?? body?.error ?? ''
  } catch {}
  return new Error(`HTTP ${res.status}${msg ? `: ${String(msg).slice(0, 120)}` : ''}`)
}

/** @param {number | null | undefined} sec */
const ago = (sec) => (sec == null ? 'unbekannt' : sec < 120 ? `vor ${sec} s` : `vor ${Math.round(sec / 60)} min`)
/** @param {string | null | undefined} iso */
const ageSec = (iso) => {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isNaN(t) ? null : Math.max(0, Math.round((Date.now() - t) / 1000))
}

// ---------- GoingElectric ----------

/** @param {Env} env */
export function checkGoingElectric(env) {
  return timed('goingelectric', 'GoingElectric', 'GoingElectric', async () => {
    const key = env.GOINGELECTRIC_API_KEY
    if (!key) throw new Error('GOINGELECTRIC_API_KEY fehlt')
    const url = new URL(GE_CHARGEPOINTS_URL)
    url.search = new URLSearchParams({ key, lat: '52.52', lng: '13.405', radius: '5' }).toString()
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) throw await httpError(res)
    const body = await res.json()
    if (body?.status !== 'ok') throw new Error(`Antwortstatus "${body?.status}"`)
    const n = Array.isArray(body.chargelocations) ? body.chargelocations.length : 0
    return `${n} Ladeorte im 5-km-Umkreis Berlin-Mitte${body.startkey ? ' (weitere Seiten vorhanden)' : ''}`
  })
}

// ---------- Supabase ----------

/** @type {{ url: string, access_token: string, refresh_token: string, expires_at: number } | null} */
let session = null

/** Anonyme Sitzung holen und im Prozess wiederverwenden (Supabase limitiert anonyme Sign-ins pro IP). */
async function anonAccessToken(/** @type {string} */ url, /** @type {string} */ key, /** @type {AbortSignal} */ signal) {
  if (session?.url === url && session.expires_at * 1000 > Date.now() + 60_000) return session.access_token
  const headers = { apikey: key, 'Content-Type': 'application/json' }
  let res = null
  if (session?.url === url) {
    res = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST', headers, body: JSON.stringify({ refresh_token: session.refresh_token }), signal,
    })
  }
  if (!res?.ok) {
    res = await fetch(`${url}/auth/v1/signup`, { method: 'POST', headers, body: JSON.stringify({ data: {} }), signal })
  }
  if (!res.ok) throw new Error(`anonymer Login: ${(await httpError(res)).message}`)
  const s = await res.json()
  session = { url, access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at }
  return s.access_token
}

/** @param {Env} env */
export function checkSupabase(env) {
  return timed('supabase', 'Supabase', 'Supabase', async () => {
    const url = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '')
    const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL oder NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY fehlt')
    const signal = AbortSignal.timeout(TIMEOUT_MS)
    const token = await anonAccessToken(url, key, signal)
    const res = await fetch(`${url}/rest/v1/rpc/list_bays`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal,
    })
    if (!res.ok) throw new Error(`list_bays(): ${(await httpError(res)).message}`)
    const bays = await res.json()
    const held = bays.filter((/** @type {any} */ b) => b.status === 'held').length
    return `anonym eingeloggt, list_bays() → ${bays.length} Stellplatz/-plätze, ${held} reserviert`
  })
}

// ---------- Ecurious ----------

/** @param {Env} env */
function ecuriousConfig(env) {
  const base = env.ECURIOUS_BASE_URL?.replace(/\/+$/, '')
  const key = env.ECURIOUS_API_KEY
  if (!base || !key) throw new Error('ECURIOUS_BASE_URL oder ECURIOUS_API_KEY fehlt')
  return { base, key }
}

/** @param {Env} env @param {string} path @param {AbortSignal} signal */
async function ecuriousGet(env, path, signal) {
  const { base, key } = ecuriousConfig(env)
  return fetch(`${base}${path}`, { headers: { 'X-API-Key': key, Accept: 'application/json' }, signal })
}

/**
 * GET /api/v1/locks und danach /plate/latest für den Demo-Lock.
 * @param {Env} env
 * @returns {Promise<CheckResult[]>}
 */
export async function checkEcurious(env) {
  /** @type {string | null} */
  let lockId = null
  const locks = await timed('ecurious_locks', 'Ecurious', 'Ecurious /locks', async () => {
    const res = await ecuriousGet(env, '/api/v1/locks', AbortSignal.timeout(TIMEOUT_MS))
    if (!res.ok) throw await httpError(res)
    const body = await res.json()
    const list = Array.isArray(body?.locks) ? body.locks : []
    if (!list.length) return `Team ${body?.team ?? '?'}: keine Locks`
    const lock = list.find((/** @type {any} */ l) => l.id === env.ECURIOUS_LOCK_ID) ?? list[0]
    lockId = lock.id
    const age = ageSec(lock.lastSeenAt)
    const state = age == null || age > 60 ? 'Status unbekannt (veraltet)' : `${lock.status}/${lock.carPresence}`
    return `${list.length} Lock(s); ${lock.name ?? lock.id} [${lock.id}]: ${state}, lastSeenAt ${ago(age)}`
  })

  const plate = await timed('ecurious_plate', 'Ecurious', 'Ecurious plate/latest', async () => {
    if (!lockId) throw new Error(locks.ok ? 'kein Lock vorhanden' : 'übersprungen, /locks fehlgeschlagen')
    const res = await ecuriousGet(env, `/api/v1/locks/${encodeURIComponent(lockId)}/plate/latest`, AbortSignal.timeout(TIMEOUT_MS))
    if (res.status === 404) return 'noch kein Kennzeichen erkannt'
    if (!res.ok) throw await httpError(res)
    const body = await res.json()
    return `letztes Kennzeichen ${maskPlate(body?.licensePlate) ?? '–'} (${ago(ageSec(body?.timestamp))})`
  })
  return [locks, plate]
}

/**
 * Öffnet GET /api/v1/events und zählt Ereignisse, bis insgesamt TIMEOUT_MS vergangen sind.
 * listenMs = 0 prüft nur, ob der Stream öffnet (für /api/health).
 * @param {Env} env @param {number} listenMs
 */
export function checkEcuriousEvents(env, listenMs) {
  return timed('ecurious_sse', 'Ecurious', 'Ecurious SSE', async () => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), Math.min(listenMs || TIMEOUT_MS, TIMEOUT_MS))
    try {
      const { base, key } = ecuriousConfig(env)
      const res = await fetch(`${base}/api/v1/events`, {
        headers: { 'X-API-Key': key, Accept: 'text/event-stream' },
        signal: ctrl.signal,
      })
      if (!res.ok) throw await httpError(res)
      const type = res.headers.get('content-type') ?? ''
      if (!type.includes('text/event-stream')) throw new Error(`kein SSE-Stream (Content-Type ${type || 'leer'})`)
      if (!listenMs || !res.body) {
        await res.body?.cancel()
        return 'Stream offen'
      }
      /** @type {Record<string, number>} */
      const counts = {}
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
      let buffer = ''
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          const parsed = parseSse(buffer + value)
          buffer = parsed.rest
          for (const m of parsed.messages) counts[m.event] = (counts[m.event] ?? 0) + 1
        }
      } catch (err) {
        if (!ctrl.signal.aborted) throw err
      }
      const total = Object.values(counts).reduce((a, b) => a + b, 0)
      const types = Object.entries(counts).map(([k, v]) => `${k}×${v}`).join(', ')
      const seconds = Math.min(listenMs, TIMEOUT_MS) / 1000
      return `${total} Events in ${seconds} s${types ? ` (${types})` : ''}`
    } finally {
      clearTimeout(timer)
    }
  })
}

// ---------- Alle ----------

/**
 * @param {Env} env
 * @param {{ sseListenMs?: number, ecuriousMock?: boolean }} [opts]
 * @returns {Promise<CheckResult[]>}
 */
export async function runChecks(env, { sseListenMs = TIMEOUT_MS, ecuriousMock = false } = {}) {
  /** @type {(id: string, name: string) => CheckResult} */
  const mock = (id, name) => ({ id, group: 'Ecurious', name, ok: true, ms: 0, mock: true, detail: 'Mock-Daten (ECURIOUS_MOCK=true)' })
  const [ge, sb, ec, sse] = await Promise.all([
    checkGoingElectric(env),
    checkSupabase(env),
    ecuriousMock
      ? [mock('ecurious_locks', 'Ecurious /locks'), mock('ecurious_plate', 'Ecurious plate/latest')]
      : checkEcurious(env),
    ecuriousMock ? mock('ecurious_sse', 'Ecurious SSE') : checkEcuriousEvents(env, sseListenMs),
  ])
  return [ge, sb, ...ec, sse]
}
