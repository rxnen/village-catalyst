import { parcelOutlineStyle } from './parcelScore.js'
import { slopeFillColor } from './slopeTiers.js'

export const SATELLITE_MIN_ZOOM = 15

const PARCEL_FILL = {
  cartoFillOpacity: 0.42,
  satelliteFillOpacity: 0.5,
}

export function styleParcelFeature(parcel, { satellite, maxCoverageRatio }) {
  const outline = parcelOutlineStyle(parcel, maxCoverageRatio)
  const fillOpacity = satellite
    ? PARCEL_FILL.satelliteFillOpacity
    : PARCEL_FILL.cartoFillOpacity

  return {
    color: outline.color,
    weight: outline.weight,
    opacity: 0.95,
    fillColor: slopeFillColor(parcel),
    fillOpacity,
  }
}

export function isSatelliteZoom(zoom) {
  return zoom >= SATELLITE_MIN_ZOOM
}
