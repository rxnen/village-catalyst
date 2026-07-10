/** Environmental hazard proximity helpers (precomputed edge distances on parcels). */

export const DEFAULT_ENV_THRESHOLDS = {
  envStrongMeters: 50,
  envMediumMeters: 25,
  envNoteMeters: 0,
}

/**
 * True when parcel falls inside a strong or medium distance threshold.
 * Distances on parcel.env are meters from cleanup-site point → nearest parcel
 * edge (0 = on/inside parcel). Note tier never excludes.
 */
export function parcelExcludedByEnv(parcel, filters) {
  const env = parcel?.env
  if (!env || !filters) return false

  const strongM = Number(filters.envStrongMeters)
  if (
    Number.isFinite(strongM) &&
    strongM > 0 &&
    env.strong != null &&
    env.strong <= strongM
  ) {
    return true
  }

  const mediumM = Number(filters.envMediumMeters)
  if (
    Number.isFinite(mediumM) &&
    mediumM > 0 &&
    env.medium != null &&
    env.medium <= mediumM
  ) {
    return true
  }

  return false
}

/** Highest-severity env flag that hits the parcel under current thresholds (or null). */
export function parcelEnvFlag(parcel, filters) {
  const env = parcel?.env
  if (!env || !filters) return null

  const strongM = Number(filters.envStrongMeters)
  if (
    Number.isFinite(strongM) &&
    strongM > 0 &&
    env.strong != null &&
    env.strong <= strongM
  ) {
    return { tier: 'strong', meters: env.strong }
  }

  const mediumM = Number(filters.envMediumMeters)
  if (
    Number.isFinite(mediumM) &&
    mediumM > 0 &&
    env.medium != null &&
    env.medium <= mediumM
  ) {
    return { tier: 'medium', meters: env.medium }
  }

  const noteM = Number(filters.envNoteMeters)
  if (
    Number.isFinite(noteM) &&
    noteM > 0 &&
    env.note != null &&
    env.note <= noteM
  ) {
    return { tier: 'note', meters: env.note }
  }

  return null
}
