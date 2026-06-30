import { useMemo } from 'react'
import {
  USE_CODE_CLUSTERS,
  attachExcludedCodes,
  parcelExcludedByUseCode,
} from './useCodeClusters.js'

export const TRACK_A_COLOR = '#f9a825'
export const TRACK_B_COLOR = '#00897b'
export const BOTH_TRACKS_COLOR = '#c62828'

export function isLead(parcel) {
  return parcel?.tracks?.length > 0
}

export function passesBothTracks(parcel) {
  return parcel?.track_a && parcel?.track_b
}

export function leadOutline(parcel) {
  if (passesBothTracks(parcel)) {
    return { color: BOTH_TRACKS_COLOR, weight: 3 }
  }
  if (parcel?.track_a) {
    return { color: TRACK_A_COLOR, weight: 2.5 }
  }
  if (parcel?.track_b) {
    return { color: TRACK_B_COLOR, weight: 2.5 }
  }
  return null
}

export function passesFilters(parcel, filters) {
  if (!parcel) return false
  if (!filters.cities.includes(parcel.city)) return false
  if (parcel.area_acres == null) return false
  if (parcel.area_acres < filters.minAcres || parcel.area_acres > filters.maxAcres) {
    return false
  }
  if (filters.onlyLeads && !isLead(parcel)) return false
  if (filters.requireBothTracks && !passesBothTracks(parcel)) return false
  if (parcelExcludedByUseCode(parcel, filters._excludedUseCodes)) return false
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

export default function FilterPanel({ filters, onChange, counts, availableCities }) {
  if (!filters) return null

  const set = (patch) => onChange(attachExcludedCodes({ ...filters, ...patch }))

  const toggleExcludeCluster = (clusterId) => {
    const next = {
      ...filters.excludeClusters,
      [clusterId]: !filters.excludeClusters[clusterId],
    }
    set({ excludeClusters: next })
  }

  const toggleCity = (city) => {
    const next = filters.cities.includes(city)
      ? filters.cities.filter((c) => c !== city)
      : [...filters.cities, city]
    set({ cities: next })
  }

  return (
    <div className="filters">
      <b>Filters</b>
      <p className="filter-count">
        Showing {counts.visible.toLocaleString()} of {counts.total.toLocaleString()} parcels
        <br />
        {counts.leads.toLocaleString()} leads ({counts.both.toLocaleString()} pass both tracks)
      </p>

      <fieldset className="filter-group">
        <legend>Cities</legend>
        {availableCities.map((city) => (
          <label key={city} className="filter-check">
            <input
              type="checkbox"
              checked={filters.cities.includes(city)}
              onChange={() => toggleCity(city)}
            />
            {cityLabel(city)}
          </label>
        ))}
      </fieldset>

      <fieldset className="filter-group">
        <legend>Parcel size (acres)</legend>
        <div className="filter-range">
          <label>
            Min
            <input
              type="number"
              min="0"
              step="0.1"
              value={filters.minAcres}
              onChange={(e) => set({ minAcres: Number(e.target.value) })}
            />
          </label>
          <label>
            Max
            <input
              type="number"
              min="0"
              step="0.1"
              value={filters.maxAcres}
              onChange={(e) => set({ maxAcres: Number(e.target.value) })}
            />
          </label>
        </div>
      </fieldset>

      <fieldset className="filter-group filter-group-use-codes">
        <legend>Assessor land use</legend>
        <p className="filter-hint filter-hint-block">
          Checked groups are hidden. Vacant, public, and institutional land stays
          visible by default for village-site screening.
        </p>
        {USE_CODE_CLUSTERS.map((cluster) => (
          <label
            key={cluster.id}
            className="filter-check filter-check-cluster"
            title={cluster.hint}
          >
            <input
              type="checkbox"
              checked={filters.excludeClusters[cluster.id]}
              onChange={() => toggleExcludeCluster(cluster.id)}
            />
            {cluster.label}
          </label>
        ))}
      </fieldset>

      <fieldset className="filter-group">
        <legend>Lead tracks</legend>
        <p className="filter-hint filter-hint-block">
          Track A: OTEX &gt; 0, or HOEX = 0 and mailing city ≠ situs city.
          Track B: Land &gt; $50k, Imps/Land &lt; 20%, no economic unit.
        </p>
        <label className="filter-check">
          <input
            type="checkbox"
            checked={filters.onlyLeads}
            onChange={(e) => set({ onlyLeads: e.target.checked })}
          />
          Only lead parcels (Track A or B)
        </label>
        <label className="filter-check">
          <input
            type="checkbox"
            checked={filters.requireBothTracks}
            onChange={(e) => set({ requireBothTracks: e.target.checked })}
            disabled={!filters.onlyLeads}
          />
          Only strongest leads (both tracks)
        </label>
      </fieldset>
    </div>
  )
}
