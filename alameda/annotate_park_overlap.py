#!/usr/bin/env python3
"""Annotate parcel_index.json with CPAD park overlap fraction.

Fetches California Protected Areas Database (CPAD) holdings for Alameda
County, drops linear trail corridors from the exclusion overlay, unions
the remaining park polygons, and stores for each parcel:

  park_overlap_frac: float in [0, 1]  (omitted when 0)

Fraction is area(parcel ∩ union(parks)) / area(parcel), so stacked or
adjacent holdings are not double-counted. Parcels at or above 10% overlap
are treated as exclusions in the map filter.

Trail corridors are omitted from the union so a trail running through a
parcel does not exclude it. A holding counts as a trail corridor when:

  * SPEC_USE is "Trail Corridor", or
  * UNIT_NAME / SITE_NAME looks like a trail or greenway (and not a park),
    or
  * the polygon is a long, narrow strip (linear corridor geometry).

Usage:
  python annotate_park_overlap.py
  python annotate_park_overlap.py --force-fetch
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import geopandas as gpd
import pandas as pd
import shapely

from arcgis_fetch import fetch_layer_geojson

ALAMEDA_DIR = Path(__file__).resolve().parent
PROCESSED = ALAMEDA_DIR / "processed"
PARCELS_GEOM = PROCESSED / "parcels.geojson"
OUT_INDEX = ALAMEDA_DIR.parent / "frontend" / "public" / "alameda" / "parcel_index.json"
CPAD_CACHE = PROCESSED / "cpad_ala.geojson"

CPAD_URL = (
    "https://services1.arcgis.com/4ZKi1B1zTblbwgWB/arcgis/rest/services/"
    "CPAD_Holdings_Current_Release/FeatureServer/0"
)
CPAD_WHERE = "COUNTY='Alameda'"
CPAD_FIELDS = [
    "HOLDING_ID",
    "UNIT_NAME",
    "SITE_NAME",
    "SPEC_USE",
    "ACCESS_TYP",
    "AGNCY_NAME",
    "LAYER",
    "COUNTY",
    "ACRES",
    "LAND_WATER",
    "PARK_URL",
]

AREA_CRS = "EPSG:26910"  # NAD83 / UTM zone 10N — meters
DEFAULT_OVERLAP_THRESHOLD = 0.1

TRAIL_SPEC_USE = "trail corridor"
TRAIL_NAME_RE = re.compile(
    r"\b(trail|greenway|bike path|bicycle path|trailway)\b", re.I
)
PARK_NAME_RE = re.compile(
    r"\b(park|preserve|recreation area|botanical|playground|garden)\b", re.I
)
# Long, narrow strips: typical trail right-of-way, not a compact park.
TRAIL_MIN_ASPECT = 8.0
TRAIL_MAX_WIDTH_M = 40.0


def _text(value) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return "" if text in {"", "nan", "None"} else text


def _polygon_is_strip(poly, *, min_aspect: float, max_width_m: float) -> bool:
    if poly is None or poly.is_empty or poly.area <= 0:
        return False
    mrr = poly.minimum_rotated_rectangle
    coords = list(mrr.exterior.coords)
    if len(coords) < 3:
        return False
    e0 = shapely.distance(shapely.Point(coords[0]), shapely.Point(coords[1]))
    e1 = shapely.distance(shapely.Point(coords[1]), shapely.Point(coords[2]))
    length, width = (e0, e1) if e0 >= e1 else (e1, e0)
    if width <= 0:
        return True
    return width <= max_width_m and (length / width) >= min_aspect


def is_linear_strip(geom) -> bool:
    """True when every polygon part is a long, narrow corridor."""
    if geom is None or geom.is_empty:
        return False
    if not geom.is_valid:
        geom = shapely.make_valid(geom)
        if geom is None or geom.is_empty:
            return False
    if geom.geom_type == "Polygon":
        parts = [geom]
    elif geom.geom_type in {"MultiPolygon", "GeometryCollection"}:
        parts = [g for g in geom.geoms if g.geom_type == "Polygon" and not g.is_empty]
    else:
        # LineString / MultiLineString leftovers after make_valid.
        return True
    if not parts:
        return True
    return all(
        _polygon_is_strip(
            part, min_aspect=TRAIL_MIN_ASPECT, max_width_m=TRAIL_MAX_WIDTH_M
        )
        for part in parts
    )


def _attr(row, key: str) -> str:
    if hasattr(row, "get"):
        return _text(row.get(key))
    return _text(getattr(row, key, ""))


def is_trail_corridor(row, geom=None) -> bool:
    """True for linear trail corridors that should not exclude parcels."""
    spec = _attr(row, "SPEC_USE").casefold()
    if spec == TRAIL_SPEC_USE:
        return True
    name = f"{_attr(row, 'UNIT_NAME')} {_attr(row, 'SITE_NAME')}".strip()
    if TRAIL_NAME_RE.search(name) and not PARK_NAME_RE.search(name):
        return True
    if geom is not None:
        return is_linear_strip(geom)
    return False


def fetch_cpad_holdings(*, force: bool = False) -> gpd.GeoDataFrame:
    if CPAD_CACHE.exists() and not force:
        print(f"Loading cached CPAD holdings from {CPAD_CACHE}")
        return gpd.read_file(CPAD_CACHE)

    print(f"Fetching CPAD holdings ({CPAD_WHERE})…")
    gdf = fetch_layer_geojson(
        CPAD_URL,
        out_fields=CPAD_FIELDS,
        where=CPAD_WHERE,
    )
    CPAD_CACHE.parent.mkdir(parents=True, exist_ok=True)
    gdf.to_file(CPAD_CACHE, driver="GeoJSON")
    print(f"  cached {len(gdf):,} features → {CPAD_CACHE}")
    return gdf


def split_park_and_trail(holdings: gpd.GeoDataFrame) -> tuple[gpd.GeoDataFrame, gpd.GeoDataFrame]:
    polys = holdings.copy()
    if polys.crs is None:
        polys = polys.set_crs("EPSG:4326")
    polys = polys.to_crs(AREA_CRS)
    trail_flags = []
    for row in polys.itertuples(index=False):
        props = {
            "SPEC_USE": getattr(row, "SPEC_USE", ""),
            "UNIT_NAME": getattr(row, "UNIT_NAME", ""),
            "SITE_NAME": getattr(row, "SITE_NAME", ""),
        }
        trail_flags.append(is_trail_corridor(props, geom=row.geometry))
    mask = pd.Series(trail_flags, index=polys.index, dtype=bool)
    return polys.loc[~mask].copy(), polys.loc[mask].copy()


def build_union(gdf: gpd.GeoDataFrame):
    geoms = []
    for geom in gdf.geometry:
        if geom is None or geom.is_empty:
            continue
        if not geom.is_valid:
            geom = shapely.make_valid(geom)
        if geom is None or geom.is_empty:
            continue
        geoms.append(geom)
    if not geoms:
        return None
    union = shapely.union_all(geoms)
    if union is None or union.is_empty:
        return None
    return union


def annotate_park_overlap(
    parcels: dict[str, dict],
    geom_gdf: gpd.GeoDataFrame,
    park_union,
    *,
    threshold: float = DEFAULT_OVERLAP_THRESHOLD,
) -> dict[str, int]:
    """Mutate parcels with park_overlap_frac. Return stats."""
    for parcel in parcels.values():
        parcel.pop("park_overlap_frac", None)

    pct_key = f"excluded_ge_{int(round(threshold * 100))}"
    empty_stats = {"hit_parcels": 0, pct_key: 0}
    if geom_gdf.empty or park_union is None:
        return empty_stats

    apns = set(parcels.keys())
    parcels_gdf = geom_gdf[geom_gdf["APN"].isin(apns)].copy()
    if parcels_gdf.crs is None:
        parcels_gdf = parcels_gdf.set_crs("EPSG:4326")
    parcels_gdf = parcels_gdf.to_crs(AREA_CRS)

    park_gdf = gpd.GeoDataFrame(
        {"park_id": [0]}, geometry=[park_union], crs=AREA_CRS
    )
    joined = gpd.sjoin(
        parcels_gdf[["APN", "geometry"]],
        park_gdf,
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
        inter = poly.intersection(park_union)
        if inter is None or inter.is_empty:
            continue
        frac = float(inter.area) / parcel_area
        if frac <= 0:
            continue
        frac = min(1.0, max(0.0, frac))
        parcels[apn]["park_overlap_frac"] = round(frac, 4)
        hit_parcels += 1
        if frac >= threshold:
            excluded += 1

    return {"hit_parcels": hit_parcels, pct_key: excluded}


def annotate_index_file(
    index_path: Path = OUT_INDEX,
    parcels_geom_path: Path = PARCELS_GEOM,
    *,
    threshold: float = DEFAULT_OVERLAP_THRESHOLD,
    force_fetch: bool = False,
) -> dict[str, int]:
    if not index_path.exists():
        sys.exit(f"Missing {index_path}")
    if not parcels_geom_path.exists():
        sys.exit(f"Missing {parcels_geom_path}")

    holdings = fetch_cpad_holdings(force=force_fetch)
    print(f"  {len(holdings):,} Alameda CPAD holdings")
    parks, trails = split_park_and_trail(holdings)
    print(
        f"  {len(parks):,} park holdings in exclusion overlay; "
        f"{len(trails):,} trail corridors omitted"
    )
    print("Unioning park polygons…")
    park_union = build_union(parks)
    if park_union is None:
        print("  park union is empty — no overlap fields written")

    print(f"Loading parcel index {index_path}…")
    index = json.loads(index_path.read_text())
    parcels = index["parcels"]
    print(f"  {len(parcels):,} parcels")

    print(f"Loading geometries {parcels_geom_path}…")
    geom = gpd.read_file(parcels_geom_path, columns=["APN", "geometry"])
    print(f"  {len(geom):,} parcel polygons")

    print("Computing park overlap fractions…")
    stats = annotate_park_overlap(
        parcels, geom, park_union, threshold=threshold
    )
    pct = int(round(threshold * 100))
    print(
        f"  {stats['hit_parcels']:,} parcels intersect a park; "
        f"{stats[f'excluded_ge_{pct}']:,} have ≥{pct}% overlap"
    )

    defaults = index.setdefault("defaults", {})
    defaults["parkOverlapThreshold"] = threshold

    index_path.write_text(json.dumps(index))
    print(f"Wrote {index_path} ({index_path.stat().st_size / 1e6:.1f} MB)")
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--threshold",
        type=float,
        default=DEFAULT_OVERLAP_THRESHOLD,
        help="Overlap fraction at or above which a parcel is excluded (default 0.1)",
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
        help="Re-download CPAD holdings even if cache exists",
    )
    args = parser.parse_args()
    annotate_index_file(
        index_path=args.index,
        threshold=args.threshold,
        force_fetch=args.force_fetch,
    )


if __name__ == "__main__":
    main()
