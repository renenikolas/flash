// Serverseitiger Zugriff auf die Ecurious Parking-Lock-API. Nie im Browser importieren.
import { describeError, TIMEOUT_MS } from './checks.mjs'
import { maskPlate } from './plates.mjs'

export const STALE_AFTER_SEC = 60

export type RawLock = {
  id: string
  name?: string
  serialHex?: string
  hasCamera?: boolean
  status?: string
  carPresence?: string
  battery12V?: number
  battery3_7V?: number
  signalStrength4G?: number
  waterIngress?: boolean
  activeErrors?: unknown[]
  lastSeenAt?: string | null
  whitelist?: string[] // "*" = jedes Kennzeichen
}

export type LockView = {
  id: string
  name: string
  hasCamera: boolean
  status: 'raised' | 'lowered' | 'moving' | 'unknown'
  carPresence: 'vacant' | 'occupied' | 'unknown'
  lastSeenAt: string | null
  ageSec: number | null
  stale: boolean
  battery12V: number | null
  signalStrength4G: number | null
  waterIngress: boolean
  activeErrors: string[]
}

export type PlateView = { masked: string | null; timestamp: string | null; plateType: string | null }

export type Command =
  | { action: 'lock' | 'unlock'; cancelAutoLift?: boolean }
  | { action: 'keep-state'; state: 'normal' | 'keep_open' | 'keep_closed' }
  | { action: 'whitelist'; plates?: string[]; wildcard?: boolean }

export class EcuriousError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message)
  }
}

export function ecuriousConfig() {
  const env = process.env
  return {
    base: env.ECURIOUS_BASE_URL?.replace(/\/+$/, '') ?? '',
    key: env.ECURIOUS_API_KEY ?? '',
    lockId: env.ECURIOUS_LOCK_ID || null,
    mock: env.ECURIOUS_MOCK === 'true',
    commandsEnabled: env.ECURIOUS_COMMANDS_ENABLED === 'true',
    adminToken: env.FLASH_ADMIN_TOKEN ?? '',
  }
}

/** Lock-IDs kommen aus der API; wir lassen nur harmlose Zeichen in den Pfad. */
export function assertLockId(id: string) {
  if (!/^[\w-]{1,128}$/.test(id)) throw new EcuriousError('Ungültige Lock-ID', 400)
  return id
}

/** Status älter als 60 s gilt als unbekannt. */
export function toLockView(raw: RawLock, nowMs = Date.now()): LockView {
  const seen = raw.lastSeenAt ? Date.parse(raw.lastSeenAt) : NaN
  const ageSec = Number.isNaN(seen) ? null : Math.max(0, Math.round((nowMs - seen) / 1000))
  const stale = ageSec === null || ageSec > STALE_AFTER_SEC
  const status = raw.status === 'raised' || raw.status === 'lowered' || raw.status === 'moving' ? raw.status : 'unknown'
  const presence = raw.carPresence === 'vacant' || raw.carPresence === 'occupied' ? raw.carPresence : 'unknown'
  return {
    id: raw.id,
    name: raw.name ?? raw.id,
    hasCamera: Boolean(raw.hasCamera),
    status: stale ? 'unknown' : status,
    carPresence: stale ? 'unknown' : presence,
    lastSeenAt: raw.lastSeenAt ?? null,
    ageSec,
    stale,
    battery12V: typeof raw.battery12V === 'number' ? raw.battery12V : null,
    signalStrength4G: typeof raw.signalStrength4G === 'number' ? raw.signalStrength4G : null,
    waterIngress: Boolean(raw.waterIngress),
    activeErrors: (raw.activeErrors ?? []).map((e) => (typeof e === 'string' ? e : JSON.stringify(e))),
  }
}

export function toPlateView(raw: { licensePlate?: unknown; timestamp?: unknown; plateType?: unknown } | null): PlateView | null {
  if (!raw) return null
  return {
    masked: maskPlate(raw.licensePlate),
    timestamp: typeof raw.timestamp === 'string' ? raw.timestamp : null,
    plateType: typeof raw.plateType === 'string' ? raw.plateType : null,
  }
}

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const { base, key } = ecuriousConfig()
  if (!base || !key) throw new EcuriousError('ECURIOUS_BASE_URL oder ECURIOUS_API_KEY fehlt', 503)
  let res: Response
  try {
    res = await fetch(`${base}${path}`, {
      method: init?.method ?? 'GET',
      headers: { 'X-API-Key': key, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    throw new EcuriousError(`Ecurious nicht erreichbar: ${describeError(err)}`, 504)
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const msg = body?.message ?? body?.error ?? ''
    throw new EcuriousError(`Ecurious HTTP ${res.status}${msg ? `: ${String(msg).slice(0, 120)}` : ''}`, res.status === 404 ? 404 : 502)
  }
  return res.json() as Promise<T>
}

// ---------- Mock (ECURIOUS_MOCK=true): ein Lock, vacant, raised ----------

const mockLock: RawLock = {
  id: 'mock-lock-1',
  name: 'Mock-Bügel Berlin',
  serialHex: '00000000',
  hasCamera: true,
  status: 'raised',
  carPresence: 'vacant',
  battery12V: 12.6,
  battery3_7V: 3.9,
  signalStrength4G: 22,
  waterIngress: false,
  activeErrors: [],
  whitelist: ['*'],
}
const mockPlate = { lockId: mockLock.id, licensePlate: 'B-FL 4711', plateType: 'standard' }

/** Mock-Zustandsänderungen gehen an offene Mock-SSE-Streams (nur innerhalb eines Prozesses). */
export const mockEvents = new EventTarget()

const mockNow = () => ({ ...mockLock, lastSeenAt: new Date().toISOString() })

// ---------- Öffentliche Funktionen ----------

export async function listLocks() {
  const cfg = ecuriousConfig()
  const raw = cfg.mock ? [mockNow()] : ((await call<{ locks?: RawLock[] }>('/api/v1/locks')).locks ?? [])
  const locks = raw.map((l) => toLockView(l))
  const defaultLockId = locks.find((l) => l.id === cfg.lockId)?.id ?? locks[0]?.id ?? null
  return { locks, defaultLockId, mock: cfg.mock }
}

export async function getLock(id: string) {
  assertLockId(id)
  const cfg = ecuriousConfig()
  if (cfg.mock) {
    if (id !== mockLock.id) throw new EcuriousError('Lock nicht gefunden', 404)
    return { lock: toLockView(mockNow()), plate: toPlateView({ ...mockPlate, timestamp: new Date(Date.now() - 300_000).toISOString() }), mock: true }
  }
  const path = `/api/v1/locks/${encodeURIComponent(id)}`
  const [{ lock }, plate] = await Promise.all([
    call<{ lock: RawLock }>(path),
    call<{ licensePlate?: string; timestamp?: string; plateType?: string }>(`${path}/plate/latest`).catch((err) => {
      if (err instanceof EcuriousError && err.status === 404) return null
      throw err
    }),
  ])
  return { lock: toLockView(lock), plate: toPlateView(plate), mock: false }
}

/** Aktuelle Whitelist je Lock (nur serverseitig; enthält Kennzeichen im Klartext). */
export async function getWhitelists(): Promise<{ id: string; whitelist: string[] | null }[]> {
  const raw = ecuriousConfig().mock ? [mockLock] : ((await call<{ locks?: RawLock[] }>('/api/v1/locks')).locks ?? [])
  return raw.map((l) => ({ id: l.id, whitelist: Array.isArray(l.whitelist) ? l.whitelist : null }))
}

/** Bewegt echte Hardware. Nur aus der Command-Route aufrufen (Flag + Admin-Token geprüft). */
export async function sendCommand(id: string, cmd: Command) {
  assertLockId(id)
  const { action, ...body } = cmd
  if (ecuriousConfig().mock) {
    if (action === 'lock' || action === 'unlock') {
      mockLock.status = action === 'lock' ? 'raised' : 'lowered'
      const detail = { type: 'status_change', lockId: id, status: mockLock.status, timestamp: new Date().toISOString() }
      mockEvents.dispatchEvent(new CustomEvent('status_change', { detail }))
    }
    if (cmd.action === 'whitelist') mockLock.whitelist = cmd.wildcard ? ['*'] : (cmd.plates ?? [])
    return { success: true, message: `Mock: ${action} ausgeführt`, result: { deviceStatus: mockLock.status, carPresence: mockLock.carPresence, success: true } }
  }
  return call<{ success: boolean; message?: string; result?: unknown }>(
    `/api/v1/locks/${encodeURIComponent(id)}/${action}`,
    { method: 'POST', body },
  )
}
