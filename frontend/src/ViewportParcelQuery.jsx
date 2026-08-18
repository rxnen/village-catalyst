import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import { formatTracks, leadRank, passesFilters } from './FilterPanel.jsx'
import {
  effectiveUseCodeRank,
  parcelListRank,
} from './useCodeRank.js'
import { parcelHierarchyTier, parcelScore } from './parcelScore.js'
import { captureMapView, mapViewChangedSignificantly } from './mapViewThreshold.js'

export const QUERY_LIMIT = 2000
const DEBOUNCE_MS = 200

function buildListItems(parcels, filters, bounds) {
  const matches = []

  for (const [apn, parcel] of Object.entries(parcels)) {
    if (!passesFilters(parcel, filters)) continue
    if (parcel.lat == null || parcel.lng == null) continue
    if (!bounds.contains([parcel.lat, parcel.lng])) continue

    const category = parcel.land_use?.category ?? 'unmatched'
    const { total: score } = parcelScore(parcel, filters.maxCoverageRatio)
    const hierarchy = parcelHierarchyTier(score)
    matches.push({
      apn,
      address: parcel.address?.trim() || 'No address',
      city: parcel.city,
      zip: parcel.zip,
      category,
      landUseLabel: parcel.land_use?.label,
      useCode: parcel.use_code,
      useCodeLabel: parcel.use_code_label,
      tracks: formatTracks(parcel),
      leadRank: leadRank(parcel),
      useCodeRank: effectiveUseCodeRank(parcel),
      coverageRatio: parcel.coverage_ratio,
      areaAcres: parcel.area_acres,
      zoningTier: parcel.zoning?.tier ?? null,
      zoningLabel: parcel.zoning?.matched_zone ?? parcel.zoning?.base_zone ?? null,
      score,
      hierarchyColor: hierarchy.color,
      hierarchyLabel: hierarchy.label,
    })
  }

  matches.sort((a, b) => {
    const scoreDiff = (b.score ?? 0) - (a.score ?? 0)
    if (scoreDiff !== 0) return scoreDiff
    const rankDiff =
      parcelListRank(a, filters.maxCoverageRatio) -
      parcelListRank(b, filters.maxCoverageRatio)
    if (rankDiff !== 0) return rankDiff
    return a.address.localeCompare(b.address, undefined, { sensitivity: 'base' })
  })

  return {
    items: matches.slice(0, QUERY_LIMIT),
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
