#!/usr/bin/env python3
"""Export frontend assets for the Alameda map.

Writes to frontend/public/alameda/:
  land_use.geojson    - General Plan land-use polygons (simplified)
  parcel_index.json   - all target-city parcels with filter fields for the UI
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import geopandas as gpd
import pandas as pd

from config import (
    DEFAULT_MAX_ASPECT_RATIO,
    DEFAULT_MIN_USABLE_WIDTH_M,
    MAX_ACRES,
    MIN_ACRES,
    SQ_M_PER_ACRE,
    TARGET_CITIES,
)
from metrics import evaluate_lead_tracks, normalize_use_code

ALAMEDA_DIR = Path(__file__).resolve().parent
PROCESSED = ALAMEDA_DIR / "processed"
PARCELS_GEOM = PROCESSED / "parcels.geojson"
LAND_USE_CACHE = PROCESSED / "land_use.geojson"
CROSSWALK = PROCESSED / "parcel_landuse_crosswalk.csv"
ZONING_CROSSWALK = PROCESSED / "parcel_zoning_crosswalk.csv"
BUILDING_COVERAGE = PROCESSED / "parcel_building_coverage.csv"
FILTERED_PARCELS = ALAMEDA_DIR / "filtered" / "Parcels_Target_Cities.csv"
USE_CODES = ALAMEDA_DIR / "raw" / "UseCodes.csv"
OUT_DIR = ALAMEDA_DIR.parent / "frontend" / "public" / "alameda"

AREA_CRS = "EPSG:26910"
SIMPLIFY_M = 5.0
DEFAULT_MAX_COVERAGE_RATIO = 0.2
_MIN_SIDE_M = 1e-6


def mrr_aspect_ratio(geom) -> float | None:
    """Length ÷ width of the geometry's minimum-rotated bounding rectangle.

    Always ≥ 1 when defined. Uses the rotated envelope (not axis-aligned
    bounds) so diagonal slivers keep a truthful elongation ratio.
    """
    if geom is None or geom.is_empty:
        return None
    try:
        mrr = geom.minimum_rotated_rectangle
    except Exception:
        return None
    if mrr is None or mrr.is_empty:
        return None
    # Point / very thin line degenerates have no usable rectangle sides.
    if mrr.geom_type == "Point":
        return None
    if mrr.geom_type == "LineString":
        return None
    try:
        coords = list(mrr.exterior.coords)
    except Exception:
        return None
    if len(coords) < 3:
        return None
    # Rectangle exterior is 5 coords (closed); adjacent sides are length & width.
    dx = coords[1][0] - coords[0][0]
    dy = coords[1][1] - coords[0][1]
    side_a = math.hypot(dx, dy)
    dx = coords[2][0] - coords[1][0]
    dy = coords[2][1] - coords[1][1]
    side_b = math.hypot(dx, dy)
    short = min(side_a, side_b)
    long = max(side_a, side_b)
    if short < _MIN_SIDE_M:
        return None
    return long / short


def max_erosion_width_m(geom, tol: float = 0.5) -> float | None:
    """Largest width W (meters) such that geom.buffer(-W/2) is non-empty.

    Inward erosion by W/2 leaves a remnant iff the parcel is at least W
    meters across somewhere. Bent alleyways can pass an MRR aspect test
    yet still fail this check. Result is twice the max interior clearance.
    """
    if geom is None or geom.is_empty:
        return None
    g = geom
    if not g.is_valid:
        g = g.buffer(0)
    if g is None or g.is_empty:
        return None

    minx, miny, maxx, maxy = g.bounds
    hi = min(maxx - minx, maxy - miny) / 2.0
    if hi <= 0:
        return 0.0

    # Numerical: buffer(-hi) on a rectangle of short side 2*hi is empty.
    lo = 0.0
    if not g.buffer(-_MIN_SIDE_M).is_empty:
        # Find largest half-width clearance that still leaves a remnant.
        while hi - lo > tol:
            mid = (lo + hi) / 2.0
            if g.buffer(-mid).is_empty:
                hi = mid
            else:
                lo = mid
        return 2.0 * lo

    # Degenerate / sub-tolerance sliver.
    return 0.0


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
    geom["aspect_ratio"] = geom.geometry.map(mrr_aspect_ratio)
    geom["max_width_m"] = geom.geometry.map(max_erosion_width_m)
    centroids = geom.geometry.centroid.to_crs("EPSG:4326")
    geom["centroid_lat"] = centroids.y
    geom["centroid_lng"] = centroids.x
    merged = attrs.merge(
        geom[
            [
                "APN",
                "area_acres",
                "aspect_ratio",
                "max_width_m",
                "centroid_lat",
                "centroid_lng",
            ]
        ],
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
    else:
        print("warning: parcel_landuse_crosswalk.csv not found")

    zoning_by_apn: dict[str, dict] = {}
    if ZONING_CROSSWALK.exists():
        zx = pd.read_csv(ZONING_CROSSWALK, dtype=str)
        for row in zx.itertuples(index=False):
            if not row.tier or str(row.tier).strip() in ("", "nan", "None"):
                continue
            overlay = row.overlay
            if overlay is None or str(overlay).strip() in ("", "nan", "None"):
                overlay = None
            else:
                overlay = str(overlay).strip()
            shelter = str(row.allows_shelter_by_right).strip().lower()
            th = str(row.allows_transitional_housing).strip().lower()
            entry_z: dict = {
                "tier": str(row.tier).strip().upper(),
                "matched_zone": str(row.matched_zone).strip()
                if row.matched_zone and str(row.matched_zone) not in ("nan", "None")
                else None,
                "base_zone": str(row.base_zone).strip()
                if row.base_zone and str(row.base_zone) not in ("nan", "None")
                else None,
                "overlay": overlay,
                "overlap_frac": float(row.overlap_frac)
                if row.overlap_frac not in (None, "", "nan")
                else None,
            }
            if shelter in ("true", "false"):
                entry_z["allows_shelter_by_right"] = shelter == "true"
            if th in ("true", "false"):
                entry_z["allows_transitional_housing"] = th == "true"
            zoning_by_apn[row.APN] = entry_z
    else:
        print("warning: parcel_zoning_crosswalk.csv not found; run join_parcels_to_zoning.py")

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
        if pd.notna(row.aspect_ratio):
            entry["aspect_ratio"] = round(float(row.aspect_ratio), 2)
        if pd.notna(row.max_width_m):
            entry["max_width_m"] = round(float(row.max_width_m), 1)
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
        zoning = zoning_by_apn.get(row.APN)
        if zoning:
            entry["zoning"] = zoning
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
            "maxAspectRatio": DEFAULT_MAX_ASPECT_RATIO,
            "minUsableWidthM": DEFAULT_MIN_USABLE_WIDTH_M,
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
    print("Annotating EnviroStor edge distances…")
    from annotate_env_distances import annotate_env_distances
    from envirostor import cleanup_sites_from_geojson, fetch_cleanup_geojson

    geom = gpd.read_file(PARCELS_GEOM, columns=["APN", "geometry"])
    sites = cleanup_sites_from_geojson(fetch_cleanup_geojson())
    stats = annotate_env_distances(index["parcels"], geom, sites)
    print(
        f"  env: {stats['hit_parcels']:,} parcels near cleanup sites "
        f"(strong {stats['strong']:,} / medium {stats['medium']:,} / note {stats['note']:,})"
    )
    index.setdefault("defaults", {}).update(
        {
            "envStrongMeters": 50,
            "envMediumMeters": 25,
            "envNoteMeters": 0,
        }
    )

    print("Annotating freeway buffer overlap…")
    from annotate_freeway_overlap import (
        annotate_freeway_overlap,
        build_freeway_buffer_union,
        fetch_shn_lines,
        DEFAULT_BUFFER_METERS,
    )

    shn = fetch_shn_lines()
    buffer_union = build_freeway_buffer_union(shn, buffer_meters=DEFAULT_BUFFER_METERS)
    fw_stats = annotate_freeway_overlap(index["parcels"], geom, buffer_union)
    print(
        f"  freeway: {fw_stats['hit_parcels']:,} intersect buffer; "
        f"{fw_stats['excluded_ge_50']:,} ≥50% overlap"
    )
    index.setdefault("defaults", {}).update(
        {
            "freewayBufferMeters": DEFAULT_BUFFER_METERS,
            "freewayOverlapThreshold": 0.5,
        }
    )

    index_path = OUT_DIR / "parcel_index.json"
    index_path.write_text(json.dumps(index))
    print(f"{index_path.name}: {len(index['parcels']):,} parcels, "
          f"{index_path.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
