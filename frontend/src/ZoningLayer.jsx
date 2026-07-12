import { useEffect, useState } from 'react'
import { GeoJSON, LayerGroup, LayersControl, useMap } from 'react-leaflet'
import {
  resolveZoningTier,
  styleForZoningTier,
  zoneIdentity,
} from './zoningTiers.js'

export const ZONING_OVERLAY_NAME = 'Zoning tiers'

const ZONING_FILES = [
  { city: 'Oakland', url: '/alameda/zoning/Oakland.geojson' },
  { city: 'Berkeley', url: '/alameda/zoning/Berkeley.geojson' },
  { city: 'San Leandro', url: '/alameda/zoning/SanLeandro.geojson' },
  { city: 'Hayward', url: '/alameda/zoning/Hayward.geojson' },
]

const OAKLAND_HIT_URL = '/alameda/zoning/Oakland_hit.geojson'
const ZONING_TIERS_URL = '/alameda/zoning/zoning_tiers.json'

const ZONING_PANE = 'zoningPane'
const HIT_ZONING_PANE = 'zoningHitPane'

function useJson(url) {
  const [data, setData] = useState(null)
  useEffect(() => {
    let cancelled = false
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load ${url}`)
        return r.json()
      })
      .then((d) => {
        if (!cancelled) setData(d)
      })
      .catch((err) => {
        console.error(err)
      })
    return () => {
      cancelled = true
    }
  }, [url])
  return data
}

function useZoningData() {
  const [collections, setCollections] = useState([])

  useEffect(() => {
    let cancelled = false
    Promise.all(
      ZONING_FILES.map(async ({ city, url }) => {
        const response = await fetch(url)
        if (!response.ok) throw new Error(`Failed to load ${url}`)
        const data = await response.json()
        return { city, data }
      }),
    )
      .then((loaded) => {
        if (!cancelled) setCollections(loaded)
      })
      .catch((err) => {
        console.error('Zoning layer failed to load', err)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return collections
}

function makeZoningStyle(tiersByCity, city, { highlight = false } = {}) {
  return (feature) => {
    const match = resolveZoningTier(tiersByCity, city, feature?.properties)
    return styleForZoningTier(match, { highlight })
  }
}

function onEachZoningFeature(tiersByCity, city, { hit = false } = {}) {
  return (feature, layer) => {
    const props = feature?.properties || {}
    const match = resolveZoningTier(tiersByCity, city, props)
    const { base, overlay, full } = zoneIdentity(city, props)
    const label = full || base || 'Zoning'
    const tierLine = match.tier
      ? `Tier ${match.tier} (matched ${match.matchedZone})`
      : 'No tier match'
    const overlayLine = overlay ? `<br/>Overlay: ${overlay}` : ''
    const hitLine = hit ? '<br/><i>Hit by viable Oakland parcels</i>' : ''
    layer.bindPopup(
      `<b>${label}</b><br/>${city}<br/>${tierLine}${overlayLine}${hitLine}`,
    )
  }
}

export function ZoningLayer() {
  const map = useMap()
  const collections = useZoningData()
  const tiersPayload = useJson(ZONING_TIERS_URL)
  const oaklandHits = useJson(OAKLAND_HIT_URL)
  const tiersByCity = tiersPayload?.by_city

  useEffect(() => {
    if (!map.getPane(ZONING_PANE)) {
      const pane = map.createPane(ZONING_PANE)
      // Above basemap tiles (200), below interactive overlays / parcels (400).
      pane.style.zIndex = 350
    }
    if (!map.getPane(HIT_ZONING_PANE)) {
      const pane = map.createPane(HIT_ZONING_PANE)
      pane.style.zIndex = 360
    }
  }, [map])

  const ready = collections.length > 0 && tiersByCity

  return (
    <LayersControl.Overlay name={ZONING_OVERLAY_NAME}>
      {ready ? (
        <LayerGroup>
          {collections.map(({ city, data }) => (
            <GeoJSON
              key={city}
              data={data}
              style={makeZoningStyle(tiersByCity, city)}
              pane={ZONING_PANE}
              onEachFeature={onEachZoningFeature(tiersByCity, city)}
            />
          ))}
          {oaklandHits && (
            <GeoJSON
              data={oaklandHits}
              style={makeZoningStyle(tiersByCity, 'Oakland', { highlight: true })}
              pane={HIT_ZONING_PANE}
              onEachFeature={onEachZoningFeature(tiersByCity, 'Oakland', {
                hit: true,
              })}
            />
          )}
        </LayerGroup>
      ) : null}
    </LayersControl.Overlay>
  )
}
