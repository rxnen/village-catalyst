import { useCallback, useEffect, useState } from 'react'
import ParcelListPanel from './ParcelListPanel.jsx'
import { ParcelClusterLayer, PARCEL_DETAIL_MIN_ZOOM } from './ParcelClusterLayer.jsx'
import { ParcelMapFocus } from './ParcelMapFocus.jsx'
import { ViewportParcelQuery } from './ViewportParcelQuery.jsx'
import { MapContainer, TileLayer, GeoJSON, LayersControl, useMap } from 'react-leaflet'
import { featureLayer } from 'esri-leaflet'
import FilterPanel, {
  BOTH_TRACKS_COLOR,
  TRACK_A_COLOR,
  TRACK_B_COLOR,
  formatTracks,
  leadOutline,
  parcelsWhere,
  passesFilters,
  useFilterCounts,
} from './FilterPanel.jsx'

const MAP_CENTER = [37.74, -122.05]

const PARCELS_URL =
  'https://services5.arcgis.com/ROBnTHSNjoZ2Wm1P/ArcGIS/rest/services/Parcels/FeatureServer/0'

const CATEGORY_COLORS = {
  residential: '#1565c0',
  commercial: '#ef6c00',
  industrial: '#6d4c41',
  open_space_public: '#2e7d32',
  public_institutional: '#7b1fa2',
  agriculture_rural: '#827717',
  mixed_use: '#00838f',
  other: '#757575',
  unmatched: '#bdbdbd',
}

const CATEGORY_LABELS = {
  residential: 'Residential',
  commercial: 'Commercial',
  industrial: 'Industrial',
  open_space_public: 'Open space / parks / public facilities',
  public_institutional: 'Public / institutional',
  agriculture_rural: 'Agriculture / rural',
  mixed_use: 'Mixed use',
  other: 'Other land use',
  unmatched: 'No land-use match',
}

function categoryColor(category) {
  return CATEGORY_COLORS[category] ?? CATEGORY_COLORS.unmatched
}

function landUseStyle(feature) {
  const color = categoryColor(feature.properties.category)
  return { color, weight: 1.2, fillColor: color, fillOpacity: 0.35 }
}

function onEachLandUse(feature, layer) {
  const p = feature.properties
  layer.bindPopup(
    `<b>${p.LABEL ?? p.GPLU}</b><br/>` +
      `${p.GPLU_definition ?? ''}<br/>` +
      `General Plan: ${p.General_Plan ?? '—'}`,
  )
}

function useJson(url) {
  const [data, setData] = useState(null)
  useEffect(() => {
    let cancelled = false
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setData(d)
      })
    return () => {
      cancelled = true
    }
  }, [url])
  return data
}

function AlamedaParcelsLayer({ parcelIndex, filters }) {
  const map = useMap()
  const parcels = parcelIndex?.parcels
  const [showDetail, setShowDetail] = useState(
    () => map.getZoom() >= PARCEL_DETAIL_MIN_ZOOM,
  )

  useEffect(() => {
    const update = () => setShowDetail(map.getZoom() >= PARCEL_DETAIL_MIN_ZOOM)
    map.on('zoomend', update)
    return () => map.off('zoomend', update)
  }, [map])

  useEffect(() => {
    if (!parcels || !filters || !showDetail) return

    const layer = featureLayer({
      url: PARCELS_URL,
      where: parcelsWhere(filters.cities),
      style: (feature) => {
        const apn = feature?.properties?.APN
        const parcel = parcels[apn]
        if (!parcel || !passesFilters(parcel, filters)) {
          return { opacity: 0, fillOpacity: 0, weight: 0 }
        }
        const category = parcel.land_use?.category ?? 'unmatched'
        const color = categoryColor(category)
        const outline = leadOutline(parcel)
        return {
          color: outline?.color ?? color,
          weight: outline?.weight ?? 0.6,
          fillColor: color,
          fillOpacity: category === 'unmatched' ? 0.12 : 0.25,
        }
      },
      onEachFeature: (feature, layer) => {
        const p = feature.properties
        const parcel = parcels[p.APN]
        if (!parcel || !passesFilters(parcel, filters)) return

        const match = parcel.land_use
        const cityLine = [p.SitusCity, p.SitusZip].filter(Boolean).join(' ')
        const tracks = formatTracks(parcel)
        const landUseBlock =
          match?.label
            ? `<br/><br/><b>Land use</b><br/>${match.label}<br/>${match.gplu_definition}` +
              (match.overlap_frac != null
                ? `<br/><i>${Math.round(match.overlap_frac * 100)}% parcel overlap</i>`
                : '')
            : '<br/><br/><i>No general-plan land-use match</i>'
        const ratioBlock =
          parcel.imps_land_ratio != null
            ? `<br/>Imps/Land: ${(parcel.imps_land_ratio * 100).toFixed(1)}%`
            : ''
        const trackBlock = tracks ? `<br/><b>${tracks}</b>` : ''
        layer.bindPopup(
          `<b>${p.APN ?? 'Unknown APN'}</b><br/>` +
            `${p.SitusAddress ?? 'No address'}<br/>` +
            cityLine +
            `<br/>${parcel.area_acres.toFixed(2)} acres` +
            ratioBlock +
            trackBlock +
            landUseBlock,
        )
      },
    })
    layer.addTo(map)
    return () => {
      map.removeLayer(layer)
    }
  }, [map, parcels, filters, showDetail])

  return null
}

const SATELLITE_MIN_ZOOM = 15

const CARTO_LIGHT = {
  url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
}

const SATELLITE = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  attribution:
    'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
}

function ZoomBasemap() {
  const map = useMap()
  const [satellite, setSatellite] = useState(() => map.getZoom() >= SATELLITE_MIN_ZOOM)

  useEffect(() => {
    const update = () => setSatellite(map.getZoom() >= SATELLITE_MIN_ZOOM)
    map.on('zoomend', update)
    return () => map.off('zoomend', update)
  }, [map])

  const basemap = satellite ? SATELLITE : CARTO_LIGHT
  return <TileLayer key={satellite ? 'satellite' : 'carto'} url={basemap.url} attribution={basemap.attribution} />
}

function Legend() {
  return (
    <div className="legend">
      <b>Lead tracks</b>
      <div className="legend-row">
        <span className="swatch swatch-outline" style={{ borderColor: BOTH_TRACKS_COLOR }} />
        Both tracks (strongest)
      </div>
      <div className="legend-row">
        <span className="swatch swatch-outline" style={{ borderColor: TRACK_A_COLOR }} />
        Track A — institutional / absentee
      </div>
      <div className="legend-row">
        <span className="swatch swatch-outline" style={{ borderColor: TRACK_B_COLOR }} />
        Track B — vacant taxable land
      </div>
      <b>General Plan land use</b>
      {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
        <div key={key} className="legend-row">
          <span className="swatch" style={{ background: CATEGORY_COLORS[key] }} />
          {label}
        </div>
      ))}
    </div>
  )
}

export default function App() {
  const landUse = useJson('/alameda/land_use.geojson')
  const parcelIndex = useJson('/alameda/parcel_index.json')
  const [filters, setFilters] = useState(null)

  useEffect(() => {
    if (!parcelIndex?.defaults) return
    setFilters({
      cities: [...parcelIndex.defaults.cities],
      minAcres: parcelIndex.defaults.minAcres,
      maxAcres: parcelIndex.defaults.maxAcres,
      onlyLeads: parcelIndex.defaults.onlyLeads,
      requireBothTracks: parcelIndex.defaults.requireBothTracks,
    })
  }, [parcelIndex])

  const counts = useFilterCounts(parcelIndex?.parcels, filters)
  const [listState, setListState] = useState({
    items: [],
    loading: false,
    truncated: false,
    error: false,
  })
  const onListStateChange = useCallback((next) => setListState(next), [])
  const [selectedApn, setSelectedApn] = useState(null)

  return (
    <div className="app">
      <MapContainer center={MAP_CENTER} zoom={11} className="map">
        <ZoomBasemap />
        {parcelIndex && filters && (
          <>
            <ParcelClusterLayer parcelIndex={parcelIndex} filters={filters} />
            <AlamedaParcelsLayer parcelIndex={parcelIndex} filters={filters} />
            <ViewportParcelQuery
              parcelIndex={parcelIndex}
              filters={filters}
              onUpdate={onListStateChange}
            />
            <ParcelMapFocus apn={selectedApn} />
          </>
        )}
        {landUse && parcelIndex && (
          <LayersControl position="bottomright">
            <LayersControl.Overlay name="General Plan land use">
              <GeoJSON
                data={landUse}
                style={landUseStyle}
                onEachFeature={onEachLandUse}
              />
            </LayersControl.Overlay>
          </LayersControl>
        )}
      </MapContainer>
      <FilterPanel
        filters={filters}
        onChange={setFilters}
        counts={counts}
        availableCities={parcelIndex?.defaults?.cities ?? []}
      />
      <ParcelListPanel
        categoryLabels={CATEGORY_LABELS}
        categoryColors={CATEGORY_COLORS}
        listState={listState}
        selectedApn={selectedApn}
        onParcelSelect={setSelectedApn}
      />
      <Legend />
    </div>
  )
}
