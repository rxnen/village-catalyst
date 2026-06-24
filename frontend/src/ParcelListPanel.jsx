import {
  BOTH_TRACKS_COLOR,
  TRACK_A_COLOR,
  TRACK_B_COLOR,
} from './FilterPanel.jsx'
import { QUERY_LIMIT } from './ViewportParcelQuery.jsx'
import { useCodeTierColor, useCodeTierLabel } from './useCodeRank.js'

function trackColor(tracks) {
  if (tracks === 'Track A + Track B') return BOTH_TRACKS_COLOR
  if (tracks === 'Track A') return TRACK_A_COLOR
  if (tracks === 'Track B') return TRACK_B_COLOR
  return null
}

function formatAddress(item) {
  if (item.address !== 'No address') return item.address
  const cityLine = [item.city, item.zip].filter(Boolean).join(' ')
  return cityLine || 'No address'
}

export default function ParcelListPanel({
  categoryLabels,
  categoryColors,
  listState,
  selectedApn,
  onParcelSelect,
}) {
  return (
    <div className="parcel-list">
      <div className="parcel-list-header">
        <b>Parcels in view</b>
        <p className="parcel-list-count">
          {listState.loading
            ? 'Loading…'
            : listState.error
              ? 'Could not load parcels'
              : `${listState.items.length.toLocaleString()} viable parcel${listState.items.length === 1 ? '' : 's'}`}
          {!listState.loading && listState.truncated && (
            <>
              <br />
              <span className="parcel-list-truncated">Map query capped at {QUERY_LIMIT.toLocaleString()}</span>
            </>
          )}
        </p>
      </div>
      <ul className="parcel-list-items">
        {!listState.loading &&
          listState.items.map((item) => (
            <li
              key={item.apn}
              className={`parcel-list-item${selectedApn === item.apn ? ' parcel-list-item-selected' : ''}`}
              onClick={() => onParcelSelect?.(item.apn)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onParcelSelect?.(item.apn)
                }
              }}
              role="button"
              tabIndex={0}
            >
              <div className="parcel-list-address">{formatAddress(item)}</div>
              <div className="parcel-list-meta">
                {item.areaAcres != null && (
                  <span className="parcel-list-acres">{item.areaAcres.toFixed(2)} ac</span>
                )}
                <span
                  className="parcel-list-chip"
                  style={{
                    background: categoryColors[item.category] ?? categoryColors.unmatched,
                  }}
                >
                  {categoryLabels[item.category] ?? categoryLabels.unmatched}
                </span>
                {item.landUseLabel && (
                  <span className="parcel-list-landuse">{item.landUseLabel}</span>
                )}
                {item.useCode && (
                  <span className="parcel-list-usecode" title={item.useCodeLabel}>
                    <span
                      className="parcel-list-usecode-tier"
                      style={{ color: useCodeTierColor(item.useCodeRank) }}
                    >
                      {useCodeTierLabel(item.useCode)}
                    </span>
                    {' · '}
                    Use {item.useCode}
                    {item.useCodeLabel ? `: ${item.useCodeLabel}` : ''}
                  </span>
                )}
                {item.tracks && (
                  <span
                    className="parcel-list-chip parcel-list-chip-outline"
                    style={{ borderColor: trackColor(item.tracks) }}
                  >
                    {item.tracks}
                  </span>
                )}
              </div>
            </li>
          ))}
        {!listState.loading && !listState.error && listState.items.length === 0 && (
          <li className="parcel-list-empty">No viable parcels in the current map view.</li>
        )}
      </ul>
    </div>
  )
}
