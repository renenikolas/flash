// Schreibt API-Schlüssel in .env.local und setzt sie sofort im laufenden Server (ohne Neustart).
// Nur serverseitig importieren.
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const ENV_FILE = path.join(process.cwd(), '.env.local')
const EXAMPLE = path.join(process.cwd(), '.env.example')

// Diese Werte darf das Menü setzen – sonst nichts.
export const EDITABLE_KEYS = ['GOINGELECTRIC_API_KEY', 'ECURIOUS_API_KEY', 'ECURIOUS_BASE_URL'] as const
export type EditableKey = (typeof EDITABLE_KEYS)[number]

/** Für die Anzeige: nie den ganzen Schlüssel zurückgeben, nur die letzten 4 Zeichen. */
export function maskedSettings() {
  return Object.fromEntries(
    EDITABLE_KEYS.map((k) => {
      const v = process.env[k] ?? ''
      if (k === 'ECURIOUS_BASE_URL') return [k, { set: !!v, preview: v }]
      return [k, { set: !!v, preview: v ? `…${v.slice(-4)}` : '' }]
    }),
  )
}

export async function updateEnvLocal(updates: Partial<Record<EditableKey, string>>) {
  let text = await readFile(ENV_FILE, 'utf8').catch(() => readFile(EXAMPLE, 'utf8').catch(() => ''))
  for (const [k, raw] of Object.entries(updates)) {
    if (!EDITABLE_KEYS.includes(k as EditableKey) || typeof raw !== 'string') continue
    const v = raw.trim().replace(/[\r\n]/g, '')
    const line = `${k}=${v}`
    const re = new RegExp(`^${k}=.*$`, 'm')
    text = re.test(text) ? text.replace(re, line) : `${text.replace(/\n?$/, '\n')}${line}\n`
    process.env[k] = v // sofort aktiv, auch ohne dass Next die Datei neu lädt
  }
  await writeFile(ENV_FILE, text)
}
