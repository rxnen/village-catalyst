#!/usr/bin/env python3
"""Annotate parcel_index.json with freeway buffer overlap fraction.

Fetches Caltrans State Highway Network (SHN) lines for Alameda County,
buffers them by BUFFER_METERS, unions the buffers, and stores for each
parcel:

  freeway_overlap_frac: float in [0, 1]  (omitted when 0)

Fraction is area(parcel ∩ union(buffers)) / area(parcel), so coverage
across multiple overlapping buffers is not double-counted.

Usage:
  python annotate_freeway_overlap.py
  python annotate_freeway_overlap.py --buffer-meters 20
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
SHN_CACHE = PROCESSED / "shn_ala.geojson"

SHN_URL = (
    "https://caltrans-gis.dot.ca.gov/arcgis/rest/services/"
    "CHhighway/SHN_Lines/FeatureServer/0"
)
SHN_WHERE = "County='ALA'"

AREA_CRS = "EPSG:26910"  # NAD83 / UTM zone 10N — meters
DEFAULT_BUFFER_METERS = 20.0


def fetch_shn_lines(*, force: bool = False) -> gpd.GeoDataFrame:
    if SHN_CACHE.exists() and not force:
        print(f"Loading cached SHN lines from {SHN_CACHE}")
        return gpd.read_file(SHN_CACHE)

    print(f"Fetching SHN lines ({SHN_WHERE})…")
    gdf = fetch_layer_geojson(
        SHN_URL,
        out_fields=["Route", "RouteS", "RouteType", "County"],
        where=SHN_WHERE,
    )
    SHN_CACHE.parent.mkdir(parents=True, exist_ok=True)
    gdf.to_file(SHN_CACHE, driver="GeoJSON")
    print(f"  cached {len(gdf):,} features → {SHN_CACHE}")
    return gdf


def build_freeway_buffer_union(
    shn: gpd.GeoDataFrame, *, buffer_meters: float
) -> shapely.geometry.base.BaseGeometry:
    lines = shn.copy()
    if lines.crs is None:
        lines = lines.set_crs("EPSG:4326")
    lines = lines.to_crs(AREA_CRS)
    buffered = lines.geometry.buffer(buffer_meters)
    union = shapely.union_all(buffered.tolist())
    if union is None or union.is_empty:
        raise RuntimeError("SHN buffer union is empty")
    return union


def annotate_freeway_overlap(
    parcels: dict[str, dict],
    geom_gdf: gpd.GeoDataFrame,
    buffer_union,
) -> dict[str, int]:
    """Mutate parcels with freeway_overlap_frac. Return stats."""
    for parcel in parcels.values():
        parcel.pop("freeway_overlap_frac", None)

    if geom_gdf.empty:
        return {"hit_parcels": 0, "excluded_ge_50": 0}

    apns = set(parcels.keys())
    parcels_gdf = geom_gdf[geom_gdf["APN"].isin(apns)].copy()
    if parcels_gdf.crs is None:
        parcels_gdf = parcels_gdf.set_crs("EPSG:4326")
    parcels_gdf = parcels_gdf.to_crs(AREA_CRS)

    buffer_gdf = gpd.GeoDataFrame(
        {"buf_id": [0]}, geometry=[buffer_union], crs=AREA_CRS
    )
    joined = gpd.sjoin(
        parcels_gdf[["APN", "geometry"]],
        buffer_gdf,
        how="inner",
        predicate="intersects",
    )
    if joined.empty:
        return {"hit_parcels": 0, "excluded_ge_50": 0}

    # One row per APN (single buffer polygon).
    hit_apns = joined["APN"].drop_duplicates()
    parcel_geoms = {
        row.APN: row.geometry for row in parcels_gdf.itertuples(index=False)
    }

    hit_parcels = 0
    excluded_ge_50 = 0
    for apn in hit_apns:
        poly = parcel_geoms.get(apn)
        if poly is None or poly.is_empty:
            continue
        parcel_area = float(poly.area)
        if parcel_area <= 0:
            continue
        inter = poly.intersection(buffer_union)
        if inter is None or inter.is_empty:
            continue
        frac = float(inter.area) / parcel_area
        if frac <= 0:
            continue
        # Clamp float noise.
        frac = min(1.0, max(0.0, frac))
        parcels[apn]["freeway_overlap_frac"] = round(frac, 4)
        hit_parcels += 1
        if frac >= 0.5:
            excluded_ge_50 += 1

    return {"hit_parcels": hit_parcels, "excluded_ge_50": excluded_ge_50}


def annotate_index_file(
    index_path: Path = OUT_INDEX,
    parcels_geom_path: Path = PARCELS_GEOM,
    *,
    buffer_meters: float = DEFAULT_BUFFER_METERS,
    force_fetch: bool = False,
) -> dict[str, int]:
    if not index_path.exists():
        sys.exit(f"Missing {index_path}")
    if not parcels_geom_path.exists():
        sys.exit(f"Missing {parcels_geom_path}")

    shn = fetch_shn_lines(force=force_fetch)
    print(f"  {len(shn):,} SHN segments")
    print(f"Buffering {buffer_meters:g} m and unioning…")
    buffer_union = build_freeway_buffer_union(shn, buffer_meters=buffer_meters)

    print(f"Loading parcel index {index_path}…")
    index = json.loads(index_path.read_text())
    parcels = index["parcels"]
    print(f"  {len(parcels):,} parcels")

    print(f"Loading geometries {parcels_geom_path}…")
    geom = gpd.read_file(parcels_geom_path, columns=["APN", "geometry"])
    print(f"  {len(geom):,} parcel polygons")

    print("Computing freeway buffer overlap fractions…")
    stats = annotate_freeway_overlap(parcels, geom, buffer_union)
    print(
        f"  {stats['hit_parcels']:,} parcels intersect buffer; "
        f"{stats['excluded_ge_50']:,} have ≥50% overlap"
    )

    defaults = index.setdefault("defaults", {})
    defaults["freewayBufferMeters"] = buffer_meters
    defaults["freewayOverlapThreshold"] = 0.5

    index_path.write_text(json.dumps(index))
    print(f"Wrote {index_path} ({index_path.stat().st_size / 1e6:.1f} MB)")
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--buffer-meters",
        type=float,
        default=DEFAULT_BUFFER_METERS,
        help="SHN line buffer distance in meters (default 20)",
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
        help="Re-download SHN lines even if cache exists",
    )
    args = parser.parse_args()
    annotate_index_file(
        index_path=args.index,
        buffer_meters=args.buffer_meters,
        force_fetch=args.force_fetch,
    )


if __name__ == "__main__":
    main()
