// Reines JS, damit scripts/check-apis.mjs es ohne Build nutzen kann.

/**
 * Maskiert ein Kennzeichen: Ortskennung und Buchstaben bleiben sichtbar,
 * Ziffern und alles danach werden zu "***" ("M-AB 1234" → "M-AB***").
 * @param {unknown} plate
 * @returns {string | null}
 */
export function maskPlate(plate) {
  if (typeof plate !== 'string') return null
  const p = plate.trim().toUpperCase().replace(/\s+/g, ' ')
  if (!p) return null
  let visible = /\d/.test(p) ? p.match(/^\D*/)[0] : p.slice(0, 2)
  visible = visible.slice(0, 6).replace(/[\s-]+$/, '')
  return `${visible}***`
}

/**
 * Maskiert rekursiv jedes Feld, dessen Name "plate" enthält (licensePlate, plate, plates …).
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function maskPlatesDeep(value) {
  if (Array.isArray(value)) return /** @type {T} */ (value.map(maskPlatesDeep))
  if (!value || typeof value !== 'object') return value
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const [k, v] of Object.entries(value)) {
    if (/plate/i.test(k) && !/type$/i.test(k)) {
      out[k] = Array.isArray(v) ? v.map(maskPlate) : maskPlate(v)
    } else {
      out[k] = maskPlatesDeep(v)
    }
  }
  return /** @type {T} */ (out)
}
