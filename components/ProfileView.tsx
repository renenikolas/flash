'use client'
import { useState } from 'react'
import { activeCar, CAR_SUGGESTIONS, DEMO_PROFILE, fleetCarToCar, HIGH_TRUST_FACTOR, type Garage, newCar, type Plan, removeCar, trustScore } from '@/lib/profile'
import { formatSlot, formatTime, isRunning, NO_SHOW_FEE_EUR, NO_SHOW_WAIVED_ABOVE_TRUST, noShowFeeEur, type StationReservation } from '@/lib/station-reservations'
import { PaidBadge, Price } from './Pricing'

type Props = {
  reservations: StationReservation[]
  onCancel: (stationId: number) => void
  onShow: (r: StationReservation) => void
  garage: Garage
  onGarageChange: (g: Garage) => void
  plan: Plan
  onPlanChange: (plan: Plan) => void
  trustFactor: number
  onTrustChange: (value: number) => void
}

const PLANS: { id: Plan; name: string }[] = [
  { id: 'free', name: 'Free' },
  { id: 'paid', name: 'Paid' },
]

function FleetBadge() {
  return <span className="shrink-0 rounded bg-purple-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">Flotte</span>
}

/** Flottenfahrzeuge komplett lila hinterlegt. */
const carStyle = (fleet?: boolean) => (fleet ? 'border-purple-300 bg-purple-50' : 'border-gray-200 bg-white')

function PerksPlaceholder() {
  return <p className="mt-1 text-xs italic text-gray-500">Perks folgen später.</p>
}

export default function ProfileView({ reservations, onCancel, onShow, garage, onGarageChange, plan, onPlanChange, trustFactor, onTrustChange }: Props) {
  const trust = trustScore(trustFactor)
  const [open, setOpen] = useState<'plan' | 'trust' | null>(null)
  const toggle = (k: 'plan' | 'trust') => setOpen((o) => (o === k ? null : k))

  const [adding, setAdding] = useState(false)
  const [carName, setCarName] = useState('')
  const [carPlate, setCarPlate] = useState('')
  const [carError, setCarError] = useState<string | null>(null)
  const [addMode, setAddMode] = useState<'own' | 'fleet'>('own')
  const [fleetCode, setFleetCode] = useState('')
  const [fleetBusy, setFleetBusy] = useState(false)
  const current = activeCar(garage)
  const [carsOpen, setCarsOpen] = useState(false)
  const startAdd = () => {
    setCarName('')
    setCarPlate('')
    setFleetCode('')
    setCarError(null)
    setAddMode('own')
    setAdding(true)
  }
  const addCar = (car: Garage['cars'][number]) => {
    // Das erste Auto wird automatisch das aktuelle.
    onGarageChange({ cars: [...garage.cars, car], activeId: garage.activeId ?? car.id })
    setAdding(false)
  }
  const submitFleet = async () => {
    setFleetBusy(true)
    setCarError(null)
    try {
      const r = await fetch('/api/fleet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: fleetCode }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) return setCarError(body.error ?? `Fehler (HTTP ${r.status})`)
      const car = fleetCarToCar(body.car, garage.cars, `car-${Date.now()}`)
      if (typeof car === 'string') return setCarError(car)
      addCar(car)
    } catch {
      setCarError('Keine Verbindung zum Server.')
    } finally {
      setFleetBusy(false)
    }
  }
  const submitCar = () => {
    const car = newCar(carName, carPlate, garage.cars, `car-${Date.now()}`)
    if (typeof car === 'string') return setCarError(car)
    addCar(car)
  }
  const sorted = [...reservations].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))

  return (
    <div className="mx-auto w-full max-w-xl space-y-4 p-4 text-sm">
      <h2 className="text-base font-semibold">Profil</h2>
      <p className="text-xs text-gray-500">Demo – noch ohne Konto. Autos und Plan liegen in diesem Browser, Reservierungen auf dem Server.</p>

      {/* ---------- Autos ---------- */}
      <div className="rounded-xl border border-gray-200 p-4">
        <p className="text-sm font-semibold text-gray-700">Mein aktuelles Auto</p>
        {current ? (
          <button
            onClick={() => setCarsOpen((o) => !o)}
            aria-expanded={carsOpen}
            className={`mt-2 flex w-full items-center gap-4 rounded-xl border-2 p-4 text-left ${carStyle(current.fleet)}`}
          >
            <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-full text-2xl ${current.fleet ? 'bg-purple-200' : 'bg-gray-100'}`}>🚗</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-lg font-bold leading-tight">
                <span className="truncate">{current.name}</span>
                {current.fleet && <FleetBadge />}
              </span>
              <span className="mt-1.5 inline-block rounded-md border-2 border-gray-900 bg-white px-2 py-0.5 font-mono text-base font-bold tracking-wide">
                {current.plate}
              </span>
              {garage.cars.length > 1 && (
                <span className="mt-1.5 block text-xs text-gray-500">
                  {carsOpen ? 'Tippe auf ein Auto zum Wechseln' : `Wechseln · ${garage.cars.length} Autos`}
                </span>
              )}
            </span>
            <span className="text-gray-400">{carsOpen ? '▲' : '▼'}</span>
          </button>
        ) : (
          <p className="mt-2 rounded-xl border-2 border-dashed border-gray-300 p-4 text-sm text-gray-500">Noch kein Auto hinterlegt.</p>
        )}

        {carsOpen && garage.cars.length > 0 && (
          <ul className="mt-3 space-y-2">
            {garage.cars.map((c) => {
              const isActive = c.id === garage.activeId
              return (
                <li key={c.id} className={`flex items-center gap-3 rounded-xl border-2 p-3 ${carStyle(c.fleet)} ${isActive ? 'ring-2 ring-blue-600 ring-offset-1' : ''}`}>
                  <button
                    onClick={() => {
                      onGarageChange({ ...garage, activeId: c.id })
                      setCarsOpen(false)
                    }}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-lg ${c.fleet ? 'bg-purple-200' : 'bg-gray-100'}`}>🚗</span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1 font-semibold">
                        <span className="truncate">{c.name}</span>
                        {c.fleet && <FleetBadge />}
                      </span>
                      <span className="font-mono text-sm">{c.plate}</span>
                      {isActive && <span className="block text-xs font-semibold text-blue-700">✓ aktuell</span>}
                    </span>
                  </button>
                  <button onClick={() => onGarageChange(removeCar(garage, c.id))} className="shrink-0 text-xs text-gray-500 underline">
                    Entfernen
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {adding ? (
          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-2 gap-1 rounded-md bg-gray-100 p-1 text-xs font-semibold">
              {(
                [
                  ['own', 'Eigenes Auto'],
                  ['fleet', 'Flottenfahrzeug'],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setAddMode(m)
                    setCarError(null)
                  }}
                  aria-pressed={addMode === m}
                  className={`rounded px-2 py-1 ${addMode === m ? 'bg-white shadow-sm' : 'text-gray-600'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {addMode === 'own' ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  submitCar()
                }}
                className="space-y-2"
              >
                <label className="block text-xs font-semibold text-gray-700">
                  Marke und Modell
                  <input
                    autoFocus
                    list="flash-car-suggestions"
                    value={carName}
                    onChange={(e) => setCarName(e.target.value)}
                    placeholder="z. B. VW ID.3"
                    className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal"
                  />
                  <datalist id="flash-car-suggestions">
                    {CAR_SUGGESTIONS.map((n) => (
                      <option key={n} value={n} />
                    ))}
                  </datalist>
                </label>
                <label className="block text-xs font-semibold text-gray-700">
                  Kennzeichen
                  <input
                    value={carPlate}
                    onChange={(e) => setCarPlate(e.target.value)}
                    placeholder="z. B. BN 2187"
                    className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 font-mono text-sm font-normal uppercase"
                  />
                </label>
                {carError && <p className="text-xs text-red-700">{carError}</p>}
                <div className="flex gap-2">
                  <button type="submit" className="flex-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white">
                    Auto speichern
                  </button>
                  <button type="button" onClick={() => setAdding(false)} className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-semibold">
                    Abbrechen
                  </button>
                </div>
              </form>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  submitFleet()
                }}
                className="space-y-2"
              >
                <label className="block text-xs font-semibold text-gray-700">
                  Firmencode
                  <input
                    autoFocus
                    value={fleetCode}
                    onChange={(e) => setFleetCode(e.target.value)}
                    placeholder="z. B. FLOTTE 1"
                    className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 font-mono text-sm font-normal uppercase"
                  />
                </label>
                <p className="text-[11px] text-gray-500">Den Code bekommst du von deiner Firma. Das Fahrzeug wird damit automatisch hinzugefügt.</p>
                {carError && <p className="text-xs text-red-700">{carError}</p>}
                <div className="flex gap-2">
                  <button type="submit" disabled={fleetBusy} className="flex-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                    {fleetBusy ? 'Prüfe …' : 'Flottenfahrzeug hinzufügen'}
                  </button>
                  <button type="button" onClick={() => setAdding(false)} className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-semibold">
                    Abbrechen
                  </button>
                </div>
              </form>
            )}
          </div>
        ) : (
          <button onClick={startAdd} className="mt-3 w-full rounded-xl border-2 border-dashed border-gray-300 px-3 py-3 text-sm font-semibold text-gray-700">
            + Auto hinzufügen
          </button>
        )}
      </div>

      {/* ---------- Reservierungen ---------- */}
      <div className="rounded-lg border border-gray-200 p-3">
        <p className="text-xs text-gray-500">Meine Reservierungen</p>
        {sorted.length === 0 ? (
          <p className="mt-1 text-xs text-gray-500">Noch keine. Tippe auf der Karte auf eine Ladestation und dann auf „Reservieren“.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {sorted.map((r) => (
              <li key={r.stationId} className={`rounded-md border p-2 ${isRunning(r) ? 'border-green-600 bg-green-50' : 'border-gray-200'}`}>
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{r.stationName}</span>
                    <span className="block text-xs text-gray-600">
                      {formatSlot(r)} · {r.kind === 'quick' ? 'Kurzreservierung' : 'Termin'} ·{' '}
                      {r.fleetCompany ? `${r.fleetCompany}-Flotte` : <Price base={r.feeBaseEur ?? r.feeEur ?? 0} plan={r.plan ?? 'free'} />}
                      {isRunning(r) && ' · läuft'}
                    </span>
                  </span>
                  {r.bay ? (
                    <span className="shrink-0 rounded-md bg-gray-900 px-2 py-0.5 text-xs font-bold text-white">{r.bay.name}</span>
                  ) : (
                    <span className="shrink-0 rounded-md bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-700">
                      Bay ab {r.bayAssignAt ? formatTime(r.bayAssignAt) : '–'}
                    </span>
                  )}
                </div>
                <div className="mt-2 flex gap-3 text-xs">
                  <button onClick={() => onShow(r)} className="text-blue-700 underline">
                    Auf Karte zeigen
                  </button>
                  <button onClick={() => onCancel(r.stationId)} className="text-gray-500 underline">
                    Stornieren
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ---------- Plan ---------- */}
      <div className="rounded-lg border border-gray-200">
        <button onClick={() => toggle('plan')} aria-expanded={open === 'plan'} className="flex w-full items-center justify-between p-3 text-left">
          <span>
            <span className="block text-xs text-gray-500">Plan</span>
            <span className="flex items-center gap-2 text-lg font-semibold">
              {plan === 'paid' ? 'Paid' : 'Free'}
              {plan === 'paid' && <PaidBadge />}
            </span>
          </span>
          <span className="text-gray-400">{open === 'plan' ? '▲' : '▼'}</span>
        </button>
        {open === 'plan' && (
          <div className="grid gap-2 border-t border-gray-200 p-3 sm:grid-cols-2">
            {PLANS.map((p) => (
              <div key={p.id} className={`rounded-md border p-3 ${p.id === plan ? 'border-blue-600 bg-blue-50' : 'border-gray-200'}`}>
                <p className="font-semibold">
                  {p.name} {p.id === plan && <span className="text-xs font-normal text-blue-700">· dein Plan</span>}
                </p>
                {p.id === 'paid' ? (
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-gray-700">
                    <li>50 % auf alle Gebühren</li>
                    <li>
                      Termine: <Price base={3} plan="paid" /> bis <Price base={7} plan="paid" />
                    </li>
                    <li>
                      No-Show: <Price base={NO_SHOW_FEE_EUR} plan="paid" />
                    </li>
                  </ul>
                ) : (
                  <PerksPlaceholder />
                )}
                {p.id !== plan && (
                  <button onClick={() => onPlanChange(p.id)} className="mt-2 w-full rounded-md border border-gray-300 px-2 py-1 text-xs font-semibold">
                    Zu {p.name} wechseln (Demo)
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---------- Trust Factor ---------- */}
      <div className="rounded-lg border border-gray-200">
        <button onClick={() => toggle('trust')} aria-expanded={open === 'trust'} className="flex w-full items-center justify-between p-3 text-left">
          <span className="flex-1">
            <span className="block text-xs text-gray-500">Trust Factor</span>
            <span className="text-lg font-semibold">
              {trust} <span className="text-sm font-normal text-gray-500">/ 100</span>
            </span>
            <span className="mt-2 block h-2 w-full max-w-xs overflow-hidden rounded-full bg-gray-200">
              <span className="block h-full rounded-full bg-blue-600" style={{ width: `${trust}%` }} />
            </span>
          </span>
          <span className="text-gray-400">{open === 'trust' ? '▲' : '▼'}</span>
        </button>
        {/* Demo-Schalter: Trust Factor hoch (über 70) oder Standard */}
        <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-3 py-2.5">
          <span className="text-xs">
            <span className="block font-semibold text-gray-700">Hoher Trust Factor (Demo)</span>
            <span className="text-gray-500">
              {trust > NO_SHOW_WAIVED_ABOVE_TRUST ? `An: ${trust} – keine No-Show-Gebühr` : `Aus: ${trust} – Standard`}
            </span>
          </span>
          <button
            role="switch"
            aria-checked={trust > NO_SHOW_WAIVED_ABOVE_TRUST}
            aria-label="Hoher Trust Factor"
            onClick={() => onTrustChange(trust > NO_SHOW_WAIVED_ABOVE_TRUST ? DEMO_PROFILE.trustFactor : HIGH_TRUST_FACTOR)}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${trust > NO_SHOW_WAIVED_ABOVE_TRUST ? 'bg-green-600' : 'bg-gray-300'}`}
          >
            <span
              className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${trust > NO_SHOW_WAIVED_ABOVE_TRUST ? 'left-[1.375rem]' : 'left-0.5'}`}
            />
          </button>
        </div>
        {open === 'trust' && (
          <div className="border-t border-gray-200 p-3">
            <p className="text-xs text-gray-600">Dein Score von 0 bis 100. Jeder startet bei 50.</p>
            <p className="mt-2 text-xs text-gray-600">
              Über {NO_SHOW_WAIVED_ABOVE_TRUST}: keine No-Show-Gebühr (<Price base={NO_SHOW_FEE_EUR} plan={plan} />), wenn du nicht innerhalb von 15
              Minuten kommst.
              {noShowFeeEur(trust) === 0 ? ' Das gilt für dich.' : ` Dir fehlen noch ${NO_SHOW_WAIVED_ABOVE_TRUST + 1 - trust} Punkte.`}
            </p>
            <PerksPlaceholder />
          </div>
        )}
      </div>
    </div>
  )
}
