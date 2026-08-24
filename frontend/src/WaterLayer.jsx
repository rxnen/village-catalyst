import { useEffect, useState } from 'react'
import { GeoJSON, LayersControl } from 'react-leaflet'

export const WATER_OVERLAY_NAME = 'Open water (bay / ocean)'

const WATER_URL = '/alameda/open_water.geojson'

const WATER_STYLE = {
  color: '#01579b',
  weight: 1.2,
  opacity: 0.9,
  fillColor: '#0288d1',
  fillOpacity: 0.28,
}

function useOpenWater() {
  const [data, setData] = useState(null)
  useEffect(() => {
    const controller = new AbortController()
    fetch(WATER_URL, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Open water HTTP ${res.status}`)
        return res.json()
      })
      .then(setData)
      .catch((err) => {
        if (err.name !== 'AbortError') {
          console.error('Failed to load open-water overlay', err)
        }
      })
    return () => controller.abort()
  }, [])
  return data
}

function onEachWater(feature, layer) {
  const p = feature.properties ?? {}
  const name = p.FULLNAME || 'Open water'
  const code = p.MTFCC ? `<br/>${p.MTFCC}` : ''
  layer.bindPopup(`<b>${name}</b>${code}<br/>Bay / ocean (Census TIGER)`)
}

/** Census TIGER open-water polygons (visualization; filtering uses precomputed water_overlap_frac). */
export function WaterLayer() {
  const data = useOpenWater()
  return (
    <LayersControl.Overlay name={WATER_OVERLAY_NAME}>
      {data ? (
        <GeoJSON data={data} style={WATER_STYLE} onEachFeature={onEachWater} />
      ) : null}
    </LayersControl.Overlay>
  )
}
