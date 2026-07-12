#!/usr/bin/env python3
"""Annotate parcel_index.json with negative-buffer max usable widths.

For each parcel stores:
  max_width_m: largest W (meters) such that buffer(-W/2) is non-empty

Parcels that bend or turn corners can pass an MRR aspect-ratio check yet
still be nowhere wide enough for a village footprint. Filtering with
  max_width_m >= minUsableWidthM
matches an inward erosion test at half the chosen minimum usable width.

Usage:
  python annotate_max_width.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import geopandas as gpd

from config import DEFAULT_MIN_USABLE_WIDTH_M
from export_geojson import AREA_CRS, max_erosion_width_m

ALAMEDA_DIR = Path(__file__).resolve().parent
PROCESSED = ALAMEDA_DIR / "processed"
PARCELS_GEOM = PROCESSED / "parcels.geojson"
OUT_INDEX = ALAMEDA_DIR.parent / "frontend" / "public" / "alameda" / "parcel_index.json"
DIST_INDEX = ALAMEDA_DIR.parent / "frontend" / "dist" / "alameda" / "parcel_index.json"


def annotate_max_widths(
    parcels: dict[str, dict],
    geom_gdf: gpd.GeoDataFrame,
) -> dict[str, int]:
    """Mutate parcels with max_width_m. Return stats."""
    for parcel in parcels.values():
        parcel.pop("max_width_m", None)

    if geom_gdf.empty:
        return {"annotated": 0, "missing": len(parcels), "skipped": 0}

    apns = set(parcels.keys())
    parcels_gdf = geom_gdf[geom_gdf["APN"].isin(apns)].copy()
    if parcels_gdf.crs is None:
        parcels_gdf = parcels_gdf.set_crs("EPSG:4326")
    parcels_gdf = parcels_gdf.to_crs(AREA_CRS)
    parcels_gdf = parcels_gdf.drop_duplicates(subset=["APN"], keep="first")

    widths = parcels_gdf.geometry.map(max_erosion_width_m)
    annotated = skipped = 0
    for apn, width in zip(parcels_gdf["APN"], widths):
        if apn not in parcels:
            continue
        if width is None or (isinstance(width, float) and width != width):
            skipped += 1
            continue
        parcels[apn]["max_width_m"] = round(float(width), 1)
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

    print("Computing negative-buffer max usable widths…")
    stats = annotate_max_widths(parcels, geom)
    print(
        f"  annotated {stats['annotated']:,}; "
        f"skipped degenerate {stats['skipped']:,}; "
        f"missing geometry {stats['missing']:,}"
    )

    index.setdefault("defaults", {})["minUsableWidthM"] = DEFAULT_MIN_USABLE_WIDTH_M
    OUT_INDEX.write_text(json.dumps(index))
    print(
        f"Wrote {OUT_INDEX.name}: {OUT_INDEX.stat().st_size / 1e6:.1f} MB "
        f"(default minUsableWidthM={DEFAULT_MIN_USABLE_WIDTH_M})"
    )

    if DIST_INDEX.parent.exists():
        DIST_INDEX.write_text(json.dumps(index))
        print(f"Also wrote {DIST_INDEX}")


if __name__ == "__main__":
    main()
