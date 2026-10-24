// Demo-Profil auf dem Server statt im Browser: Autos, Plan, Trust Factor, gemeldete Bay-Zuteilungen.
// Eine Datei für alle Browser (.data/demo-profile.json) – es gibt noch keine Konten. Nur serverseitig importieren.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Garage, Plan } from './profile'

const FILE = path.join(process.cwd(), '.data', 'demo-profile.json')

export type DemoProfile = {
  garage: Garage
  plan: Plan
  trustFactor: number
  seenBayNotices: string[] // "stationId|startsAt" der schon gemeldeten Bay-Zuteilungen
}

export async function readDemoProfile(): Promise<DemoProfile | null> {
  try {
    return JSON.parse(await readFile(FILE, 'utf8'))
  } catch {
    return null // noch keine Datei
  }
}

const DEFAULTS: DemoProfile = { garage: { cars: [], activeId: null }, plan: 'free', trustFactor: 50, seenBayNotices: [] }

/** Übernimmt nur bekannte Felder mit passendem Typ. */
function sanitize(patch: Record<string, unknown>): Partial<DemoProfile> {
  const out: Partial<DemoProfile> = {}
  const g = patch.garage as Garage | undefined
  if (g && Array.isArray(g.cars)) {
    out.garage = {
      cars: g.cars
        .filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string' && typeof c.plate === 'string')
        .slice(0, 20),
      activeId: typeof g.activeId === 'string' ? g.activeId : null,
    }
  }
  if (patch.plan === 'free' || patch.plan === 'paid') out.plan = patch.plan
  if (typeof patch.trustFactor === 'number' && Number.isFinite(patch.trustFactor)) {
    out.trustFactor = Math.round(Math.min(100, Math.max(0, patch.trustFactor)))
  }
  if (Array.isArray(patch.seenBayNotices)) {
    out.seenBayNotices = patch.seenBayNotices.filter((x): x is string => typeof x === 'string').slice(-50)
  }
  return out
}

let queue: Promise<unknown> = Promise.resolve()

/** Ändert die Datei; nicht angegebene Felder bleiben, wie sie sind. */
export function updateDemoProfile(patch: Record<string, unknown>) {
  const run = queue.then(async () => {
    const next = { ...DEFAULTS, ...(await readDemoProfile()), ...sanitize(patch) }
    await mkdir(path.dirname(FILE), { recursive: true })
    const tmp = `${FILE}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(next, null, 2))
    await rename(tmp, FILE)
    return next
  })
  queue = run.catch(() => {})
  return run
}
