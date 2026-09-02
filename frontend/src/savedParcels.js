const STORAGE_KEY = 'tvs-saved-parcels'

export function loadSavedApns() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((apn) => typeof apn === 'string' && apn.length > 0)
  } catch {
    return []
  }
}

function persistSavedApns(apns) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(apns))
}

export function saveApn(apns, apn) {
  if (apns.includes(apn)) return apns
  const next = [...apns, apn]
  persistSavedApns(next)
  return next
}

export function removeApn(apns, apn) {
  if (!apns.includes(apn)) return apns
  const next = apns.filter((entry) => entry !== apn)
  persistSavedApns(next)
  return next
}

export function toggleSavedApn(apns, apn) {
  return apns.includes(apn) ? removeApn(apns, apn) : saveApn(apns, apn)
}
