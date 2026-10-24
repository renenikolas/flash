// Gutschein-Code für Partner-Vorteile (z. B. Americano-Rabatt). Sieht aus wie ein QR-Code,
// ist aber ein zufälliges Muster – pro Reservierung gleich (Seed), bis echte Gutscheine angebunden sind.

const N = 25 // Module pro Seite (wie QR-Version 2)

function rng(seed: string) {
  let h = 2166136261
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return () => {
    h = Math.imul(h ^ (h >>> 15), h | 1)
    h ^= h + Math.imul(h ^ (h >>> 7), h | 61)
    return ((h ^ (h >>> 14)) >>> 0) / 4294967296
  }
}

/** Positionsmarke (7×7) oben links, oben rechts, unten links – inkl. weißem Rand. */
function finder(x: number, y: number) {
  for (const [fx, fy] of [
    [0, 0],
    [N - 7, 0],
    [0, N - 7],
  ]) {
    const dx = x - fx
    const dy = y - fy
    if (dx >= -1 && dx <= 7 && dy >= -1 && dy <= 7) {
      if (dx < 0 || dy < 0 || dx > 6 || dy > 6) return false // Rand
      const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3))
      return ring !== 2 // äußerer Ring und 3×3-Kern dunkel
    }
  }
  return null
}

export default function PerkQrCode({ seed, size = 132 }: { seed: string; size?: number }) {
  const rand = rng(seed)
  const cells: [number, number][] = []
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const f = finder(x, y)
      if (f ?? rand() < 0.5) cells.push([x, y])
    }
  }
  return (
    <svg viewBox={`-2 -2 ${N + 4} ${N + 4}`} width={size} height={size} role="img" aria-label="Gutschein-Code" className="rounded-md bg-white">
      <rect x={-2} y={-2} width={N + 4} height={N + 4} fill="#fff" />
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill="#111827" />
      ))}
    </svg>
  )
}
