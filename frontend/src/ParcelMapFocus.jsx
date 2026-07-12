import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import { captureMapView } from './mapViewThreshold.js'

const FOCUS_MAX_ZOOM = 17
const FLY_DURATION = 0.75

export function ParcelMapFocus({ apn, lat, lng }) {
  const map = useMap()
  const savedViewRef = useRef(null)
  const prevApnRef = useRef(null)

  useEffect(() => {
    const prevApn = prevApnRef.current
    prevApnRef.current = apn

    if (!apn) {
      const saved = savedViewRef.current
      savedViewRef.current = null
      if (saved && prevApn) {
        map.flyTo(saved.center, saved.zoom, { duration: FLY_DURATION })
      }
      return
    }

    if (lat == null || lng == null) return

    // Remember the view from before the first focus in this selection session.
    if (!prevApn) {
      savedViewRef.current = captureMapView(map)
    }

    map.flyTo([lat, lng], FOCUS_MAX_ZOOM, { duration: FLY_DURATION })
  }, [map, apn, lat, lng])

  return null
}
