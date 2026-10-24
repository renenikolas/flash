'use client'
// Menü zum Setzen der API-Schlüssel (GoingElectric, Ecurious). Speichert in .env.local auf dem Server.
import { useEffect, useState } from 'react'

type Field = 'GOINGELECTRIC_API_KEY' | 'ECURIOUS_API_KEY' | 'ECURIOUS_BASE_URL'
type Settings = Record<Field, { set: boolean; preview: string }>

const FIELDS: { key: Field; label: string; secret: boolean; placeholder: string }[] = [
  { key: 'GOINGELECTRIC_API_KEY', label: 'GoingElectric API-Key', secret: true, placeholder: 'Schlüssel von goingelectric.de' },
  { key: 'ECURIOUS_API_KEY', label: 'Ecurious API-Key', secret: true, placeholder: 'pkl_live_…' },
  { key: 'ECURIOUS_BASE_URL', label: 'Ecurious Base-URL', secret: false, placeholder: 'https://…' },
]

export default function ApiKeysMenu({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [values, setValues] = useState<Partial<Record<Field, string>>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setValues({})
    setMsg(null)
    fetch('/api/settings')
      .then((r) => r.json())
      .then((b) => setSettings(b.settings))
      .catch(() => setMsg('Einstellungen nicht geladen.'))
  }, [open])

  const save = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const r = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) })
      const b = await r.json()
      if (!r.ok) return setMsg(b.error ?? `Fehler (HTTP ${r.status})`)
      setSettings(b.settings)
      setValues({})
      setMsg(b.changed.length ? 'Gespeichert – gilt sofort.' : 'Nichts geändert.')
      onSaved()
    } catch {
      setMsg('Keine Verbindung zum Server.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-md px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-100" title="API-Schlüssel">
        ⚙️ API-Schlüssel
      </button>
      {open && (
        <div className="fixed inset-0 z-[3000] grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="api-keys-title">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              save()
            }}
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"
          >
            <p id="api-keys-title" className="text-lg font-bold">
              API-Schlüssel
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Wird in <code>.env.local</code> auf diesem Rechner gespeichert und gilt sofort. Leere Felder bleiben unverändert.
            </p>
            <div className="mt-4 space-y-3">
              {FIELDS.map((f) => (
                <label key={f.key} className="block text-sm font-semibold text-gray-700">
                  <span className="flex items-center justify-between">
                    {f.label}
                    <span className={`text-xs font-normal ${settings?.[f.key]?.set ? 'text-green-700' : 'text-red-700'}`}>
                      {!settings ? '…' : settings[f.key].set ? `gesetzt ${settings[f.key].preview}` : 'fehlt'}
                    </span>
                  </span>
                  <input
                    type={f.secret ? 'password' : 'url'}
                    autoComplete="off"
                    value={values[f.key] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    placeholder={f.secret && settings?.[f.key]?.set ? 'neuen Schlüssel eingeben, um ihn zu ersetzen' : f.placeholder}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 font-mono text-sm font-normal"
                  />
                </label>
              ))}
            </div>
            {msg && <p className={`mt-3 text-sm ${msg.startsWith('Gespeichert') ? 'text-green-700' : 'text-red-700'}`}>{msg}</p>}
            <div className="mt-4 flex gap-2">
              <button type="submit" disabled={busy} className="flex-1 rounded-lg bg-blue-600 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                {busy ? 'Speichere …' : 'Speichern'}
              </button>
              <button type="button" onClick={() => setOpen(false)} className="flex-1 rounded-lg border border-gray-300 px-3 py-2.5 text-sm font-semibold">
                Schließen
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
