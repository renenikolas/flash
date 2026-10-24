'use client'
import L from 'leaflet'
import { useCallback, useEffect, useState } from 'react'
import { CircleMarker, MapContainer, Marker, Popup, TileLayer } from 'react-leaflet'
import type { BBox, Station } from '@/lib/goingelectric'
import type { Bay } from '@/lib/supabase-browser'

const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende · ' +
  'Daten: <a href="https://www.goingelectric.de/stromtankstellen/" target="_blank" rel="noreferrer">GoingElectric</a>'

const bayIcon = (free: boolean) =>
  L.divIcon({ className: '', html: `<div class="flash-bay ${free ? 'free' : 'held'}">P</div>`, iconSize: [36, 36], iconAnchor: [18, 18] })

type Props = {
  center: [number, number]
  stations: Station[]
  bays: Bay[]
  bayLabel: string
  searching: boolean
  onSearch: (bbox: BBox) => void
}

export default function MapView({ center, stations, bays, bayLabel, searching, onSearch }: Props) {
  const [map, setMap] = useState<L.Map | null>(null)

  const search = useCallback(() => {
    if (!map) return
    const b = map.getBounds()
    onSearch({ sw_lat: b.getSouth(), sw_lng: b.getWest(), ne_lat: b.getNorth(), ne_lng: b.getEast() })
  }, [map, onSearch])

  // Einmal beim Start laden, danach nur per Button (keine Abfrage bei jeder Kartenbewegung).
  useEffect(() => {
    if (map) search()
  }, [map])

  return (
    <div className="relative h-full w-full">
      <MapContainer ref={setMap} center={center} zoom={15} className="h-full w-full">
        <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution={ATTRIBUTION} maxZoom={19} />
        {stations.map((s) => (
          <CircleMarker
            key={s.id}
            center={[s.lat, s.lng]}
            radius={7}
            pathOptions={{ color: '#1e3a8a', weight: 1, fillColor: s.faultReport ? '#f59e0b' : '#3b82f6', fillOpacity: 0.85 }}
          >
            <Popup>
              <strong>{s.name}</strong>
              <br />
              {s.address}
              <br />
              {s.plugs.map((p) => `${p.count}× ${p.type} ${p.powerKw} kW`).join(', ')}
              {s.operator && (<><br />Betreiber: {s.operator}</>)}
              {s.faultReport && (<><br />⚠️ Störungsmeldung vorhanden</>)}
              {s.url && (<><br /><a href={s.url} target="_blank" rel="noreferrer">Auf GoingElectric ansehen</a></>)}
            </Popup>
          </CircleMarker>
        ))}
        {bays.map((b) => (
          <Marker key={b.id} position={[b.lat, b.lng]} icon={bayIcon(b.status === 'free')} zIndexOffset={1000}>
            <Popup>
              <strong>{b.name}</strong>
              <br />
              {bayLabel}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
      <button
        onClick={search}
        disabled={!map || searching}
        className="absolute left-1/2 top-3 z-[1000] -translate-x-1/2 whitespace-nowrap rounded-full bg-white px-4 py-2 text-sm font-semibold text-gray-900 shadow-md ring-1 ring-black/10 disabled:opacity-60"
      >
        {searching ? 'Suche …' : 'In diesem Bereich suchen'}
      </button>
    </div>
  )
}
