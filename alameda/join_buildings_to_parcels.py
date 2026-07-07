#!/usr/bin/env python3
"""Spatially join Microsoft building footprints to Alameda County parcel polygons.

For each building/parcel intersection, computes the overlap area in square meters.
Parcel-level totals sum those overlaps so a building that straddles two parcels
contributes proportionally to each.

Inputs:
  data/building_footprints.geojson  - county-bounded footprints (filter_building_footprints.py)
  processed/parcels.geojson         - county parcel geometries

Outputs:
  processed/parcel_building_coverage.csv  - every parcel with footprint area + coverage ratio
  processed/building_parcel_crosswalk.csv - one row per building with primary (largest overlap) APN
"""

from __future__ import annotations

import sys
from pathlib import Path

import geopandas as gpd
import pandas as pd
import shapely

from config import SQ_M_PER_ACRE

ALAMEDA_DIR = Path(__file__).resolve().parent
DATA_DIR = ALAMEDA_DIR / "data"
PROCESSED = ALAMEDA_DIR / "processed"
BUILDINGS = DATA_DIR / "building_footprints.geojson"
PARCELS_GEOM = PROCESSED / "parcels.geojson"
RAW_PARCELS = ALAMEDA_DIR / "raw" / "Parcels.csv"

COVERAGE_OUT = PROCESSED / "parcel_building_coverage.csv"
CROSSWALK_OUT = PROCESSED / "building_parcel_crosswalk.csv"

AREA_CRS = "EPSG:26910"


def main() -> None:
    for path in (BUILDINGS, PARCELS_GEOM):
        if not path.exists():
            sys.exit(f"Missing {path}")

    parcels = gpd.read_file(PARCELS_GEOM)
    parcels = parcels[parcels.geometry.notna()].copy()
    parcels = parcels.to_crs(AREA_CRS)
    parcels.geometry = parcels.geometry.make_valid()
    parcels["parcel_area_sq_m"] = parcels.geometry.area
    parcels = parcels[parcels["parcel_area_sq_m"] > 0].copy()
    print(f"loaded {len(parcels):,} parcel geometries")

    buildings = gpd.read_file(BUILDINGS)
    buildings = buildings.to_crs(AREA_CRS)
    buildings.geometry = buildings.geometry.make_valid()
    buildings["building_area_sq_m"] = buildings.geometry.area
    buildings = buildings[buildings["building_area_sq_m"] > 0].copy()
    buildings["building_id"] = buildings.index.astype(int)
    print(f"loaded {len(buildings):,} building footprints")

    pairs = gpd.sjoin(
        buildings,
        parcels[["APN", "parcel_area_sq_m", "geometry"]],
        how="inner",
        predicate="intersects",
    )
    print(f"{len(pairs):,} building/parcel intersection pairs")

    parcel_geom = parcels.geometry.loc[pairs["index_right"]].make_valid().values
    building_geom = pairs.geometry.make_valid().values
    pairs["overlap_sq_m"] = shapely.area(shapely.intersection(building_geom, parcel_geom))

    by_parcel = pairs.groupby("APN", as_index=False).agg(
        building_footprint_sq_m=("overlap_sq_m", "sum"),
        building_count=("building_id", "nunique"),
    )
    coverage = parcels[["APN", "parcel_area_sq_m"]].drop_duplicates("APN").merge(
        by_parcel, on="APN", how="left"
    )
    coverage["building_footprint_sq_m"] = coverage["building_footprint_sq_m"].fillna(0.0)
    coverage["building_count"] = coverage["building_count"].fillna(0).astype(int)
    coverage["parcel_area_acres"] = coverage["parcel_area_sq_m"] / SQ_M_PER_ACRE
    coverage["building_footprint_acres"] = coverage["building_footprint_sq_m"] / SQ_M_PER_ACRE
    coverage["coverage_ratio"] = coverage["building_footprint_sq_m"] / coverage["parcel_area_sq_m"]

    if RAW_PARCELS.exists():
        attrs = pd.read_csv(
            RAW_PARCELS,
            usecols=["APN", "SitusCity", "SitusAddress", "Land", "Imps", "UseCode"],
            dtype=str,
            encoding="utf-8-sig",
        )
        coverage = coverage.merge(attrs, on="APN", how="left")

    coverage = coverage.sort_values(["coverage_ratio", "APN"], ascending=[True, True])
    PROCESSED.mkdir(parents=True, exist_ok=True)
    coverage.to_csv(COVERAGE_OUT, index=False)
    print(f"wrote {len(coverage):,} parcel rows -> {COVERAGE_OUT}")

    primary = (
        pairs.sort_values("overlap_sq_m", ascending=False)
        .drop_duplicates("building_id")
        [["building_id", "APN", "building_area_sq_m", "overlap_sq_m", "parcel_area_sq_m"]]
        .rename(columns={"overlap_sq_m": "primary_overlap_sq_m"})
    )
    primary["primary_overlap_frac"] = primary["primary_overlap_sq_m"] / primary["building_area_sq_m"]
    primary.to_csv(CROSSWALK_OUT, index=False)
    print(f"wrote {len(primary):,} matched building rows -> {CROSSWALK_OUT}")

    matched_buildings = len(primary)
    unmatched_buildings = len(buildings) - matched_buildings
    parcels_with_buildings = int((coverage["building_count"] > 0).sum())
    vacant_by_footprint = int((coverage["building_count"] == 0).sum())
    print(
        f"buildings matched to a parcel: {matched_buildings:,}; "
        f"unmatched (outside parcel polygons): {unmatched_buildings:,}"
    )
    print(
        f"parcels with >=1 building footprint: {parcels_with_buildings:,}; "
        f"parcels with no footprint: {vacant_by_footprint:,}"
    )


if __name__ == "__main__":
    main()
