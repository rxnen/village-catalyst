import { useEffect, useState } from 'react'
import { GeoJSON, LayersControl } from 'react-leaflet'

export const PARK_OVERLAY_NAME = 'Protected parks (CPAD)'

const CPAD_URL =
  'https://services1.arcgis.com/4ZKi1B1zTblbwgWB/arcgis/rest/services/CPAD_Holdings_Current_Release/FeatureServer/0'

const CPAD_WHERE = "COUNTY='Alameda'"

const PARK_STYLE = {
  color: '#1b5e20',
  weight: 1.2,
  opacity: 0.9,
  fillColor: '#2e7d32',
  fillOpacity: 0.32,
}

const TRAIL_STYLE = {
  color: '#558b2f',
  weight: 1.6,
  opacity: 0.95,
  fillColor: '#9ccc65',
  fillOpacity: 0.12,
}

const TRAIL_SPEC_USE = 'trail corridor'
const TRAIL_NAME_RE = /\b(trail|greenway|bike path|bicycle path|trailway)\b/i
const PARK_NAME_RE = /\b(park|preserve|recreation area|botanical|playground|garden)\b/i

export function isCpadTrailCorridor(props = {}) {
  const spec = String(props.SPEC_USE ?? '').trim().toLowerCase()
  if (spec === TRAIL_SPEC_USE) return true
  const name = `${props.UNIT_NAME ?? ''} ${props.SITE_NAME ?? ''}`.trim()
  return TRAIL_NAME_RE.test(name) && !PARK_NAME_RE.test(name)
}

async function fetchCpadHoldings(signal) {
  const pageSize = 2000
  let offset = 0
  const features = []
  for (;;) {
    const params = new URLSearchParams({
      where: CPAD_WHERE,
      outFields:
        'UNIT_NAME,SITE_NAME,SPEC_USE,ACCESS_TYP,AGNCY_NAME,LAYER,COUNTY,ACRES,PARK_URL',
      outSR: '4326',
      f: 'geojson',
      resultRecordCount: String(pageSize),
      resultOffset: String(offset),
    })
    const res = await fetch(`${CPAD_URL}/query?${params.toString()}`, { signal })
    if (!res.ok) throw new Error(`CPAD holdings HTTP ${res.status}`)
    const data = await res.json()
    const batch = Array.isArray(data.features) ? data.features : []
    features.push(...batch)
    const more = data.properties?.exceededTransferLimit && batch.length > 0
    if (!more) break
    offset += batch.length
  }
  return { type: 'FeatureCollection', features }
}

function useCpadHoldings() {
  const [data, setData] = useState(null)
  useEffect(() => {
    const controller = new AbortController()
    fetchCpadHoldings(controller.signal)
      .then(setData)
      .catch((err) => {
        if (err.name !== 'AbortError') {
          console.error('Failed to load CPAD holdings', err)
        }
      })
    return () => controller.abort()
  }, [])
  return data
}

function onEachHolding(feature, layer) {
  const p = feature.properties ?? {}
  const name = p.UNIT_NAME || p.SITE_NAME || 'Protected area'
  const agency = p.AGNCY_NAME ? `<br/>${p.AGNCY_NAME}` : ''
  const access = p.ACCESS_TYP ? `<br/>${p.ACCESS_TYP}` : ''
  const spec = String(p.SPEC_USE ?? '').trim()
  const specLine = spec ? `<br/>${spec}` : ''
  const trail = isCpadTrailCorridor(p) ? '<br/><i>Trail corridor (not an exclusion)</i>' : ''
  const acres =
    p.ACRES != null && Number.isFinite(Number(p.ACRES))
      ? `<br/>${Number(p.ACRES).toFixed(1)} acres`
      : ''
  const link = p.PARK_URL
    ? `<br/><a href="${p.PARK_URL}" target="_blank" rel="noreferrer">Park website</a>`
    : ''
  layer.bindPopup(`<b>${name}</b>${agency}${access}${specLine}${trail}${acres}${link}`)
}

function holdingStyle(feature) {
  return isCpadTrailCorridor(feature?.properties) ? TRAIL_STYLE : PARK_STYLE
}

/** CPAD holdings for Alameda (visualization; filtering uses precomputed park_overlap_frac). */
export function ParkLayer() {
  const data = useCpadHoldings()
  return (
    <LayersControl.Overlay name={PARK_OVERLAY_NAME}>
      {data ? (
        <GeoJSON data={data} style={holdingStyle} onEachFeature={onEachHolding} />
      ) : null}
    </LayersControl.Overlay>
  )
}
