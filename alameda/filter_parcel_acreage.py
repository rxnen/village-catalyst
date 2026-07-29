#!/usr/bin/env python3
"""Compute parcel area from geometry and keep 1–10 acre lots.

Reads filtered/Parcels_Target_Cities.csv and writes
filtered/Parcels_Suitable_Size.csv.
"""

import csv
import sys
from pathlib import Path

import geopandas as gpd
import pandas as pd

from config import MAX_ACRES, MIN_ACRES, SQ_M_PER_ACRE
from metrics import evaluate_lead_tracks

ALAMEDA_DIR = Path(__file__).resolve().parent
SRC = ALAMEDA_DIR / "filtered" / "Parcels_Target_Cities.csv"
PARCELS_GEOM = ALAMEDA_DIR / "processed" / "parcels.geojson"
DEST = ALAMEDA_DIR / "filtered" / "Parcels_Suitable_Size.csv"


def main() -> None:
    if not SRC.exists():
        sys.exit(f"Source file not found: {SRC} (run filter_parcels.py first)")
    if not PARCELS_GEOM.exists():
        sys.exit(f"Parcel geometry not found: {PARCELS_GEOM} "
                 "(run build_parcel_landuse_crosswalk.py first)")

    attrs = pd.read_csv(SRC, dtype=str, encoding="utf-8-sig")
    apns = set(attrs["APN"])

    geom = gpd.read_file(PARCELS_GEOM)
    geom = geom[geom["APN"].isin(apns)].to_crs("EPSG:26910")
    geom["shape_area_sqm"] = geom.geometry.area
    geom["area_acres"] = geom["shape_area_sqm"] / SQ_M_PER_ACRE
    areas = geom[["APN", "shape_area_sqm", "area_acres"]].copy()

    merged = attrs.merge(areas, on="APN", how="left")
    missing = merged["shape_area_sqm"].isna().sum()
    if missing:
        print(f"warning: {missing:,} parcels missing geometry (dropped)")
        merged = merged[merged["shape_area_sqm"].notna()]

    in_range = merged[
        (merged["area_acres"] >= MIN_ACRES) & (merged["area_acres"] <= MAX_ACRES)
    ].copy()

    lead_rows = []
    for row in in_range.itertuples(index=False):
        leads = evaluate_lead_tracks(
            land=row.Land,
            imps=row.Imps,
            hoex=row.HOEX,
            otex=row.OTEX,
            situs_city=row.SitusCity,
            mailing_city_state=row.MailingAddressCityState,
            economic_unit=row.EconomicUnit,
            use_code=row.UseCode,
        )
        lead_rows.append(leads)
    in_range["lead_excluded"] = [r["excluded"] for r in lead_rows]
    in_range["track_a"] = [r["track_a"] for r in lead_rows]
    in_range["track_b"] = [r["track_b"] for r in lead_rows]
    in_range["lead_tracks"] = [",".join(r["tracks"]) for r in lead_rows]
    in_range["imps_land_ratio"] = [r["imps_land_ratio"] for r in lead_rows]

    in_range = in_range[~in_range["lead_excluded"]].copy()
    leads = in_range["lead_tracks"].str.len() > 0
    dropped_small = ((merged["area_acres"] < MIN_ACRES)).sum()
    dropped_large = ((merged["area_acres"] > MAX_ACRES)).sum()

    DEST.parent.mkdir(exist_ok=True)
    fieldnames = list(attrs.columns)
    for col in ("shape_area_sqm", "area_acres", "imps_land_ratio", "track_a", "track_b", "lead_tracks"):
        if col not in fieldnames:
            fieldnames.append(col)

    with open(DEST, "w", newline="", encoding="utf-8") as fout:
        writer = csv.DictWriter(fout, fieldnames=fieldnames, quoting=csv.QUOTE_ALL)
        writer.writeheader()
        for row in in_range.to_dict(orient="records"):
            out = {k: row.get(k, "") for k in fieldnames}
            ratio = row.get("imps_land_ratio")
            if ratio is not None and ratio == ratio:
                out["imps_land_ratio"] = f"{float(ratio):.6f}"
            else:
                out["imps_land_ratio"] = ""
            out["track_a"] = "yes" if row.get("track_a") else "no"
            out["track_b"] = "yes" if row.get("track_b") else "no"
            writer.writerow(out)

    both = ((in_range["track_a"]) & (in_range["track_b"])).sum()
    print(
        f"{SRC.name}: kept {len(in_range):,} parcels between "
        f"{MIN_ACRES:g}–{MAX_ACRES:g} acres "
        f"(dropped {dropped_small:,} below {MIN_ACRES:g}, "
        f"{dropped_large:,} above {MAX_ACRES:g}) -> {DEST}"
    )
    print(
        f"lead tracks: A {in_range['track_a'].sum():,}; "
        f"B {in_range['track_b'].sum():,}; both {both:,}; "
        f"either {leads.sum():,}"
    )


if __name__ == "__main__":
    main()
