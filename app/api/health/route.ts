import { connection } from 'next/server'
import { runChecks, type CheckResult } from '@/lib/checks.mjs'
import { ecuriousConfig } from '@/lib/ecurious'

export type Health = {
  checks: CheckResult[]
  ecuriousMock: boolean
  commandsEnabled: boolean
  checkedAt: string
}

// 30 s im Speicher: schont Rate-Limits (u. a. anonyme Supabase-Logins) bei vielen offenen Tabs.
let cached: { at: number; promise: Promise<Health> } | null = null

async function compute(): Promise<Health> {
  const cfg = ecuriousConfig()
  // SSE hier nur "öffnet der Stream?" – das 5-s-Lauschen macht npm run check:apis.
  const checks = await runChecks(process.env, { sseListenMs: 0, ecuriousMock: cfg.mock })
  return { checks, ecuriousMock: cfg.mock, commandsEnabled: cfg.commandsEnabled, checkedAt: new Date().toISOString() }
}

export async function GET() {
  await connection()
  if (!cached || Date.now() - cached.at > 30_000) {
    cached = { at: Date.now(), promise: compute() }
  }
  return Response.json(await cached.promise, { headers: { 'Cache-Control': 'no-store' } })
}
