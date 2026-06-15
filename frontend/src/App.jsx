import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, GeoJSON, LayersControl } from 'react-leaflet'

const SF_CENTER = [37.7749, -122.4194]

const CATEGORY_COLORS = {
  'Recreation & Park': '#2e7d32',
  'Public Works': '#6d4c41',
  'Unified School District': '#f9a825',
  'Real Estate': '#8e24aa',
  'MTA': '#1565c0',
  'Fire': '#c62828',
  'Port': '#00838f',
  'SFHA': '#ad1457',
  'PUC/Water': '#0277bd',
  'PUC/Wastewater': '#455a64',
  'Public Library': '#5e35b1',
  'OCII - Former SFRA': '#ef6c00',
  'Health': '#00897b',
  'Police': '#283593',
}
const OTHER_COLOR = '#757575'
const PARCEL_COLOR = '#263238'

const categoryColor = (category) => CATEGORY_COLORS[category] ?? OTHER_COLOR

function landStyle(feature) {
  const color = categoryColor(feature.properties.category)
  return { color, weight: 1.5, fillColor: color, fillOpacity: 0.45 }
}

// outline-only so the land category color stays visible underneath
const parcelStyle = {
  color: PARCEL_COLOR,
  weight: 0.8,
  fillOpacity: 0,
}

function onEachLand(feature, layer) {
  const p = feature.properties
  layer.bindPopup(
    `<b>${p.land_name ?? 'Unnamed land'}</b><br/>` +
    `land_id ${p.land_id}<br/>` +
    `${p.category ?? 'Uncategorized'} · ${p.department_name ?? 'Unknown department'}`,
  )
}

function onEachParcel(feature, layer) {
  const p = feature.properties
  layer.bindPopup(
    `<b>Parcel ${p.blklot}</b><br/>` +
    `${p.land_name ?? 'Unnamed land'} (land_id ${p.land_id})`,
  )
}

function useGeojson(url) {
  const [data, setData] = useState(null)
  useEffect(() => {
    let cancelled = false
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setData(d)
      })
    return () => {
      cancelled = true
    }
  }, [url])
  return data
}

function Legend() {
  return (
    <div className="legend">
      <b>City land category</b>
      {Object.entries(CATEGORY_COLORS).map(([name, color]) => (
        <div key={name} className="legend-row">
          <span className="swatch" style={{ background: color }} />
          {name}
        </div>
      ))}
      <div className="legend-row">
        <span className="swatch" style={{ background: OTHER_COLOR }} />
        Other
      </div>
      <div className="legend-row">
        <span className="swatch swatch-outline" style={{ borderColor: PARCEL_COLOR }} />
        Matched parcel
      </div>
    </div>
  )
}

export default function App() {
  const lands = useGeojson('/city_lands.geojson')
  const parcels = useGeojson('/land_parcels.geojson')

  return (
    <div className="app">
      <MapContainer center={SF_CENTER} zoom={13} className="map" preferCanvas>
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        />
        {lands && parcels && (
          <LayersControl position="topright">
            <LayersControl.Overlay checked name="City lands">
              <GeoJSON data={lands} style={landStyle} onEachFeature={onEachLand} />
            </LayersControl.Overlay>
            <LayersControl.Overlay checked name="Parcels matched to a land">
              <GeoJSON data={parcels} style={parcelStyle} onEachFeature={onEachParcel} />
            </LayersControl.Overlay>
          </LayersControl>
        )}
      </MapContainer>
      <Legend />
    </div>
  )
}
