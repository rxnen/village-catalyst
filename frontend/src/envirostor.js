import { useEffect, useState } from 'react'
import L from 'leaflet'

const ENVIROSTOR_FEATURESERVER =
  'https://services3.arcgis.com/Oy2JTCD10wkoelxS/arcgis/rest/services/Envirostor_Public_Data_Export/FeatureServer'

const ENVIROSTOR_WHERE = "county='Alameda'"

// Cleanup-site status tiers (layer 0). Order matters: certified O&M / land-use
// restriction variants must be checked before plain "Certified".
export const CLEANUP_STATUS_TIERS = {
  strong: {
    id: 'strong',
    label: 'Strong flag',
    hint: 'On-parcel disqualifying; nearby serious caution',
    color: '#c62828',
    radius: 7,
  },
  medium: {
    id: 'medium',
    label: 'Medium flag',
    hint: 'Unresolved elsewhere; reconcile with GeoTracker',
    color: '#ef6c00',
    radius: 6,
  },
  note: {
    id: 'note',
    label: 'Note only',
    hint: 'Resolved; no residential restriction — record, do not knock out',
    color: '#78909c',
    radius: 5,
  },
  unknown: {
    id: 'unknown',
    label: 'Unknown status',
    hint: 'Status not recognized by tier rules',
    color: '#bdbdbd',
    radius: 5,
  },
}

const TIER_ORDER = ['note', 'medium', 'strong']

// Groundwater / surface-water / well media codes that raise risk one tier.
const ELEVATED_WATER_MEDIA = new Set(['AQUI', 'SURFW', 'WELL'])

function normalizeStatus(status) {
  return String(status ?? '').trim()
}

export function cleanupStatusTier(status) {
  const s = normalizeStatus(status)
  if (!s) return 'unknown'

  if (s === 'Active') return 'strong'
  if (s === 'Inactive - Needs Evaluation') return 'strong'
  if (s === 'Inactive - Action Required') return 'strong'
  if (/land use restriction/i.test(s)) return 'strong'
  if (/\boperation\s*&\s*maintenance\b/i.test(s) || /\bO&M\b/i.test(s)) return 'strong'

  if (/^refer:/i.test(s)) return 'medium'
  if (s === 'Inactive - Withdrawn') return 'medium'

  if (s === 'No Further Action') return 'note'
  if (s === 'No Action Required') return 'note'
  if (s === 'Certified') return 'note'

  return 'unknown'
}

/** Parse comma-separated potential_media_affected; true if any token is AQUI/SURFW/WELL. */
export function hasElevatedWaterMedia(potentialMediaAffected) {
  if (potentialMediaAffected == null || potentialMediaAffected === '') return false
  const raw = String(potentialMediaAffected).trim()
  if (!raw || raw.toUpperCase() === 'NONE SPECIFIED' || raw.toUpperCase() === 'NMA') {
    return false
  }
  return raw
    .split(',')
    .map((token) => token.trim().toUpperCase())
    .filter(Boolean)
    .some((token) => ELEVATED_WATER_MEDIA.has(token))
}

function bumpTier(tier) {
  const idx = TIER_ORDER.indexOf(tier)
  if (idx < 0) return tier
  return TIER_ORDER[Math.min(idx + 1, TIER_ORDER.length - 1)]
}

/**
 * Final cleanup-site flag: status tier, then +1 if potential_media_affected
 * includes AQUI, SURFW, or WELL (any comma-separated token).
 */
export function cleanupHazardTier(properties) {
  const base = cleanupStatusTier(properties?.status)
  const mediaBump = hasElevatedWaterMedia(properties?.potential_media_affected)
  const tier = mediaBump ? bumpTier(base) : base
  return { tier, base, mediaBump }
}

// Layer 0 = cleanup sites (tiered by status), 1 = hazardous waste (partial flag),
// 2 = ICE / investigation & corrective-action sites (warning sign).
export const HAZARD_LAYERS = [
  {
    id: 0,
    key: 'cleanup',
    name: 'Cleanup sites',
    schema: 'cleanup',
    color: '#c62828',
    radius: 7,
  },
  {
    id: 1,
    key: 'hazwaste',
    name: 'Hazardous waste (partial flag)',
    schema: 'facility',
    color: '#ef6c00',
    radius: 6,
  },
  {
    id: 2,
    key: 'ice',
    name: 'ICE sites (warning)',
    schema: 'facility',
    color: '#f9a825',
    radius: 5,
  },
]

async function fetchAllFeatures(layerId, signal) {
  const pageSize = 2000
  let offset = 0
  const features = []
  // Paginate defensively even though current Alameda counts fit in one page.
  for (;;) {
    const params = new URLSearchParams({
      where: ENVIROSTOR_WHERE,
      outFields: '*',
      outSR: '4326',
      f: 'geojson',
      resultRecordCount: String(pageSize),
      resultOffset: String(offset),
    })
    const url = `${ENVIROSTOR_FEATURESERVER}/${layerId}/query?${params.toString()}`
    const res = await fetch(url, { signal })
    if (!res.ok) throw new Error(`EnviroStor layer ${layerId} HTTP ${res.status}`)
    const data = await res.json()
    const batch = Array.isArray(data.features) ? data.features : []
    features.push(...batch)
    const more = data.properties?.exceededTransferLimit && batch.length > 0
    if (!more) break
    offset += batch.length
  }
  return { type: 'FeatureCollection', features }
}

export function useEnviroStorLayer(layerId) {
  const [data, setData] = useState(null)
  useEffect(() => {
    if (layerId == null) {
      setData(null)
      return
    }
    const controller = new AbortController()
    fetchAllFeatures(layerId, controller.signal)
      .then(setData)
      .catch((err) => {
        if (err.name !== 'AbortError') {
          console.error(`Failed to load EnviroStor layer ${layerId}`, err)
        }
      })
    return () => controller.abort()
  }, [layerId])
  return data
}

/** Shared fetch for cleanup sites (layer 0) — map overlay + proximity filters. */
export function useEnviroStorCleanupSites() {
  return useEnviroStorLayer(0)
}

export function hazardPointToLayer(layerConfig) {
  return (feature, latlng) => {
    let color = layerConfig.color
    let radius = layerConfig.radius
    let fillOpacity = 0.9

    if (layerConfig.schema === 'cleanup') {
      const { tier } = cleanupHazardTier(feature?.properties)
      const tierStyle = CLEANUP_STATUS_TIERS[tier] ?? CLEANUP_STATUS_TIERS.unknown
      color = tierStyle.color
      radius = tierStyle.radius
      if (tier === 'note') fillOpacity = 0.65
    }

    return L.circleMarker(latlng, {
      radius,
      color: '#ffffff',
      weight: 1.5,
      fillColor: color,
      fillOpacity,
    })
  }
}

function escapeHtml(value) {
  if (value == null) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fieldRow(label, value) {
  if (value == null || value === '' || value === 'NONE SPECIFIED') return ''
  return `<br/><b>${escapeHtml(label)}:</b> ${escapeHtml(value)}`
}

function cleanupPopup(p) {
  const cityLine = [p.city, p.zip].filter(Boolean).join(' ')
  const coc = p.confirmed_coc || p.potential_coc
  const { tier, base, mediaBump } = cleanupHazardTier(p)
  const tierMeta = CLEANUP_STATUS_TIERS[tier] ?? CLEANUP_STATUS_TIERS.unknown
  const baseMeta = CLEANUP_STATUS_TIERS[base] ?? CLEANUP_STATUS_TIERS.unknown
  const tierBlock = mediaBump
    ? `<br/><b>Flag:</b> ${escapeHtml(tierMeta.label)}` +
      ` <i>(bumped from ${escapeHtml(baseMeta.label)} — water media)</i>`
    : `<br/><b>Flag:</b> ${escapeHtml(tierMeta.label)}`
  const envirostorLink = p.envirostor_id
    ? `<br/><a class="hazard-popup-link" target="_blank" rel="noopener" href="https://www.envirostor.dtsc.ca.gov/public/profile_report?global_id=${encodeURIComponent(
        p.envirostor_id,
      )}">EnviroStor profile &rarr;</a>`
    : ''
  return (
    `<b>${escapeHtml(p.project_name || 'Cleanup site')}</b>` +
    `<br/>${escapeHtml(p.address || 'No address')}` +
    (cityLine ? `<br/>${escapeHtml(cityLine)}` : '') +
    fieldRow('Type', p.site_type) +
    fieldRow('Status', p.status) +
    tierBlock +
    fieldRow('Acres', p.acres) +
    fieldRow('Media affected', p.potential_media_affected) +
    fieldRow('Contaminants', coc) +
    envirostorLink
  )
}

function facilityPopup(p) {
  const cityLine = [p.city, p.zip].filter(Boolean).join(' ')
  return (
    `<b>${escapeHtml(p.facility_name || 'Facility')}</b>` +
    `<br/>${escapeHtml(p.address || 'No address')}` +
    (cityLine ? `<br/>${escapeHtml(cityLine)}` : '') +
    fieldRow('Type', p.facility_type) +
    fieldRow('Status', p.facility_status) +
    fieldRow('EPA ID', p.epa_id) +
    fieldRow('CalEnviroScreen', p.calenviroscreen_score)
  )
}

export function hazardOnEachFeature(layerConfig) {
  const build = layerConfig.schema === 'cleanup' ? cleanupPopup : facilityPopup
  return (feature, layer) => {
    layer.bindPopup(build(feature?.properties ?? {}))
  }
}
