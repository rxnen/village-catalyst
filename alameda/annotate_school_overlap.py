#!/usr/bin/env python3
"""Annotate parcel_index.json with active school-campus overlap fraction.

Fetches California School Campus Database (CSCD) 2025 current stacked
campus polygons for Alameda County (Status='Active'), unions them, and
stores for each parcel:

  school_overlap_frac: float in [0, 1]  (omitted when 0)

Fraction is area(parcel ∩ union(campuses)) / area(parcel), so stacked
or adjacent campuses are not double-counted. Parcels at or above 30%
overlap are treated as exclusions in the map filter.

Usage:
  python annotate_school_overlap.py
  python annotate_school_overlap.py --force-fetch
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import geopandas as gpd
import shapely

from arcgis_fetch import fetch_layer_geojson

ALAMEDA_DIR = Path(__file__).resolve().parent
PROCESSED = ALAMEDA_DIR / "processed"
PARCELS_GEOM = PROCESSED / "parcels.geojson"
OUT_INDEX = ALAMEDA_DIR.parent / "frontend" / "public" / "alameda" / "parcel_index.json"
CSCD_CACHE = PROCESSED / "cscd_ala_active.geojson"

CSCD_URL = (
    "https://services1.arcgis.com/4ZKi1B1zTblbwgWB/arcgis/rest/services/"
    "California_School_Campus_Database_2025/FeatureServer/0"
)
CSCD_WHERE = "County='Alameda' AND Status='Active'"
CSCD_FIELDS = [
    "School",
    "District",
    "Status",
    "County",
    "Level_",
    "Street",
    "City",
]

AREA_CRS = "EPSG:26910"  # NAD83 / UTM zone 10N — meters
DEFAULT_OVERLAP_THRESHOLD = 0.3


def fetch_cscd_campuses(*, force: bool = False) -> gpd.GeoDataFrame:
    if CSCD_CACHE.exists() and not force:
        print(f"Loading cached CSCD campuses from {CSCD_CACHE}")
        return gpd.read_file(CSCD_CACHE)

    print(f"Fetching CSCD campuses ({CSCD_WHERE})…")
    gdf = fetch_layer_geojson(
        CSCD_URL,
        out_fields=CSCD_FIELDS,
        where=CSCD_WHERE,
    )
    CSCD_CACHE.parent.mkdir(parents=True, exist_ok=True)
    gdf.to_file(CSCD_CACHE, driver="GeoJSON")
    print(f"  cached {len(gdf):,} features → {CSCD_CACHE}")
    return gdf


def build_school_union(campuses: gpd.GeoDataFrame):
    polys = campuses.copy()
    if polys.crs is None:
        polys = polys.set_crs("EPSG:4326")
    polys = polys.to_crs(AREA_CRS)
    geoms = []
    for geom in polys.geometry:
        if geom is None or geom.is_empty:
            continue
        if not geom.is_valid:
            geom = shapely.make_valid(geom)
        if geom is None or geom.is_empty:
            continue
        geoms.append(geom)
    union = shapely.union_all(geoms) if geoms else None
    if union is None or union.is_empty:
        raise RuntimeError("CSCD campus union is empty")
    return union


def annotate_school_overlap(
    parcels: dict[str, dict],
    geom_gdf: gpd.GeoDataFrame,
    school_union,
    *,
    threshold: float = DEFAULT_OVERLAP_THRESHOLD,
) -> dict[str, int]:
    """Mutate parcels with school_overlap_frac. Return stats."""
    for parcel in parcels.values():
        parcel.pop("school_overlap_frac", None)

    if geom_gdf.empty:
        return {"hit_parcels": 0, "excluded_ge_30": 0}

    apns = set(parcels.keys())
    parcels_gdf = geom_gdf[geom_gdf["APN"].isin(apns)].copy()
    if parcels_gdf.crs is None:
        parcels_gdf = parcels_gdf.set_crs("EPSG:4326")
    parcels_gdf = parcels_gdf.to_crs(AREA_CRS)

    school_gdf = gpd.GeoDataFrame(
        {"sch_id": [0]}, geometry=[school_union], crs=AREA_CRS
    )
    joined = gpd.sjoin(
        parcels_gdf[["APN", "geometry"]],
        school_gdf,
        how="inner",
        predicate="intersects",
    )
    if joined.empty:
        return {"hit_parcels": 0, "excluded_ge_30": 0}

    hit_apns = joined["APN"].drop_duplicates()
    parcel_geoms = {
        row.APN: row.geometry for row in parcels_gdf.itertuples(index=False)
    }

    hit_parcels = 0
    excluded_ge_30 = 0
    for apn in hit_apns:
        poly = parcel_geoms.get(apn)
        if poly is None or poly.is_empty:
            continue
        parcel_area = float(poly.area)
        if parcel_area <= 0:
            continue
        inter = poly.intersection(school_union)
        if inter is None or inter.is_empty:
            continue
        frac = float(inter.area) / parcel_area
        if frac <= 0:
            continue
        frac = min(1.0, max(0.0, frac))
        parcels[apn]["school_overlap_frac"] = round(frac, 4)
        hit_parcels += 1
        if frac >= threshold:
            excluded_ge_30 += 1

    return {"hit_parcels": hit_parcels, "excluded_ge_30": excluded_ge_30}


def annotate_index_file(
    index_path: Path = OUT_INDEX,
    parcels_geom_path: Path = PARCELS_GEOM,
    *,
    threshold: float = DEFAULT_OVERLAP_THRESHOLD,
    force_fetch: bool = False,
) -> dict[str, int]:
    if not index_path.exists():
        sys.exit(f"Missing {index_path}")
    if not parcels_geom_path.exists():
        sys.exit(f"Missing {parcels_geom_path}")

    campuses = fetch_cscd_campuses(force=force_fetch)
    print(f"  {len(campuses):,} active Alameda campuses")
    print("Unioning campus polygons…")
    school_union = build_school_union(campuses)

    print(f"Loading parcel index {index_path}…")
    index = json.loads(index_path.read_text())
    parcels = index["parcels"]
    print(f"  {len(parcels):,} parcels")

    print(f"Loading geometries {parcels_geom_path}…")
    geom = gpd.read_file(parcels_geom_path, columns=["APN", "geometry"])
    print(f"  {len(geom):,} parcel polygons")

    print("Computing school campus overlap fractions…")
    stats = annotate_school_overlap(
        parcels, geom, school_union, threshold=threshold
    )
    pct = int(round(threshold * 100))
    print(
        f"  {stats['hit_parcels']:,} parcels intersect a campus; "
        f"{stats['excluded_ge_30']:,} have ≥{pct}% overlap"
    )

    defaults = index.setdefault("defaults", {})
    defaults["schoolOverlapThreshold"] = threshold

    index_path.write_text(json.dumps(index))
    print(f"Wrote {index_path} ({index_path.stat().st_size / 1e6:.1f} MB)")
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--threshold",
        type=float,
        default=DEFAULT_OVERLAP_THRESHOLD,
        help="Overlap fraction at or above which a parcel is excluded (default 0.3)",
    )
    parser.add_argument(
        "--index",
        type=Path,
        default=OUT_INDEX,
        help="Path to parcel_index.json",
    )
    parser.add_argument(
        "--force-fetch",
        action="store_true",
        help="Re-download CSCD campuses even if cache exists",
    )
    args = parser.parse_args()
    annotate_index_file(
        index_path=args.index,
        threshold=args.threshold,
        force_fetch=args.force_fetch,
    )


if __name__ == "__main__":
    main()
