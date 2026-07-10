"""EnviroStor cleanup-site fetch and status-tier classification.

Mirrors frontend/src/envirostor.js so parcel_index env distances match the map.
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlencode
from urllib.request import urlopen

ENVIROSTOR_LAYER0 = (
    "https://services3.arcgis.com/Oy2JTCD10wkoelxS/arcgis/rest/services/"
    "Envirostor_Public_Data_Export/FeatureServer/0"
)
ENVIROSTOR_WHERE = "county='Alameda'"
ELEVATED_WATER_MEDIA = frozenset({"AQUI", "SURFW", "WELL"})
TIER_ORDER = ("note", "medium", "strong")


def cleanup_status_tier(status: str | None) -> str:
    s = (status or "").strip()
    if not s:
        return "unknown"
    if s == "Active":
        return "strong"
    if s == "Inactive - Needs Evaluation":
        return "strong"
    if s == "Inactive - Action Required":
        return "strong"
    if re.search(r"land use restriction", s, re.I):
        return "strong"
    if re.search(r"operation\s*&\s*maintenance", s, re.I) or re.search(r"\bO&M\b", s):
        return "strong"
    if re.match(r"^refer:", s, re.I):
        return "medium"
    if s == "Inactive - Withdrawn":
        return "medium"
    if s in ("No Further Action", "No Action Required", "Certified"):
        return "note"
    return "unknown"


def has_elevated_water_media(potential_media_affected: str | None) -> bool:
    if potential_media_affected is None:
        return False
    raw = str(potential_media_affected).strip()
    if not raw or raw.upper() in {"NONE SPECIFIED", "NMA"}:
        return False
    return any(
        token.strip().upper() in ELEVATED_WATER_MEDIA
        for token in raw.split(",")
        if token.strip()
    )


def bump_tier(tier: str) -> str:
    try:
        idx = TIER_ORDER.index(tier)
    except ValueError:
        return tier
    return TIER_ORDER[min(idx + 1, len(TIER_ORDER) - 1)]


def cleanup_hazard_tier(properties: dict[str, Any]) -> dict[str, Any]:
    base = cleanup_status_tier(properties.get("status"))
    media_bump = has_elevated_water_media(properties.get("potential_media_affected"))
    tier = bump_tier(base) if media_bump else base
    return {"tier": tier, "base": base, "mediaBump": media_bump}


def fetch_cleanup_geojson(page_size: int = 2000) -> dict[str, Any]:
    features: list[dict] = []
    offset = 0
    while True:
        params = urlencode(
            {
                "where": ENVIROSTOR_WHERE,
                "outFields": "*",
                "outSR": "4326",
                "f": "geojson",
                "resultRecordCount": page_size,
                "resultOffset": offset,
            }
        )
        with urlopen(f"{ENVIROSTOR_LAYER0}/query?{params}") as resp:
            data = json_load(resp)
        batch = data.get("features") or []
        features.extend(batch)
        more = data.get("properties", {}).get("exceededTransferLimit") and batch
        if not more:
            break
        offset += len(batch)
    return {"type": "FeatureCollection", "features": features}


def json_load(resp):
    import json

    return json.loads(resp.read().decode("utf-8"))


def cleanup_sites_from_geojson(feature_collection: dict[str, Any]) -> list[dict[str, Any]]:
    sites: list[dict[str, Any]] = []
    for feature in feature_collection.get("features") or []:
        coords = (feature.get("geometry") or {}).get("coordinates")
        if not coords or len(coords) < 2:
            continue
        lng, lat = coords[0], coords[1]
        if lat is None or lng is None:
            continue
        props = feature.get("properties") or {}
        tier_info = cleanup_hazard_tier(props)
        tier = tier_info["tier"]
        if tier == "unknown":
            continue
        sites.append(
            {
                "lat": float(lat),
                "lng": float(lng),
                "tier": tier,
                "name": (props.get("project_name") or "").strip() or None,
                "status": (props.get("status") or "").strip() or None,
                "address": (props.get("address") or "").strip() or None,
                "city": (props.get("city") or "").strip() or None,
                "envirostor_id": (
                    str(props["envirostor_id"]).strip()
                    if props.get("envirostor_id") not in (None, "")
                    else None
                ),
            }
        )
    return sites
