'use client'
// Popup, sobald für einen Termin der Bay feststeht (30 min vor Beginn).
// Fragt, ob man es noch schafft; sonst Storno mit halber Erstattung.
import { useState } from 'react'
import { bayPosition, formatEur, formatSlot, lateCancelRefundEur, type StationReservation } from '@/lib/station-reservations'
import ParkingLotGraphic from './ParkingLotGraphic'

const SEEN_KEY = 'flash-bay-notified'
export const noticeKey = (r: StationReservation) => `${r.stationId}|${r.startsAt}`

/** Früher im Browser gespeicherte Meldungen – nur noch zum einmaligen Übernehmen ins Demo-Profil. */
export function loadSeenBayNotices(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]')
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

/** Erster Termin, dessen Bay nachträglich vergeben wurde und der noch nicht gemeldet ist. */
export function pendingBayNotice(list: StationReservation[], seen: string[]) {
  return list.find((r) => r.bayAssignAt && r.bayAssignedAt && r.bay && !seen.includes(noticeKey(r))) ?? null
}

type Props = {
  reservation: StationReservation
  onClose: () => void
  onShow: () => void
  /** Storniert; liefert die Erstattung vom Server oder einen Fehlertext. */
  onCancel: () => Promise<{ refundEur: number | null } | { error: string }>
}

export default function BayNotice({ reservation: r, onClose, onShow, onCancel }: Props) {
  const [step, setStep] = useState<'ask' | 'confirm' | 'busy' | 'done'>('ask')
  const [result, setResult] = useState<string | null>(null)
  const refund = lateCancelRefundEur(r) ?? 0
  const fee = r.feeEur ?? 0

  const cancel = async () => {
    setStep('busy')
    const res = await onCancel()
    if ('error' in res) {
      setResult(res.error)
      setStep('confirm')
      return
    }
    const back = res.refundEur ?? 0
    setResult(back > 0 ? `Storniert. ${formatEur(back)} werden dir erstattet.` : 'Storniert.')
    setStep('done')
  }

  if (step === 'done') {
    return (
      <div className="fixed inset-0 z-[3000] grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true">
        <div className="w-full max-w-sm rounded-2xl bg-white p-5 text-center shadow-2xl">
          <p className="text-lg font-bold">{result}</p>
          <p className="mt-1 text-sm text-gray-600">{r.stationName}</p>
          <button onClick={onClose} className="mt-4 w-full rounded-lg bg-blue-600 px-3 py-2.5 text-sm font-semibold text-white">
            OK
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[3000] grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="bay-notice-title">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
        <p className="text-sm font-semibold text-green-700">🔔 Dein Bay steht fest</p>
        <p id="bay-notice-title" className="mt-1 text-5xl font-bold leading-tight">
          {r.bay?.name}
        </p>
        <p className="mt-1 text-base font-semibold">{r.stationName}</p>
        <p className="text-sm text-gray-600">
          Termin {formatSlot(r)}
          {r.bay?.lockName && ` · Parkbügel ${r.bay.lockName}`}
        </p>
        <ParkingLotGraphic {...bayPosition(r.bay)} />

        {step === 'ask' ? (
          <>
            <p className="mt-4 text-base font-semibold">Schaffst du es noch rechtzeitig?</p>
            <div className="mt-2 flex gap-2">
              <button onClick={onShow} className="flex-1 rounded-lg bg-green-600 px-3 py-2.5 text-sm font-semibold text-white">
                Ja, ich komme
              </button>
              <button onClick={() => setStep('confirm')} className="flex-1 rounded-lg border border-red-300 px-3 py-2.5 text-sm font-semibold text-red-700">
                Nein, stornieren
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-900">
              {fee > 0 ? (
                <>
                  Du bekommst <strong>{formatEur(refund)}</strong> zurück – die Hälfte deiner Reservierungsgebühr von {formatEur(fee)}.
                </>
              ) : (
                'Die Stornierung ist kostenlos.'
              )}
            </p>
            {result && <p className="mt-2 text-xs text-red-700">{result}</p>}
            <div className="mt-2 flex gap-2">
              <button
                onClick={cancel}
                disabled={step === 'busy'}
                className="flex-1 rounded-lg bg-red-600 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {step === 'busy' ? 'Storniere …' : 'Jetzt stornieren'}
              </button>
              <button onClick={() => setStep('ask')} className="flex-1 rounded-lg border border-gray-300 px-3 py-2.5 text-sm font-semibold">
                Zurück
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
