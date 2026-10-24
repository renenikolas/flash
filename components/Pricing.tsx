// Preisanzeige mit Paid-Plan-Rabatt: alter Preis durchgestrichen, neuer daneben.
import type { Plan } from '@/lib/profile'
import { applyPlan, formatEur, HOLD_MINUTES, NO_SHOW_WAIVED_ABOVE_TRUST, noShowBaseEur } from '@/lib/station-reservations'

/** Basispreis → auf dem Paid Plan "~~7 €~~ 3,50 €", sonst "7 €". 0 → "kostenlos". */
export function Price({ base, plan }: { base: number; plan: Plan }) {
  if (base === 0) return <>kostenlos</>
  if (plan !== 'paid') return <>{formatEur(base)}</>
  return (
    <>
      <s className="font-normal text-gray-400">{formatEur(base)}</s> <span className="font-semibold text-green-700">{formatEur(applyPlan(base, plan))}</span>
    </>
  )
}

/** Spanne wie "3–7 €", auf dem Paid Plan mit Rabatt. */
export function PriceRange({ from, to, plan }: { from: number; to: number; plan: Plan }) {
  const range = (a: number, b: number) => `${formatEur(a).replace(/\s*€/, '')}–${formatEur(b)}`
  if (plan !== 'paid') return <>{range(from, to)}</>
  return (
    <>
      <s className="text-gray-400">{range(from, to)}</s>{' '}
      <span className="font-semibold text-green-700">{range(applyPlan(from, plan), applyPlan(to, plan))}</span>
    </>
  )
}

export function PaidBadge() {
  return <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-800">Paid Plan · −50 %</span>
}

/** Hinweis zur No-Show-Gebühr für Trust Factor und Plan. */
export function NoShowNote({ trust, plan }: { trust: number; plan: Plan }) {
  const base = noShowBaseEur(trust)
  if (base === 0) return <>Keine No-Show-Gebühr – dein Trust Factor liegt über {NO_SHOW_WAIVED_ABOVE_TRUST}.</>
  return (
    <>
      Kommst du später als {HOLD_MINUTES} Minuten, fällt eine No-Show-Gebühr von <Price base={base} plan={plan} /> an
      {plan === 'paid' && ' (Paid Plan)'}. Ab einem Trust Factor über {NO_SHOW_WAIVED_ABOVE_TRUST} entfällt sie.
    </>
  )
}
