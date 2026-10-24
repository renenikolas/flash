// Minimaler Server-Sent-Events-Parser (reines JS, wird auch von check-apis.mjs genutzt).
import { maskPlatesDeep } from './plates.mjs'

/**
 * Zerlegt einen SSE-Puffer in vollständige Nachrichten. Der unvollständige Rest
 * wird zurückgegeben und mit dem nächsten Chunk erneut übergeben.
 * @param {string} buffer
 * @returns {{ messages: { event: string, data: string }[], rest: string }}
 */
export function parseSse(buffer) {
  const blocks = buffer.replace(/\r\n|\r(?!$)/g, '\n').split('\n\n')
  const rest = blocks.pop() ?? ''
  const messages = []
  for (const block of blocks) {
    let event = 'message'
    const data = []
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue
      const i = line.indexOf(':')
      const field = i === -1 ? line : line.slice(0, i)
      const value = i === -1 ? '' : line.slice(i + 1).replace(/^ /, '')
      if (field === 'event') event = value
      else if (field === 'data') data.push(value)
    }
    if (data.length) messages.push({ event, data: data.join('\n') })
  }
  return { messages, rest }
}

/**
 * Serialisiert ein Ereignis neu, mit maskierten Kennzeichen. Nicht-JSON-Daten werden
 * verworfen, weil wir dort nicht garantieren können, dass kein Kennzeichen drinsteht.
 * @param {{ event: string, data: string }} msg
 * @returns {string | null}
 */
export function sanitizeSseMessage(msg) {
  let payload
  try {
    payload = JSON.parse(msg.data)
  } catch {
    return null
  }
  const event = msg.event.replace(/[\r\n]/g, '')
  return `event: ${event}\ndata: ${JSON.stringify(maskPlatesDeep(payload))}\n\n`
}
