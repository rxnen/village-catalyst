export function parcelDetailLink(apn) {
  const safe = String(apn)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
  return `<br/><br/><a href="#" class="parcel-popup-detail-link" data-parcel-apn="${safe}">View parcel details →</a>`
}

export function attachParcelPopupSelect(map, onParcelSelect) {
  const onClick = (e) => {
    const link = e.target.closest('[data-parcel-apn]')
    if (!link) return
    e.preventDefault()
    const apn = link.getAttribute('data-parcel-apn')
    if (apn) onParcelSelect(apn)
  }

  const container = map.getContainer()
  container.addEventListener('click', onClick)
  return () => container.removeEventListener('click', onClick)
}
