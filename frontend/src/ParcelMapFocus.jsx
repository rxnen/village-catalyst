import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import { query } from 'esri-leaflet'

const PARCELS_URL =
  'https://services5.arcgis.com/ROBnTHSNjoZ2Wm1P/ArcGIS/rest/services/Parcels/FeatureServer/0'

const FOCUS_MAX_ZOOM = 17

function apnWhere(apn) {
  return `APN='${String(apn).replace(/'/g, "''")}'`
}

export function ParcelMapFocus({ apn }) {
  const map = useMap()

  useEffect(() => {
    if (!apn) return

    let cancelled = false

    query({ url: PARCELS_URL })
      .where(apnWhere(apn))
      .returnGeometry(true)
      .limit(1)
      .run((err, featureCollection) => {
        if (cancelled || err) return

        const feature = featureCollection.features?.[0]
        if (!feature) return

        const bounds = L.geoJSON(feature).getBounds()
        if (!bounds.isValid()) return

        map.flyToBounds(bounds, {
          padding: [60, 60],
          maxZoom: FOCUS_MAX_ZOOM,
          duration: 0.75,
        })
      })

    return () => {
      cancelled = true
    }
  }, [map, apn])

  return null
}
