/** Zoning tier lookup from Zoning.xlsx (exported as zoning_tiers.json). */

export const ZONING_TIER_COLORS = {
  A: { color: '#2e7d32', fillColor: '#43a047' },
  B: { color: '#f9a825', fillColor: '#fdd835' },
  C: { color: '#c62828', fillColor: '#e53935' },
}

export const ZONING_TIER_FALLBACK = {
  color: '#757575',
  fillColor: '#9e9e9e',
}

export const ZONING_TIER_LABELS = {
  A: 'Tier A — shelter by right',
  B: 'Tier B — CUP / discretionary',
  C: 'Tier C — rezone needed',
}

function cleanOverlay(overlay) {
  if (overlay == null) return null
  const text = String(overlay).trim()
  if (!text || text === 'None' || text === 'null') return null
  return text.replace(/^\/+/, '')
}

/** Extract base / overlay / full label from a city zoning feature. */
export function zoneIdentity(city, properties = {}) {
  switch (city) {
    case 'Oakland':
      return {
        base: properties.basezone ?? null,
        overlay: cleanOverlay(properties.overlay),
        full: properties.znlabel ?? null,
      }
    case 'Berkeley':
      return {
        base: properties.zoneclass ?? null,
        overlay: null,
        full: properties.zoneclass ?? null,
      }
    case 'San Leandro':
      return {
        base: properties.ZONING ?? null,
        overlay: cleanOverlay(properties.OVERLAY),
        full: properties.LABEL ?? null,
      }
    case 'Hayward':
      return {
        base: properties.ZONING_ ?? null,
        overlay: cleanOverlay(properties.ZoningOverlay),
        full: null,
      }
    default:
      return { base: null, overlay: null, full: null }
  }
}

function lookupZone(cityMap, zone) {
  if (!cityMap || zone == null) return null
  const key = String(zone).trim()
  if (!key) return null
  return cityMap[key] ?? null
}

/**
 * Resolve spreadsheet tier for a zoning feature.
 * Prefer base+overlay when that exact row exists; otherwise use the base row.
 */
export function resolveZoningTier(tiersByCity, city, properties) {
  const cityMap = tiersByCity?.[city]
  const { base, overlay, full } = zoneIdentity(city, properties)

  const candidates = []
  if (full) candidates.push(String(full).trim())
  if (base && overlay) candidates.push(`${String(base).trim()}/${overlay}`)
  // Oakland sometimes stores the combo in basezone itself (e.g. RU-3/D-BR).
  if (base) candidates.push(String(base).trim())

  for (const candidate of candidates) {
    const hit = lookupZone(cityMap, candidate)
    if (hit) {
      return {
        tier: hit.tier,
        matchedZone: candidate,
        usedOverlay: Boolean(overlay) && candidate.includes('/'),
        ...hit,
      }
    }
  }

  return {
    tier: null,
    matchedZone: base ? String(base).trim() : null,
    usedOverlay: false,
  }
}

export function styleForZoningTier(match, { highlight = false } = {}) {
  const colors =
    (match?.tier && ZONING_TIER_COLORS[match.tier]) || ZONING_TIER_FALLBACK
  return {
    color: colors.color,
    fillColor: colors.fillColor,
    weight: highlight ? 1.4 : 0.7,
    opacity: highlight ? 0.85 : 0.55,
    fillOpacity: highlight ? 0.55 : 0.45,
  }
}
