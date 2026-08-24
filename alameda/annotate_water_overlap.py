#!/usr/bin/env python3
"""Annotate parcel_index.json with open-water (bay/ocean) overlap fraction.

Reads Census TIGER/Line Area Hydrography for Alameda County
(raw/Areawater) and keeps only open-water polygons:

  H2051  Bay/Estuary/Gulf/Sound
  H2053  Ocean/Sea

Lakes, ponds, reservoirs, streams, canals, and ice are ignored. The
remaining polygons are unioned, and each parcel stores:

  water_overlap_frac: float in [0, 1]  (omitted when 0)

Fraction is area(parcel ∩ union(open water)) / area(parcel). Parcels at
or above 50% overlap are treated as exclusions — they sit in the bay,
not merely along the shoreline.

Also writes a simplified overlay GeoJSON for the map layer.

Usage:
  python annotate_water_overlap.py
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import geopandas as gpd
import shapely

ALAMEDA_DIR = Path(__file__).resolve().parent
PROCESSED = ALAMEDA_DIR / "processed"
PARCELS_GEOM = PROCESSED / "parcels.geojson"
OUT_INDEX = ALAMEDA_DIR.parent / "frontend" / "public" / "alameda" / "parcel_index.json"
OUT_OVERLAY = ALAMEDA_DIR.parent / "frontend" / "public" / "alameda" / "open_water.geojson"
AREAWATER_SHP = ALAMEDA_DIR / "raw" / "Areawater" / "tl_2025_06001_areawater.shp"

AREA_CRS = "EPSG:26910"  # NAD83 / UTM zone 10N — meters
DEFAULT_OVERLAP_THRESHOLD = 0.5
OVERLAY_SIMPLIFY_M = 15.0

# Census MAF/TIGER Feature Class Codes for open water only.
OPEN_WATER_MTFCC = frozenset({"H2051", "H2053"})


def load_open_water(shp_path: Path = AREAWATER_SHP) -> gpd.GeoDataFrame:
    if not shp_path.exists():
        sys.exit(f"Missing {shp_path}")
    gdf = gpd.read_file(shp_path)
    if "MTFCC" not in gdf.columns:
        sys.exit(f"{shp_path} has no MTFCC column")
    open_water = gdf[gdf["MTFCC"].isin(OPEN_WATER_MTFCC)].copy()
    if open_water.empty:
        sys.exit(f"No open-water features (MTFCC {sorted(OPEN_WATER_MTFCC)}) in {shp_path}")
    if open_water.crs is None:
        open_water = open_water.set_crs("EPSG:4269")
    return open_water


def build_water_union(open_water: gpd.GeoDataFrame):
    polys = open_water.to_crs(AREA_CRS)
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
        raise RuntimeError("Open-water union is empty")
    return union


def write_overlay_geojson(
    open_water: gpd.GeoDataFrame,
    out_path: Path = OUT_OVERLAY,
    *,
    simplify_m: float = OVERLAY_SIMPLIFY_M,
) -> None:
    overlay = open_water.to_crs(AREA_CRS).copy()
    overlay["geometry"] = overlay.geometry.simplify(simplify_m, preserve_topology=True)
    overlay = overlay.to_crs("EPSG:4326")
    keep = [c for c in ("FULLNAME", "MTFCC") if c in overlay.columns]
    overlay = overlay[keep + ["geometry"]]
    out_path.parent.mkdir(parents=True, exist_ok=True)
    overlay.to_file(out_path, driver="GeoJSON")
    print(f"  overlay {len(overlay):,} features → {out_path}")


def annotate_water_overlap(
    parcels: dict[str, dict],
    geom_gdf: gpd.GeoDataFrame,
    water_union,
    *,
    threshold: float = DEFAULT_OVERLAP_THRESHOLD,
) -> dict[str, int]:
    """Mutate parcels with water_overlap_frac. Return stats."""
    for parcel in parcels.values():
        parcel.pop("water_overlap_frac", None)

    pct_key = f"excluded_ge_{int(round(threshold * 100))}"
    empty_stats = {"hit_parcels": 0, pct_key: 0}
    if geom_gdf.empty or water_union is None:
        return empty_stats

    apns = set(parcels.keys())
    parcels_gdf = geom_gdf[geom_gdf["APN"].isin(apns)].copy()
    if parcels_gdf.crs is None:
        parcels_gdf = parcels_gdf.set_crs("EPSG:4326")
    parcels_gdf = parcels_gdf.to_crs(AREA_CRS)

    water_gdf = gpd.GeoDataFrame(
        {"water_id": [0]}, geometry=[water_union], crs=AREA_CRS
    )
    joined = gpd.sjoin(
        parcels_gdf[["APN", "geometry"]],
        water_gdf,
        how="inner",
        predicate="intersects",
    )
    if joined.empty:
        return empty_stats

    hit_apns = joined["APN"].drop_duplicates()
    parcel_geoms = {
        row.APN: row.geometry for row in parcels_gdf.itertuples(index=False)
    }

    hit_parcels = 0
    excluded = 0
    for apn in hit_apns:
        poly = parcel_geoms.get(apn)
        if poly is None or poly.is_empty:
            continue
        parcel_area = float(poly.area)
        if parcel_area <= 0:
            continue
        inter = poly.intersection(water_union)
        if inter is None or inter.is_empty:
            continue
        frac = float(inter.area) / parcel_area
        if frac <= 0:
            continue
        frac = min(1.0, max(0.0, frac))
        parcels[apn]["water_overlap_frac"] = round(frac, 4)
        hit_parcels += 1
        if frac >= threshold:
            excluded += 1

    return {"hit_parcels": hit_parcels, pct_key: excluded}


def annotate_index_file(
    index_path: Path = OUT_INDEX,
    parcels_geom_path: Path = PARCELS_GEOM,
    *,
    threshold: float = DEFAULT_OVERLAP_THRESHOLD,
) -> dict[str, int]:
    if not index_path.exists():
        sys.exit(f"Missing {index_path}")
    if not parcels_geom_path.exists():
        sys.exit(f"Missing {parcels_geom_path}")

    open_water = load_open_water()
    names = (
        open_water["FULLNAME"].fillna("(unnamed)").astype(str).unique().tolist()
        if "FULLNAME" in open_water.columns
        else []
    )
    print(f"  {len(open_water):,} open-water polygons: {', '.join(names)}")
    print("Unioning open-water polygons…")
    water_union = build_water_union(open_water)
    write_overlay_geojson(open_water)

    print(f"Loading parcel index {index_path}…")
    index = json.loads(index_path.read_text())
    parcels = index["parcels"]
    print(f"  {len(parcels):,} parcels")

    print(f"Loading geometries {parcels_geom_path}…")
    geom = gpd.read_file(parcels_geom_path, columns=["APN", "geometry"])
    print(f"  {len(geom):,} parcel polygons")

    print("Computing open-water overlap fractions…")
    stats = annotate_water_overlap(
        parcels, geom, water_union, threshold=threshold
    )
    pct = int(round(threshold * 100))
    print(
        f"  {stats['hit_parcels']:,} parcels intersect open water; "
        f"{stats[f'excluded_ge_{pct}']:,} have ≥{pct}% overlap"
    )

    defaults = index.setdefault("defaults", {})
    defaults["waterOverlapThreshold"] = threshold

    index_path.write_text(json.dumps(index))
    print(f"Wrote {index_path} ({index_path.stat().st_size / 1e6:.1f} MB)")
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--threshold",
        type=float,
        default=DEFAULT_OVERLAP_THRESHOLD,
        help="Overlap fraction at or above which a parcel is excluded (default 0.5)",
    )
    parser.add_argument(
        "--index",
        type=Path,
        default=OUT_INDEX,
        help="Path to parcel_index.json",
    )
    args = parser.parse_args()
    annotate_index_file(index_path=args.index, threshold=args.threshold)


if __name__ == "__main__":
    main()
