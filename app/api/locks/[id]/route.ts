import type { NextRequest } from 'next/server'
import { EcuriousError, getLock } from '@/lib/ecurious'

export async function GET(_req: NextRequest, ctx: RouteContext<'/api/locks/[id]'>) {
  const { id } = await ctx.params
  try {
    return Response.json(await getLock(id), { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    const status = err instanceof EcuriousError ? err.status : 502
    return Response.json({ error: (err as Error).message }, { status })
  }
}
