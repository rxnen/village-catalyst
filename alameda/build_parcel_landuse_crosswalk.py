#!/usr/bin/env python3
"""Spatially join Alameda parcels to General Plan land-use polygons.

Each parcel is matched to the single land-use polygon it overlaps most, and
the match is kept only when that polygon covers at least MIN_OVERLAP of the
parcel area (default 50%). This mirrors the SF city-lands crosswalk logic.

Inputs:
  raw/Parcels.csv      - parcel attributes (no geometry in export)
  raw/Land_Use.csv     - land-use attributes (no geometry in export)

Geometry is fetched once from the county ArcGIS FeatureServers and cached under
processed/ so reruns are fast.

Outputs:
  processed/parcel_landuse_crosswalk.csv  - APN + land-use fields + overlap_frac
  processed/parcels_with_landuse.csv      - full parcel roll + matched land use
"""

from __future__ import annotations

import sys
from pathlib import Path

import geopandas as gpd
import pandas as pd
import shapely

from arcgis_fetch import load_or_fetch
from config import PARCELS_WHERE, TARGET_CITIES

ALAMEDA_DIR = Path(__file__).resolve().parent
RAW_PARCELS = ALAMEDA_DIR / "raw" / "Parcels.csv"
FILTERED_PARCELS = ALAMEDA_DIR / "filtered" / "Parcels_Target_Cities.csv"
SUITABLE_PARCELS = ALAMEDA_DIR / "filtered" / "Parcels_Suitable_Size.csv"
RAW_LAND_USE = ALAMEDA_DIR / "raw" / "Land_Use.csv"
PROCESSED = ALAMEDA_DIR / "processed"

PARCELS_LAYER = (
    "https://services5.arcgis.com/ROBnTHSNjoZ2Wm1P/"
    "ArcGIS/rest/services/Parcels/FeatureServer/0"
)
LAND_USE_LAYER = (
    "https://services5.arcgis.com/ROBnTHSNjoZ2Wm1P/"
    "ArcGIS/rest/services/OWTS_MaintStar_Layers/FeatureServer/3"
)

PARCELS_CACHE = PROCESSED / "parcels.geojson"
LAND_USE_CACHE = PROCESSED / "land_use.geojson"
CROSSWALK_OUT = PROCESSED / "parcel_landuse_crosswalk.csv"
ENRICHED_OUT = PROCESSED / "parcels_with_landuse.csv"

MIN_OVERLAP = 0.5
AREA_CRS = "EPSG:26910"  # meters, for area calculations

LAND_USE_ATTRS = [
    "OBJECTID",
    "General_Plan",
    "GPLU",
    "GPLU_definition",
    "LABEL",
    "EAGPLU_Residential_Overlay",
    "EAGPLU_Residential_Overlay_Defi",
]


def load_parcel_attributes() -> pd.DataFrame:
    if FILTERED_PARCELS.exists():
        src = FILTERED_PARCELS
    elif SUITABLE_PARCELS.exists():
        src = SUITABLE_PARCELS
    else:
        src = RAW_PARCELS

    df = pd.read_csv(src, dtype=str, encoding="utf-8-sig")
    if src == RAW_PARCELS:
        cities = {c.upper() for c in TARGET_CITIES}
        df = df[df["SitusCity"].str.upper().isin(cities)]
    return df


def load_landuse_attributes() -> pd.DataFrame:
    df = pd.read_csv(RAW_LAND_USE, dtype=str, encoding="utf-8-sig")
    # CSV export uses the full overlay field name; ArcGIS truncates it.
    if "EAGPLU_Residential_Overlay_Definition" not in df.columns:
        alt = "EAGPLU_Residential_Overlay_Defi"
        if alt in df.columns:
            df = df.rename(columns={alt: "EAGPLU_Residential_Overlay_Definition"})
    return df


def main() -> None:
    for src in (RAW_PARCELS, RAW_LAND_USE):
        if not src.exists():
            sys.exit(f"Source file not found: {src}")

    force = "--force" in sys.argv
    PROCESSED.mkdir(exist_ok=True)

    if not SUITABLE_PARCELS.exists() and not FILTERED_PARCELS.exists():
        print("hint: run filter_parcels.py first")
    elif not SUITABLE_PARCELS.exists():
        print("hint: run filter_parcel_acreage.py to apply acreage filter")

    parcel_attrs = load_parcel_attributes()
    target_apns = set(parcel_attrs["APN"])
    print(f"target cities: {', '.join(TARGET_CITIES)} ({len(target_apns):,} parcels)")

    parcels = load_or_fetch(
        PARCELS_CACHE,
        PARCELS_LAYER,
        out_fields=["APN", "OBJECTID"],
        force=force,
    ).rename(columns={"OBJECTID": "parcel_objectid"})
    parcels = parcels[parcels["APN"].isin(target_apns)].copy()
    land_use = load_or_fetch(
        LAND_USE_CACHE,
        LAND_USE_LAYER,
        out_fields=LAND_USE_ATTRS,
        force=force,
    )
    if "EAGPLU_Residential_Overlay_Defi" in land_use.columns:
        land_use = land_use.rename(
            columns={"EAGPLU_Residential_Overlay_Defi": "EAGPLU_Residential_Overlay_Definition"}
        )

    parcels = parcels.to_crs(AREA_CRS)
    land_use = land_use.to_crs(AREA_CRS)
    parcels.geometry = parcels.geometry.make_valid()
    land_use.geometry = land_use.geometry.make_valid()
    parcels["parcel_area"] = parcels.geometry.area
    parcels = parcels[parcels["parcel_area"] > 0].copy()
    print(f"loaded {len(parcels):,} parcel geometries and {len(land_use):,} land-use polygons")

    pairs = gpd.sjoin(parcels, land_use, how="inner", predicate="intersects")
    land_geom = land_use.geometry.loc[pairs["index_right"]].make_valid().values
    parcel_geom = pairs.geometry.make_valid().values
    inter_area = shapely.area(shapely.intersection(parcel_geom, land_geom))
    pairs["overlap_frac"] = inter_area / pairs["parcel_area"]
    print(f"{len(pairs):,} intersecting parcel/land-use candidate pairs")

    best = (
        pairs.sort_values("overlap_frac", ascending=False)
        .drop_duplicates("APN")
    )
    matched = best[best["overlap_frac"] >= MIN_OVERLAP].copy()
    print(
        f"{len(matched):,} parcels are mostly (>={MIN_OVERLAP:.0%}) inside a land-use "
        f"polygon; {len(best) - len(matched):,} sliver/edge overlaps discarded; "
        f"{len(parcels) - len(best):,} parcels with no intersection"
    )

    crosswalk_cols = [
        "APN",
        "OBJECTID",
        "General_Plan",
        "GPLU",
        "GPLU_definition",
        "LABEL",
        "EAGPLU_Residential_Overlay",
        "EAGPLU_Residential_Overlay_Definition",
        "overlap_frac",
    ]
    crosswalk = matched[crosswalk_cols].rename(columns={"OBJECTID": "landuse_objectid"})
    crosswalk = crosswalk.sort_values(["GPLU", "APN"])
    crosswalk.to_csv(CROSSWALK_OUT, index=False)
    print(f"wrote {len(crosswalk):,} crosswalk rows -> {CROSSWALK_OUT}")

    enriched = parcel_attrs.merge(crosswalk, on="APN", how="left")
    enriched["landuse_matched"] = enriched["landuse_objectid"].notna().map({True: "yes", False: "no"})
    enriched.to_csv(ENRICHED_OUT, index=False)
    print(f"wrote {len(enriched):,} enriched parcel rows -> {ENRICHED_OUT}")

    print("\nTop matched GPLU codes:")
    for gplu, count in crosswalk["GPLU"].value_counts().head(12).items():
        definition = crosswalk.loc[crosswalk["GPLU"] == gplu, "GPLU_definition"].iloc[0]
        print(f"  {gplu} ({definition}): {count:,}")


if __name__ == "__main__":
    main()
