const PAN_RATIO_THRESHOLD = 0.1
const ZOOM_RATIO_THRESHOLD = 0.1

function viewSpan(bounds) {
  return {
    lat: bounds.getNorth() - bounds.getSouth(),
    lng: bounds.getEast() - bounds.getWest(),
  }
}

function viewSizeMeters(map, bounds) {
  const sw = bounds.getSouthWest()
  const ne = bounds.getNorthEast()
  const height = map.distance(sw, [ne.lat, sw.lng])
  const width = map.distance(sw, [sw.lat, ne.lng])
  return Math.max(height, width, 1)
}

export function mapViewChangedSignificantly(map, lastView) {
  if (!lastView) return true

  const bounds = map.getBounds()
  const center = map.getCenter()
  const viewSize = viewSizeMeters(map, bounds)
  const panRatio = map.distance(lastView.center, center) / viewSize

  const span = viewSpan(bounds)
  const lastSpan = viewSpan(lastView.bounds)
  const zoomRatio = Math.max(
    Math.abs(span.lat - lastSpan.lat) / Math.max(lastSpan.lat, 1e-9),
    Math.abs(span.lng - lastSpan.lng) / Math.max(lastSpan.lng, 1e-9),
  )

  return panRatio >= PAN_RATIO_THRESHOLD || zoomRatio >= ZOOM_RATIO_THRESHOLD
}

export function captureMapView(map) {
  return {
    center: map.getCenter(),
    bounds: map.getBounds(),
    zoom: map.getZoom(),
  }
}
