import {
  BOTH_TRACKS_COLOR,
  TRACK_A_COLOR,
  TRACK_B_COLOR,
  formatTracks,
} from './FilterPanel.jsx'
import { QUERY_LIMIT } from './ViewportParcelQuery.jsx'
import { CLEANUP_STATUS_TIERS } from './envirostor.js'
import { useCodeTierColor, useCodeTierLabel, effectiveUseCodeRank } from './useCodeRank.js'
import {
  ZONING_TIER_COLORS,
  ZONING_TIER_LABELS,
} from './zoningTiers.js'
import { ZONING_TIER_POINTS } from './parcelScore.js'

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

function formatEnvMeters(meters) {
  if (meters == null || Number.isNaN(meters)) return '—'
  if (meters <= 0) return 'On parcel'
  if (meters < 10) return `${meters.toFixed(1)} m`
  return `${Math.round(meters)} m`
}

function envThresholdForTier(filters, tier) {
  if (!filters) return null
  if (tier === 'strong') return Number(filters.envStrongMeters)
  if (tier === 'medium') return Number(filters.envMediumMeters)
  if (tier === 'note') return Number(filters.envNoteMeters)
  return null
}

function siteHitsThreshold(site, filters) {
  const threshold = envThresholdForTier(filters, site.tier)
  if (!Number.isFinite(threshold) || threshold <= 0) return false
  return site.meters != null && site.meters <= threshold
}

function envirostorProfileUrl(id) {
  if (!id) return null
  return `https://www.envirostor.dtsc.ca.gov/public/profile_report?global_id=${encodeURIComponent(id)}`
}

function DetailRow({ label, children }) {
  return (
    <div className="parcel-detail-row">
      <div className="parcel-detail-label">{label}</div>
      <div className="parcel-detail-value">{children}</div>
    </div>
  )
}

function EnvHazardsSection({ parcel, filters }) {
  const sites = Array.isArray(parcel?.env_sites) ? parcel.env_sites : []
  const env = parcel?.env

  if (!sites.length && !env) {
    return (
      <div className="parcel-detail-section">
        <b>Environmental hazards</b>
        <p className="parcel-detail-muted">
          No EnviroStor cleanup sites within 500 m of this parcel.
        </p>
      </div>
    )
  }

  return (
    <div className="parcel-detail-section">
      <b>Environmental hazards</b>
      <p className="parcel-detail-hint">
        Edge distance to nearby EnviroStor cleanup sites (up to 500 m).
      </p>
      {sites.length > 0 ? (
        <ul className="parcel-env-list">
          {sites.map((site, index) => {
            const tierMeta =
              CLEANUP_STATUS_TIERS[site.tier] ?? CLEANUP_STATUS_TIERS.unknown
            const active = siteHitsThreshold(site, filters)
            const profileUrl = envirostorProfileUrl(site.envirostor_id)
            const key = `${site.envirostor_id ?? site.name ?? 'site'}-${site.meters}-${index}`
            return (
              <li
                key={key}
                className={`parcel-env-item${active ? ' parcel-env-item-active' : ''}`}
              >
                <div className="parcel-env-item-top">
                  <span
                    className="parcel-list-chip parcel-list-chip-outline parcel-env-tier"
                    style={{ borderColor: tierMeta.color, color: tierMeta.color }}
                    title={tierMeta.hint}
                  >
                    {tierMeta.label}
                  </span>
                  <span className="parcel-env-meters">{formatEnvMeters(site.meters)}</span>
                  {active && <span className="parcel-env-active-tag">In filter range</span>}
                </div>
                <div className="parcel-env-name">{site.name || 'Cleanup site'}</div>
                {site.status && (
                  <div className="parcel-env-meta">Status: {site.status}</div>
                )}
                {(site.address || site.city) && (
                  <div className="parcel-env-meta">
                    {[site.address, site.city].filter(Boolean).join(', ')}
                  </div>
                )}
                {profileUrl && (
                  <a
                    className="parcel-env-link"
                    href={profileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    EnviroStor profile →
                  </a>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="parcel-detail-muted">Nearby distances on file, but no site details.</p>
      )}
    </div>
  )
}

function ParcelDetail({
  apn,
  parcel,
  listItem,
  categoryLabels,
  categoryColors,
  filters,
  onBack,
}) {
  const category = parcel?.land_use?.category ?? listItem?.category ?? 'unmatched'
  const landUse = parcel?.land_use
  const tracks = listItem?.tracks || formatTracks(parcel)
  const useCode = parcel?.use_code ?? listItem?.useCode
  const useCodeRank = listItem?.useCodeRank ?? effectiveUseCodeRank(parcel)
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
        {parcel?.aspect_ratio != null && (
          <DetailRow label="Aspect ratio">
            {parcel.aspect_ratio.toFixed(1)}:1
          </DetailRow>
        )}
        {parcel?.max_width_m != null && (
          <DetailRow label="Max width">
            {parcel.max_width_m.toFixed(0)} m
          </DetailRow>
        )}

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

        {parcel?.coverage_ratio != null && (
          <DetailRow label="Footprint coverage">
            {(parcel.coverage_ratio * 100).toFixed(1)}%
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
          <b>Zoning</b>
          {parcel?.zoning?.tier ? (
            <>
              <span
                className="parcel-list-chip parcel-detail-chip"
                style={{
                  background:
                    ZONING_TIER_COLORS[parcel.zoning.tier]?.fillColor ?? '#9e9e9e',
                  color: '#111',
                }}
              >
                Tier {parcel.zoning.tier}
                {ZONING_TIER_POINTS[parcel.zoning.tier] != null
                  ? ` (${ZONING_TIER_POINTS[parcel.zoning.tier] > 0 ? '+' : ''}${ZONING_TIER_POINTS[parcel.zoning.tier]})`
                  : ''}
              </span>
              <p className="parcel-detail-landuse-name">
                {parcel.zoning.matched_zone || parcel.zoning.base_zone || '—'}
              </p>
              <p className="parcel-detail-muted">
                {ZONING_TIER_LABELS[parcel.zoning.tier] ?? `Tier ${parcel.zoning.tier}`}
              </p>
              {parcel.zoning.overlay && (
                <p className="parcel-detail-muted">Overlay: {parcel.zoning.overlay}</p>
              )}
              {parcel.zoning.overlap_frac != null && (
                <p className="parcel-detail-muted">
                  {Math.round(parcel.zoning.overlap_frac * 100)}% parcel overlap with this zone
                </p>
              )}
            </>
          ) : (
            <p className="parcel-detail-muted">No zoning match on file.</p>
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

        <EnvHazardsSection parcel={parcel} filters={filters} />
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
  filters,
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
                    {item.zoningTier && (
                      <span
                        className="parcel-list-chip"
                        title={item.zoningLabel || `Tier ${item.zoningTier}`}
                        style={{
                          background:
                            ZONING_TIER_COLORS[item.zoningTier]?.fillColor ?? '#9e9e9e',
                          color: '#111',
                        }}
                      >
                        Zone {item.zoningTier}
                        {item.zoningLabel ? ` · ${item.zoningLabel}` : ''}
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
              filters={filters}
              onBack={() => onParcelSelect?.(null)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
