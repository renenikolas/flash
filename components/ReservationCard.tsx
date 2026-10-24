'use client'
import type { Car, Plan } from '@/lib/profile'
import { NoShowNote, Price } from './Pricing'
import { bayPosition, formatSlot, formatTime, isRunning, type StationReservation } from '@/lib/station-reservations'
import ParkingLotGraphic from './ParkingLotGraphic'
import PerkQrCode from './PerkQrCode'

type Props = {
  reservation: StationReservation
  more: number // weitere Reservierungen außer dieser
  expanded: boolean
  onToggle: () => void
  onShowStation: () => void
  onCancel: () => void
  onOpenProfile: () => void
  car: Car | null
  plan: Plan
  trust: number
}

/** Feld unten links auf der Karte: nächste Reservierung, aufgeklappt mit dem zugeteilten Bay. */
export default function ReservationCard({ reservation: r, more, expanded, onToggle, onShowStation, onCancel, onOpenProfile, car, plan, trust }: Props) {
  const running = isRunning(r)
  // Das Auto, mit dem gebucht wurde (z. B. über die API); sonst das aktuelle aus dem Profil.
  const shownCar = r.car ?? car
  return (
    <div className="absolute bottom-16 left-3 z-[1000] max-h-[calc(100%-6rem)] w-96 max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-2xl bg-white text-base shadow-xl ring-1 ring-black/10">
      <button onClick={onToggle} aria-expanded={expanded} className="flex w-full items-center gap-4 p-4 text-left">
        <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-xl text-2xl font-bold text-white ${running ? 'bg-green-600' : 'bg-blue-600'}`}>
          P
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-gray-500">{running ? 'Reservierung läuft' : 'Deine Reservierung'}</span>
          <span className="block truncate text-lg font-semibold leading-snug">{r.stationName}</span>
          <span className="block text-sm text-gray-600">{formatSlot(r)}</span>
        </span>
        <span className="text-gray-400">{expanded ? '▼' : '▲'}</span>
      </button>

      {expanded && (
        <div className="border-t border-gray-200 p-4">
          <p className="text-sm text-gray-500">Dein Bay</p>
          {r.bay ? (
            <>
              <p className="text-4xl font-bold leading-tight">{r.bay.name}</p>
              {r.bay.lockName && <p className="text-sm text-gray-500">Parkbügel {r.bay.lockName}</p>}
              <ParkingLotGraphic {...bayPosition(r.bay)} />
            </>
          ) : (
            <>
              <p className="text-2xl font-bold leading-tight">steht um {r.bayAssignAt ? formatTime(r.bayAssignAt) : '–'} fest</p>
              <p className="text-sm text-gray-500">Der Bay wird 30 Minuten vor deinem Termin zugeteilt. Du bekommst dann eine Benachrichtigung.</p>
              <ParkingLotGraphic number={0} total={r.chargePoints ?? 2} />
            </>
          )}

          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            {r.stationAddress && (
              <>
                <dt className="text-gray-500">Adresse</dt>
                <dd>{r.stationAddress}</dd>
              </>
            )}
            {r.perk && (
              <>
                <dt className="text-gray-500">Vorteil</dt>
                <dd className="font-semibold text-amber-800">☕ {r.perk}</dd>
              </>
            )}
            <dt className="text-gray-500">Art</dt>
            <dd>
              {r.kind === 'quick' ? 'Kurzreservierung (15 min)' : 'Termin'}
              {r.source === 'api' && ' · über API'}
            </dd>
            {r.fleetCompany ? (
              <>
                <dt className="text-gray-500">Standort</dt>
                <dd className="font-semibold text-purple-800">{r.fleetCompany}-Flottenparkplatz</dd>
              </>
            ) : (
              <>
                <dt className="text-gray-500">Gebühr</dt>
                <dd>
                  <Price base={r.feeBaseEur ?? r.feeEur ?? 0} plan={r.plan ?? 'free'} />
                  {r.kind === 'quick' && ' · Stornieren kostenlos'}
                  {r.plan === 'paid' && !!r.feeEur && ' · Paid Plan'}
                </dd>
              </>
            )}
            <dt className="text-gray-500">Auto</dt>
            <dd>
              {shownCar ? (
                <>
                  {shownCar.name} · <span className="font-mono">{shownCar.plate}</span>
                </>
              ) : (
                <button onClick={onOpenProfile} className="text-blue-700 underline">
                  Im Profil hinzufügen
                </button>
              )}
            </dd>
          </dl>

          {!r.fleetCompany && (
            <p className="mt-3 text-xs leading-snug text-gray-500">
              <NoShowNote trust={trust} plan={plan} />
            </p>
          )}

          {r.perk && (
            <div className="mt-3 flex items-center gap-3 rounded-xl bg-amber-50 p-3">
              <PerkQrCode seed={`${r.stationId}|${r.createdAt ?? r.startsAt}`} size={96} />
              <p className="text-sm font-semibold text-amber-900">
                Im Café vorzeigen:
                <span className="block font-normal">{r.perk}</span>
              </p>
            </div>
          )}

          <div className="mt-4 flex gap-2">
            {r.lat != null && (
              <button onClick={onShowStation} className="flex-1 rounded-lg bg-blue-600 px-3 py-2.5 text-sm font-semibold text-white">
                Zur Station
              </button>
            )}
            <button onClick={onCancel} className="flex-1 rounded-lg border border-gray-300 px-3 py-2.5 text-sm font-semibold">
              Stornieren
            </button>
          </div>
          {more > 0 && (
            <button onClick={onOpenProfile} className="mt-3 w-full text-sm text-gray-500 underline">
              {more} weitere im Profil
            </button>
          )}
        </div>
      )}
    </div>
  )
}
