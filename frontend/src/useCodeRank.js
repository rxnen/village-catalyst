/**
 * Rough suitability tiers for tiny-village land (lower rank = better fit).
 *
 * 0 — Vacant public / city-owned institutional land
 * 1 — Vacant developable land (res, commercial, industrial, rural)
 * 2 — Institutional excess potential (school, church, cemetery, etc.)
 * 3 — Marginal: common areas, parking, partial build, unknown
 * 4 — Low-intensity occupied or transitional rural
 * 5 — Active buildings in use (homes, stores, offices, etc.)
 */

const TIER_BY_CODE = {
  // Tier 0 — fallow public / exempt agency land
  300: 0,
  6000: 0,
  6001: 0,

  // Tier 1 — vacant land
  800: 1,
  1000: 1,
  1040: 1,
  3000: 1,
  4000: 1,
  5000: 1,
  5700: 1,
  5900: 1,
  7000: 1,
  7040: 1,

  // Tier 2 — institutional / possible surplus church-school land
  6200: 2,
  6300: 2,
  6400: 2,
  6500: 2,
  6590: 2,
  6600: 2,
  6700: 2,
  6800: 2,
  7090: 2,
  7900: 2,
  9910: 2,

  // Tier 3 — common areas, parking, partial vacant, misc low fit
  0: 3,
  840: 3,
  900: 3,
  940: 3,
  1166: 3,
  1190: 3,
  1590: 3,
  1595: 3,
  1690: 3,
  1890: 3,
  3990: 3,
  4191: 3,
  4500: 3,
  4600: 3,
  4601: 3,
  4700: 3,
  6100: 3,
  7390: 3,
  7391: 3,
  7392: 3,
  7395: 3,
  7790: 3,
  8300: 3,
  8400: 3,
  9491: 3,
  9999: 3,

  // Tier 4 — occupied low-density, utilities, transitional rural
  400: 4,
  500: 4,
  600: 4,
  700: 4,
  750: 4,
  5100: 4,
  5200: 4,
  5300: 4,
  5400: 4,
  5500: 4,
  5600: 4,
  5800: 4,
  9100: 4,
}

const TIER_LABELS = [
  'Vacant public land',
  'Vacant land',
  'Institutional surplus',
  'Marginal / common area',
  'Low-intensity use',
  'Active buildings',
]

export function useCodeRank(code) {
  if (code == null || code === '') return 5
  const key = String(code)
  return TIER_BY_CODE[key] ?? 5
}

export function useCodeTierLabel(code) {
  return TIER_LABELS[useCodeRank(code)] ?? TIER_LABELS[5]
}

export function useCodeTierColor(rank) {
  if (rank <= 1) return '#2e7d32'
  if (rank === 2) return '#1565c0'
  if (rank === 3) return '#78909c'
  if (rank === 4) return '#ef6c00'
  return '#c62828'
}

/** Lower value sorts higher in the parcel list. */
export function parcelListRank(item) {
  return item.leadRank * 10 + item.useCodeRank
}
