'use client'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Health } from '@/app/api/health/route'
import type { LockView, PlateView } from '@/lib/ecurious'
import type { BBox, Station } from '@/lib/goingelectric'
import { type Bay, ensureGuest, getSupabase, rpcErrorText } from '@/lib/supabase-browser'

const MapView = dynamic(() => import('./MapView'), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-gray-500">Karte lädt …</div>,
})

const BERLIN: [number, number] = [52.52, 13.405]
const SSE_EVENTS = ['status_change', 'vehicle_presence', 'photo_captured', 'alarm'] as const

// crypto.randomUUID gibt es nur in sicheren Kontexten (https/localhost), nicht über die LAN-IP am Handy.
const uuid = () =>
  crypto.randomUUID?.() ??
  '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
    (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16),
  )

const ago = (sec: number | null) =>
  sec == null ? 'unbekannt' : sec < 120 ? `vor ${Math.round(sec)} s` : `vor ${Math.round(sec / 60)} min`

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function StatusBar({ health }: { health: Health | null }) {
  const groups = ['GoingElectric', 'Supabase', 'Ecurious'] as const
  return (
    <details className="text-xs">
      <summary className="flex cursor-pointer list-none flex-wrap gap-2">
        {groups.map((g) => {
          const cs = health?.checks.filter((c) => c.group === g) ?? []
          const state = !health ? 'pending' : cs.some((c) => !c.ok) ? 'down' : cs.some((c) => c.mock) ? 'mock' : 'up'
          const color = { pending: 'bg-gray-300', down: 'bg-red-500', mock: 'bg-amber-400', up: 'bg-green-500' }[state]
          return (
            <span key={g} className="flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1 font-medium text-gray-800">
              <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
              {g}
              {state === 'mock' && ' (Mock)'}
            </span>
          )
        })}
      </summary>
      <ul className="mt-2 space-y-1 rounded bg-gray-50 p-2 font-mono text-[11px] text-gray-700">
        {health?.checks.map((c) => (
          <li key={c.id}>
            {c.ok ? (c.mock ? '🟡' : '✅') : '❌'} {c.name} · {c.ms} ms · {c.detail}
          </li>
        ))}
      </ul>
    </details>
  )
}

export default function FlashApp() {
  const [now, setNow] = useState(0) // erst im Browser setzen, nicht beim Prerender
  const [health, setHealth] = useState<Health | null>(null)

  // Supabase
  const [bays, setBays] = useState<Bay[]>([])
  const [offsetMs, setOffsetMs] = useState(0) // DB-Uhr minus Browser-Uhr
  const [sbState, setSbState] = useState('verbinde …')
  const [realtime, setRealtime] = useState('–')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  // Ecurious
  const [defaultLockId, setDefaultLockId] = useState<string | null>(null)
  const [lock, setLock] = useState<(LockView & { fetchedAt: number }) | null>(null)
  const [plate, setPlate] = useState<PlateView | null>(null)
  const [lockError, setLockError] = useState<string | null>(null)
  const [sse, setSse] = useState<'connecting' | 'open' | 'down'>('connecting')
  const [lastEvent, setLastEvent] = useState<string | null>(null)

  // GoingElectric
  const [stations, setStations] = useState<Station[]>([])
  const [stationsMsg, setStationsMsg] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)

  const bay = bays[0] ?? null
  const lockId = bay?.lock_id ?? defaultLockId
  const lockIdRef = useRef(lockId)
  lockIdRef.current = lockId

  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // ---------- API-Status ----------
  useEffect(() => {
    const load = () => fetch('/api/health').then((r) => r.json()).then(setHealth).catch(() => {})
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [])

  // ---------- Supabase: Gast-Login, list_bays, Realtime ----------
  const loadBays = useCallback(async () => {
    const sb = getSupabase()
    if (!sb) return
    const { data, error } = await sb.rpc('list_bays')
    if (error) {
      setSbState(`list_bays fehlgeschlagen: ${error.message}`)
      return
    }
    const rows = (data ?? []) as Bay[]
    setBays(rows)
    if (rows[0]) setOffsetMs(Date.parse(rows[0].server_now) - Date.now())
    setSbState('verbunden')
  }, [])

  useEffect(() => {
    const sb = getSupabase()
    if (!sb) {
      setSbState('nicht konfiguriert (NEXT_PUBLIC_SUPABASE_* fehlt)')
      return
    }
    let channel: ReturnType<typeof sb.channel> | null = null
    let cancelled = false
    ;(async () => {
      try {
        await ensureGuest(sb)
        await sb.realtime.setAuth()
        if (cancelled) return
        await loadBays()
        channel = sb
          .channel('bays', { config: { private: true } })
          .on('broadcast', { event: 'reservation_changed' }, () => loadBays())
          .subscribe((status) => setRealtime(status === 'SUBSCRIBED' ? 'live' : status.toLowerCase()))
      } catch (err) {
        setSbState(`Gast-Login fehlgeschlagen: ${(err as Error).message}`)
      }
    })()
    return () => {
      cancelled = true
      if (channel) sb.removeChannel(channel)
    }
  }, [loadBays])

  // Hold abgelaufen → einmal neu laden (Status kommt immer aus der DB).
  const remainingMs = bay?.expires_at ? Date.parse(bay.expires_at) - (now + offsetMs) : null
  const expiredRef = useRef<string | null>(null)
  useEffect(() => {
    if (bay?.expires_at && remainingMs !== null && remainingMs <= 0 && expiredRef.current !== bay.expires_at) {
      expiredRef.current = bay.expires_at
      loadBays()
    }
  }, [bay?.expires_at, remainingMs, loadBays])

  const callRpc = async (fn: string, args: Record<string, unknown>) => {
    const sb = getSupabase()
    if (!sb) return
    setBusy(true)
    setMsg(null)
    try {
      let r = await sb.rpc(fn, args)
      if (r.error && !r.error.code) r = await sb.rpc(fn, args) // Netzwerkfehler: einmal wiederholen (idempotent)
      if (r.error) setMsg(rpcErrorText(r.error.message))
      await loadBays()
    } finally {
      setBusy(false)
    }
  }
  const reserve = () => bay && callRpc('reserve_bay', { bay_id: bay.id, minutes: 10, request_id: uuid() })
  const cancel = () => bay?.reservation_id && callRpc('cancel_reservation', { id: bay.reservation_id })

  // ---------- Ecurious: Lock-Status (SSE + Polling-Fallback) ----------
  useEffect(() => {
    fetch('/api/locks')
      .then(async (r) => {
        const body = await r.json()
        if (!r.ok) throw new Error(body.error)
        setDefaultLockId(body.defaultLockId)
        if (!body.defaultLockId) setLockError('Keine Locks für diesen API-Key')
      })
      .catch((err) => setLockError(err.message))
  }, [])

  const refreshLock = useCallback(async () => {
    const id = lockIdRef.current
    if (!id) return
    try {
      const r = await fetch(`/api/locks/${encodeURIComponent(id)}`)
      const body = await r.json()
      if (!r.ok) throw new Error(body.error)
      setLock({ ...body.lock, fetchedAt: Date.now() })
      setPlate(body.plate)
      setLockError(null)
    } catch (err) {
      setLockError((err as Error).message)
    }
  }, [])

  useEffect(() => {
    if (!lockId) return
    refreshLock()
    const t = setInterval(refreshLock, sse === 'open' ? 30_000 : 5_000)
    return () => clearInterval(t)
  }, [lockId, sse, refreshLock])

  const [sseAttempt, setSseAttempt] = useState(0)
  useEffect(() => {
    const es = new EventSource('/api/locks/events')
    let retry: ReturnType<typeof setTimeout> | undefined
    es.onopen = () => setSse('open')
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        setSse('down')
        retry = setTimeout(() => setSseAttempt((n) => n + 1), 30_000)
      } else {
        setSse('connecting')
      }
    }
    for (const type of SSE_EVENTS) {
      es.addEventListener(type, (e) => {
        const d = JSON.parse((e as MessageEvent).data)
        if (lockIdRef.current && d.lockId !== lockIdRef.current) return
        setLastEvent(`${type} · ${new Date(d.timestamp ?? Date.now()).toLocaleTimeString('de-DE')}`)
        refreshLock()
      })
    }
    return () => {
      clearTimeout(retry)
      es.close()
    }
  }, [sseAttempt, refreshLock])

  // Alter der Daten läuft im Browser weiter; > 60 s gilt als unbekannt.
  const lockAge = lock?.ageSec != null ? lock.ageSec + (now - lock.fetchedAt) / 1000 : null
  const lockStale = !lock || lock.stale || lockAge === null || lockAge > 60

  // ---------- Admin-Befehle (nur bei ECURIOUS_COMMANDS_ENABLED) ----------
  const command = async (action: 'lock' | 'unlock') => {
    if (!lockId) return
    const label = action === 'lock' ? 'HOCHFAHREN (Platz sperren)' : 'SENKEN (Platz freigeben)'
    if (!confirm(`Bügel wirklich ${label}? Das bewegt echte Hardware.`)) return
    let token = sessionStorage.getItem('flash-admin-token')
    if (!token) {
      token = prompt('Admin-Token (FLASH_ADMIN_TOKEN):')
      if (!token) return
    }
    setMsg(null)
    const r = await fetch(`/api/locks/${encodeURIComponent(lockId)}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
      body: JSON.stringify({ action }),
    })
    const body = await r.json().catch(() => ({}))
    if (r.status === 401) sessionStorage.removeItem('flash-admin-token')
    else sessionStorage.setItem('flash-admin-token', token)
    setMsg(r.ok ? `Befehl bestätigt: ${body.message ?? 'ok'} – echter Zustand folgt per Live-Status.` : body.error ?? `HTTP ${r.status}`)
    setTimeout(refreshLock, 1500)
  }

  // ---------- GoingElectric ----------
  const searchStations = useCallback(async (b: BBox) => {
    setSearching(true)
    setStationsMsg(null)
    try {
      const qs = new URLSearchParams(Object.entries(b).map(([k, v]) => [k, v.toFixed(5)]))
      const r = await fetch(`/api/chargepoints?${qs}`)
      const body = await r.json()
      if (!r.ok) throw new Error(body.error)
      setStations(body.stations)
      setStationsMsg(`${body.stations.length} Ladeorte im Ausschnitt${body.truncated ? ' (gekürzt – weiter hineinzoomen)' : ''}`)
    } catch (err) {
      setStationsMsg(`Ladesäulen: ${(err as Error).message}`)
    } finally {
      setSearching(false)
    }
  }, [])

  // ---------- Anzeige ----------
  const bayLabel = !bay
    ? ''
    : bay.status === 'free'
      ? 'Frei'
      : bay.held_by_me
        ? `Von dir reserviert – noch ${mmss(remainingMs ?? 0)}`
        : `Reserviert (anderer Gast) – frei in ${mmss(remainingMs ?? 0)}`
  const barrier = lockStale ? 'unbekannt' : lock?.status === 'raised' ? 'oben (gesperrt)' : 'unten (offen)'
  const presence = lockStale ? 'unbekannt' : lock?.carPresence === 'occupied' ? 'belegt' : 'frei'

  return (
    <div className="flex min-h-dvh flex-col md:h-dvh">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-gray-200 px-4 py-2">
        <h1 className="text-lg font-bold tracking-tight">⚡ FLASH</h1>
        <StatusBar health={health} />
      </header>

      <main className="flex flex-1 flex-col md:min-h-0 md:flex-row">
        <section className="h-[55vh] md:h-auto md:flex-1">
          <MapView
            center={bay ? [bay.lat, bay.lng] : BERLIN}
            stations={stations}
            bays={bays}
            bayLabel={bayLabel}
            searching={searching}
            onSearch={searchStations}
          />
        </section>

        <aside className="w-full space-y-4 p-4 text-sm md:w-96 md:overflow-y-auto">
          <div className="rounded-lg border border-gray-200 p-3">
            <h2 className="font-semibold">{bay?.name ?? 'Stellplatz'}</h2>
            <p className="text-xs text-gray-500">Supabase: {sbState} · Realtime: {realtime}</p>
            {bay && (
              <>
                <p className={`mt-2 text-base font-semibold ${bay.status === 'free' ? 'text-green-700' : 'text-amber-700'}`}>{bayLabel}</p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={reserve}
                    disabled={busy || bay.status !== 'free'}
                    className="flex-1 rounded-md bg-blue-600 px-3 py-2 font-semibold text-white disabled:opacity-40"
                  >
                    Reservieren 10 min
                  </button>
                  <button
                    onClick={cancel}
                    disabled={busy || !bay.held_by_me}
                    className="flex-1 rounded-md border border-gray-300 px-3 py-2 font-semibold disabled:opacity-40"
                  >
                    Stornieren
                  </button>
                </div>
              </>
            )}
            {msg && <p className="mt-2 text-xs text-red-700">{msg}</p>}
          </div>

          <div className="rounded-lg border border-gray-200 p-3">
            <h2 className="font-semibold">
              Parkbügel {lock?.name ? `· ${lock.name}` : ''} {health?.ecuriousMock && <span className="text-amber-700">(Mock)</span>}
            </h2>
            {lockError && <p className="text-xs text-red-700">{lockError}</p>}
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-gray-500">Bügel</dt>
              <dd className="font-medium">{barrier}</dd>
              <dt className="text-gray-500">Platz</dt>
              <dd className="font-medium">{presence}</dd>
              <dt className="text-gray-500">Kennzeichen</dt>
              <dd className="font-mono">{plate?.masked ?? '–'}</dd>
              <dt className="text-gray-500">Daten</dt>
              <dd>{ago(lockAge)}{lockStale && lock ? ' (älter als 60 s)' : ''}</dd>
              <dt className="text-gray-500">Live</dt>
              <dd>{sse === 'open' ? 'SSE verbunden' : sse === 'connecting' ? 'SSE verbindet … (Polling 5 s)' : 'SSE aus – Polling alle 5 s'}</dd>
              {lastEvent && (
                <>
                  <dt className="text-gray-500">Ereignis</dt>
                  <dd>{lastEvent}</dd>
                </>
              )}
            </dl>
            {health?.commandsEnabled && lockId && (
              <div className="mt-3 border-t border-dashed border-gray-300 pt-3">
                <p className="mb-2 text-xs font-semibold uppercase text-red-700">Admin · bewegt echte Hardware</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => command('lock')}
                    disabled={lockStale || lock?.carPresence !== 'vacant'}
                    title={lockStale || lock?.carPresence !== 'vacant' ? 'Nur bei frisch gemeldetem freien Platz' : undefined}
                    className="flex-1 rounded-md bg-red-600 px-3 py-2 font-semibold text-white disabled:opacity-40"
                  >
                    Bügel hoch
                  </button>
                  <button onClick={() => command('unlock')} className="flex-1 rounded-md bg-gray-800 px-3 py-2 font-semibold text-white">
                    Bügel runter
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="text-xs text-gray-600">
            <p>{stationsMsg ?? 'Ladesäulen werden geladen …'}</p>
            <p className="mt-1">
              Daten:{' '}
              <a className="underline" href="https://www.goingelectric.de/stromtankstellen/" target="_blank" rel="noreferrer">
                GoingElectric
              </a>{' '}
              · Karte ©{' '}
              <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
                OpenStreetMap
              </a>
            </p>
          </div>
        </aside>
      </main>
    </div>
  )
}
