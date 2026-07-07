#!/usr/bin/env python3
"""Export frontend assets for the Alameda map.

Writes to frontend/public/alameda/:
  land_use.geojson    - General Plan land-use polygons (simplified)
  parcel_index.json   - all target-city parcels with filter fields for the UI
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import geopandas as gpd
import pandas as pd

from config import MAX_ACRES, MIN_ACRES, SQ_M_PER_ACRE, TARGET_CITIES
from metrics import evaluate_lead_tracks, normalize_use_code

ALAMEDA_DIR = Path(__file__).resolve().parent
PROCESSED = ALAMEDA_DIR / "processed"
PARCELS_GEOM = PROCESSED / "parcels.geojson"
LAND_USE_CACHE = PROCESSED / "land_use.geojson"
CROSSWALK = PROCESSED / "parcel_landuse_crosswalk.csv"
BUILDING_COVERAGE = PROCESSED / "parcel_building_coverage.csv"
FILTERED_PARCELS = ALAMEDA_DIR / "filtered" / "Parcels_Target_Cities.csv"
USE_CODES = ALAMEDA_DIR / "raw" / "UseCodes.csv"
OUT_DIR = ALAMEDA_DIR.parent / "frontend" / "public" / "alameda"

AREA_CRS = "EPSG:26910"
SIMPLIFY_M = 5.0
DEFAULT_MAX_COVERAGE_RATIO = 0.2


def load_use_code_lookup() -> dict[str, str]:
    if not USE_CODES.exists():
        return {}
    df = pd.read_csv(USE_CODES, dtype=str, encoding="utf-8-sig")
    return {
        normalize_use_code(row.Use_Code): row.Use_Code_Common_Name
        for row in df.itertuples(index=False)
        if normalize_use_code(row.Use_Code) is not None
    }


def gplu_category(gplu: str) -> str:
    code = (gplu or "").upper()
    if code in {"RH", "R1", "RSL", "RLM", "RMN", "RMX", "LDR", "MDR", "LMDR", "HDR", "MHDR", "RR"} or code.startswith("CBD-R"):
        return "residential"
    if code in {"GC", "CG", "CC", "CNM", "CS"} or code.startswith("CBD-") and "R" not in code[:6]:
        return "commercial"
    if code in {"I", "LIRD"}:
        return "industrial"
    if code in {"OS-N", "OS-P", "P", "PF", "RM"} or code.startswith("PF-"):
        return "open_space_public"
    if code in {"PUB", "MP", "S"}:
        return "public_institutional"
    if code in {"LPA", "WM", "SD", "SLVSP"}:
        return "agriculture_rural"
    if code in {"MU", "CBD-TOD-R", "CBD-TOD-O", "CBD-RMU"}:
        return "mixed_use"
    return "other"


def build_parcel_index() -> dict:
    if not FILTERED_PARCELS.exists():
        sys.exit(f"Missing {FILTERED_PARCELS} (run filter_parcels.py first)")
    if not PARCELS_GEOM.exists():
        sys.exit(f"Missing {PARCELS_GEOM} (run build_parcel_landuse_crosswalk.py first)")

    attrs = pd.read_csv(FILTERED_PARCELS, dtype=str, encoding="utf-8-sig")
    geom = gpd.read_file(PARCELS_GEOM)
    geom = geom[geom["APN"].isin(attrs["APN"])].to_crs(AREA_CRS)
    geom["area_acres"] = geom.geometry.area / SQ_M_PER_ACRE
    centroids = geom.geometry.centroid.to_crs("EPSG:4326")
    geom["centroid_lat"] = centroids.y
    geom["centroid_lng"] = centroids.x
    merged = attrs.merge(
        geom[["APN", "area_acres", "centroid_lat", "centroid_lng"]],
        on="APN",
        how="left",
    )

    use_code_lookup = load_use_code_lookup()
    if not use_code_lookup and USE_CODES.exists():
        print("warning: UseCodes.csv loaded but no codes found")
    elif not USE_CODES.exists():
        print("warning: UseCodes.csv not found; parcel use codes will be omitted")

    land_use_by_apn: dict[str, dict] = {}
    if CROSSWALK.exists():
        xw = pd.read_csv(CROSSWALK, dtype=str)
        for row in xw.itertuples(index=False):
            land_use_by_apn[row.APN] = {
                "general_plan": row.General_Plan,
                "gplu": row.GPLU,
                "gplu_definition": row.GPLU_definition,
                "label": row.LABEL,
                "category": gplu_category(row.GPLU),
                "overlap_frac": float(row.overlap_frac),
            }

    coverage_by_apn: dict[str, float] = {}
    if BUILDING_COVERAGE.exists():
        cov = pd.read_csv(BUILDING_COVERAGE)
        cov = (
            cov.groupby("APN", as_index=False)
            .agg(
                building_footprint_sq_m=("building_footprint_sq_m", "sum"),
                parcel_area_sq_m=("parcel_area_sq_m", "sum"),
            )
        )
        cov["coverage_ratio"] = cov["building_footprint_sq_m"] / cov["parcel_area_sq_m"]
        coverage_by_apn = {
            row.APN: float(row.coverage_ratio)
            for row in cov.itertuples(index=False)
        }
    else:
        print("warning: parcel_building_coverage.csv not found; run join_buildings_to_parcels.py")

    parcels: dict[str, dict] = {}
    excluded = track_a_n = track_b_n = both_n = 0
    for row in merged.itertuples(index=False):
        leads = evaluate_lead_tracks(
            land=row.Land,
            imps=row.Imps,
            hoex=row.HOEX,
            otex=row.OTEX,
            situs_city=row.SitusCity,
            mailing_city_state=row.MailingAddressCityState,
            economic_unit=row.EconomicUnit,
            use_code=row.UseCode,
        )
        if leads["excluded"]:
            excluded += 1
            continue
        if leads["track_a"]:
            track_a_n += 1
        if leads["track_b"]:
            track_b_n += 1
        if leads["track_a"] and leads["track_b"]:
            both_n += 1

        city = (row.SitusCity or "").strip().upper()
        entry: dict = {
            "city": city,
            "area_acres": float(row.area_acres) if pd.notna(row.area_acres) else None,
            "track_a": leads["track_a"],
            "track_b": leads["track_b"],
            "tracks": leads["tracks"],
        }
        situs_address = (row.SitusAddress or "").strip()
        if situs_address:
            entry["address"] = situs_address
        situs_zip = (row.SitusZip or "").strip()
        if situs_zip:
            entry["zip"] = situs_zip
        if pd.notna(row.centroid_lat) and pd.notna(row.centroid_lng):
            entry["lat"] = float(row.centroid_lat)
            entry["lng"] = float(row.centroid_lng)
        if leads["imps_land_ratio"] is not None:
            entry["imps_land_ratio"] = leads["imps_land_ratio"]
        coverage_ratio = coverage_by_apn.get(row.APN)
        if coverage_ratio is not None:
            entry["coverage_ratio"] = coverage_ratio
        lu = land_use_by_apn.get(row.APN)
        entry["land_use"] = lu if lu else {"category": "unmatched"}
        use_code = normalize_use_code(row.UseCode)
        if use_code:
            entry["use_code"] = use_code
            label = use_code_lookup.get(use_code)
            if label:
                entry["use_code_label"] = label
        parcels[row.APN] = entry

    print(
        f"lead tracks: excluded {excluded:,}; "
        f"track A {track_a_n:,}; track B {track_b_n:,}; both {both_n:,}"
    )

    return {
        "defaults": {
            "cities": list(TARGET_CITIES),
            "minAcres": MIN_ACRES,
            "maxAcres": MAX_ACRES,
            "maxCoverageRatio": DEFAULT_MAX_COVERAGE_RATIO,
            "onlyLeads": False,
            "requireBothTracks": False,
        },
        "parcels": parcels,
    }


def main() -> None:
    if not LAND_USE_CACHE.exists():
        sys.exit("Missing land_use.geojson cache (run build_parcel_landuse_crosswalk.py first)")

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    land_use = gpd.read_file(LAND_USE_CACHE)
    land_use["category"] = land_use["GPLU"].map(gplu_category)
    land_use.geometry = (
        land_use.geometry.to_crs(AREA_CRS).simplify(SIMPLIFY_M).to_crs("EPSG:4326")
    )
    land_use_path = OUT_DIR / "land_use.geojson"
    land_use.to_file(land_use_path, driver="GeoJSON", COORDINATE_PRECISION=6)
    print(f"{land_use_path.name}: {len(land_use):,} features, "
          f"{land_use_path.stat().st_size / 1e6:.1f} MB")

    index = build_parcel_index()
    index_path = OUT_DIR / "parcel_index.json"
    index_path.write_text(json.dumps(index))
    print(f"{index_path.name}: {len(index['parcels']):,} parcels, "
          f"{index_path.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
