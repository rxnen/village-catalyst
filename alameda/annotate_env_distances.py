#!/usr/bin/env python3
"""Annotate parcel_index.json with EnviroStor cleanup edge distances.

For each parcel, stores:
  env: { strong: m|null, medium: m|null, note: m|null }
  env_sites: up to N nearest cleanup sites (edge distance), with metadata

Distance is from the cleanup-site point to the nearest parcel boundary
edge (0 if the point falls on/inside the polygon), in meters (EPSG:26910).

Usage:
  python annotate_env_distances.py
  python annotate_env_distances.py --max-meters 500
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import geopandas as gpd
from shapely.geometry import Point

from envirostor import cleanup_sites_from_geojson, fetch_cleanup_geojson

ALAMEDA_DIR = Path(__file__).resolve().parent
PROCESSED = ALAMEDA_DIR / "processed"
PARCELS_GEOM = PROCESSED / "parcels.geojson"
OUT_INDEX = ALAMEDA_DIR.parent / "frontend" / "public" / "alameda" / "parcel_index.json"

AREA_CRS = "EPSG:26910"  # NAD83 / UTM zone 10N — meters
DEFAULT_MAX_METERS = 500
DEFAULT_MAX_SITES = 8
TIERS = ("strong", "medium", "note")


def _site_record(site: dict, meters: float) -> dict:
    rec: dict = {
        "tier": site["tier"],
        "meters": round(float(meters), 1),
    }
    if site.get("name"):
        rec["name"] = site["name"]
    if site.get("status"):
        rec["status"] = site["status"]
    if site.get("address"):
        rec["address"] = site["address"]
    if site.get("city"):
        rec["city"] = site["city"]
    if site.get("envirostor_id"):
        rec["envirostor_id"] = site["envirostor_id"]
    return rec


def annotate_env_distances(
    parcels: dict[str, dict],
    geom_gdf: gpd.GeoDataFrame,
    sites: list[dict],
    *,
    max_meters: float = DEFAULT_MAX_METERS,
    max_sites: int = DEFAULT_MAX_SITES,
) -> dict[str, int]:
    """Mutate parcels with env distances + env_sites. Return stats."""
    for parcel in parcels.values():
        parcel.pop("env", None)
        parcel.pop("env_sites", None)

    if geom_gdf.empty or not sites:
        return {t: 0 for t in TIERS} | {"sites": 0, "hit_parcels": 0}

    apns = set(parcels.keys())
    parcels_gdf = geom_gdf[geom_gdf["APN"].isin(apns)].copy()
    if parcels_gdf.crs is None:
        parcels_gdf = parcels_gdf.set_crs("EPSG:4326")
    parcels_gdf = parcels_gdf.to_crs(AREA_CRS)

    sites_rows = []
    for i, site in enumerate(sites):
        sites_rows.append(
            {
                "site_id": i,
                "tier": site["tier"],
                "geometry": Point(site["lng"], site["lat"]),
            }
        )
    sites_gdf = gpd.GeoDataFrame(sites_rows, geometry="geometry", crs="EPSG:4326").to_crs(
        AREA_CRS
    )

    site_buffers = sites_gdf.copy()
    site_buffers.geometry = site_buffers.geometry.buffer(max_meters)
    joined = gpd.sjoin(
        parcels_gdf[["APN", "geometry"]],
        site_buffers[["site_id", "tier", "geometry"]],
        how="inner",
        predicate="intersects",
    )
    if joined.empty:
        return {t: 0 for t in TIERS} | {"sites": len(sites), "hit_parcels": 0}

    site_points = {
        int(row.site_id): row.geometry for row in sites_gdf.itertuples(index=False)
    }
    parcel_geoms = {
        row.APN: row.geometry for row in parcels_gdf.itertuples(index=False)
    }

    # All (apn, site_id, tier, dist) hits; then reduce per parcel.
    hits_by_apn: dict[str, list[tuple[float, int, str]]] = {}
    best_tier: dict[tuple[str, str], float] = {}

    for row in joined.itertuples(index=False):
        apn = row.APN
        tier = row.tier
        site_id = int(row.site_id)
        point = site_points[site_id]
        poly = parcel_geoms[apn]
        if poly is None or poly.is_empty:
            continue
        dist = 0.0 if poly.covers(point) else float(poly.distance(point))
        if dist > max_meters:
            continue
        hits_by_apn.setdefault(apn, []).append((dist, site_id, tier))
        key = (apn, tier)
        prev = best_tier.get(key)
        if prev is None or dist < prev:
            best_tier[key] = dist

    tier_hits = {t: 0 for t in TIERS}
    hit_parcels = 0

    for apn, hit_list in hits_by_apn.items():
        env = {t: None for t in TIERS}
        for tier in TIERS:
            d = best_tier.get((apn, tier))
            if d is not None:
                env[tier] = round(d, 1)
                tier_hits[tier] += 1

        # Nearest unique sites (by site_id), sorted by distance.
        hit_list.sort(key=lambda x: x[0])
        seen_ids: set[int] = set()
        env_sites: list[dict] = []
        for dist, site_id, _tier in hit_list:
            if site_id in seen_ids:
                continue
            seen_ids.add(site_id)
            env_sites.append(_site_record(sites[site_id], dist))
            if len(env_sites) >= max_sites:
                break

        parcels[apn]["env"] = env
        parcels[apn]["env_sites"] = env_sites
        hit_parcels += 1

    return {**tier_hits, "sites": len(sites), "hit_parcels": hit_parcels}


def annotate_index_file(
    index_path: Path = OUT_INDEX,
    parcels_geom_path: Path = PARCELS_GEOM,
    *,
    max_meters: float = DEFAULT_MAX_METERS,
    max_sites: int = DEFAULT_MAX_SITES,
) -> dict[str, int]:
    if not index_path.exists():
        sys.exit(f"Missing {index_path}")
    if not parcels_geom_path.exists():
        sys.exit(f"Missing {parcels_geom_path}")

    print("Fetching EnviroStor cleanup sites…")
    geo = fetch_cleanup_geojson()
    sites = cleanup_sites_from_geojson(geo)
    print(f"  {len(sites):,} tiered cleanup sites")

    print(f"Loading parcel index {index_path}…")
    index = json.loads(index_path.read_text())
    parcels = index["parcels"]
    print(f"  {len(parcels):,} parcels")

    print(f"Loading geometries {parcels_geom_path}…")
    geom = gpd.read_file(parcels_geom_path, columns=["APN", "geometry"])
    print(f"  {len(geom):,} parcel polygons")

    print(f"Computing edge distances (max {max_meters:g} m, up to {max_sites} sites)…")
    stats = annotate_env_distances(
        parcels, geom, sites, max_meters=max_meters, max_sites=max_sites
    )
    print(
        f"  hit parcels {stats['hit_parcels']:,}; "
        f"strong links {stats['strong']:,}; "
        f"medium {stats['medium']:,}; note {stats['note']:,}"
    )

    defaults = index.setdefault("defaults", {})
    defaults.setdefault("envStrongMeters", 50)
    defaults.setdefault("envMediumMeters", 25)
    defaults.setdefault("envNoteMeters", 0)

    index_path.write_text(json.dumps(index))
    print(f"Wrote {index_path} ({index_path.stat().st_size / 1e6:.1f} MB)")
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--max-meters",
        type=float,
        default=DEFAULT_MAX_METERS,
        help="Store distances up to this many meters (default 500)",
    )
    parser.add_argument(
        "--max-sites",
        type=int,
        default=DEFAULT_MAX_SITES,
        help="Max nearby sites stored per parcel (default 8)",
    )
    parser.add_argument(
        "--index",
        type=Path,
        default=OUT_INDEX,
        help="Path to parcel_index.json",
    )
    args = parser.parse_args()
    annotate_index_file(
        index_path=args.index,
        max_meters=args.max_meters,
        max_sites=args.max_sites,
    )


if __name__ == "__main__":
    main()
