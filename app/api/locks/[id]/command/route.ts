// Hardware-Befehle. Nur aktiv mit ECURIOUS_COMMANDS_ENABLED=true und passendem Admin-Token.
import { timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { type Command, EcuriousError, ecuriousConfig, getLock, sendCommand } from '@/lib/ecurious'
import { maskPlatesDeep } from '@/lib/plates.mjs'

function tokenMatches(given: string | null, expected: string) {
  if (!given || !expected) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function parseCommand(body: any): Command | null {
  switch (body?.action) {
    case 'lock':
    case 'unlock':
      return { action: body.action, cancelAutoLift: body.cancelAutoLift === true }
    case 'keep-state':
      return ['normal', 'keep_open', 'keep_closed'].includes(body.state) ? { action: 'keep-state', state: body.state } : null
    case 'whitelist':
      if (body.wildcard === true) return { action: 'whitelist', wildcard: true }
      if (Array.isArray(body.plates) && body.plates.length <= 10 && body.plates.every((p: unknown) => typeof p === 'string' && p.length <= 15)) {
        return { action: 'whitelist', plates: body.plates }
      }
      return null
    default:
      return null
  }
}

export async function POST(req: NextRequest, ctx: RouteContext<'/api/locks/[id]/command'>) {
  const cfg = ecuriousConfig()
  if (!cfg.commandsEnabled) {
    return Response.json({ error: 'Befehle sind deaktiviert (ECURIOUS_COMMANDS_ENABLED=false)' }, { status: 403 })
  }
  if (!tokenMatches(req.headers.get('x-admin-token'), cfg.adminToken)) {
    return Response.json({ error: 'Admin-Token fehlt oder ist falsch (FLASH_ADMIN_TOKEN)' }, { status: 401 })
  }
  const { id } = await ctx.params
  const cmd = parseCommand(await req.json().catch(() => null))
  if (!cmd) return Response.json({ error: 'Ungültiger Befehl' }, { status: 400 })

  try {
    if (cmd.action === 'lock') {
      // Bügel nie unter ein Auto heben: aktueller Zustand muss frisch und "vacant" sein.
      const { lock } = await getLock(id)
      if (lock.carPresence !== 'vacant') {
        return Response.json({ error: `Bügel wird nicht gehoben: Platz ist ${lock.carPresence === 'occupied' ? 'belegt' : 'in unbekanntem Zustand'}` }, { status: 409 })
      }
    }
    const result = await sendCommand(id, cmd)
    // success=true bestätigt nur den Befehl; den echten Zustand liefern SSE bzw. GET /api/locks/[id].
    return Response.json(maskPlatesDeep(result))
  } catch (err) {
    const status = err instanceof EcuriousError ? err.status : 502
    return Response.json({ error: (err as Error).message }, { status })
  }
}
