'use client'
import L from 'leaflet'
import { useCallback, useEffect, useState } from 'react'
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, ZoomControl } from 'react-leaflet'
import { fleetSitesFor } from '@/lib/fleet-sites'
import { PARTNER_SITES } from '@/lib/partner-sites'
import type { BBox, Station } from '@/lib/goingelectric'
import type { Car, Plan } from '@/lib/profile'
import { nextReservation, type StationReservation } from '@/lib/station-reservations'
import ReservationCard from './ReservationCard'
import StationPopup from './StationPopup'

const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende · ' +
  'Daten: <a href="https://www.goingelectric.de/stromtankstellen/" target="_blank" rel="noreferrer">GoingElectric</a>'

// Schild mit Beschriftung für eigene Standorte (lila: Flotte, braun: Partner wie Cafés),
// grün umrandet wenn reserviert. Zwischengespeichert, damit Leaflet das Icon nicht bei jedem Render neu setzt.
const labelIcons = new Map<string, L.DivIcon>()
const labelIcon = (label: string, reserved: boolean, color = '#7e22ce') => {
  const key = `${label}|${reserved}|${color}`
  if (!labelIcons.has(key)) labelIcons.set(key, makeLabelIcon(label, reserved, color))
  return labelIcons.get(key)!
}
const makeLabelIcon = (label: string, reserved: boolean, color: string) =>
  L.divIcon({
    className: '',
    html:
      // Breite folgt dem Text; zentriert über dem Punkt.
      `<div style="position:absolute;transform:translate(-50%,-50%);background:${color};color:#fff;font:700 13px/1 system-ui,sans-serif;` +
      `padding:7px 10px;border-radius:9999px;box-shadow:0 1px 4px rgba(0,0,0,.35);` +
      `border:3px solid ${reserved ? '#16a34a' : '#fff'};white-space:nowrap">${label}</div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  })

type Props = {
  center: [number, number]
  stations: Station[]
  searching: boolean
  onSearch: (bbox: BBox) => void
  reservations: StationReservation[]
  onReserve: (r: StationReservation) => Promise<string | null>
  onCancel: (stationId: number) => void
  car: Car | null
  plan: Plan
  trust: number
  focus: StationReservation | null
  onFocusDone: () => void
  onOpenProfile: () => void
}

export default function MapView(props: Props) {
  const { center, stations, searching, onSearch, reservations, onReserve, onCancel } = props
  const [map, setMap] = useState<L.Map | null>(null)

  // Feld unten links: gewählte (aus dem Profil) oder nächste Reservierung.
  const [shownId, setShownId] = useState<number | null>(null)
  const [expanded, setExpanded] = useState(false)
  const shown = reservations.find((r) => r.stationId === shownId) ?? nextReservation(reservations)
  const showStation = useCallback(
    (r: StationReservation) => {
      if (map && r.lat != null && r.lng != null) map.flyTo([r.lat, r.lng], Math.max(map.getZoom(), 16))
    },
    [map],
  )

  const { focus, onFocusDone } = props
  useEffect(() => {
    if (!focus) return
    setShownId(focus.stationId)
    setExpanded(true)
    showStation(focus)
    onFocusDone()
  }, [focus, onFocusDone, showStation])

  const search = useCallback(() => {
    if (!map) return
    const b = map.getBounds()
    onSearch({ sw_lat: b.getSouth(), sw_lng: b.getWest(), ne_lat: b.getNorth(), ne_lng: b.getEast() })
  }, [map, onSearch])

  // Leaflet hält Klicks im Popup für Kartenklicks, sobald React den geklickten Knopf ersetzt
  // (z. B. "Reservieren" → Auswahl), und schließt das Popup. Deshalb closeOnClick={false} am
  // Popup und hier selbst schließen – nur wenn der Klick wirklich nicht aus einem Popup kam.
  // composedPath() kennt den Weg zum Zeitpunkt des Klicks, auch wenn der Knopf inzwischen weg ist.
  useEffect(() => {
    if (!map) return
    const onClick = (e: L.LeafletMouseEvent) => {
      const fromPopup = e.originalEvent.composedPath().some((n) => n instanceof Element && n.classList.contains('leaflet-popup'))
      if (!fromPopup) map.closePopup()
    }
    map.on('click', onClick)
    return () => {
      map.off('click', onClick)
    }
  }, [map])

  // Einmal beim Start laden, danach nur per Button (keine Abfrage bei jeder Kartenbewegung).
  useEffect(() => {
    if (map) search()
  }, [map])

  return (
    <div className="relative h-full w-full">
      <MapContainer ref={setMap} center={center} zoom={15} zoomControl={false} className="h-full w-full">
        {/* Zoom rechts oben, damit das Reservierungsfeld links ihn nicht verdeckt */}
        <ZoomControl position="topright" />
        <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution={ATTRIBUTION} maxZoom={19} />
        {stations.map((s) => {
          const reservation = reservations.find((r) => r.stationId === s.id)
          const fill = reservation ? '#16a34a' : s.faultReport ? '#f59e0b' : '#3b82f6'
          return (
            <CircleMarker
              key={s.id}
              center={[s.lat, s.lng]}
              radius={reservation ? 9 : 7}
              pathOptions={{ color: '#1e3a8a', weight: 1, fillColor: fill, fillOpacity: 0.85 }}
            >
              {/* Oben Platz lassen, damit der Suchen-Button das Popup nicht verdeckt. */}
              <Popup minWidth={256} maxWidth={280} autoPanPaddingTopLeft={[16, 64]} closeOnClick={false}>
                <StationPopup station={s} reservation={reservation} onReserve={onReserve} onCancel={onCancel} plan={props.plan} trust={props.trust} />
              </Popup>
            </CircleMarker>
          )
        })}
        {PARTNER_SITES.map((site) => {
          const reservation = reservations.find((r) => r.stationId === site.id)
          return (
            <Marker key={site.id} position={[site.lat, site.lng]} icon={labelIcon(site.label, !!reservation, '#92400e')} zIndexOffset={1500}>
              <Popup minWidth={256} maxWidth={280} autoPanPaddingTopLeft={[16, 64]} closeOnClick={false}>
                <StationPopup
                  station={site}
                  reservation={reservation}
                  onReserve={onReserve}
                  onCancel={onCancel}
                  plan={props.plan}
                  trust={props.trust}
                  perk={site.perk}
                />
              </Popup>
            </Marker>
          )
        })}
        {fleetSitesFor(props.car).map((site) => {
          const reservation = reservations.find((r) => r.stationId === site.id)
          return (
            <Marker key={site.id} position={[site.lat, site.lng]} icon={labelIcon(site.label, !!reservation)} zIndexOffset={2000}>
              <Popup minWidth={256} maxWidth={280} autoPanPaddingTopLeft={[16, 64]} closeOnClick={false}>
                <StationPopup
                  station={site}
                  reservation={reservation}
                  onReserve={onReserve}
                  onCancel={onCancel}
                  plan={props.plan}
                  trust={props.trust}
                  fleetCompany={site.company}
                />
              </Popup>
            </Marker>
          )
        })}
      </MapContainer>
      <button
        onClick={search}
        disabled={!map || searching}
        className="absolute left-1/2 top-3 z-[1000] -translate-x-1/2 whitespace-nowrap rounded-full bg-white px-4 py-2 text-sm font-semibold text-gray-900 shadow-md ring-1 ring-black/10 disabled:opacity-60"
      >
        {searching ? 'Suche …' : 'In diesem Bereich suchen'}
      </button>
      {shown && (
        <ReservationCard
          reservation={shown}
          more={reservations.length - 1}
          expanded={expanded}
          onToggle={() => setExpanded((e) => !e)}
          onShowStation={() => showStation(shown)}
          onCancel={() => onCancel(shown.stationId)}
          onOpenProfile={props.onOpenProfile}
          car={props.car}
          plan={props.plan}
          trust={props.trust}
        />
      )}
    </div>
  )
}
