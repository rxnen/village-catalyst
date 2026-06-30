import {
  BOTH_TRACKS_COLOR,
  TRACK_A_COLOR,
  TRACK_B_COLOR,
  formatTracks,
} from './FilterPanel.jsx'
import { QUERY_LIMIT } from './ViewportParcelQuery.jsx'
import { useCodeTierColor, useCodeTierLabel, useCodeRank as getUseCodeRank } from './useCodeRank.js'

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

function formatCity(city) {
  if (!city) return '—'
  return city[0] + city.slice(1).toLowerCase()
}

function DetailRow({ label, children }) {
  return (
    <div className="parcel-detail-row">
      <div className="parcel-detail-label">{label}</div>
      <div className="parcel-detail-value">{children}</div>
    </div>
  )
}

function ParcelDetail({
  apn,
  parcel,
  listItem,
  categoryLabels,
  categoryColors,
  onBack,
}) {
  const category = parcel?.land_use?.category ?? listItem?.category ?? 'unmatched'
  const landUse = parcel?.land_use
  const tracks = listItem?.tracks || formatTracks(parcel)
  const useCode = parcel?.use_code ?? listItem?.useCode
  const useCodeRank = listItem?.useCodeRank ?? getUseCodeRank(useCode)
  const addressItem = listItem ?? {
    address: parcel?.address?.trim() || 'No address',
    city: parcel?.city,
    zip: parcel?.zip,
  }

  return (
    <>
      <div className="parcel-list-header parcel-detail-header">
        <button type="button" className="parcel-detail-back" onClick={onBack}>
          ← Parcels in view
        </button>
        <div className="parcel-detail-title">{formatAddress(addressItem)}</div>
      </div>
      <div className="parcel-detail-body">
        <DetailRow label="APN">{apn}</DetailRow>
        <DetailRow label="City">{formatCity(parcel?.city ?? listItem?.city)}</DetailRow>
        {listItem?.zip && <DetailRow label="ZIP">{listItem.zip}</DetailRow>}
        <DetailRow label="Area">
          {parcel?.area_acres != null
            ? `${parcel.area_acres.toFixed(2)} acres`
            : listItem?.areaAcres != null
              ? `${listItem.areaAcres.toFixed(2)} acres`
              : '—'}
        </DetailRow>

        <div className="parcel-detail-section">
          <b>Lead tracks</b>
          {tracks ? (
            <span
              className="parcel-list-chip parcel-list-chip-outline parcel-detail-track"
              style={{ borderColor: trackColor(tracks) }}
            >
              {tracks}
            </span>
          ) : (
            <p className="parcel-detail-muted">No lead tracks matched.</p>
          )}
          {parcel?.track_a && (
            <p className="parcel-detail-hint">
              Track A — institutional owner or absentee (mailing city differs from situs, or other exempt).
            </p>
          )}
          {parcel?.track_b && (
            <p className="parcel-detail-hint">
              Track B — vacant taxable land (low improvements-to-land ratio, no economic unit).
            </p>
          )}
        </div>

        {parcel?.imps_land_ratio != null && (
          <DetailRow label="Improvements / land">
            {(parcel.imps_land_ratio * 100).toFixed(1)}%
          </DetailRow>
        )}

        <div className="parcel-detail-section">
          <b>Assessor use code</b>
          {useCode ? (
            <>
              <p className="parcel-detail-usecode">
                <span
                  className="parcel-list-usecode-tier"
                  style={{ color: useCodeTierColor(useCodeRank) }}
                >
                  {useCodeTierLabel(useCode)}
                </span>
                {' · '}
                Code {useCode}
              </p>
              {(parcel?.use_code_label ?? listItem?.useCodeLabel) && (
                <p className="parcel-detail-muted">
                  {parcel?.use_code_label ?? listItem?.useCodeLabel}
                </p>
              )}
            </>
          ) : (
            <p className="parcel-detail-muted">No use code on file.</p>
          )}
        </div>

        <div className="parcel-detail-section">
          <b>General Plan land use</b>
          <span
            className="parcel-list-chip parcel-detail-chip"
            style={{ background: categoryColors[category] ?? categoryColors.unmatched }}
          >
            {categoryLabels[category] ?? categoryLabels.unmatched}
          </span>
          {landUse?.label ? (
            <>
              <p className="parcel-detail-landuse-name">{landUse.label}</p>
              {landUse.gplu && (
                <p className="parcel-detail-muted">
                  GPLU {landUse.gplu}
                  {landUse.general_plan ? ` · ${landUse.general_plan}` : ''}
                </p>
              )}
              {landUse.gplu_definition && (
                <p className="parcel-detail-muted">{landUse.gplu_definition}</p>
              )}
              {landUse.overlap_frac != null && (
                <p className="parcel-detail-muted">
                  {Math.round(landUse.overlap_frac * 100)}% parcel overlap with this designation
                </p>
              )}
            </>
          ) : (
            <p className="parcel-detail-muted">No general-plan land-use match.</p>
          )}
        </div>
      </div>
    </>
  )
}

export default function ParcelListPanel({
  categoryLabels,
  categoryColors,
  listState,
  parcelIndex,
  selectedApn,
  onParcelSelect,
}) {
  const selectedParcel = selectedApn ? parcelIndex?.parcels?.[selectedApn] : null
  const selectedListItem = selectedApn
    ? listState.items.find((item) => item.apn === selectedApn)
    : null
  const showDetail = Boolean(selectedApn)

  return (
    <div className="parcel-list">
      <div className={`parcel-list-slider${showDetail ? ' parcel-list-slider-detail' : ''}`}>
        <div className="parcel-list-page">
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
                  <span className="parcel-list-truncated">
                    Map query capped at {QUERY_LIMIT.toLocaleString()}
                  </span>
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

        <div className="parcel-list-page">
          {showDetail && (
            <ParcelDetail
              apn={selectedApn}
              parcel={selectedParcel}
              listItem={selectedListItem}
              categoryLabels={categoryLabels}
              categoryColors={categoryColors}
              onBack={() => onParcelSelect?.(null)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
