import { connection } from 'next/server'
import { EcuriousError, listLocks } from '@/lib/ecurious'

export async function GET() {
  await connection()
  try {
    return Response.json(await listLocks(), { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    const status = err instanceof EcuriousError ? err.status : 502
    return Response.json({ error: (err as Error).message }, { status })
  }
}
