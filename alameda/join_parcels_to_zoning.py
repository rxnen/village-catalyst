#!/usr/bin/env python3
"""Spatially join target-city parcels to zoning polygons and resolve A/B/C tiers.

Joins every parcel in the target-city attribute set (not just map-viable
parcels) to its city's zoning layer, picks the zone with greatest overlap,
then resolves the Zoning.xlsx tier (base+overlay row if present, else base).

Outputs:
  processed/parcel_zoning_crosswalk.csv
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import geopandas as gpd
import pandas as pd
import shapely

from config import TARGET_CITIES

ALAMEDA_DIR = Path(__file__).resolve().parent
REPO = ALAMEDA_DIR.parent
PROCESSED = ALAMEDA_DIR / "processed"
RAW_ZONING = ALAMEDA_DIR / "raw" / "zoning"
PARCELS_GEOM = PROCESSED / "parcels.geojson"
FILTERED_PARCELS = ALAMEDA_DIR / "filtered" / "Parcels_Target_Cities.csv"
TIERS_JSON = REPO / "frontend" / "public" / "alameda" / "zoning" / "zoning_tiers.json"
CROSSWALK_OUT = PROCESSED / "parcel_zoning_crosswalk.csv"

AREA_CRS = "EPSG:26910"

# SitusCity (uppercase) → Zoning.xlsx / GeoJSON city label
CITY_LABEL = {
    "OAKLAND": "Oakland",
    "BERKELEY": "Berkeley",
    "SAN LEANDRO": "San Leandro",
    "HAYWARD": "Hayward",
}

ZONING_FILES = {
    "Oakland": RAW_ZONING / "Oakland.geojson",
    "Berkeley": RAW_ZONING / "Berkeley.geojson",
    "San Leandro": RAW_ZONING / "SanLeandro.geojson",
    "Hayward": RAW_ZONING / "Hayward.geojson",
}


def clean_overlay(overlay) -> str | None:
    if overlay is None or (isinstance(overlay, float) and pd.isna(overlay)):
        return None
    text = str(overlay).strip()
    if not text or text in ("None", "null", "nan"):
        return None
    return text.lstrip("/")


def zone_identity(city: str, props: dict) -> tuple[str | None, str | None, str | None]:
    """Return (base, overlay, full) for a zoning feature."""
    if city == "Oakland":
        return (
            props.get("basezone"),
            clean_overlay(props.get("overlay")),
            props.get("znlabel"),
        )
    if city == "Berkeley":
        zc = props.get("zoneclass")
        return zc, None, zc
    if city == "San Leandro":
        return (
            props.get("ZONING"),
            clean_overlay(props.get("OVERLAY")),
            props.get("LABEL"),
        )
    if city == "Hayward":
        return (
            props.get("ZONING_"),
            clean_overlay(props.get("ZoningOverlay")),
            None,
        )
    return None, None, None


def load_tiers() -> dict[str, dict[str, dict]]:
    if not TIERS_JSON.exists():
        sys.exit(f"Missing {TIERS_JSON} (run export_zoning_tiers.py first)")
    payload = json.loads(TIERS_JSON.read_text())
    return payload["by_city"]


def resolve_tier(
    by_city: dict[str, dict[str, dict]],
    city: str,
    base: str | None,
    overlay: str | None,
    full: str | None,
) -> tuple[str | None, str | None, dict]:
    city_map = by_city.get(city) or {}
    candidates: list[str] = []
    if full is not None and str(full).strip():
        candidates.append(str(full).strip())
    if base and overlay:
        candidates.append(f"{str(base).strip()}/{overlay}")
    if base is not None and str(base).strip():
        candidates.append(str(base).strip())

    for candidate in candidates:
        hit = city_map.get(candidate)
        if hit:
            return hit.get("tier"), candidate, hit
    return None, (str(base).strip() if base else None), {}


def load_apn_cities() -> pd.DataFrame:
    if not FILTERED_PARCELS.exists():
        sys.exit(f"Missing {FILTERED_PARCELS} (run filter_parcels.py first)")
    df = pd.read_csv(FILTERED_PARCELS, dtype=str, encoding="utf-8-sig")
    cities = {c.upper() for c in TARGET_CITIES}
    df = df[df["SitusCity"].str.upper().isin(cities)].copy()
    df["city_label"] = df["SitusCity"].str.upper().str.strip().map(CITY_LABEL)
    df = df[df["city_label"].notna()][["APN", "city_label"]].drop_duplicates("APN")
    return df


def join_city(
    parcels: gpd.GeoDataFrame,
    city: str,
    by_city: dict[str, dict[str, dict]],
) -> pd.DataFrame:
    path = ZONING_FILES[city]
    if not path.exists():
        sys.exit(f"Missing zoning file: {path}")

    city_parcels = parcels[parcels["city_label"] == city].copy()
    if city_parcels.empty:
        print(f"  {city}: no parcels")
        return pd.DataFrame()

    zoning = gpd.read_file(path)
    zoning = zoning[zoning.geometry.notna()].copy()
    zoning = zoning.to_crs(AREA_CRS)
    zoning.geometry = zoning.geometry.make_valid()
    zoning["zone_feature_id"] = zoning.index.astype(int)

    # Normalize identity columns onto the frame for sjoin carry-through.
    bases, overlays, fulls = [], [], []
    for _, row in zoning.iterrows():
        base, overlay, full = zone_identity(city, row.to_dict())
        bases.append(base)
        overlays.append(overlay)
        fulls.append(full)
    zoning["z_base_zone"] = bases
    zoning["z_overlay"] = overlays
    zoning["z_full_label"] = fulls

    pairs = gpd.sjoin(
        city_parcels[["APN", "city_label", "parcel_area", "geometry"]],
        zoning,
        how="inner",
        predicate="intersects",
    )
    if pairs.empty:
        print(f"  {city}: {len(city_parcels):,} parcels, 0 intersections")
        return pd.DataFrame()

    zone_geom = zoning.geometry.loc[pairs["index_right"]].make_valid().values
    parcel_geom = pairs.geometry.make_valid().values
    pairs["overlap_frac"] = (
        shapely.area(shapely.intersection(parcel_geom, zone_geom)) / pairs["parcel_area"]
    )

    best = (
        pairs.sort_values("overlap_frac", ascending=False)
        .drop_duplicates("APN")
        .copy()
    )

    tiers, matched, shelter, th = [], [], [], []
    for row in best.itertuples(index=False):
        base = row.z_base_zone if pd.notna(row.z_base_zone) else None
        overlay = row.z_overlay if pd.notna(row.z_overlay) else None
        full = row.z_full_label if pd.notna(row.z_full_label) else None
        if isinstance(overlay, str) and not overlay.strip():
            overlay = None
        tier, matched_zone, hit = resolve_tier(by_city, city, base, overlay, full)
        tiers.append(tier)
        matched.append(matched_zone)
        shelter.append(bool(hit.get("allows_shelter_by_right")) if hit else None)
        th.append(bool(hit.get("allows_transitional_housing")) if hit else None)

    best["tier"] = tiers
    best["matched_zone"] = matched
    best["allows_shelter_by_right"] = shelter
    best["allows_transitional_housing"] = th
    best["base_zone"] = best["z_base_zone"]
    best["overlay"] = best["z_overlay"]

    print(
        f"  {city}: {len(city_parcels):,} parcels → {len(best):,} matched "
        f"({len(city_parcels) - len(best):,} unmatched); "
        f"tiers {best['tier'].value_counts(dropna=False).to_dict()}"
    )

    return best[
        [
            "APN",
            "city_label",
            "base_zone",
            "overlay",
            "matched_zone",
            "tier",
            "overlap_frac",
            "allows_shelter_by_right",
            "allows_transitional_housing",
            "zone_feature_id",
        ]
    ].rename(columns={"city_label": "city"})


def main() -> None:
    for path in (PARCELS_GEOM, FILTERED_PARCELS, TIERS_JSON):
        if not path.exists():
            sys.exit(f"Missing {path}")

    PROCESSED.mkdir(exist_ok=True)
    by_city = load_tiers()
    apn_cities = load_apn_cities()
    target_apns = set(apn_cities["APN"])
    print(f"target parcels: {len(target_apns):,}")

    print(f"loading geometries from {PARCELS_GEOM.name}…")
    parcels = gpd.read_file(PARCELS_GEOM)
    parcels = parcels[parcels["APN"].isin(target_apns)].copy()
    parcels = parcels[parcels.geometry.notna()].copy()
    parcels = parcels.merge(apn_cities, on="APN", how="left")
    parcels = parcels[parcels["city_label"].notna()].copy()
    parcels = parcels.to_crs(AREA_CRS)
    parcels.geometry = parcels.geometry.make_valid()
    parcels["parcel_area"] = parcels.geometry.area
    parcels = parcels[parcels["parcel_area"] > 0].copy()
    print(f"parcel geometries with city: {len(parcels):,}")

    frames = []
    for city in ("Oakland", "Berkeley", "San Leandro", "Hayward"):
        print(f"joining {city}…")
        frames.append(join_city(parcels, city, by_city))

    crosswalk = pd.concat([f for f in frames if not f.empty], ignore_index=True)
    crosswalk = crosswalk.sort_values(["city", "tier", "APN"])
    crosswalk.to_csv(CROSSWALK_OUT, index=False)
    print(f"wrote {len(crosswalk):,} rows -> {CROSSWALK_OUT}")
    print("tier totals:", crosswalk["tier"].value_counts(dropna=False).to_dict())


if __name__ == "__main__":
    main()
