import { formatTracks, leadRank } from './FilterPanel.jsx'
import { effectiveUseCodeRank, parcelListRank } from './useCodeRank.js'
import { parcelHierarchyTier, parcelScore } from './parcelScore.js'

export function parcelToListItem(apn, parcel, filters) {
  const category = parcel.land_use?.category ?? 'unmatched'
  const { total: score } = parcelScore(parcel, filters?.maxCoverageRatio)
  const hierarchy = parcelHierarchyTier(score)
  return {
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
  }
}

export function sortListItems(items, filters) {
  return [...items].sort((a, b) => {
    const scoreDiff = (b.score ?? 0) - (a.score ?? 0)
    if (scoreDiff !== 0) return scoreDiff
    const rankDiff =
      parcelListRank(a, filters?.maxCoverageRatio) -
      parcelListRank(b, filters?.maxCoverageRatio)
    if (rankDiff !== 0) return rankDiff
    return a.address.localeCompare(b.address, undefined, { sensitivity: 'base' })
  })
}

export function buildSavedListItems(savedApns, parcels, filters) {
  const items = []
  for (const apn of savedApns) {
    const parcel = parcels?.[apn]
    if (!parcel) continue
    items.push(parcelToListItem(apn, parcel, filters))
  }
  return sortListItems(items, filters)
}
