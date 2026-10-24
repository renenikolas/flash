#!/usr/bin/env node
// API-Smoke-Check: npm run check:apis
// Nur lesende Aufrufe. Liest .env.local, prüft alle externen APIs parallel (je max. 5 s).
import { existsSync } from 'node:fs'
import { runChecks } from '../lib/checks.mjs'

if (existsSync('.env.local')) process.loadEnvFile('.env.local')
else console.log('Hinweis: keine .env.local gefunden, nutze nur Umgebungsvariablen.\n')

const t0 = performance.now()
// Prüft immer die echte Ecurious-API, auch wenn ECURIOUS_MOCK=true für die Webseite gesetzt ist.
const results = await runChecks(process.env, { sseListenMs: 5000, ecuriousMock: false })

console.log('FLASH API-Smoke-Check')
for (const r of results) {
  console.log(`${r.ok ? '✅' : '❌'} ${r.name.padEnd(22)} ${String(r.ms).padStart(5)} ms  ${r.detail}`)
}
console.log(`Gesamt: ${Math.round(performance.now() - t0)} ms`)
process.exitCode = results.every((r) => r.ok) ? 0 : 1
