"""Parcel metric helpers shared by filter scripts and export."""

from __future__ import annotations

from config import (
    JUNK_ZERO_VALUE_USE_CODES,
    TRACK_B_MAX_IMPS_LAND_RATIO,
    TRACK_B_MIN_LAND,
)


def parse_mailing_city(mailing_city_state: str) -> str:
    """Extract city from assessor MailingAddressCityState (e.g. 'PIEDMONT CA')."""
    parts = (mailing_city_state or "").strip().upper().split()
    if len(parts) >= 2 and len(parts[-1]) == 2 and parts[-1].isalpha():
        return " ".join(parts[:-1])
    return " ".join(parts)


def _as_float(value: str | None) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def is_economic_unit_empty(value: str | None) -> bool:
    return (value or "").strip() in ("", "0")


def normalize_use_code(code: str | None) -> str | None:
    if code is None or str(code).strip() == "":
        return None
    return str(int(str(code).strip()))


def is_junk_zero_value_use_code(use_code: str | None) -> bool:
    normalized = normalize_use_code(use_code)
    return normalized is not None and normalized in JUNK_ZERO_VALUE_USE_CODES


def evaluate_lead_tracks(
    *,
    land: str | None,
    imps: str | None,
    hoex: str | None,
    otex: str | None,
    situs_city: str | None,
    mailing_city_state: str | None,
    economic_unit: str | None,
    use_code: str | None = None,
) -> dict:
    """Score a parcel against Track A / Track B lead rules.

    Returns dict with excluded, track_a, track_b, tracks (sorted list of 'a'/'b'),
    and imps_land_ratio when land > 0.
    """
    land_v = _as_float(land)
    imps_v = _as_float(imps)
    hoex_v = _as_float(hoex)
    otex_v = _as_float(otex)

    if land_v == 0 and imps_v == 0 and is_junk_zero_value_use_code(use_code):
        return {
            "excluded": True,
            "track_a": False,
            "track_b": False,
            "tracks": [],
            "imps_land_ratio": None,
        }

    situs = (situs_city or "").strip().upper()
    mail_city = parse_mailing_city(mailing_city_state or "")

    track_a = otex_v > 0 or (hoex_v == 0 and bool(mail_city) and bool(situs) and mail_city != situs)

    ratio = imps_v / land_v if land_v > 0 else None
    track_b = (
        land_v > TRACK_B_MIN_LAND
        and ratio is not None
        and ratio < TRACK_B_MAX_IMPS_LAND_RATIO
        and is_economic_unit_empty(economic_unit)
    )

    tracks: list[str] = []
    if track_a:
        tracks.append("a")
    if track_b:
        tracks.append("b")

    return {
        "excluded": False,
        "track_a": track_a,
        "track_b": track_b,
        "tracks": tracks,
        "imps_land_ratio": ratio,
    }


def has_lead(tracks: dict) -> bool:
    return not tracks.get("excluded") and bool(tracks.get("tracks"))
