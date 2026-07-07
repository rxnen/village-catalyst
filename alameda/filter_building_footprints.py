#!/usr/bin/env python3
"""Extract Microsoft building footprints within Alameda County.

Reads buildings/California.geojson (unchanged) and writes a county-bounded
subset to alameda/data/building_footprints.geojson.

The bounding box is derived from the full county parcel layer
(alameda/processed/parcels.geojson).
"""

from __future__ import annotations

import sys
from pathlib import Path

import geopandas as gpd

ALAMEDA_DIR = Path(__file__).resolve().parent
REPO_ROOT = ALAMEDA_DIR.parent
CALIFORNIA_BUILDINGS = REPO_ROOT / "buildings" / "California.geojson"
PARCELS_GEOM = ALAMEDA_DIR / "processed" / "parcels.geojson"
OUT_DIR = ALAMEDA_DIR / "data"
OUT_PATH = OUT_DIR / "building_footprints.geojson"


def alameda_county_bbox() -> tuple[float, float, float, float]:
    """Return (min_lon, min_lat, max_lon, max_lat) for Alameda County."""
    parcels = gpd.read_file(PARCELS_GEOM)
    parcels = parcels[parcels.geometry.notna()]
    min_lon, min_lat, max_lon, max_lat = parcels.total_bounds
    return float(min_lon), float(min_lat), float(max_lon), float(max_lat)


def main() -> None:
    if not CALIFORNIA_BUILDINGS.exists():
        sys.exit(f"Missing {CALIFORNIA_BUILDINGS}")
    if not PARCELS_GEOM.exists():
        sys.exit(f"Missing {PARCELS_GEOM} (run build_parcel_landuse_crosswalk.py first)")

    bbox = alameda_county_bbox()
    min_lon, min_lat, max_lon, max_lat = bbox
    print(
        "Alameda County coordinate range (WGS84):\n"
        f"  longitude: {min_lon:.8f} to {max_lon:.8f}\n"
        f"  latitude:  {min_lat:.8f} to {max_lat:.8f}"
    )

    print(f"filtering {CALIFORNIA_BUILDINGS.name} ...")
    buildings = gpd.read_file(CALIFORNIA_BUILDINGS, bbox=bbox)
    if buildings.crs is None:
        buildings = buildings.set_crs("EPSG:4326")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    buildings.to_file(OUT_PATH, driver="GeoJSON", COORDINATE_PRECISION=7)
    size_mb = OUT_PATH.stat().st_size / 1e6
    print(f"wrote {len(buildings):,} features -> {OUT_PATH} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
