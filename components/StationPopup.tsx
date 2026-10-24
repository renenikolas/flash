'use client'
import { useState } from 'react'
import type { Station } from '@/lib/goingelectric'
import type { Plan } from '@/lib/profile'
import PerkQrCode from './PerkQrCode'
import { NoShowNote, PaidBadge, Price, PriceRange } from './Pricing'
import {
  applyPlan,
  formatEur,
  formatSlot,
  formatTime,
  HOLD_MINUTES,
  QUICK_MINUTES,
  quickReservation,
  reservationFeeEur,
  STATION_FEES,
  scheduledReservation,
  type StationReservation,
  toLocalInput,
} from '@/lib/station-reservations'

type Props = {
  station: Station
  reservation: StationReservation | undefined
  /** Gibt einen Fehlertext zurück, wenn kein Bay frei ist. */
  onReserve: (r: StationReservation) => Promise<string | null>
  onCancel: (stationId: number) => void
  plan: Plan
  trust: number
  /** Vorteil eines Partner-Standorts, z. B. Café-Rabatt. */
  perk?: string
  /** Flotten-Standort dieser Firma: nur für deren Flottenfahrzeuge, ohne Preise. */
  fleetCompany?: string
}

export default function StationPopup({ station: s, reservation, onReserve, onCancel, plan, trust, perk, fleetCompany }: Props) {
  const fleet = !!fleetCompany
  const [step, setStep] = useState<'info' | 'choose' | 'schedule'>('info')
  const [when, setWhen] = useState(() => toLocalInput(Date.now() + 3_600_000))
  const [error, setError] = useState<string | null>(null)
  const whenMs = new Date(when).getTime()
  const ownFee = STATION_FEES[s.id] // eigener Tarif, z. B. Jonas Cafe
  const fee = Number.isNaN(whenMs) ? null : reservationFeeEur(whenMs, s.id)

  const [busy, setBusy] = useState(false)
  const book = async (r: StationReservation) => {
    if (busy) return
    setBusy(true)
    const err = await onReserve({
      ...r,
      stationAddress: s.address,
      lat: s.lat,
      lng: s.lng,
      chargePoints: s.plugs.reduce((n, p) => n + p.count, 0) || undefined,
    })
    setBusy(false)
    setError(err)
    if (!err) setStep('info')
  }

  const confirmSchedule = () => {
    const r = scheduledReservation(s.id, s.name, when, Date.now(), plan)
    if (typeof r === 'string') return setError(r)
    book(r)
  }

  return (
    <div className="w-64 font-sans text-sm text-gray-900">
      {/* Kopf */}
      <p className="text-base font-semibold leading-tight">{s.name}</p>
      <p className="mt-0.5 text-xs text-gray-500">{s.address}</p>
      {perk && <p className="mt-2 rounded-md bg-amber-100 px-2 py-1.5 text-xs font-semibold text-amber-900">☕ {perk}</p>}
      {fleet && <p className="mt-2 rounded-md bg-purple-100 px-2 py-1 text-xs font-semibold text-purple-800">Nur für {fleetCompany}-Flottenfahrzeuge</p>}

      {/* Anschlüsse */}
      {s.plugs.length > 0 && (
        <div className="mt-3 flex items-center gap-2">
          <span className="rounded-md bg-blue-600 px-2 py-0.5 text-xs font-bold text-white">bis {s.maxPowerKw} kW</span>
          {s.network && <span className="truncate text-xs text-gray-500">{s.network}</span>}
        </div>
      )}
      <ul className="mt-2 space-y-1">
        {s.plugs.map((p, i) => (
          <li key={i} className="flex justify-between rounded-md bg-gray-50 px-2 py-1 text-xs">
            <span>
              <span className="font-semibold">{p.count}×</span> {p.type}
            </span>
            <span className="text-gray-600">{p.powerKw} kW</span>
          </li>
        ))}
      </ul>
      {s.operator && <p className="mt-2 text-xs text-gray-500">Betreiber: {s.operator}</p>}
      {s.faultReport && <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">⚠️ Störung gemeldet</p>}

      {/* Reservierung */}
      <div className="mt-3 border-t border-gray-200 pt-3">
        {reservation ? (
          <div className="rounded-md bg-green-50 p-2">
            <p className="text-xs font-semibold text-green-800">✓ {reservation.kind === 'quick' ? 'Kurzreservierung' : 'Reserviert'}</p>
            <p className="text-sm font-medium text-green-900">{formatSlot(reservation)}</p>
            {reservation.bay ? (
              <p className="text-xs text-green-800">Dein Platz: {reservation.bay.name}</p>
            ) : (
              reservation.bayAssignAt && <p className="text-xs text-green-800">Bay wird um {formatTime(reservation.bayAssignAt)} zugeteilt</p>
            )}
            {!fleet && (
              <p className="text-xs text-green-800">
                Gebühr: <Price base={reservation.feeBaseEur ?? reservation.feeEur ?? 0} plan={reservation.plan ?? 'free'} />
                {reservation.kind === 'quick' && ' · Stornieren kostenlos'}
                {reservation.plan === 'paid' && !!reservation.feeEur && ' · Paid Plan'}
              </p>
            )}
            {perk && (
              <div className="mt-2 flex flex-col items-center rounded-md bg-amber-50 p-2 text-center">
                <PerkQrCode seed={`${reservation.stationId}|${reservation.createdAt ?? reservation.startsAt}`} />
                <p className="mt-1 text-xs font-semibold text-amber-900">Im Café vorzeigen: {perk}</p>
              </div>
            )}
            <button onClick={() => onCancel(s.id)} className="mt-2 w-full rounded-md border border-green-700 px-3 py-1.5 text-xs font-semibold text-green-800">
              Stornieren
            </button>
          </div>
        ) : step === 'info' ? (
          <button onClick={() => setStep('choose')} className="w-full rounded-md bg-blue-600 px-3 py-2 font-semibold text-white">
            Reservieren
          </button>
        ) : step === 'choose' ? (
          <div className="space-y-2">
            <button onClick={() => book(quickReservation(s.id, s.name))} className="w-full rounded-md border border-blue-600 bg-blue-50 px-3 py-2 text-left">
              <span className="flex justify-between font-semibold text-blue-800">Kurzreservierung {!fleet && <span>kostenlos</span>}</span>
              <span className="block text-xs text-blue-700">
                {QUICK_MINUTES} Minuten ab jetzt
                {!fleet && ' · Stornieren immer kostenlos'}
              </span>
            </button>
            {error && <p className="text-xs text-red-700">{error}</p>}
            <button onClick={() => setStep('schedule')} className="w-full rounded-md border border-gray-300 px-3 py-2 text-left">
              <span className="flex justify-between font-semibold">
                Termin wählen
                {!fleet && (
                  <span className="font-normal text-gray-600">
                    {ownFee ? (
                      <>
                        {ownFee.label}: <Price base={ownFee.eur} plan={plan} />
                      </>
                    ) : (
                      <PriceRange from={3} to={7} plan={plan} />
                    )}
                  </span>
                )}
              </span>
              <span className="block text-xs text-gray-500">Datum und Uhrzeit wählen</span>
            </button>
            {!fleet && plan === 'paid' && (
              <p className="text-[11px] text-green-800">
                <PaidBadge /> Du bist auf dem Paid Plan: 50 % auf alle Gebühren.
              </p>
            )}
            {!fleet && (
              <p className="text-[11px] leading-snug text-gray-500">
                <NoShowNote trust={trust} plan={plan} />
              </p>
            )}
            <button onClick={() => setStep('info')} className="w-full text-xs text-gray-500 underline">
              Abbrechen
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-gray-700">
              Datum und Uhrzeit
              <input
                type="datetime-local"
                value={when}
                min={toLocalInput(Date.now())}
                onChange={(e) => setWhen(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal"
              />
            </label>
            <p className="text-xs text-gray-500">Der Platz wird ab dieser Uhrzeit {HOLD_MINUTES} Minuten für dich freigehalten.</p>
            {!fleet && (
              <div className="rounded-md bg-gray-50 p-2 text-xs">
                <p className="flex justify-between font-semibold">
                  Reservierungsgebühr <span>{fee === null ? '–' : <Price base={fee} plan={plan} />}</span>
                </p>
                <ul className="mt-1 space-y-0.5 text-gray-600">
                  {(ownFee
                    ? ([
                        [ownFee.eur, ownFee.label],
                        [0, 'übrige Zeiten'],
                      ] as [number, string][])
                    : ([
                        [3, '22–6 Uhr'],
                        [5, '13–17 Uhr'],
                        [7, 'übrige Zeiten'],
                      ] as [number, string][])
                  ).map(([base, label]) => (
                    <li key={label} className={fee === base ? 'font-semibold text-gray-900' : ''}>
                      {label}: <Price base={base} plan={plan} />
                    </li>
                  ))}
                </ul>
                {plan === 'paid' && (
                  <p className="mt-1 text-[11px] text-green-800">
                    <PaidBadge /> Du bist auf dem Paid Plan.
                  </p>
                )}
              </div>
            )}
            {!fleet && (
              <p className="text-[11px] leading-snug text-gray-500">
                <NoShowNote trust={trust} plan={plan} />
              </p>
            )}
            {error && <p className="text-xs text-red-700">{error}</p>}
            <button onClick={confirmSchedule} className="w-full rounded-md bg-blue-600 px-3 py-2 font-semibold text-white">
              Termin reservieren
              {!fleet && fee !== null && ` · ${fee === 0 ? 'kostenlos' : formatEur(applyPlan(fee, plan))}`}
            </button>
            <button onClick={() => setStep('choose')} className="w-full text-xs text-gray-500 underline">
              Zurück
            </button>
          </div>
        )}
      </div>

      {s.url && (
        <a href={s.url} target="_blank" rel="noreferrer" className="mt-3 block text-center text-xs text-gray-500 underline">
          Auf GoingElectric ansehen
        </a>
      )}
    </div>
  )
}
