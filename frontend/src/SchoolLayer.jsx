import { useEffect, useState } from 'react'
import { GeoJSON, LayersControl } from 'react-leaflet'

export const SCHOOL_OVERLAY_NAME = 'Active school campuses (CSCD)'

const CSCD_URL =
  'https://services1.arcgis.com/4ZKi1B1zTblbwgWB/arcgis/rest/services/California_School_Campus_Database_2025/FeatureServer/0'

const CSCD_WHERE = "County='Alameda' AND Status='Active'"

const SCHOOL_STYLE = {
  color: '#6a1b9a',
  weight: 1.5,
  opacity: 0.9,
  fillColor: '#8e24aa',
  fillOpacity: 0.28,
}

async function fetchCscdCampuses(signal) {
  const pageSize = 2000
  let offset = 0
  const features = []
  for (;;) {
    const params = new URLSearchParams({
      where: CSCD_WHERE,
      outFields: 'School,District,Status,County,Level_,Street,City',
      outSR: '4326',
      f: 'geojson',
      resultRecordCount: String(pageSize),
      resultOffset: String(offset),
    })
    const res = await fetch(`${CSCD_URL}/query?${params.toString()}`, { signal })
    if (!res.ok) throw new Error(`CSCD campuses HTTP ${res.status}`)
    const data = await res.json()
    const batch = Array.isArray(data.features) ? data.features : []
    features.push(...batch)
    const more = data.properties?.exceededTransferLimit && batch.length > 0
    if (!more) break
    offset += batch.length
  }
  return { type: 'FeatureCollection', features }
}

function useCscdCampuses() {
  const [data, setData] = useState(null)
  useEffect(() => {
    const controller = new AbortController()
    fetchCscdCampuses(controller.signal)
      .then(setData)
      .catch((err) => {
        if (err.name !== 'AbortError') {
          console.error('Failed to load CSCD school campuses', err)
        }
      })
    return () => controller.abort()
  }, [])
  return data
}

function onEachCampus(feature, layer) {
  const p = feature.properties ?? {}
  const name = p.School || 'School campus'
  const district = p.District ? `<br/>${p.District}` : ''
  const level = p.Level_ ? `<br/>${p.Level_}` : ''
  const city = p.City || p.County || '—'
  layer.bindPopup(`<b>${name}</b>${district}${level}<br/>${city}<br/>Status: ${p.Status ?? '—'}`)
}

/** CSCD active campuses for Alameda (visualization; filtering uses precomputed school_overlap_frac). */
export function SchoolLayer() {
  const data = useCscdCampuses()
  return (
    <LayersControl.Overlay name={SCHOOL_OVERLAY_NAME}>
      {data ? (
        <GeoJSON data={data} style={SCHOOL_STYLE} onEachFeature={onEachCampus} />
      ) : null}
    </LayersControl.Overlay>
  )
}
