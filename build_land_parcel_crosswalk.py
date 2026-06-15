#!/usr/bin/env python3
"""Build a land_id <-> blklot crosswalk by spatially joining the filtered
parcels to the filtered city lands.

Each parcel is matched to the single city land it overlaps most, and the
match is kept only if that land covers at least MIN_OVERLAP of the parcel's
area. The majority rule means boundary slivers and street-edge touches do
not produce matches, and each blklot can appear at most once.

Writes a two-column CSV (land_id, blklot) to processed/land_parcel_crosswalk.csv.
"""

import sys
from pathlib import Path

import geopandas as gpd
import pandas as pd
import shapely

PROJECT_DIR = Path(__file__).resolve().parent
PARCELS_SRC = PROJECT_DIR / "filtered" / "Parcels_Active.csv"
LANDS_SRC = PROJECT_DIR / "filtered" / "City_Lands_SF.csv"
DEST = PROJECT_DIR / "processed" / "land_parcel_crosswalk.csv"

MIN_OVERLAP = 0.5        # parcel belongs to a land if >=50% of its area is inside it
AREA_CRS = "EPSG:26910"  # NAD83 / UTM zone 10N (meters), for area calculations


def load_wkt_csv(path: Path, id_col: str) -> gpd.GeoDataFrame:
    # dtype=str keeps leading zeros in blklot; usecols avoids loading the
    # 30+ attribute columns of the parcels file
    df = pd.read_csv(path, usecols=[id_col, "shape"], dtype=str)
    no_geom = df["shape"].isna() | (df["shape"].str.strip() == "")
    if no_geom.any():
        print(f"{path.name}: dropping {no_geom.sum():,} rows without geometry")
        df = df[~no_geom]
    geom = gpd.GeoSeries.from_wkt(df.pop("shape"), crs="EPSG:4326")
    return gpd.GeoDataFrame(df, geometry=geom.make_valid().to_crs(AREA_CRS))


def main() -> None:
    for src in (PARCELS_SRC, LANDS_SRC):
        if not src.exists():
            sys.exit(f"Source file not found: {src}")

    parcels = load_wkt_csv(PARCELS_SRC, "blklot")
    lands = load_wkt_csv(LANDS_SRC, "land_id")
    print(f"loaded {len(parcels):,} parcels and {len(lands):,} city lands")

    parcels["parcel_area"] = parcels.geometry.area
    degenerate = parcels["parcel_area"] <= 0
    if degenerate.any():
        print(f"dropping {degenerate.sum():,} parcels with zero-area geometry")
        parcels = parcels[~degenerate]

    pairs = gpd.sjoin(parcels, lands, how="inner", predicate="intersects")
    land_geom = lands.geometry.loc[pairs["index_right"]].values
    inter_area = shapely.area(shapely.intersection(pairs.geometry.values, land_geom))
    pairs["overlap_frac"] = inter_area / pairs["parcel_area"]
    print(f"{len(pairs):,} intersecting parcel/land candidate pairs")

    # keep each parcel's single largest overlap, then apply the majority rule
    best = (pairs.sort_values("overlap_frac", ascending=False)
                 .drop_duplicates("blklot"))
    matched = best[best["overlap_frac"] >= MIN_OVERLAP]
    print(f"{len(matched):,} parcels are mostly (>={MIN_OVERLAP:.0%}) inside a "
          f"city land; {len(best) - len(matched):,} sliver/edge overlaps discarded")

    DEST.parent.mkdir(exist_ok=True)
    crosswalk = matched[["land_id", "blklot"]].sort_values(["land_id", "blklot"])
    crosswalk.to_csv(DEST, index=False)
    print(f"wrote {len(crosswalk):,} rows covering "
          f"{crosswalk['land_id'].nunique():,} distinct lands -> {DEST}")


if __name__ == "__main__":
    main()
