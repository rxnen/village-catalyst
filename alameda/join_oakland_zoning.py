#!/usr/bin/env python3
"""Spatially join viable Oakland parcels to Oakland zoning polygons.

Uses the same viability rules as the map defaults (acreage, aspect, usable
width, default use-code clusters, EnviroStor strong/medium exclusion), then
intersects those parcel polygons with Oakland zoning.

Outputs:
  processed/oakland_viable_zoning_crosswalk.csv  - one row per viable parcel
  processed/oakland_hit_zones.json               - zone labels + feature ids hit
  processed/oakland_hit_zones.geojson            - zoning polygons that were hit
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import geopandas as gpd
import pandas as pd
import shapely

from config import (
    DEFAULT_MAX_ASPECT_RATIO,
    DEFAULT_MIN_USABLE_WIDTH_M,
    MAX_ACRES,
    MIN_ACRES,
)

ALAMEDA_DIR = Path(__file__).resolve().parent
REPO = ALAMEDA_DIR.parent
PROCESSED = ALAMEDA_DIR / "processed"
PARCELS_GEOM = PROCESSED / "parcels.geojson"
ZONING_PATH = ALAMEDA_DIR / "raw" / "zoning" / "Oakland.geojson"
PARCEL_INDEX = REPO / "frontend" / "public" / "alameda" / "parcel_index.json"

CROSSWALK_OUT = PROCESSED / "oakland_viable_zoning_crosswalk.csv"
HIT_ZONES_JSON = PROCESSED / "oakland_hit_zones.json"
HIT_ZONES_GEOJSON = PROCESSED / "oakland_hit_zones.geojson"
PUBLIC_HIT_ZONES = REPO / "frontend" / "public" / "alameda" / "zoning" / "Oakland_hit.geojson"

AREA_CRS = "EPSG:26910"
CITY = "OAKLAND"

# Mirrors frontend/src/useCodeClusters.js defaultIncluded clusters.
DEFAULT_INCLUDED_USE_CODES = frozenset(
    str(code)
    for code in (
        # vacant_land
        800, 1000, 1040, 3000, 4000, 5000, 5700, 5900, 7000, 7040,
        # public_government
        6000, 6001,
        # institutional
        6100, 6200, 6400, 6500, 6590, 6600, 6700, 6800, 7900,
    )
)

ENV_STRONG_M = 50.0
ENV_MEDIUM_M = 25.0


def parcel_excluded_by_env(parcel: dict) -> bool:
    env = parcel.get("env") or {}
    strong = env.get("strong")
    medium = env.get("medium")
    if strong is not None and strong <= ENV_STRONG_M:
        return True
    if medium is not None and medium <= ENV_MEDIUM_M:
        return True
    return False


def is_viable_oakland(parcel: dict) -> bool:
    if parcel.get("city") != CITY:
        return False
    acres = parcel.get("area_acres")
    if acres is None or acres < MIN_ACRES or acres > MAX_ACRES:
        return False
    aspect = parcel.get("aspect_ratio")
    if aspect is not None and aspect > DEFAULT_MAX_ASPECT_RATIO:
        return False
    width = parcel.get("max_width_m")
    if width is not None and width < DEFAULT_MIN_USABLE_WIDTH_M:
        return False
    use_code = parcel.get("use_code")
    if use_code is None or str(use_code) not in DEFAULT_INCLUDED_USE_CODES:
        return False
    if parcel_excluded_by_env(parcel):
        return False
    return True


def load_viable_apns() -> dict[str, dict]:
    with PARCEL_INDEX.open() as f:
        index = json.load(f)
    viable = {
        apn: parcel
        for apn, parcel in index["parcels"].items()
        if is_viable_oakland(parcel)
    }
    return viable


def main() -> None:
    for path in (PARCELS_GEOM, ZONING_PATH, PARCEL_INDEX):
        if not path.exists():
            sys.exit(f"Missing {path}")

    PROCESSED.mkdir(exist_ok=True)
    viable = load_viable_apns()
    target_apns = set(viable)
    print(f"viable Oakland parcels (map defaults): {len(target_apns):,}")
    if not target_apns:
        sys.exit("No viable Oakland parcels found")

    print(f"loading parcel geometries from {PARCELS_GEOM.name}…")
    parcels = gpd.read_file(PARCELS_GEOM)
    parcels = parcels[parcels["APN"].isin(target_apns)].copy()
    parcels = parcels[parcels.geometry.notna()].copy()
    print(f"matched parcel geometries: {len(parcels):,}")
    missing = target_apns - set(parcels["APN"])
    if missing:
        print(f"warning: {len(missing):,} viable APNs missing geometry")

    zoning = gpd.read_file(ZONING_PATH)
    zoning = zoning[zoning.geometry.notna()].copy()
    zoning["zone_feature_id"] = zoning.index.astype(int)
    print(f"Oakland zoning polygons: {len(zoning):,}")

    parcels = parcels.to_crs(AREA_CRS)
    zoning = zoning.to_crs(AREA_CRS)
    parcels.geometry = parcels.geometry.make_valid()
    zoning.geometry = zoning.geometry.make_valid()
    parcels["parcel_area"] = parcels.geometry.area
    parcels = parcels[parcels["parcel_area"] > 0].copy()

    pairs = gpd.sjoin(
        parcels[["APN", "parcel_area", "geometry"]],
        zoning,
        how="inner",
        predicate="intersects",
    )
    zone_geom = zoning.geometry.loc[pairs["index_right"]].make_valid().values
    parcel_geom = pairs.geometry.make_valid().values
    pairs["overlap_frac"] = shapely.area(shapely.intersection(parcel_geom, zone_geom)) / pairs[
        "parcel_area"
    ]
    print(f"intersecting parcel/zone pairs: {len(pairs):,}")

    best = (
        pairs.sort_values("overlap_frac", ascending=False)
        .drop_duplicates("APN")
        .copy()
    )
    print(
        f"parcels with a zoning match: {len(best):,} "
        f"({len(parcels) - len(best):,} with no intersection)"
    )

    best["znlabel"] = best["znlabel"].fillna("").astype(str)
    best["basezone"] = best["basezone"].fillna("").astype(str)
    best["overlay"] = best["overlay"].fillna("").astype(str)
    best["address"] = best["APN"].map(lambda apn: viable[apn].get("address"))
    best["area_acres"] = best["APN"].map(lambda apn: viable[apn].get("area_acres"))
    best["use_code"] = best["APN"].map(lambda apn: viable[apn].get("use_code"))
    best["use_code_label"] = best["APN"].map(
        lambda apn: viable[apn].get("use_code_label")
    )

    crosswalk = best[
        [
            "APN",
            "address",
            "area_acres",
            "use_code",
            "use_code_label",
            "znlabel",
            "basezone",
            "overlay",
            "zone_feature_id",
            "overlap_frac",
        ]
    ].sort_values(["znlabel", "APN"])
    crosswalk.to_csv(CROSSWALK_OUT, index=False)
    print(f"wrote {len(crosswalk):,} rows -> {CROSSWALK_OUT}")

    hit_ids = sorted(set(pairs["zone_feature_id"].astype(int)))
    by_label = (
        best.groupby(["znlabel", "basezone", "overlay"], dropna=False)
        .size()
        .reset_index(name="viable_parcel_count")
        .sort_values(["viable_parcel_count", "znlabel"], ascending=[False, True])
    )
    by_base = (
        best.groupby("basezone", dropna=False)
        .size()
        .reset_index(name="viable_parcel_count")
        .sort_values(["viable_parcel_count", "basezone"], ascending=[False, True])
    )

    summary = {
        "city": CITY,
        "viable_parcel_count": len(target_apns),
        "matched_parcel_count": int(len(best)),
        "hit_zone_polygon_count": len(hit_ids),
        "hit_znlabel_count": int(by_label.shape[0]),
        "hit_basezone_count": int(by_base.shape[0]),
        "hit_zone_feature_ids": hit_ids,
        "by_znlabel": by_label.to_dict(orient="records"),
        "by_basezone": by_base.to_dict(orient="records"),
    }
    HIT_ZONES_JSON.write_text(json.dumps(summary, indent=2))
    print(f"wrote summary -> {HIT_ZONES_JSON}")

    hit_zoning = zoning[zoning["zone_feature_id"].isin(hit_ids)].to_crs("EPSG:4326")
    hit_zoning.to_file(HIT_ZONES_GEOJSON, driver="GeoJSON")
    PUBLIC_HIT_ZONES.parent.mkdir(parents=True, exist_ok=True)
    hit_zoning.to_file(PUBLIC_HIT_ZONES, driver="GeoJSON")
    print(f"wrote {len(hit_zoning):,} hit-zone polygons -> {HIT_ZONES_GEOJSON}")
    print(f"copied for frontend -> {PUBLIC_HIT_ZONES}")

    print("\nZones hit by viable Oakland parcels (by znlabel):")
    for row in by_label.itertuples(index=False):
        overlay = f" overlay={row.overlay}" if row.overlay else ""
        print(
            f"  {row.znlabel or '(blank)':20s}  "
            f"base={row.basezone or '—'}{overlay}  "
            f"parcels={row.viable_parcel_count}"
        )


if __name__ == "__main__":
    main()
