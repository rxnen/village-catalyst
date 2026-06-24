import { useEffect, useState } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet.markercluster'
import { passesFilters } from './FilterPanel.jsx'

export const PARCEL_DETAIL_MIN_ZOOM = 14
const DEBOUNCE_MS = 200

function clusterIcon(cluster) {
  const count = cluster.getChildCount()
  const size = count < 100 ? 36 : count < 1000 ? 44 : 52
  return L.divIcon({
    html: `<div class="parcel-cluster-marker"><span>${count.toLocaleString()}</span></div>`,
    className: 'parcel-cluster-icon',
    iconSize: [size, size],
  })
}

function markersInView(parcels, filters, bounds) {
  const markers = []
  for (const parcel of Object.values(parcels)) {
    if (!passesFilters(parcel, filters)) continue
    if (parcel.lat == null || parcel.lng == null) continue
    if (!bounds.contains([parcel.lat, parcel.lng])) continue
    markers.push(L.marker([parcel.lat, parcel.lng]))
  }
  return markers
}

export function ParcelClusterLayer({ parcelIndex, filters }) {
  const map = useMap()
  const parcels = parcelIndex?.parcels
  const [showClusters, setShowClusters] = useState(
    () => map.getZoom() < PARCEL_DETAIL_MIN_ZOOM,
  )

  useEffect(() => {
    const update = () => setShowClusters(map.getZoom() < PARCEL_DETAIL_MIN_ZOOM)
    map.on('zoomend', update)
    return () => map.off('zoomend', update)
  }, [map])

  useEffect(() => {
    if (!parcels || !filters || !showClusters) return

    let cancelled = false
    let timer
    let group = null

    const rebuild = () => {
      if (group) {
        map.removeLayer(group)
        group = null
      }
      if (cancelled) return

      group = L.markerClusterGroup({
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: false,
        maxClusterRadius: 55,
        iconCreateFunction: clusterIcon,
      })

      const bounds = map.getBounds().pad(0.12)
      group.addLayers(markersInView(parcels, filters, bounds))
      map.addLayer(group)
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
      if (group) map.removeLayer(group)
    }
  }, [map, parcels, filters, showClusters])

  return null
}
