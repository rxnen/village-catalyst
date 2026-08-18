import { parcelOutlineStyle } from './parcelScore.js'

export const SATELLITE_MIN_ZOOM = 15

export function styleParcelFeature(parcel, { maxCoverageRatio }) {
  const outline = parcelOutlineStyle(parcel, maxCoverageRatio)
  return {
    color: outline.color,
    weight: outline.weight,
    opacity: 0.95,
    fillOpacity: 0,
  }
}

export function isSatelliteZoom(zoom) {
  return zoom >= SATELLITE_MIN_ZOOM
}
