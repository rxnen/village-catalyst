import { leadOutline } from './FilterPanel.jsx'

export const SATELLITE_MIN_ZOOM = 15

export function styleParcelFeature(parcel, { categoryColor, satellite }) {
  const category = parcel.land_use?.category ?? 'unmatched'
  const color = categoryColor(category)
  const outline = leadOutline(parcel)

  if (outline) {
    const fillOpacity = satellite
      ? category === 'unmatched'
        ? 0.28
        : 0.38
      : category === 'unmatched'
        ? 0.12
        : 0.25
    return {
      color: outline.color,
      weight: outline.weight,
      fillColor: color,
      fillOpacity,
    }
  }

  if (satellite) {
    return {
      color: '#ffffff',
      weight: 2.2,
      opacity: 0.95,
      fillColor: color,
      fillOpacity: category === 'unmatched' ? 0.42 : 0.55,
    }
  }

  return {
    color,
    weight: 0.6,
    fillColor: color,
    fillOpacity: category === 'unmatched' ? 0.12 : 0.25,
  }
}

export function isSatelliteZoom(zoom) {
  return zoom >= SATELLITE_MIN_ZOOM
}
