/**
 * Assessor use-code groups for map filtering.
 * Checked = show parcels with codes in that group.
 *
 * Defaults favor transitional-housing-village candidates: vacant developable
 * land, public/agency parcels, and active institutions stay visible; occupied
 * homes, businesses, and low-fit misc codes are hidden.
 */

export const USE_CODE_CLUSTERS = [
  {
    id: 'vacant_land',
    label: 'Vacant developable land',
    hint: 'Residential, commercial, industrial, and rural parcels with no active use',
    defaultIncluded: true,
    codes: [
      800, 1000, 1040, 3000, 4000, 5000, 5700, 5900, 7000, 7040,
    ],
  },
  {
    id: 'public_government',
    label: 'Government vacant land',
    hint: 'Government-owned vacant parcels (6000, 6001)',
    defaultIncluded: true,
    codes: [6000, 6001],
  },
  {
    id: 'institutional',
    label: 'Schools, churches & cemeteries',
    hint: 'Institutional sites that may have surplus land',
    defaultIncluded: true,
    codes: [6100, 6200, 6400, 6500, 6590, 6600, 6700, 6800, 7900],
  },
  {
    id: 'single_family',
    label: 'Occupied single-family homes',
    hint: 'Detached homes, duets, and live/work houses in residential use',
    defaultIncluded: false,
    codes: [
      1100, 1101, 1120, 1130, 1140, 1150, 1160, 1200, 1201, 1300,
      1400, 1420, 1430, 1440, 1900, 1901, 1950,
    ],
  },
  {
    id: 'small_multi_family',
    label: 'Duplex through fourplex',
    hint: 'Two- to four-unit residential buildings',
    defaultIncluded: false,
    codes: [
      2100, 2200, 2300, 2400, 2440, 2500, 2501, 2502, 2541, 2542,
      2600, 2700, 2800, 2900,
    ],
  },
  {
    id: 'townhouses_duets',
    label: 'Townhouses & planned tracts',
    hint: 'Townhouse, PUD, and boarding-house tracts with units in place',
    defaultIncluded: false,
    codes: [
      1500, 1505, 1520, 1525, 1530, 1535, 1540, 1545, 1600, 1620,
      1630, 1640, 1700, 1800, 1820, 1830, 1840, 1850, 1860,
    ],
  },
  {
    id: 'apartments_condos',
    label: 'Apartments & condominiums',
    hint: 'Five or more units, condo units, and cooperatives',
    defaultIncluded: false,
    codes: [
      7100, 7200, 7300, 7301, 7302, 7305, 7320, 7321, 7322, 7325,
      7330, 7335, 7340, 7341, 7342, 7345, 7400, 7430, 7500, 7600,
      7700, 7701, 7705, 7706, 7800,
    ],
  },
  {
    id: 'commercial_retail_offices',
    label: 'Stores, restaurants & offices',
    hint: 'Retail, shopping centers, banks, and office buildings',
    defaultIncluded: false,
    codes: [
      3100, 3120, 3200, 3300, 3400, 3500, 3600, 3605, 3610, 3620,
      3700, 3701, 3702, 3703, 3704, 3705, 3800, 3900, 4240, 6850,
      8000, 8100, 8200, 8300, 8400, 8500, 9200, 9300, 9301, 9400,
      9401, 9405, 9500,
    ],
  },
  {
    id: 'industrial',
    label: 'Industrial & warehousing',
    hint: 'Factories, warehouses, terminals, and wrecking yards',
    defaultIncluded: false,
    codes: [
      4100, 4101, 4102, 4103, 4191, 4200, 4201, 4202, 4205, 4300,
      4400, 4800, 4900,
    ],
  },
  {
    id: 'hospitality_health',
    label: 'Hotels, care & hospitals',
    hint: 'Lodging, medical, nursing, and funeral facilities',
    defaultIncluded: false,
    codes: [8600, 8700, 8800, 8801, 8802, 8900, 8901, 9000],
  },
  {
    id: 'mobile_floating',
    label: 'Mobile & floating homes',
    hint: 'Mobile-home parks, rural mobile homes, and floating homes',
    defaultIncluded: false,
    codes: [600, 700, 750, 5100, 5200, 9100],
  },
  {
    id: 'recreation',
    label: 'Golf, theaters & recreation',
    hint: 'Golf courses, gyms, stadiums, wineries, and museums',
    defaultIncluded: false,
    codes: [
      6300, 9600, 9700, 9800, 9801, 9802, 9900, 9901, 9905, 9910,
    ],
  },
  {
    id: 'active_rural',
    label: 'Active farms & rural commercial',
    hint: 'Working agriculture, rural industry, and land in transition',
    defaultIncluded: false,
    codes: [4500, 5300, 5400, 5500, 5600, 5800],
  },
  {
    id: 'utilities_extraction',
    label: 'Utilities, quarries & landfills',
    hint: 'Utility easements, mining, landfills, salt ponds, and subsurface rights',
    defaultIncluded: false,
    codes: [400, 500, 4600, 4601, 4700, 9902],
  },
  {
    id: 'common_areas_unknown',
    label: 'Common areas, exempt agency & unknown',
    hint: 'HOA common areas, exempt agency (ownership only), partial tract lots, and unclassified codes',
    defaultIncluded: false,
    codes: [
      0, 300, 840, 900, 940, 1166, 1190, 1590, 1595, 1690, 1890, 3990, 7090,
      7390, 7391, 7392, 7395, 7790, 9491, 9999,
    ],
  },
]

export function defaultIncludeClusters() {
  return Object.fromEntries(
    USE_CODE_CLUSTERS.map((cluster) => [cluster.id, cluster.defaultIncluded]),
  )
}

export function makeExcludedCodeSet(includeClusters) {
  const codes = new Set()
  if (!includeClusters) return codes
  for (const cluster of USE_CODE_CLUSTERS) {
    if (includeClusters[cluster.id]) continue
    for (const code of cluster.codes) codes.add(String(code))
  }
  return codes
}

export function attachExcludedCodes(filters) {
  if (!filters) return filters
  return {
    ...filters,
    _excludedUseCodes: makeExcludedCodeSet(filters.includeClusters),
  }
}

export function parcelExcludedByUseCode(parcel, excludedUseCodes, maxCoverageRatio) {
  if (!excludedUseCodes?.size || parcel?.use_code == null) return false
  const code = String(parcel.use_code)
  if (
    code === '300' &&
    maxCoverageRatio != null &&
    parcel.coverage_ratio != null &&
    parcel.coverage_ratio < maxCoverageRatio
  ) {
    return false
  }
  return excludedUseCodes.has(code)
}
