// Reicht den Ecurious-SSE-Stream an den Browser weiter – mit maskierten Kennzeichen.
// Bricht der Upstream ab, endet auch dieser Stream; EventSource im Browser verbindet neu.
import { connection } from 'next/server'
import { describeError, TIMEOUT_MS } from '@/lib/checks.mjs'
import { ecuriousConfig, mockEvents } from '@/lib/ecurious'
import { parseSse, sanitizeSseMessage } from '@/lib/sse.mjs'

const HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
}
const HEARTBEAT_MS = 15_000

export async function GET(req: Request) {
  await connection()
  const cfg = ecuriousConfig()
  const enc = new TextEncoder()

  if (cfg.mock) {
    let cleanup = () => {}
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (s: string) => controller.enqueue(enc.encode(s))
        const onEvent = (e: Event) => send(sanitizeSseMessage({ event: e.type, data: JSON.stringify((e as CustomEvent).detail) }) ?? '')
        const beat = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS)
        mockEvents.addEventListener('status_change', onEvent)
        cleanup = () => {
          clearInterval(beat)
          mockEvents.removeEventListener('status_change', onEvent)
        }
        req.signal.addEventListener('abort', () => {
          cleanup()
          try { controller.close() } catch {}
        })
        send(`event: ready\ndata: ${JSON.stringify({ mock: true })}\n\n`)
      },
      cancel: () => cleanup(),
    })
    return new Response(stream, { headers: HEADERS })
  }

  if (!cfg.base || !cfg.key) {
    return Response.json({ error: 'ECURIOUS_BASE_URL oder ECURIOUS_API_KEY fehlt' }, { status: 503 })
  }

  const upstreamAbort = new AbortController()
  req.signal.addEventListener('abort', () => upstreamAbort.abort())
  const connectTimer = setTimeout(() => upstreamAbort.abort(), TIMEOUT_MS)
  let upstream: Response
  try {
    upstream = await fetch(`${cfg.base}/api/v1/events`, {
      headers: { 'X-API-Key': cfg.key, Accept: 'text/event-stream' },
      signal: upstreamAbort.signal,
    })
  } catch (err) {
    return Response.json({ error: `Ecurious-SSE nicht erreichbar: ${describeError(err)}` }, { status: 504 })
  } finally {
    clearTimeout(connectTimer)
  }
  if (!upstream.ok || !upstream.body) {
    await upstream.body?.cancel()
    return Response.json({ error: `Ecurious-SSE HTTP ${upstream.status}` }, { status: 502 })
  }

  const reader = upstream.body.pipeThrough(new TextDecoderStream()).getReader()
  let beat: ReturnType<typeof setInterval> | undefined
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (s: string) => controller.enqueue(enc.encode(s))
      beat = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS)
      send(`event: ready\ndata: ${JSON.stringify({ mock: false })}\n\n`)
      let buffer = ''
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          const parsed = parseSse(buffer + value)
          buffer = parsed.rest
          for (const msg of parsed.messages) {
            const out = sanitizeSseMessage(msg)
            if (out) send(out)
          }
        }
      } catch {
        // Upstream abgebrochen oder Client weg – Stream beenden, Browser verbindet neu.
      } finally {
        clearInterval(beat)
        try { controller.close() } catch {}
      }
    },
    cancel() {
      clearInterval(beat)
      upstreamAbort.abort()
    },
  })
  return new Response(stream, { headers: HEADERS })
}
