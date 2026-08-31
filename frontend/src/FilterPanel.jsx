import { useEffect, useMemo, useState } from 'react'
import {
  USE_CODE_CLUSTERS,
  attachExcludedCodes,
  parcelExcludedByUseCode,
} from './useCodeClusters.js'
import { CLEANUP_STATUS_TIERS } from './envirostor.js'
import {
  DEFAULT_ENV_THRESHOLDS,
  parcelExcludedByEnv,
} from './envirostorProximity.js'
import {
  SLOPE_TIERS,
  defaultIncludeSlopeTiers,
  parcelExcludedBySlope,
} from './slopeTiers.js'

export const TRACK_A_COLOR = '#f9a825'
export const TRACK_B_COLOR = '#00897b'
export const BOTH_TRACKS_COLOR = '#1b5e20'

export function isLead(parcel) {
  return parcel?.tracks?.length > 0
}

export function passesBothTracks(parcel) {
  return parcel?.track_a && parcel?.track_b
}

/** Whether a named filter group is active. Missing keys default to on. */
export function isFilterEnabled(filters, id) {
  if (!filters?.enabled || filters.enabled[id] === undefined) return true
  return Boolean(filters.enabled[id])
}

/** Cities used for ArcGIS queries / city membership when location is on. */
export function effectiveCities(filters, allCities = []) {
  if (!isFilterEnabled(filters, 'location')) return allCities
  return filters?.cities ?? []
}

/** Parcels with this much area inside the SHN freeway buffer are excluded. */
export const FREEWAY_OVERLAP_THRESHOLD = 0.5

/** Parcels with this much area inside an active CSCD school campus are excluded. */
export const SCHOOL_OVERLAP_THRESHOLD = 0.3

/** Parcels with this much area inside a CPAD park holding are excluded. */
export const PARK_OVERLAP_THRESHOLD = 0.1

/** Parcels with this much area inside Census TIGER bay/ocean polygons are excluded. */
export const WATER_OVERLAP_THRESHOLD = 0.5

export function passesFilters(parcel, filters) {
  if (!parcel) return false

  if (isFilterEnabled(filters, 'location')) {
    if (!filters.cities.includes(parcel.city)) return false
  }

  if (isFilterEnabled(filters, 'size')) {
    if (parcel.area_acres == null) return false
    if (parcel.area_acres < filters.minAcres || parcel.area_acres > filters.maxAcres) {
      return false
    }
  }

  if (isFilterEnabled(filters, 'aspect')) {
    if (
      filters.maxAspectRatio != null &&
      parcel.aspect_ratio != null &&
      parcel.aspect_ratio > filters.maxAspectRatio
    ) {
      return false
    }
  }

  if (isFilterEnabled(filters, 'width')) {
    if (
      filters.minUsableWidthM != null &&
      filters.minUsableWidthM > 0 &&
      parcel.max_width_m != null &&
      parcel.max_width_m < filters.minUsableWidthM
    ) {
      return false
    }
  }

  if (isFilterEnabled(filters, 'leads')) {
    if (filters.onlyLeads && !isLead(parcel)) return false
    if (filters.requireBothTracks && !passesBothTracks(parcel)) return false
  }

  if (isFilterEnabled(filters, 'landUse')) {
    const coverageCap = isFilterEnabled(filters, 'buildings')
      ? filters.maxCoverageRatio
      : null
    if (
      parcelExcludedByUseCode(parcel, filters._excludedUseCodes, coverageCap)
    ) {
      return false
    }
  }

  if (isFilterEnabled(filters, 'environment')) {
    if (parcelExcludedByEnv(parcel, filters)) return false
  }

  if (isFilterEnabled(filters, 'freeway')) {
    if ((parcel.freeway_overlap_frac ?? 0) >= FREEWAY_OVERLAP_THRESHOLD) {
      return false
    }
  }

  if (isFilterEnabled(filters, 'schools')) {
    if ((parcel.school_overlap_frac ?? 0) >= SCHOOL_OVERLAP_THRESHOLD) {
      return false
    }
  }

  if (isFilterEnabled(filters, 'parks')) {
    if ((parcel.park_overlap_frac ?? 0) >= PARK_OVERLAP_THRESHOLD) {
      return false
    }
  }

  if (isFilterEnabled(filters, 'water')) {
    if ((parcel.water_overlap_frac ?? 0) >= WATER_OVERLAP_THRESHOLD) {
      return false
    }
  }

  if (isFilterEnabled(filters, 'slope')) {
    if (parcelExcludedBySlope(parcel, filters.includeSlopeTiers)) return false
  }

  return true
}

export function parcelsWhere(cities) {
  if (!cities.length) return '1=0'
  return `SitusCity IN (${cities.map((c) => `'${c}'`).join(',')})`
}

export function countMatching(parcels, filters) {
  if (!parcels || !filters) return { visible: 0, total: 0, leads: 0, both: 0 }
  const total = Object.keys(parcels).length
  let visible = 0
  let leads = 0
  let both = 0
  for (const parcel of Object.values(parcels)) {
    if (isLead(parcel)) leads++
    if (passesBothTracks(parcel)) both++
    if (passesFilters(parcel, filters)) visible++
  }
  return { visible, total, leads, both }
}

export function useFilterCounts(parcels, filters) {
  return useMemo(() => countMatching(parcels, filters), [parcels, filters])
}

export function formatTracks(parcel) {
  if (passesBothTracks(parcel)) return 'Track A + Track B'
  if (parcel?.track_a) return 'Track A'
  if (parcel?.track_b) return 'Track B'
  return ''
}

export function leadRank(parcel) {
  if (passesBothTracks(parcel)) return 0
  if (parcel?.track_a || parcel?.track_b) return 1
  return 2
}

function cityLabel(city) {
  return city[0] + city.slice(1).toLowerCase()
}

function formatAcres(n) {
  if (n == null || Number.isNaN(n)) return '—'
  const rounded = Math.round(n * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : String(rounded)
}

function summarizeItems(items, maxVisible = 1) {
  if (!items.length) return 'None'
  if (items.length <= maxVisible) return items.join(', ')
  const shown = items.slice(0, maxVisible).join(', ')
  return `${shown} +${items.length - maxVisible}`
}

function IconPin() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"
      />
    </svg>
  )
}

function IconRuler() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M20.6 6.6 17.4 3.4a1.5 1.5 0 0 0-2.1 0L3.4 15.3a1.5 1.5 0 0 0 0 2.1l3.2 3.2a1.5 1.5 0 0 0 2.1 0L20.6 8.7a1.5 1.5 0 0 0 0-2.1zM8.1 18.9l-3-3 2.1-2.1.9.9 1.1-1.1-.9-.9 1.1-1.1.9.9 1.1-1.1-.9-.9 1.1-1.1 3 3-7.5 7.5z"
      />
    </svg>
  )
}

function IconBuilding() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v4h5a1 1 0 0 1 1 1v11h-2v-3h-4v3H4zm2-2h4v-2H6v2zm0-4h4v-2H6v2zm0-4h4V9H6v2zm0-4h4V5H6v2zm8 8h4v-2h-4v2zm0-4h4v-2h-4v2z"
      />
    </svg>
  )
}

function IconFootprint() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4 20h7V9H4v11zm9 0h7V4h-7v16zM6 11h3v2H6v-2zm0 4h3v2H6v-2zm9-8h3v2h-3V7zm0 4h3v2h-3v-2zm0 4h3v2h-3v-2z"
      />
    </svg>
  )
}

function IconTracks() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2 4.5 5v6.5c0 4.7 3.2 9.1 7.5 10.5 4.3-1.4 7.5-5.8 7.5-10.5V5L12 2zm0 2.2 6 2.4v5c0 3.6-2.4 7-6 8.3-3.6-1.3-6-4.7-6-8.3v-5l6-2.4zM11 7h2v6h-2V7zm0 8h2v2h-2v-2z"
      />
    </svg>
  )
}

function IconHazard() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 3.2 2.5 20h19L12 3.2zm0 3.3 6.6 11.5H5.4L12 6.5zM11 11h2v4h-2v-4zm0 5h2v2h-2v-2z"
      />
    </svg>
  )
}

function IconFreeway() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4 4h16v2H4V4zm0 14h16v2H4v-2zM3 8h4l1.5 8h-2L5.2 10H3V8zm14 0h4v2h-2.2l-1.3 6h-2L17 8zm-6.5 0h3v2h-1v2h1v2h-1v2h-1v-2h-1v-2h1V10h-1V8z"
      />
    </svg>
  )
}

function IconSchool() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 3 2 8l10 5 8-4v6h2V8L12 3zM4 13.2V17c0 1.1 3.6 3 8 3s8-1.9 8-3v-3.8l-8 4-8-4z"
      />
    </svg>
  )
}

function IconPark() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 3c-2.8 2.4-4 5-4 7.2 0 2 1.3 3.8 4 5.3 2.7-1.5 4-3.3 4-5.3C16 8 14.8 5.4 12 3zM4 20h16v2H4v-2zm7-6.2V20h2v-6.2c-0.3.1-.7.2-1 .2s-.7-.1-1-.2z"
      />
    </svg>
  )
}

function IconWater() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 3.2C9.2 7 6 11.1 6 14.2 6 17.5 8.7 20 12 20s6-2.5 6-5.8C18 11.1 14.8 7 12 3.2zM8.2 14.4c.3-1.5 1.5-3.5 3.8-6.6 2.3 3.1 3.5 5.1 3.8 6.6H8.2z"
      />
    </svg>
  )
}

function IconSlope() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M2 20 14 4l8 16H2zm4.5-2h11.1L14 8.6 6.5 18z"
      />
    </svg>
  )
}

function IconAspect() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4 7h16v10H4V7zm2 2v6h12V9H6zm1 1h4v4H7v-4z"
      />
    </svg>
  )
}

function IconWidth() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4 11h2v2H4v-2zm4 0h8v2H8v-2zm10 0h2v2h-2v-2zM7 7l-3 5 3 5v-3h10v3l3-5-3-5v3H7V7z"
      />
    </svg>
  )
}

const FILTER_SECTIONS = [
  {
    id: 'location',
    label: 'Location',
    overviewLabel: 'Cities',
    icon: IconPin,
  },
  {
    id: 'size',
    label: 'Parcel size',
    overviewLabel: 'Size',
    icon: IconRuler,
  },
  {
    id: 'aspect',
    label: 'Aspect ratio',
    overviewLabel: 'Aspect',
    icon: IconAspect,
  },
  {
    id: 'width',
    label: 'Min width',
    overviewLabel: 'Width',
    icon: IconWidth,
  },
  {
    id: 'landUse',
    label: 'Land use',
    overviewLabel: 'Land use',
    icon: IconBuilding,
  },
  {
    id: 'buildings',
    label: 'Buildings',
    overviewLabel: 'Max ratio',
    icon: IconFootprint,
  },
  {
    id: 'leads',
    label: 'Lead tracks',
    overviewLabel: 'Leads',
    icon: IconTracks,
  },
  {
    id: 'environment',
    label: 'Environment',
    overviewLabel: 'Hazards',
    icon: IconHazard,
  },
  {
    id: 'freeway',
    label: 'Freeways',
    overviewLabel: 'Freeways',
    icon: IconFreeway,
  },
  {
    id: 'schools',
    label: 'Schools',
    overviewLabel: 'Schools',
    icon: IconSchool,
  },
  {
    id: 'parks',
    label: 'Parks',
    overviewLabel: 'Parks',
    icon: IconPark,
  },
  {
    id: 'water',
    label: 'Open water',
    overviewLabel: 'Water',
    icon: IconWater,
  },
  {
    id: 'slope',
    label: 'Slope',
    overviewLabel: 'Slope',
    icon: IconSlope,
  },
]

export function defaultEnabledFilters() {
  return Object.fromEntries(FILTER_SECTIONS.map((section) => [section.id, true]))
}

function IconSliders() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M3 7h11v2H3V7zm14 0h4v2h-4V7zM3 15h4v2H3v-2zm7 0h11v2H10v-2zM14 5v6h2V5h-2zM6 13v6h2v-6H6z"
      />
    </svg>
  )
}

function overviewValue(sectionId, filters) {
  if (!filters) return '—'
  if (!isFilterEnabled(filters, sectionId)) return 'Off'

  if (sectionId === 'location') {
    const labels = filters.cities.map(cityLabel)
    return summarizeItems(labels, 1)
  }

  if (sectionId === 'size') {
    return `${formatAcres(filters.minAcres)}–${formatAcres(filters.maxAcres)} ac`
  }

  if (sectionId === 'aspect') {
    const max = filters.maxAspectRatio
    if (max == null) return 'Off'
    return `≤ ${formatAcres(max)}:1`
  }

  if (sectionId === 'width') {
    const w = filters.minUsableWidthM
    if (w == null || w <= 0) return 'Off'
    return `≥ ${formatAcres(w)} m`
  }

  if (sectionId === 'landUse') {
    const selected = USE_CODE_CLUSTERS.filter(
      (cluster) => filters.includeClusters[cluster.id],
    ).map((cluster) => cluster.label)
    return summarizeItems(selected, 1)
  }

  if (sectionId === 'buildings') {
    return String(filters.maxCoverageRatio)
  }

  if (sectionId === 'leads') {
    if (filters.requireBothTracks && filters.onlyLeads) return 'Both tracks'
    if (filters.onlyLeads) return 'Leads only'
    return 'All parcels'
  }

  if (sectionId === 'environment') {
    const s = filters.envStrongMeters
    const m = filters.envMediumMeters
    const n = filters.envNoteMeters
    return `${s}/${m}/${n} m`
  }

  if (sectionId === 'freeway') {
    return `≥ ${Math.round(FREEWAY_OVERLAP_THRESHOLD * 100)}% in buffer`
  }

  if (sectionId === 'schools') {
    return `≥ ${Math.round(SCHOOL_OVERLAP_THRESHOLD * 100)}% campus overlap`
  }

  if (sectionId === 'parks') {
    return `≥ ${Math.round(PARK_OVERLAP_THRESHOLD * 100)}% park overlap`
  }

  if (sectionId === 'water') {
    return `≥ ${Math.round(WATER_OVERLAP_THRESHOLD * 100)}% bay / ocean`
  }

  if (sectionId === 'slope') {
    const selected = SLOPE_TIERS.filter(
      (tier) => filters.includeSlopeTiers?.[tier.id] !== false,
    ).map((tier) => tier.label)
    return summarizeItems(selected, 1)
  }

  return '—'
}

function FilterToggle({ checked, onChange, label, hint }) {
  return (
    <div className="filter-toggle">
      <span className="filter-toggle-text">
        <span className="filter-toggle-label">{label}</span>
        {hint ? <span className="filter-toggle-hint">{hint}</span> : null}
      </span>
      <button
        type="button"
        className={`filter-switch${checked ? ' filter-switch-on' : ''}`}
        role="switch"
        aria-checked={checked}
        aria-label={`${label}: ${checked ? 'on' : 'off'}`}
        onClick={() => onChange(!checked)}
      >
        <span className="filter-switch-knob" />
      </button>
    </div>
  )
}

function FilterControlDetail({ filters, setEnabled, setAllEnabled }) {
  const enabledCount = FILTER_SECTIONS.filter((section) =>
    isFilterEnabled(filters, section.id),
  ).length
  const total = FILTER_SECTIONS.length

  return (
    <>
      <h2 className="filters-detail-title">Filter control</h2>
      <p className="filters-detail-desc">
        Turn filter groups on or off without losing their settings. With every
        group off, the map shows all parcels in the loaded county dataset.
        Re-enable groups one by one to see what each one removes.
      </p>
      <div className="filters-detail-controls">
        <div className="filter-control-actions">
          <button
            type="button"
            className="filter-control-action"
            onClick={() => setAllEnabled(true)}
            disabled={enabledCount === total}
          >
            Turn all on
          </button>
          <button
            type="button"
            className="filter-control-action"
            onClick={() => setAllEnabled(false)}
            disabled={enabledCount === 0}
          >
            Turn all off
          </button>
          <span className="filter-control-count">
            {enabledCount} of {total} on
          </span>
        </div>
        <div className="filter-control-toggles">
          {FILTER_SECTIONS.map((section) => (
            <FilterToggle
              key={section.id}
              label={section.label}
              hint={
                section.id === 'buildings'
                  ? 'Affects ranking and the use-code 300 exception'
                  : section.id === 'freeway'
                    ? 'Hides parcels ≥50% inside the 20 m highway buffer'
                    : section.id === 'schools'
                      ? 'Hides parcels ≥30% overlapping an active school campus'
                    : section.id === 'parks'
                      ? 'Hides parcels ≥10% overlapping a CPAD park (trail corridors excepted)'
                    : section.id === 'water'
                      ? 'Hides parcels ≥50% inside bay or ocean (not rivers or ponds)'
                    : undefined
              }
              checked={isFilterEnabled(filters, section.id)}
              onChange={(next) => setEnabled(section.id, next)}
            />
          ))}
        </div>
      </div>
    </>
  )
}

function FilterSectionDetail({
  sectionId,
  filters,
  set,
  availableCities,
  toggleCity,
  toggleIncludeCluster,
  toggleIncludeSlopeTier,
}) {
  if (sectionId === 'control') {
    return null
  }

  const enabled = isFilterEnabled(filters, sectionId)

  const body = (() => {
  if (sectionId === 'location') {
    return (
      <>
        <h2 className="filters-detail-title">Location</h2>
        <p className="filters-detail-desc">
          Which cities&apos; assessor rolls feed the search. Each one adds its
          full roll before other filters run.
        </p>
        <div className="filters-detail-controls">
          {availableCities.map((city) => (
            <label key={city} className="filter-check">
              <input
                type="checkbox"
                checked={filters.cities.includes(city)}
                onChange={() => toggleCity(city)}
                disabled={!enabled}
              />
              {cityLabel(city)}
            </label>
          ))}
        </div>
      </>
    )
  }

  if (sectionId === 'size') {
    return (
      <>
        <h2 className="filters-detail-title">Parcel size</h2>
        <p className="filters-detail-desc">
          Keep parcels whose assessed lot area falls between these acreage
          bounds. Values are inclusive.
        </p>
        <div className="filters-detail-controls">
          <div className="filter-range">
            <label>
              Min (acres)
              <input
                type="number"
                min="0"
                step="0.1"
                value={filters.minAcres}
                disabled={!enabled}
                onChange={(e) => set({ minAcres: Number(e.target.value) })}
              />
            </label>
            <label>
              Max (acres)
              <input
                type="number"
                min="0"
                step="0.1"
                value={filters.maxAcres}
                disabled={!enabled}
                onChange={(e) => set({ maxAcres: Number(e.target.value) })}
              />
            </label>
          </div>
        </div>
      </>
    )
  }

  if (sectionId === 'aspect') {
    return (
      <>
        <h2 className="filters-detail-title">Aspect ratio</h2>
        <p className="filters-detail-desc">
          Hide parcels whose minimum-rotated bounding rectangle is longer than
          this length÷width ratio. Village sites are often about 1:1 to 3:1;
          alleyways and rail strips run 10:1 and higher. Measured from the
          rotated envelope so diagonal parcels are not misread as square.
        </p>
        <div className="filters-detail-controls">
          <div className="filter-range">
            <label>
              Max ratio (length÷width)
              <input
                type="number"
                min="1"
                step="0.5"
                value={filters.maxAspectRatio}
                disabled={!enabled}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  set({
                    maxAspectRatio: Number.isFinite(n) && n >= 1 ? n : 1,
                  })
                }}
              />
            </label>
          </div>
          <p className="filter-hint filter-hint-block">
            Default 6:1 filters out obvious slivers while keeping compact and
            moderately elongated lots. Raise the limit to include longer parcels;
            lower it toward 3 for stricter village-shaped sites.
          </p>
        </div>
      </>
    )
  }

  if (sectionId === 'width') {
    return (
      <>
        <h2 className="filters-detail-title">Min width</h2>
        <p className="filters-detail-desc">
          Hide parcels that are nowhere at least this wide. Each parcel is
          eroded inward by half this distance; if nothing survives, the lot was
          never wide enough (including bent alleys that still pass the aspect
          ratio box test). Set to 0 to turn off.
        </p>
        <div className="filters-detail-controls">
          <div className="filter-range">
            <label>
              Min usable width (m)
              <input
                type="number"
                min="0"
                step="1"
                value={filters.minUsableWidthM}
                disabled={!enabled}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  set({
                    minUsableWidthM: Number.isFinite(n) && n >= 0 ? n : 0,
                  })
                }}
              />
            </label>
          </div>
          <p className="filter-hint filter-hint-block">
            Default 20 m catches corridor and dog-leg parcels that look
            acceptable by bounding-box aspect alone. Raise for stricter sites;
            lower or set 0 to keep narrower lots.
          </p>
        </div>
      </>
    )
  }

  if (sectionId === 'landUse') {
    return (
      <>
        <h2 className="filters-detail-title">Land use</h2>
        <p className="filters-detail-desc">
          Checked assessor land-use groups are shown. Vacant, public, and
          institutional land stays visible by default for village-site
          screening.
        </p>
        <div className="filters-detail-controls filters-detail-clusters">
          {USE_CODE_CLUSTERS.map((cluster) => (
            <label
              key={cluster.id}
              className="filter-check filter-check-cluster"
              title={cluster.hint}
            >
              <input
                type="checkbox"
                checked={filters.includeClusters[cluster.id]}
                disabled={!enabled}
                onChange={() => toggleIncludeCluster(cluster.id)}
              />
              <span>
                <span className="filter-cluster-label">{cluster.label}</span>
                <span className="filter-cluster-hint">{cluster.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </>
    )
  }

  if (sectionId === 'buildings') {
    return (
      <>
        <h2 className="filters-detail-title">Buildings</h2>
        <p className="filters-detail-desc">
          Coverage ratio is the share of the parcel area covered by Microsoft
          building footprints (0 = no detected structures, 1 = fully covered).
          Parcels are ranked, not hidden, by this value. Best candidates have
          low coverage, a top-tier use code, and both lead tracks. Use code 300
          (exempt public agency) can appear when coverage is low, but is never
          treated as a top-tier use signal.
        </p>
        <div className="filters-detail-controls">
          <div className="filter-range">
            <label>
              Max ratio (ranking)
              <input
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={filters.maxCoverageRatio}
                disabled={!enabled}
                onChange={(e) => set({ maxCoverageRatio: Number(e.target.value) })}
              />
            </label>
          </div>
        </div>
      </>
    )
  }

  if (sectionId === 'leads') {
    return (
      <>
        <h2 className="filters-detail-title">Lead tracks</h2>
        <div className="filters-detail-desc">
          <p>
            Lead tracks flag lots that often look easier to buy or reuse. That
            usually means the owner does not live there, or the land is valuable
            but barely built on. A lot can match one track or both.
          </p>
          <p>
            <b>Track A</b> looks at who owns the lot. It matches when a church,
            nonprofit, or public agency has a tax exemption, or when the owner’s
            tax bill is mailed to a different city and they are not claiming a
            homeowner exemption — a sign they probably do not live on the
            property.
          </p>
          <p>
            <b>Track B</b> looks at how the lot is used. It matches when the
            county values the land at more than $50,000, buildings on it are
            worth less than 20% of the land, and the lot is not grouped with
            neighboring lots as one business. That usually means empty or
            underused land.
          </p>
        </div>
        <div className="filters-detail-controls">
          <label className="filter-check">
            <input
              type="checkbox"
              checked={filters.onlyLeads}
              disabled={!enabled}
              onChange={(e) => set({ onlyLeads: e.target.checked })}
            />
            Only lots that match Track A or Track B
          </label>
          <label className="filter-check">
            <input
              type="checkbox"
              checked={filters.requireBothTracks}
              onChange={(e) => set({ requireBothTracks: e.target.checked })}
              disabled={!enabled || !filters.onlyLeads}
            />
            Only lots that match both tracks
          </label>
        </div>
      </>
    )
  }

  if (sectionId === 'environment') {
    const setMeters = (key, raw) => {
      const n = Number(raw)
      set({ [key]: Number.isFinite(n) && n >= 0 ? n : 0 })
    }
    return (
      <>
        <h2 className="filters-detail-title">Environment</h2>
        <p className="filters-detail-desc">
          Flag parcels near EnviroStor cleanup sites by distance to the parcel
          edge (0 m if the site is on the parcel). Strong and medium hits hide
          parcels from results; note hits are recorded only (they do not hide).
          Set a distance to 0 to turn that tier off.
        </p>
        <div className="filters-detail-controls">
          <div className="filter-env-thresholds">
            <label className="filter-field" title={CLEANUP_STATUS_TIERS.strong.hint}>
              <span className="filter-env-label">
                <span
                  className="swatch swatch-dot"
                  style={{ background: CLEANUP_STATUS_TIERS.strong.color }}
                />
                Strong flag
              </span>
              <span className="filter-env-input-row">
                <input
                  type="number"
                  min="0"
                  step="5"
                  value={filters.envStrongMeters}
                  disabled={!enabled}
                  onChange={(e) => setMeters('envStrongMeters', e.target.value)}
                />
                <span className="filter-env-unit">m</span>
              </span>
            </label>
            <label className="filter-field" title={CLEANUP_STATUS_TIERS.medium.hint}>
              <span className="filter-env-label">
                <span
                  className="swatch swatch-dot"
                  style={{ background: CLEANUP_STATUS_TIERS.medium.color }}
                />
                Medium flag
              </span>
              <span className="filter-env-input-row">
                <input
                  type="number"
                  min="0"
                  step="5"
                  value={filters.envMediumMeters}
                  disabled={!enabled}
                  onChange={(e) => setMeters('envMediumMeters', e.target.value)}
                />
                <span className="filter-env-unit">m</span>
              </span>
            </label>
            <label className="filter-field" title={CLEANUP_STATUS_TIERS.note.hint}>
              <span className="filter-env-label">
                <span
                  className="swatch swatch-dot"
                  style={{ background: CLEANUP_STATUS_TIERS.note.color }}
                />
                Note only
              </span>
              <span className="filter-env-input-row">
                <input
                  type="number"
                  min="0"
                  step="5"
                  value={filters.envNoteMeters}
                  disabled={!enabled}
                  onChange={(e) => setMeters('envNoteMeters', e.target.value)}
                />
                <span className="filter-env-unit">m</span>
              </span>
            </label>
          </div>
          <p className="filter-hint filter-hint-block">
            Defaults: strong {DEFAULT_ENV_THRESHOLDS.envStrongMeters} m, medium{' '}
            {DEFAULT_ENV_THRESHOLDS.envMediumMeters} m, note off. Distances are
            measured from the cleanup-site point to the nearest parcel boundary
            edge.
          </p>
        </div>
      </>
    )
  }

  if (sectionId === 'freeway') {
    const pct = Math.round(FREEWAY_OVERLAP_THRESHOLD * 100)
    return (
      <>
        <h2 className="filters-detail-title">Freeways</h2>
        <p className="filters-detail-desc">
          Hide parcels whose footprint falls mostly inside Caltrans State
          Highway Network buffers (20 m around SHN centerlines in Alameda
          County). Overlap is measured against the union of all buffers, so
          coverage can add up across multiple highway segments without
          double-counting shared area.
        </p>
        <div className="filters-detail-controls">
          <p className="filter-hint filter-hint-block">
            When this filter is on, parcels with ≥{pct}% of their area inside
            the buffer are removed from the map and list. Turn the group off in
            Filter control to keep those parcels visible.
          </p>
        </div>
      </>
    )
  }

  if (sectionId === 'schools') {
    const pct = Math.round(SCHOOL_OVERLAP_THRESHOLD * 100)
    return (
      <>
        <h2 className="filters-detail-title">Schools</h2>
        <p className="filters-detail-desc">
          Hide parcels that overlap active K–12 campuses in the California
          School Campus Database (CSCD 2025, Schools_Current_Stacked). Only
          campuses with Status = Active in Alameda County are used. Overlap is
          measured against the union of campus polygons, so stacked schools on
          the same site are not double-counted.
        </p>
        <div className="filters-detail-controls">
          <p className="filter-hint filter-hint-block">
            When this filter is on, parcels with ≥{pct}% of their area inside a
            campus are removed from the map and list. Parcels under that
            threshold stay visible. Turn the group off in Filter control to
            keep campus-covered parcels in the results.
          </p>
        </div>
      </>
    )
  }

  if (sectionId === 'parks') {
    const pct = Math.round(PARK_OVERLAP_THRESHOLD * 100)
    return (
      <>
        <h2 className="filters-detail-title">Parks</h2>
        <p className="filters-detail-desc">
          Hide parcels that overlap protected park and open-space holdings in
          the California Protected Areas Database (CPAD, current release). Only
          Alameda County holdings are used. Linear trail corridors are left out
          of the overlay, so a trail running through a parcel does not exclude
          it. Overlap is measured against the union of park polygons, so
          adjacent holdings are not double-counted.
        </p>
        <div className="filters-detail-controls">
          <p className="filter-hint filter-hint-block">
            When this filter is on, parcels with ≥{pct}% of their area inside a
            park are removed from the map and list. Parcels under that
            threshold stay visible. Turn the group off in Filter control to
            keep park-covered parcels in the results.
          </p>
        </div>
      </>
    )
  }

  if (sectionId === 'water') {
    const pct = Math.round(WATER_OVERLAP_THRESHOLD * 100)
    return (
      <>
        <h2 className="filters-detail-title">Open water</h2>
        <p className="filters-detail-desc">
          Hide parcels that sit in San Francisco Bay, San Leandro Bay, or
          Oakland Inner Harbor. The overlay uses Census TIGER Area Hydrography
          for Alameda County and keeps only bay/ocean polygons (MTFCC H2051
          and H2053). Lakes, ponds, reservoirs, creeks, and canals are not
          used, so a river or pond crossing a parcel does not exclude it.
        </p>
        <div className="filters-detail-controls">
          <p className="filter-hint filter-hint-block">
            When this filter is on, parcels with ≥{pct}% of their area in open
            water are removed from the map and list. Waterfront lots under
            that threshold stay visible. Turn the group off in Filter control
            to keep bay-covered parcels in the results.
          </p>
        </div>
      </>
    )
  }

  if (sectionId === 'slope') {
    return (
      <>
        <h2 className="filters-detail-title">Slope</h2>
        <p className="filters-detail-desc">
          Checked mean-grade bands stay visible. Unchecked bands are hidden.
          Grades come from USGS 3DEP percent slope; Very steep (≥25%) is off by
          default because it is usually a poor fit for housing.
        </p>
        <div className="filters-detail-controls filters-detail-clusters">
          {SLOPE_TIERS.map((tier, index) => {
            const prev = index === 0 ? 0 : SLOPE_TIERS[index - 1].maxMeanPct
            const range = Number.isFinite(tier.maxMeanPct)
              ? index === 0
                ? `<${tier.maxMeanPct}%`
                : `${prev}–${tier.maxMeanPct}%`
              : `≥${prev}%`
            return (
              <label
                key={tier.id}
                className="filter-check filter-check-cluster"
                title={tier.hint}
              >
                <input
                  type="checkbox"
                  checked={filters.includeSlopeTiers?.[tier.id] !== false}
                  disabled={!enabled}
                  onChange={() => toggleIncludeSlopeTier(tier.id)}
                />
                <span>
                  <span className="filter-cluster-label">
                    <span
                      className="swatch"
                      style={{
                        background: tier.fillColor,
                        display: 'inline-block',
                        marginRight: 6,
                        verticalAlign: 'middle',
                      }}
                    />
                    {tier.label} ({range})
                  </span>
                  <span className="filter-cluster-hint">{tier.hint}</span>
                </span>
              </label>
            )
          })}
        </div>
      </>
    )
  }

  return null
  })()

  if (!body) return null

  return (
    <div className={!enabled ? 'filters-detail-disabled' : undefined}>
      {!enabled ? (
        <p className="filter-disabled-banner">
          This filter is turned off in Filter control. Settings below are kept
          but not applied to the map.
        </p>
      ) : null}
      {body}
    </div>
  )
}

export default function FilterPanel({
  filters,
  onChange,
  counts,
  availableCities,
  expanded,
  onExpandedChange,
}) {
  const [activeSection, setActiveSection] = useState('control')

  useEffect(() => {
    if (!expanded) return
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onExpandedChange(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [expanded, onExpandedChange])

  if (!filters) return null

  const set = (patch) => onChange(attachExcludedCodes({ ...filters, ...patch }))

  const setEnabled = (id, next) => {
    set({
      enabled: {
        ...defaultEnabledFilters(),
        ...filters.enabled,
        [id]: next,
      },
    })
  }

  const setAllEnabled = (next) => {
    set({
      enabled: Object.fromEntries(
        FILTER_SECTIONS.map((section) => [section.id, next]),
      ),
    })
  }

  const toggleIncludeCluster = (clusterId) => {
    const next = {
      ...filters.includeClusters,
      [clusterId]: !filters.includeClusters[clusterId],
    }
    set({ includeClusters: next })
  }

  const toggleIncludeSlopeTier = (tierId) => {
    const current = {
      ...defaultIncludeSlopeTiers(),
      ...filters.includeSlopeTiers,
    }
    set({
      includeSlopeTiers: {
        ...current,
        [tierId]: !current[tierId],
      },
    })
  }

  const toggleCity = (city) => {
    const next = filters.cities.includes(city)
      ? filters.cities.filter((c) => c !== city)
      : [...filters.cities, city]
    set({ cities: next })
  }

  const enabledCount = FILTER_SECTIONS.filter((section) =>
    isFilterEnabled(filters, section.id),
  ).length

  if (expanded) {
    return (
      <div className="filters-expanded" role="dialog" aria-label="Filters">
        <aside className="filters-nav">
          <button
            type="button"
            className={`filters-nav-item${activeSection === 'control' ? ' filters-nav-item-active' : ''}`}
            onClick={() => setActiveSection('control')}
          >
            <IconSliders />
            Filter control
          </button>
          <div className="filters-nav-divider" />
          {FILTER_SECTIONS.map((section) => {
            const Icon = section.icon
            const active = activeSection === section.id
            const on = isFilterEnabled(filters, section.id)
            return (
              <button
                key={section.id}
                type="button"
                className={`filters-nav-item${active ? ' filters-nav-item-active' : ''}${!on ? ' filters-nav-item-off' : ''}`}
                onClick={() => setActiveSection(section.id)}
              >
                <Icon />
                {section.label}
                {!on ? <span className="filters-nav-off">Off</span> : null}
              </button>
            )
          })}
        </aside>

        <section className="filters-detail">
          <button
            type="button"
            className="filters-collapse-btn"
            onClick={() => onExpandedChange(false)}
          >
            Collapse filters
          </button>
          <div className="filters-detail-body">
            {activeSection === 'control' ? (
              <FilterControlDetail
                filters={filters}
                setEnabled={setEnabled}
                setAllEnabled={setAllEnabled}
              />
            ) : (
              <FilterSectionDetail
                sectionId={activeSection}
                filters={filters}
                set={set}
                availableCities={availableCities}
                toggleCity={toggleCity}
                toggleIncludeCluster={toggleIncludeCluster}
                toggleIncludeSlopeTier={toggleIncludeSlopeTier}
              />
            )}
          </div>
        </section>
      </div>
    )
  }

  return (
    <aside className="filters-sidebar" aria-label="Filter overview">
      <div className="filters-overview">
        <div className="filters-overview-header">
          <b>Filters</b>
          <p className="filter-count">
            {counts.visible.toLocaleString()} of {counts.total.toLocaleString()} parcels
          </p>
          <p className="filter-count">
            {enabledCount} of {FILTER_SECTIONS.length} filters on
          </p>
        </div>

        <dl className="filters-overview-list">
          {FILTER_SECTIONS.map((section) => (
            <div
              key={section.id}
              className={`filters-overview-row${!isFilterEnabled(filters, section.id) ? ' filters-overview-row-off' : ''}`}
            >
              <dt>{section.overviewLabel}</dt>
              <dd>{overviewValue(section.id, filters)}</dd>
            </div>
          ))}
        </dl>
      </div>

      <button
        type="button"
        className="filters-expand-btn"
        onClick={() => onExpandedChange(true)}
      >
        Expand filters
      </button>
    </aside>
  )
}
