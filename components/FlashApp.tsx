'use client'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Health } from '@/app/api/health/route'
import type { LockView, PlateView } from '@/lib/ecurious'
import type { BBox, Station } from '@/lib/goingelectric'
import { TUM_STAMMGELAENDE } from '@/lib/fleet-sites'
import { activeCar, DEMO_PROFILE, type Garage, loadGarage, loadPlan, loadTrust, type Plan } from '@/lib/profile'
import { activeReservations, type StationReservation } from '@/lib/station-reservations'
import ApiKeysMenu from './ApiKeysMenu'
import BayNotice, { loadSeenBayNotices, noticeKey, pendingBayNotice } from './BayNotice'
import ProfileView from './ProfileView'

const MapView = dynamic(() => import('./MapView'), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-gray-500">Karte lädt …</div>,
})

const SSE_EVENTS = ['status_change', 'vehicle_presence', 'photo_captured', 'alarm'] as const
// Seitenleiste (Parkbügel-Status, manuelle Steuerung) vorerst ausgeblendet – nur die Karte.
// Solange sie aus ist, fragt die Seite auch keinen Bügel-Status ab. Der Whitelist-Abgleich der
// Reservierungen läuft davon unabhängig auf dem Server.
const SHOW_STATUS_PANEL = false

const ago = (sec: number | null) =>
  sec == null ? 'unbekannt' : sec < 120 ? `vor ${Math.round(sec)} s` : `vor ${Math.round(sec / 60)} min`

function StatusBar({ health }: { health: Health | null }) {
  const groups = ['GoingElectric', 'Ecurious'] as const
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
  const [tab, setTab] = useState<'map' | 'profile'>('map')
  const [health, setHealth] = useState<Health | null>(null)
  const reloadHealth = useRef<() => void>(() => {})

  // Ecurious
  const [defaultLockId, setDefaultLockId] = useState<string | null>(null)
  const [locks, setLocks] = useState<LockView[]>([])
  const [pickedLockId, setPickedLockId] = useState<string | null>(null)
  const [lock, setLock] = useState<(LockView & { fetchedAt: number }) | null>(null)
  const [plate, setPlate] = useState<PlateView | null>(null)
  const [lockError, setLockError] = useState<string | null>(null)
  const [sse, setSse] = useState<'connecting' | 'open' | 'down'>('connecting')
  const [lastEvent, setLastEvent] = useState<string | null>(null)
  const [adminMsg, setAdminMsg] = useState<string | null>(null)
  const [cancelAutoLift, setCancelAutoLift] = useState(false)
  const [platesInput, setPlatesInput] = useState('')

  // GoingElectric
  const [stations, setStations] = useState<Station[]>([])
  const [stationsMsg, setStationsMsg] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [stationRes, setStationRes] = useState<StationReservation[]>([])
  const [focusRes, setFocusRes] = useState<StationReservation | null>(null) // aus dem Profil "Auf Karte zeigen"
  const [bayNotice, setBayNotice] = useState<StationReservation | null>(null)
  const [seenBayNotices, setSeenBayNotices] = useState<string[]>([])
  const [profileLoaded, setProfileLoaded] = useState(false)

  const lockId = pickedLockId ?? defaultLockId
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
    reloadHealth.current = () => fetch('/api/health?fresh=1').then((r) => r.json()).then(setHealth).catch(() => {})
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [])

  // ---------- Ecurious: Lock-Status (SSE + Polling-Fallback) ----------
  useEffect(() => {
    if (!SHOW_STATUS_PANEL) return
    fetch('/api/locks')
      .then(async (r) => {
        const body = await r.json()
        if (!r.ok) throw new Error(body.error)
        setDefaultLockId(body.defaultLockId)
        setLocks(body.locks)
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
    if (!SHOW_STATUS_PANEL || !lockId) return
    refreshLock()
    const t = setInterval(refreshLock, sse === 'open' ? 30_000 : 5_000)
    return () => clearInterval(t)
  }, [lockId, sse, refreshLock])

  const [sseAttempt, setSseAttempt] = useState(0)
  useEffect(() => {
    if (!SHOW_STATUS_PANEL) return
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
        const detail = type === 'alarm' ? ` (${d.error ?? 'unbekannt'})` : ''
        setLastEvent(`${type}${detail} · ${new Date(d.timestamp ?? Date.now()).toLocaleTimeString('de-DE')}`)
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
  // cmd entspricht dem Body von POST /api/locks/[id]/command: lock, unlock, keep-state, whitelist.
  // Ohne question geht der Befehl sofort raus (Öffnen/Schließen).
  const command = async (cmd: Record<string, unknown>, question?: string) => {
    if (!lockId) return
    if (question && !confirm(`${question} (${lockId})`)) return
    setAdminMsg(null)
    // Lokal ohne FLASH_ADMIN_TOKEN geht es direkt; nur wenn der Server 401 meldet, nach dem Token fragen.
    const send = (token: string | null) =>
      fetch(`/api/locks/${encodeURIComponent(lockId)}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'x-admin-token': token } : {}) },
        body: JSON.stringify(cmd),
      })
    let r = await send(sessionStorage.getItem('flash-admin-token'))
    if (r.status === 401) {
      sessionStorage.removeItem('flash-admin-token')
      const token = prompt('Admin-Token (FLASH_ADMIN_TOKEN):')
      if (!token) return
      r = await send(token)
      if (r.ok) sessionStorage.setItem('flash-admin-token', token)
    }
    const body = await r.json().catch(() => ({}))
    const whitelist = Array.isArray(body.whitelist) ? ` Whitelist: ${body.whitelist.join(', ') || 'leer'}` : ''
    setAdminMsg(
      r.ok
        ? `Befehl bestätigt: ${body.message ?? (body.state ? `Modus ${body.state}` : 'ok')}.${whitelist} Echter Zustand folgt per Live-Status.`
        : `Fehler: ${body.error ?? `HTTP ${r.status}`}`,
    )
    setTimeout(refreshLock, 1500)
  }

  const moveBarrier = (action: 'lock' | 'unlock') => command({ action, cancelAutoLift })
  const keepState = (state: 'normal' | 'keep_open' | 'keep_closed') =>
    command({ action: 'keep-state', state }, `Schrankenmodus auf „${state}“ setzen?`)
  const setWhitelist = (mode: 'plates' | 'wildcard' | 'off') => {
    if (mode === 'wildcard') return command({ action: 'whitelist', wildcard: true }, 'Auto-Unlock für JEDES Fahrzeug einschalten?')
    if (mode === 'off') return command({ action: 'whitelist', plates: [] }, 'Auto-Unlock ausschalten (Whitelist leeren)?')
    const plates = platesInput.split(/[,;\n]/).map((p) => p.trim().toUpperCase()).filter(Boolean)
    if (!plates.length || plates.length > 10 || plates.some((p) => p.length > 15)) {
      setAdminMsg('Fehler: 1–10 Kennzeichen, je höchstens 15 Zeichen, mit Komma getrennt.')
      return
    }
    return command({ action: 'whitelist', plates }, `Auto-Unlock nur für ${plates.join(', ')} erlauben?`)
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

  // ---------- Ladesäulen-Reservierungen (Server, gleiche Daten wie die externe API) ----------
  const [garage, setGarage] = useState<Garage>({ cars: [], activeId: null })
  const [plan, setPlan] = useState<Plan>('free')
  const [trust, setTrust] = useState(DEMO_PROFILE.trustFactor)
  const [resError, setResError] = useState<string | null>(null)
  const loadStationRes = useCallback(async () => {
    try {
      const r = await fetch('/api/reservations')
      const body = await r.json()
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`)
      setStationRes(body.reservations)
      setResError(null)
    } catch (err) {
      setResError(`Reservierungen nicht geladen: ${(err as Error).message}`)
    }
  }, [])
  // Termin hat seinen Bay bekommen (30 min vorher) → einmal als Popup melden.
  useEffect(() => {
    if (!bayNotice && profileLoaded) setBayNotice(pendingBayNotice(stationRes, seenBayNotices))
  }, [stationRes, bayNotice, profileLoaded, seenBayNotices])
  const closeBayNotice = (show: boolean) => {
    if (!bayNotice) return
    const seen = [...seenBayNotices, noticeKey(bayNotice)].slice(-50)
    setSeenBayNotices(seen)
    void saveProfile({ seenBayNotices: seen })
    if (show) {
      setFocusRes(bayNotice)
      setTab('map')
    }
    setBayNotice(null)
  }

  // Alle 5 s neu laden, damit Buchungen von anderen Servern (API) hier auftauchen.
  useEffect(() => {
    loadStationRes()
    const t = setInterval(loadStationRes, 5_000)
    return () => clearInterval(t)
  }, [loadStationRes])
  // Demo-Profil liegt auf dem Server (.data/demo-profile.json) und gilt für jeden Browser.
  // Gibt es die Datei noch nicht, werden einmal die bisherigen Browser-Daten hochgeladen.
  const saveProfile = (patch: Record<string, unknown>) =>
    fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }).catch(() => {})
  useEffect(() => {
    ;(async () => {
      try {
        const body = await (await fetch('/api/profile')).json()
        let p = body.profile
        const localGarage = loadGarage()
        // Erster Start: alles übernehmen. Hat der Server noch keine Autos, dieser Browser aber schon: Autos nachreichen.
        if (!body.exists) {
          p = { garage: localGarage, plan: loadPlan(), trustFactor: loadTrust(), seenBayNotices: loadSeenBayNotices() }
          await saveProfile(p)
        } else if (!p.garage.cars.length && localGarage.cars.length) {
          p = { ...p, garage: localGarage }
          await saveProfile({ garage: localGarage })
        }
        setGarage(p.garage)
        setPlan(p.plan)
        setTrust(p.trustFactor)
        setSeenBayNotices(p.seenBayNotices ?? [])
      } finally {
        setProfileLoaded(true)
      }
    })()
  }, [])
  const updateTrust = (value: number) => {
    setTrust(value)
    void saveProfile({ trustFactor: value })
  }
  const updatePlan = (p: Plan) => {
    setPlan(p)
    void saveProfile({ plan: p })
  }
  const updateGarage = (g: Garage) => {
    setGarage(g)
    void saveProfile({ garage: g })
  }
  // Die Popup-Reservierung ist vorab im Browser geprüft; Gebühr und Bay legt der Server fest.
  const reserveStation = async (r: StationReservation) => {
    const car = activeCar(garage)
    try {
      const res = await fetch('/api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stationId: r.stationId,
          stationName: r.stationName,
          stationAddress: r.stationAddress,
          lat: r.lat,
          lng: r.lng,
          chargePoints: r.chargePoints,
          kind: r.kind,
          startsAt: r.kind === 'scheduled' ? r.startsAt : undefined,
          plan,
          car: car && { name: car.name, plate: car.plate },
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) return body.error ?? `Fehler (HTTP ${res.status})`
      await loadStationRes()
      return null
    } catch {
      return 'Keine Verbindung zum Server.'
    }
  }
  const cancelWithRefund = async (stationId: number): Promise<{ refundEur: number | null } | { error: string }> => {
    try {
      const res = await fetch(`/api/reservations/${stationId}`, { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      await loadStationRes()
      return res.ok ? { refundEur: body.refundEur ?? null } : { error: body.error ?? `Fehler (HTTP ${res.status})` }
    } catch {
      return { error: 'Keine Verbindung zum Server.' }
    }
  }
  const cancelStation = async (stationId: number) => {
    await fetch(`/api/reservations/${stationId}`, { method: 'DELETE' }).catch(() => {})
    await loadStationRes()
  }
  const myStationRes = now ? activeReservations(stationRes, now) : stationRes

  // ---------- Anzeige ----------
  const barrier = lockStale
    ? 'unbekannt'
    : { raised: 'oben (gesperrt)', lowered: 'unten (offen)', moving: 'fährt gerade …', unknown: 'unbekannt' }[lock?.status ?? 'unknown']
  const presence = lockStale ? 'unbekannt' : lock?.carPresence === 'occupied' ? 'belegt' : 'frei'

  return (
    <div className="flex h-dvh flex-col">
      {bayNotice && (
        <BayNotice
          reservation={bayNotice}
          onClose={() => closeBayNotice(false)}
          onShow={() => closeBayNotice(true)}
          onCancel={() => cancelWithRefund(bayNotice.stationId)}
        />
      )}
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-gray-200 px-4 py-2">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-bold tracking-tight">⚡ FLASH</h1>
          <nav className="flex gap-1 text-sm">
            {(
              [
                ['map', 'Karte'],
                ['profile', 'Profil'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                aria-current={tab === id ? 'page' : undefined}
                className={`rounded-md px-3 py-1 font-medium ${tab === id ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'}`}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-start gap-2">
          <StatusBar health={health} />
          <ApiKeysMenu onSaved={() => reloadHealth.current()} />
        </div>
      </header>

      {/* Karte bleibt gemountet (Leaflet, SSE); das Profil liegt darüber. */}
      <div className="relative flex flex-1 flex-col md:min-h-0">
      {tab === 'profile' && (
        <div className="absolute inset-0 z-[1100] overflow-y-auto bg-white">
          <ProfileView
            reservations={myStationRes}
            onCancel={cancelStation}
            onShow={(r) => {
              setFocusRes(r)
              setTab('map')
            }}
            garage={garage}
            onGarageChange={updateGarage}
            plan={plan}
            onPlanChange={updatePlan}
            trustFactor={trust}
            onTrustChange={updateTrust}
          />
        </div>
      )}
      <main className="flex min-h-0 flex-1 flex-col md:flex-row">
        <section className={`relative ${SHOW_STATUS_PANEL ? 'h-[55vh] md:h-auto md:flex-1' : 'min-h-0 flex-1'}`}>
          <MapView
            center={TUM_STAMMGELAENDE}
            stations={stations}
            searching={searching}
            onSearch={searchStations}
            reservations={myStationRes}
            onReserve={reserveStation}
            onCancel={cancelStation}
            car={activeCar(garage)}
            plan={plan}
            trust={trust}
            focus={focusRes}
            onFocusDone={() => setFocusRes(null)}
            onOpenProfile={() => setTab('profile')}
          />
          {/* Nur Fehler einblenden (Ladesäulen oder Reservierungen nicht geladen). */}
          {(resError || stationsMsg?.startsWith('Ladesäulen:')) && (
            <p className="absolute right-3 top-16 z-[1000] max-w-xs rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800 shadow ring-1 ring-red-200">
              {resError ?? stationsMsg}
            </p>
          )}
        </section>

        {SHOW_STATUS_PANEL && (
        <aside className="w-full space-y-4 p-4 text-sm md:w-96 md:overflow-y-auto">
          <div className="rounded-lg border border-gray-200 p-3">
            <h2 className="font-semibold">
              Parkbügel {lock?.name ? `· ${lock.name}` : ''} {health?.ecuriousMock && <span className="text-amber-700">(Mock)</span>}
            </h2>
            {locks.length > 1 && (
              <label className="mt-1 flex items-center gap-2 text-xs text-gray-600">
                Lock
                <select
                  value={lockId ?? ''}
                  onChange={(e) => {
                    setPickedLockId(e.target.value)
                    setLock(null)
                    setPlate(null)
                    setLastEvent(null)
                    setAdminMsg(null)
                  }}
                  className="rounded border border-gray-300 bg-white px-1 py-0.5"
                >
                  {locks.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({l.id})
                    </option>
                  ))}
                </select>
              </label>
            )}
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
                    onClick={() => moveBarrier('lock')}
                    disabled={lockStale || lock?.carPresence !== 'vacant'}
                    title={lockStale || lock?.carPresence !== 'vacant' ? 'Nur bei frisch gemeldetem freien Platz' : undefined}
                    className="flex-1 rounded-md bg-red-600 px-3 py-2 font-semibold text-white disabled:opacity-40"
                  >
                    Schließen (Bügel hoch)
                  </button>
                  <button onClick={() => moveBarrier('unlock')} className="flex-1 rounded-md bg-gray-800 px-3 py-2 font-semibold text-white">
                    Öffnen (Bügel runter)
                  </button>
                </div>
                <label className="mt-2 flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={cancelAutoLift} onChange={(e) => setCancelAutoLift(e.target.checked)} />
                  Automatisches Wiederhochfahren abbrechen (cancelAutoLift)
                </label>

                <p className="mt-3 text-xs font-semibold text-gray-700">Schrankenmodus (Keep-State)</p>
                <div className="mt-1 flex gap-2">
                  {(['normal', 'keep_open', 'keep_closed'] as const).map((s) => (
                    <button key={s} onClick={() => keepState(s)} className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs font-semibold">
                      {s}
                    </button>
                  ))}
                </div>

                <p className="mt-3 text-xs font-semibold text-gray-700">
                  Auto-Unlock per Kennzeichen (Whitelist){!lock?.hasCamera && lock ? ' – dieser Lock hat keine Kamera' : ''}
                </p>
                <p className="mt-0.5 text-[11px] text-gray-500">
                  Wird automatisch nach den Reservierungen gesetzt – manuelle Änderungen überschreibt der nächste Abgleich (alle 15 s).
                </p>
                <input
                  value={platesInput}
                  onChange={(e) => setPlatesInput(e.target.value)}
                  placeholder="z. B. MBD14E, B12345"
                  className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 font-mono text-xs"
                />
                <div className="mt-1 flex gap-2">
                  <button onClick={() => setWhitelist('plates')} className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs font-semibold">
                    Setzen
                  </button>
                  <button onClick={() => setWhitelist('wildcard')} className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs font-semibold">
                    Alle Fahrzeuge
                  </button>
                  <button onClick={() => setWhitelist('off')} className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs font-semibold">
                    Aus
                  </button>
                </div>
                {adminMsg && <p className={`mt-2 text-xs ${adminMsg.startsWith('Fehler') ? 'text-red-700' : 'text-green-700'}`}>{adminMsg}</p>}
              </div>
            )}
          </div>

          <div className="text-xs text-gray-600">
            <p>{stationsMsg ?? 'Ladesäulen werden geladen …'}</p>
            {resError && <p className="mt-1 text-red-700">{resError}</p>}
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
        )}
      </main>
      </div>
    </div>
  )
}
