import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import { passesFilters } from './FilterPanel.jsx'
import { parcelToListItem, sortListItems } from './parcelListItem.js'
import { captureMapView, mapViewChangedSignificantly } from './mapViewThreshold.js'

export const QUERY_LIMIT = 2000
const DEBOUNCE_MS = 200

function buildListItems(parcels, filters, bounds) {
  const matches = []

  for (const [apn, parcel] of Object.entries(parcels)) {
    if (!passesFilters(parcel, filters)) continue
    if (parcel.lat == null || parcel.lng == null) continue
    if (!bounds.contains([parcel.lat, parcel.lng])) continue
    matches.push(parcelToListItem(apn, parcel, filters))
  }

  return {
    items: sortListItems(matches, filters).slice(0, QUERY_LIMIT),
    truncated: matches.length > QUERY_LIMIT,
  }
}

export function ViewportParcelQuery({ parcelIndex, filters, onUpdate }) {
  const map = useMap()

  useEffect(() => {
    if (!parcelIndex?.parcels || !filters) return

    let cancelled = false
    let timer
    let lastView = null

    const rebuild = () => {
      if (cancelled) return
      if (!mapViewChangedSignificantly(map, lastView)) return

      const { items, truncated } = buildListItems(
        parcelIndex.parcels,
        filters,
        map.getBounds(),
      )
      lastView = captureMapView(map)
      onUpdate({ items, loading: false, truncated, error: false })
    }

    const scheduleRebuild = () => {
      clearTimeout(timer)
      timer = setTimeout(rebuild, DEBOUNCE_MS)
    }

    scheduleRebuild()
    map.on('moveend', scheduleRebuild)

    return () => {
      cancelled = true
      clearTimeout(timer)
      map.off('moveend', scheduleRebuild)
    }
  }, [map, parcelIndex, filters, onUpdate])

  return null
}
