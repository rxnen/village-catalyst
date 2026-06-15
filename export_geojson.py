#!/usr/bin/env python3
"""Export display GeoJSON for the frontend map.

Two layers, written to frontend/public/ so Vite serves them statically:
  city_lands.geojson  - filtered SF city lands (geometry simplified ~1 m
                        for display; full detail stays in filtered/)
  land_parcels.geojson - the parcels matched to a land by the crosswalk,
                         tagged with their land's name and category
"""

import sys
from pathlib import Path

import geopandas as gpd
import pandas as pd

PROJECT_DIR = Path(__file__).resolve().parent
LANDS_SRC = PROJECT_DIR / "filtered" / "City_Lands_SF.csv"
PARCELS_SRC = PROJECT_DIR / "filtered" / "Parcels_Active.csv"
XWALK = PROJECT_DIR / "processed" / "land_parcel_crosswalk.csv"
OUT_DIR = PROJECT_DIR / "frontend" / "public"

AREA_CRS = "EPSG:26910"  # meters, for simplification tolerance
SIMPLIFY_M = 1.0


def to_gdf(df: pd.DataFrame) -> gpd.GeoDataFrame:
    geom = gpd.GeoSeries.from_wkt(df.pop("shape"), crs="EPSG:4326").make_valid()
    gdf = gpd.GeoDataFrame(df, geometry=geom)
    return gdf[~gdf.geometry.is_empty & gdf.geometry.notna()]


def write(gdf: gpd.GeoDataFrame, path: Path) -> None:
    path.unlink(missing_ok=True)
    # 6 decimal places (~10 cm) keeps the files small
    gdf.to_file(path, driver="GeoJSON", COORDINATE_PRECISION=6)
    print(f"{path.name}: {len(gdf):,} features, "
          f"{path.stat().st_size / 1e6:.1f} MB")


def main() -> None:
    for src in (LANDS_SRC, PARCELS_SRC, XWALK):
        if not src.exists():
            sys.exit(f"Input file not found: {src}")
    OUT_DIR.mkdir(exist_ok=True)

    lands = to_gdf(pd.read_csv(
        LANDS_SRC, dtype=str,
        usecols=["land_id", "land_name", "category", "department_name", "shape"]))
    lands.geometry = (lands.geometry.to_crs(AREA_CRS)
                                    .simplify(SIMPLIFY_M)
                                    .to_crs("EPSG:4326"))
    write(lands, OUT_DIR / "city_lands.geojson")

    xw = pd.read_csv(XWALK, dtype=str)
    parcels = to_gdf(pd.read_csv(PARCELS_SRC, usecols=["blklot", "shape"], dtype=str)
                     .merge(xw, on="blklot", how="inner"))
    parcels = parcels.merge(lands.drop(columns="geometry")[["land_id", "land_name", "category"]],
                            on="land_id", how="left")
    parcels.geometry = (parcels.geometry.to_crs(AREA_CRS)
                                        .simplify(SIMPLIFY_M / 2)
                                        .to_crs("EPSG:4326"))
    write(parcels, OUT_DIR / "land_parcels.geojson")


if __name__ == "__main__":
    main()
