import { useEffect, useMemo, useState } from 'react'
import buffer from '@turf/buffer'
import { GeoJSON, LayerGroup, LayersControl } from 'react-leaflet'

export const FREEWAY_OVERLAY_NAME = 'State highways (SHN)'

const SHN_URL =
  'https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHhighway/SHN_Lines/FeatureServer/0'

const SHN_WHERE = "County='ALA'"
const BUFFER_METERS = 20

const FREEWAY_STYLE = {
  color: '#ff1493',
  weight: 3.5,
  opacity: 1,
  fillOpacity: 0,
}

/** Neon orange outline of the ~20 m buffer around each SHN centerline. */
const BUFFER_STYLE = {
  color: '#ff5f1f',
  weight: 2.5,
  opacity: 1,
  fillOpacity: 0,
}

async function fetchShnLines(signal) {
  const pageSize = 2000
  let offset = 0
  const features = []
  for (;;) {
    const params = new URLSearchParams({
      where: SHN_WHERE,
      outFields: 'Route,RouteS,RouteType,County,Direction,AlignCode',
      outSR: '4326',
      f: 'geojson',
      resultRecordCount: String(pageSize),
      resultOffset: String(offset),
    })
    const res = await fetch(`${SHN_URL}/query?${params.toString()}`, { signal })
    if (!res.ok) throw new Error(`SHN lines HTTP ${res.status}`)
    const data = await res.json()
    const batch = Array.isArray(data.features) ? data.features : []
    features.push(...batch)
    const more = data.properties?.exceededTransferLimit && batch.length > 0
    if (!more) break
    offset += batch.length
  }
  return { type: 'FeatureCollection', features }
}

function bufferShnLines(lines) {
  const features = []
  for (const feature of lines.features) {
    try {
      const buffered = buffer(feature, BUFFER_METERS, { units: 'meters' })
      if (buffered) features.push(buffered)
    } catch (err) {
      console.warn('SHN buffer failed for feature', feature?.properties, err)
    }
  }
  return { type: 'FeatureCollection', features }
}

function useShnLines() {
  const [data, setData] = useState(null)
  useEffect(() => {
    const controller = new AbortController()
    fetchShnLines(controller.signal)
      .then(setData)
      .catch((err) => {
        if (err.name !== 'AbortError') {
          console.error('Failed to load Caltrans SHN lines', err)
        }
      })
    return () => controller.abort()
  }, [])
  return data
}

function onEachFreeway(feature, layer) {
  const p = feature.properties ?? {}
  const route = p.RouteS || p.Route || '?'
  const type = p.RouteType || 'Highway'
  const dir = p.Direction ? ` · ${p.Direction}` : ''
  layer.bindPopup(`<b>${type} ${route}</b>${dir}<br/>County: ${p.County ?? '—'}`)
}

function onEachBuffer(feature, layer) {
  const p = feature.properties ?? {}
  const route = p.RouteS || p.Route || '?'
  const type = p.RouteType || 'Highway'
  layer.bindPopup(
    `<b>${type} ${route}</b><br/>${BUFFER_METERS} m buffer<br/>County: ${p.County ?? '—'}`,
  )
}

/** Caltrans State Highway Network lines for Alameda (visualization; filtering uses precomputed freeway_overlap_frac). */
export function FreewayLayer() {
  const data = useShnLines()
  const buffers = useMemo(() => (data ? bufferShnLines(data) : null), [data])
  return (
    <LayersControl.Overlay name={FREEWAY_OVERLAY_NAME}>
      {data && buffers ? (
        <LayerGroup>
          <GeoJSON data={buffers} style={BUFFER_STYLE} onEachFeature={onEachBuffer} />
          <GeoJSON data={data} style={FREEWAY_STYLE} onEachFeature={onEachFreeway} />
        </LayerGroup>
      ) : null}
    </LayersControl.Overlay>
  )
}
