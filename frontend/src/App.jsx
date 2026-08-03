import { useCallback, useEffect, useMemo, useState } from 'react'
import ParcelListPanel from './ParcelListPanel.jsx'
import { ParcelClusterLayer, PARCEL_DETAIL_MIN_ZOOM } from './ParcelClusterLayer.jsx'
import { ParcelMapFocus } from './ParcelMapFocus.jsx'
import { ViewportParcelQuery } from './ViewportParcelQuery.jsx'
import { MapContainer, TileLayer, GeoJSON, LayersControl, useMap } from 'react-leaflet'
import { featureLayer } from 'esri-leaflet'
import FilterPanel, {
  formatTracks,
  parcelsWhere,
  passesFilters,
  countMatching,
  defaultEnabledFilters,
  effectiveCities,
} from './FilterPanel.jsx'
import { attachExcludedCodes, defaultIncludeClusters } from './useCodeClusters.js'
import {
  CLEANUP_STATUS_TIERS,
  HAZARD_LAYERS,
  hazardOnEachFeature,
  hazardPointToLayer,
  useEnviroStorCleanupSites,
  useEnviroStorLayer,
} from './envirostor.js'
import { DEFAULT_ENV_THRESHOLDS } from './envirostorProximity.js'
import { HIERARCHY_TIERS, parcelScore } from './parcelScore.js'
import { isSatelliteZoom, styleParcelFeature } from './parcelStyle.js'
import { attachParcelPopupSelect, parcelDetailLink } from './parcelPopup.js'
import { ZoningLayer, ZONING_OVERLAY_NAME } from './ZoningLayer.jsx'
import { FreewayLayer } from './FreewayLayer.jsx'
import {
  ZONING_TIER_COLORS,
  ZONING_TIER_LABELS,
} from './zoningTiers.js'
import {
  DEFAULT_SLOPE_STEEP_PCT,
  SLOPE_TIERS,
  defaultIncludeSlopeTiers,
  formatSlopeSummary,
} from './slopeTiers.js'

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

function AlamedaParcelsLayer({ parcelIndex, filters, onParcelSelect }) {
  const map = useMap()
  const parcels = parcelIndex?.parcels
  const [showDetail, setShowDetail] = useState(
    () => map.getZoom() >= PARCEL_DETAIL_MIN_ZOOM,
  )
  const [satellite, setSatellite] = useState(() => isSatelliteZoom(map.getZoom()))

  useEffect(() => {
    if (!onParcelSelect) return
    return attachParcelPopupSelect(map, onParcelSelect)
  }, [map, onParcelSelect])

  useEffect(() => {
    const update = () => {
      setShowDetail(map.getZoom() >= PARCEL_DETAIL_MIN_ZOOM)
      setSatellite(isSatelliteZoom(map.getZoom()))
    }
    map.on('zoomend', update)
    return () => map.off('zoomend', update)
  }, [map])

  useEffect(() => {
    if (!parcels || !filters || !showDetail) return

    const allCities = parcelIndex?.defaults?.cities ?? []
    const layer = featureLayer({
      url: PARCELS_URL,
      where: parcelsWhere(effectiveCities(filters, allCities)),
      style: (feature) => {
        const apn = feature?.properties?.APN
        const parcel = parcels[apn]
        if (!parcel || !passesFilters(parcel, filters)) {
          return { opacity: 0, fillOpacity: 0, weight: 0 }
        }
        return styleParcelFeature(parcel, {
          satellite,
          maxCoverageRatio: filters.maxCoverageRatio,
        })
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
        const coverageBlock =
          parcel.coverage_ratio != null
            ? `<br/>Footprint coverage: ${(parcel.coverage_ratio * 100).toFixed(1)}%`
            : ''
        const steepPct =
          parcelIndex?.defaults?.slopeSteepPct ?? DEFAULT_SLOPE_STEEP_PCT
        const slopeLine = formatSlopeSummary(parcel, steepPct)
        const slopeBlock = slopeLine ? `<br/>${slopeLine}` : ''
        const trackBlock = tracks ? `<br/><b>${tracks}</b>` : ''
        const { total: scoreTotal, breakdown } = parcelScore(
          parcel,
          filters.maxCoverageRatio,
        )
        const zoning = parcel.zoning
        const zoningPts = breakdown.zoning
        const zoningSign = zoningPts > 0 ? `+${zoningPts}` : String(zoningPts)
        const zoningBlock = zoning?.tier
          ? `<br/>Zoning: <b>${zoning.matched_zone || zoning.base_zone || '—'}</b> · Tier ${zoning.tier} (${zoningSign})`
          : '<br/>Zoning: <i>unmatched</i>'
        const scoreBlock =
          `<br/><b>Vacancy score: ${scoreTotal}</b>` +
          (breakdown.synergy
            ? ' <i>(includes synergy bonus)</i>'
            : '')
        layer.bindPopup(
          `<b>${p.APN ?? 'Unknown APN'}</b><br/>` +
            `${p.SitusAddress ?? 'No address'}<br/>` +
            cityLine +
            `<br/>${parcel.area_acres.toFixed(2)} acres` +
            ratioBlock +
            coverageBlock +
            slopeBlock +
            zoningBlock +
            scoreBlock +
            trackBlock +
            landUseBlock +
            parcelDetailLink(p.APN),
        )
      },
    })
    layer.addTo(map)
    return () => {
      map.removeLayer(layer)
    }
  }, [map, parcels, filters, showDetail, satellite, parcelIndex])

  return null
}

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
  const [satellite, setSatellite] = useState(() => isSatelliteZoom(map.getZoom()))

  useEffect(() => {
    const update = () => setSatellite(isSatelliteZoom(map.getZoom()))
    map.on('zoomend', update)
    return () => map.off('zoomend', update)
  }, [map])

  const basemap = satellite ? SATELLITE : CARTO_LIGHT
  return <TileLayer key={satellite ? 'satellite' : 'carto'} url={basemap.url} attribution={basemap.attribution} />
}

function HazardOverlay({ layer, data: sharedData }) {
  const fetched = useEnviroStorLayer(sharedData ? null : layer.id)
  const data = sharedData ?? fetched
  return (
    <LayersControl.Overlay name={layer.name}>
      {data ? (
        <GeoJSON
          data={data}
          pointToLayer={hazardPointToLayer(layer)}
          onEachFeature={hazardOnEachFeature(layer)}
        />
      ) : null}
    </LayersControl.Overlay>
  )
}

const HAZARD_LAYER_NAMES = new Set(HAZARD_LAYERS.map((layer) => layer.name))

/** Syncs LayersControl overlay toggles into React state (hazards + zoning). */
function OverlayVisibilityTracker({ onHazardChange, onZoningChange }) {
  const map = useMap()
  useEffect(() => {
    const onAdd = (event) => {
      if (HAZARD_LAYER_NAMES.has(event.name)) onHazardChange(event.name, true)
      if (event.name === ZONING_OVERLAY_NAME) onZoningChange(true)
    }
    const onRemove = (event) => {
      if (HAZARD_LAYER_NAMES.has(event.name)) onHazardChange(event.name, false)
      if (event.name === ZONING_OVERLAY_NAME) onZoningChange(false)
    }
    map.on('overlayadd', onAdd)
    map.on('overlayremove', onRemove)
    return () => {
      map.off('overlayadd', onAdd)
      map.off('overlayremove', onRemove)
    }
  }, [map, onHazardChange, onZoningChange])
  return null
}

function Legend() {
  return (
    <div className="legend legend-compact" title="Parcel outline colors by vacancy score">
      {HIERARCHY_TIERS.map((tier) => (
        <div key={tier.id} className="legend-row" title={tier.hint}>
          <span className="swatch swatch-outline" style={{ borderColor: tier.color }} />
          {tier.label} ({tier.minScore}+)
        </div>
      ))}
    </div>
  )
}

function SlopeLegend() {
  const rangeLabel = (tier, index) => {
    const prev = index === 0 ? 0 : SLOPE_TIERS[index - 1].maxMeanPct
    if (!Number.isFinite(tier.maxMeanPct)) return `≥${prev}%`
    if (index === 0) return `<${tier.maxMeanPct}%`
    return `${prev}–${tier.maxMeanPct}%`
  }
  return (
    <div className="legend slope-legend" title="Parcel fill colors by mean percent grade (USGS 3DEP)">
      <div className="hazard-legend-title">Slope (fill)</div>
      {SLOPE_TIERS.map((tier, index) => (
        <div key={tier.id} className="legend-row" title={tier.hint}>
          <span className="swatch" style={{ background: tier.fillColor }} />
          {tier.label} ({rangeLabel(tier, index)})
        </div>
      ))}
    </div>
  )
}

function ZoningTierLegend() {
  return (
    <div className="legend zoning-tier-legend" title="Zoning tiers from Zoning.xlsx">
      <div className="hazard-legend-title">Zoning tiers</div>
      {['A', 'B', 'C'].map((tier) => (
        <div key={tier} className="legend-row">
          <span
            className="swatch"
            style={{ background: ZONING_TIER_COLORS[tier].fillColor }}
          />
          {ZONING_TIER_LABELS[tier]}
        </div>
      ))}
    </div>
  )
}

function HazardLegend({ stackedAboveZoning = false }) {
  const cleanupTiers = ['strong', 'medium', 'note'].map((id) => CLEANUP_STATUS_TIERS[id])
  const otherLayers = HAZARD_LAYERS.filter((layer) => layer.schema !== 'cleanup')

  return (
    <div
      className={`legend hazard-legend${stackedAboveZoning ? ' hazard-legend-above-zoning' : ''}`}
      title="EnviroStor environmental hazard sites"
    >
      <div className="hazard-legend-title">Environmental hazards</div>
      <div className="hazard-legend-subtitle">Cleanup sites (by status)</div>
      {cleanupTiers.map((tier) => (
        <div key={tier.id} className="legend-row" title={tier.hint}>
          <span className="swatch swatch-dot" style={{ background: tier.color }} />
          {tier.label}
        </div>
      ))}
      {otherLayers.map((layer) => (
        <div key={layer.key} className="legend-row">
          <span className="swatch swatch-dot" style={{ background: layer.color }} />
          {layer.name}
        </div>
      ))}
    </div>
  )
}

export default function App() {
  const landUse = useJson('/alameda/land_use.geojson')
  const parcelIndex = useJson('/alameda/parcel_index.json')
  const cleanupGeoJSON = useEnviroStorCleanupSites()
  const [filters, setFilters] = useState(null)

  useEffect(() => {
    if (!parcelIndex?.defaults) return
    const d = parcelIndex.defaults
    setFilters(
      attachExcludedCodes({
        cities: [...d.cities],
        minAcres: d.minAcres,
        maxAcres: d.maxAcres,
        maxAspectRatio: d.maxAspectRatio ?? 6,
        minUsableWidthM: d.minUsableWidthM ?? 20,
        maxCoverageRatio: d.maxCoverageRatio ?? 0.2,
        onlyLeads: d.onlyLeads,
        requireBothTracks: d.requireBothTracks,
        includeClusters: {
          ...defaultIncludeClusters(),
          ...d.includeClusters,
        },
        includeSlopeTiers: {
          ...defaultIncludeSlopeTiers(),
          ...d.includeSlopeTiers,
        },
        envStrongMeters: d.envStrongMeters ?? DEFAULT_ENV_THRESHOLDS.envStrongMeters,
        envMediumMeters: d.envMediumMeters ?? DEFAULT_ENV_THRESHOLDS.envMediumMeters,
        envNoteMeters: d.envNoteMeters ?? DEFAULT_ENV_THRESHOLDS.envNoteMeters,
        enabled: defaultEnabledFilters(),
      }),
    )
  }, [parcelIndex])

  const counts = useMemo(
    () => countMatching(parcelIndex?.parcels, filters),
    [parcelIndex, filters],
  )
  const [listState, setListState] = useState({
    items: [],
    loading: false,
    truncated: false,
    error: false,
  })
  const onListStateChange = useCallback((next) => setListState(next), [])
  const [selectedApn, setSelectedApn] = useState(null)
  const [filtersExpanded, setFiltersExpanded] = useState(false)
  const [hazardLayerOn, setHazardLayerOn] = useState(() =>
    Object.fromEntries(HAZARD_LAYERS.map((layer) => [layer.name, false])),
  )
  const [zoningVisible, setZoningVisible] = useState(false)
  const onHazardVisibility = useCallback((name, visible) => {
    setHazardLayerOn((prev) =>
      prev[name] === visible ? prev : { ...prev, [name]: visible },
    )
  }, [])
  const onZoningVisibility = useCallback((visible) => {
    setZoningVisible(visible)
  }, [])
  const anyHazardVisible = Object.values(hazardLayerOn).some(Boolean)

  return (
    <div className={`app${filtersExpanded ? ' app-filters-expanded' : ''}`}>
      <MapContainer center={MAP_CENTER} zoom={11} className="map">
        <ZoomBasemap />
        {parcelIndex && filters && (
          <>
            <ParcelClusterLayer parcelIndex={parcelIndex} filters={filters} />
            <AlamedaParcelsLayer
              parcelIndex={parcelIndex}
              filters={filters}
              onParcelSelect={setSelectedApn}
            />
            <ViewportParcelQuery
              parcelIndex={parcelIndex}
              filters={filters}
              onUpdate={onListStateChange}
            />
            <ParcelMapFocus
              apn={selectedApn}
              lat={parcelIndex.parcels?.[selectedApn]?.lat}
              lng={parcelIndex.parcels?.[selectedApn]?.lng}
            />
          </>
        )}
        <LayersControl position="bottomright">
          <ZoningLayer />
          <FreewayLayer />
          {landUse && parcelIndex && (
            <LayersControl.Overlay name="General Plan land use">
              <GeoJSON
                data={landUse}
                style={landUseStyle}
                onEachFeature={onEachLandUse}
              />
            </LayersControl.Overlay>
          )}
          {HAZARD_LAYERS.map((layer) => (
            <HazardOverlay
              key={layer.key}
              layer={layer}
              data={layer.id === 0 ? cleanupGeoJSON : undefined}
            />
          ))}
        </LayersControl>
        <OverlayVisibilityTracker
          onHazardChange={onHazardVisibility}
          onZoningChange={onZoningVisibility}
        />
      </MapContainer>
      <FilterPanel
        filters={filters}
        onChange={setFilters}
        counts={counts}
        availableCities={parcelIndex?.defaults?.cities ?? []}
        expanded={filtersExpanded}
        onExpandedChange={setFiltersExpanded}
      />
      <ParcelListPanel
        categoryLabels={CATEGORY_LABELS}
        categoryColors={CATEGORY_COLORS}
        listState={listState}
        parcelIndex={parcelIndex}
        selectedApn={selectedApn}
        onParcelSelect={setSelectedApn}
        filters={filters}
      />
      {!filtersExpanded && (
        <>
          <Legend />
          <SlopeLegend />
          {zoningVisible && <ZoningTierLegend />}
          {anyHazardVisible && (
            <HazardLegend stackedAboveZoning={zoningVisible} />
          )}
        </>
      )}
    </div>
  )
}
