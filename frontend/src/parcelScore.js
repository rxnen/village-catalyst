import {
  TOP_USE_CODE_MAX_RANK,
  effectiveUseCodeRank,
  passesLowCoverage,
} from './useCodeRank.js'
import { passesBothTracks } from './FilterPanel.jsx'

const USE_CODE_POINTS = {
  0: 18,
  1: 15,
  2: 7,
  3: 2,
  4: 0,
  5: -5,
}

/** Zoning.xlsx A/B/C feasibility points for parcelScore. */
export const ZONING_TIER_POINTS = {
  A: 15,
  B: 8,
  C: -5,
}

export const HIERARCHY_TIERS = [
  {
    id: 'prime',
    label: 'Prime vacant',
    minScore: 60,
    color: '#1b5e20',
    weight: 3,
    hint: 'Both lead tracks, top-tier use code, low footprint coverage, and Tier A zoning',
  },
  {
    id: 'strong',
    label: 'Strong candidate',
    minScore: 45,
    color: '#00897b',
    weight: 2.8,
    hint: 'Two strong vacancy signals aligned',
  },
  {
    id: 'promising',
    label: 'Promising',
    minScore: 30,
    color: '#1565c0',
    weight: 2.5,
    hint: 'One strong signal with supporting evidence',
  },
  {
    id: 'watchlist',
    label: 'Watchlist',
    minScore: 15,
    color: '#ef6c00',
    weight: 2,
    hint: 'Single meaningful vacancy signal',
  },
  {
    id: 'background',
    label: 'Background',
    minScore: 1,
    color: '#78909c',
    weight: 1.5,
    hint: 'Passes filters but weak vacancy evidence',
  },
  {
    id: 'none',
    label: 'No signal',
    minScore: 0,
    color: '#bdbdbd',
    weight: 1,
    hint: 'No positive vacancy points',
  },
]

function leadTrackPoints(parcel) {
  if (passesBothTracks(parcel)) return 30
  if (parcel?.track_b) return 12
  if (parcel?.track_a) return 8
  return 0
}

function useCodePoints(parcel) {
  const rank = effectiveUseCodeRank(parcel)
  return USE_CODE_POINTS[rank] ?? USE_CODE_POINTS[5]
}

function coveragePoints(parcel, maxCoverageRatio) {
  const ratio = parcel?.coverage_ratio
  if (ratio == null) return 0
  if (ratio === 0) return 25
  if (ratio < 0.05) return 22
  if (ratio < 0.1) return 18
  if (ratio < 0.15) return 14
  if (ratio < maxCoverageRatio) return 10
  if (ratio < 0.4) return 3
  return 0
}

function impsLandPoints(parcel) {
  const ratio = parcel?.imps_land_ratio
  if (ratio == null) return 0
  if (ratio < 0.05) return 5
  if (ratio < 0.1) return 3
  if (ratio < 0.2) return 1
  return 0
}

export function zoningTierPoints(parcel) {
  const tier = parcel?.zoning?.tier
  if (tier == null) return 0
  return ZONING_TIER_POINTS[tier] ?? 0
}

function synergyBonus(parcel, maxCoverageRatio) {
  if (
    passesBothTracks(parcel) &&
    effectiveUseCodeRank(parcel) <= TOP_USE_CODE_MAX_RANK &&
    passesLowCoverage(parcel, maxCoverageRatio) &&
    parcel?.zoning?.tier === 'A'
  ) {
    return 5
  }
  return 0
}

export function parcelScore(parcel, maxCoverageRatio) {
  const breakdown = {
    leadTracks: leadTrackPoints(parcel),
    useCode: useCodePoints(parcel),
    coverage: coveragePoints(parcel, maxCoverageRatio),
    impsLand: impsLandPoints(parcel),
    zoning: zoningTierPoints(parcel),
    synergy: synergyBonus(parcel, maxCoverageRatio),
  }
  const raw =
    breakdown.leadTracks +
    breakdown.useCode +
    breakdown.coverage +
    breakdown.impsLand +
    breakdown.zoning +
    breakdown.synergy
  return {
    total: Math.max(0, raw),
    breakdown,
  }
}

export function parcelHierarchyTier(score) {
  for (const tier of HIERARCHY_TIERS) {
    if (score >= tier.minScore) return tier
  }
  return HIERARCHY_TIERS[HIERARCHY_TIERS.length - 1]
}

export function parcelOutlineStyle(parcel, maxCoverageRatio) {
  const { total } = parcelScore(parcel, maxCoverageRatio)
  const tier = parcelHierarchyTier(total)
  return {
    color: tier.color,
    weight: tier.weight,
    score: total,
    tier,
  }
}
