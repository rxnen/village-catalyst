import { parcelOutlineStyle } from './parcelScore.js'

export const SATELLITE_MIN_ZOOM = 15

const PARCEL_FILL = {
  fillColor: '#94a3b8',
  cartoFillOpacity: 0.18,
  satelliteFillOpacity: 0.32,
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
    fillColor: PARCEL_FILL.fillColor,
    fillOpacity,
  }
}

export function isSatelliteZoom(zoom) {
  return zoom >= SATELLITE_MIN_ZOOM
}
