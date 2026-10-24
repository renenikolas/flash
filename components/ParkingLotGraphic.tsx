// Draufsicht auf den Parkplatz: alle Bays nebeneinander, der zugewiesene Bay grün mit Auto.

const W = 320
const H = 156
const PAD = 16
const STALL_TOP = 26
const STALL_H = 78

/** number = 0: Bay steht noch nicht fest, alle grau. */
type Props = { number: number; total: number }

export default function ParkingLotGraphic({ number, total }: Props) {
  const stallW = Math.min(72, (W - 2 * PAD) / total)
  const left = (W - stallW * total) / 2

  return (
    <figure className="mt-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Parkplatz mit ${total} ${total === 1 ? 'Bay' : 'Bays'}${number ? `, dein Bay: Bay ${number}` : ', Bay noch nicht zugeteilt'}`}
        className="w-full rounded-xl bg-gray-700"
      >
        {/* Ladesäulen-Leiste oben */}
        <rect x={left} y={10} width={stallW * total} height={10} rx={3} fill="#4b5563" />

        {Array.from({ length: total }, (_, i) => {
          const x = left + i * stallW
          const mine = i + 1 === number
          const cx = x + stallW / 2
          return (
            <g key={i}>
              <rect x={x + 3} y={STALL_TOP} width={stallW - 6} height={STALL_H} rx={4} fill={mine ? '#16a34a' : '#374151'} />
              {/* Ladesäule mit Blitz */}
              <rect x={cx - 7} y={8} width={14} height={14} rx={3} fill={mine ? '#22c55e' : '#6b7280'} />
              <path d={`M${cx + 1} 10 L${cx - 3} 16 H${cx} L${cx - 1} 20 L${cx + 4} 13 H${cx + 1} Z`} fill="#fff" />
              {mine ? (
                // Auto von oben
                <g>
                  <rect x={cx - 13} y={STALL_TOP + 14} width={26} height={44} rx={8} fill="#fff" />
                  <rect x={cx - 10} y={STALL_TOP + 20} width={20} height={9} rx={3} fill="#bbf7d0" />
                  <rect x={cx - 10} y={STALL_TOP + 45} width={20} height={6} rx={2} fill="#bbf7d0" />
                </g>
              ) : null}
              <text
                x={cx}
                y={STALL_TOP + STALL_H - 6}
                textAnchor="middle"
                fontSize={mine ? 12 : 13}
                fontWeight={700}
                fill={mine ? '#fff' : '#d1d5db'}
                fontFamily="system-ui, sans-serif"
              >
                {mine ? `Bay ${i + 1}` : i + 1}
              </text>
            </g>
          )
        })}

        {/* weiße Trennlinien zwischen den Bays */}
        {Array.from({ length: total + 1 }, (_, i) => (
          <line key={i} x1={left + i * stallW} y1={STALL_TOP} x2={left + i * stallW} y2={STALL_TOP + STALL_H} stroke="#fff" strokeWidth={2} />
        ))}

        {/* Fahrspur mit Mittellinie und Pfeil */}
        <line x1={PAD} y1={130} x2={W - PAD} y2={130} stroke="#e5e7eb" strokeWidth={2} strokeDasharray="10 8" />
        <path d={`M${W - PAD - 22} 122 L${W - PAD - 8} 130 L${W - PAD - 22} 138`} fill="none" stroke="#e5e7eb" strokeWidth={2.5} />
      </svg>
      <figcaption className="mt-1.5 flex items-center gap-2 text-xs text-gray-600">
        {number > 0 && (
          <>
            <span className="inline-block h-3 w-3 rounded-sm bg-green-600" /> Dein Bay
          </>
        )}
        <span className={`${number > 0 ? 'ml-2 ' : ''}inline-block h-3 w-3 rounded-sm bg-gray-700`} /> {total} {total === 1 ? 'Bay' : 'Bays'} insgesamt
      </figcaption>
    </figure>
  )
}
