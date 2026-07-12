#!/usr/bin/env python3
"""Annotate parcel_index.json with minimum-rotated-rectangle aspect ratios.

For each parcel stores:
  aspect_ratio: length ÷ width of the MRR (≥ 1), rounded to 2 decimals

Uses the rotated envelope (not axis-aligned bounds) so diagonal alley/rail
slivers keep a truthful elongation ratio.

Usage:
  python annotate_aspect_ratios.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import geopandas as gpd

from config import DEFAULT_MAX_ASPECT_RATIO
from export_geojson import AREA_CRS, mrr_aspect_ratio

ALAMEDA_DIR = Path(__file__).resolve().parent
PROCESSED = ALAMEDA_DIR / "processed"
PARCELS_GEOM = PROCESSED / "parcels.geojson"
OUT_INDEX = ALAMEDA_DIR.parent / "frontend" / "public" / "alameda" / "parcel_index.json"
DIST_INDEX = ALAMEDA_DIR.parent / "frontend" / "dist" / "alameda" / "parcel_index.json"


def annotate_aspect_ratios(
    parcels: dict[str, dict],
    geom_gdf: gpd.GeoDataFrame,
) -> dict[str, int]:
    """Mutate parcels with aspect_ratio. Return stats."""
    for parcel in parcels.values():
        parcel.pop("aspect_ratio", None)

    if geom_gdf.empty:
        return {"annotated": 0, "missing": len(parcels), "skipped": 0}

    apns = set(parcels.keys())
    parcels_gdf = geom_gdf[geom_gdf["APN"].isin(apns)].copy()
    if parcels_gdf.crs is None:
        parcels_gdf = parcels_gdf.set_crs("EPSG:4326")
    parcels_gdf = parcels_gdf.to_crs(AREA_CRS)
    # One geometry per APN (source file can carry duplicates).
    parcels_gdf = parcels_gdf.drop_duplicates(subset=["APN"], keep="first")

    ratios = parcels_gdf.geometry.map(mrr_aspect_ratio)
    annotated = skipped = 0
    for apn, ratio in zip(parcels_gdf["APN"], ratios):
        if apn not in parcels:
            continue
        if ratio is None or (isinstance(ratio, float) and ratio != ratio):
            skipped += 1
            continue
        parcels[apn]["aspect_ratio"] = round(float(ratio), 2)
        annotated += 1

    missing = len(parcels) - annotated - skipped
    return {
        "annotated": annotated,
        "missing": max(0, missing),
        "skipped": skipped,
    }


def main() -> None:
    if not OUT_INDEX.exists():
        sys.exit(f"Missing {OUT_INDEX} (run export_geojson.py first)")
    if not PARCELS_GEOM.exists():
        sys.exit(f"Missing {PARCELS_GEOM}")

    print(f"Loading {OUT_INDEX.name}…")
    index = json.loads(OUT_INDEX.read_text())
    parcels = index["parcels"]
    print(f"  {len(parcels):,} parcels")

    print(f"Loading {PARCELS_GEOM.name}…")
    geom = gpd.read_file(PARCELS_GEOM, columns=["APN", "geometry"])
    print(f"  {len(geom):,} geometries")

    print("Computing minimum-rotated-rectangle aspect ratios…")
    stats = annotate_aspect_ratios(parcels, geom)
    print(
        f"  annotated {stats['annotated']:,}; "
        f"skipped degenerate {stats['skipped']:,}; "
        f"missing geometry {stats['missing']:,}"
    )

    index.setdefault("defaults", {})["maxAspectRatio"] = DEFAULT_MAX_ASPECT_RATIO
    OUT_INDEX.write_text(json.dumps(index))
    print(
        f"Wrote {OUT_INDEX.name}: {OUT_INDEX.stat().st_size / 1e6:.1f} MB "
        f"(default maxAspectRatio={DEFAULT_MAX_ASPECT_RATIO})"
    )

    if DIST_INDEX.parent.exists():
        DIST_INDEX.parent.mkdir(parents=True, exist_ok=True)
        DIST_INDEX.write_text(json.dumps(index))
        print(f"Also wrote {DIST_INDEX}")


if __name__ == "__main__":
    main()
