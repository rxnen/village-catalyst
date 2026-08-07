import { parcelOutlineStyle } from './parcelScore.js'
import { slopeFillColor } from './slopeTiers.js'

export const SATELLITE_MIN_ZOOM = 15

const PARCEL_FILL = {
  fillColor: '#94a3b8',
  cartoFillOpacity: 0.18,
  satelliteFillOpacity: 0.32,
  slopeCartoFillOpacity: 0.42,
  slopeSatelliteFillOpacity: 0.5,
}

export function styleParcelFeature(
  parcel,
  { satellite, maxCoverageRatio, colorBySlope = false },
) {
  const outline = parcelOutlineStyle(parcel, maxCoverageRatio)
  const fillColor = colorBySlope ? slopeFillColor(parcel) : PARCEL_FILL.fillColor
  const fillOpacity = colorBySlope
    ? satellite
      ? PARCEL_FILL.slopeSatelliteFillOpacity
      : PARCEL_FILL.slopeCartoFillOpacity
    : satellite
      ? PARCEL_FILL.satelliteFillOpacity
      : PARCEL_FILL.cartoFillOpacity

  return {
    color: outline.color,
    weight: outline.weight,
    opacity: 0.95,
    fillColor,
    fillOpacity,
  }
}

export function isSatelliteZoom(zoom) {
  return zoom >= SATELLITE_MIN_ZOOM
}
