#!/usr/bin/env python3
"""Fetch GeoJSON features from an ArcGIS FeatureServer layer."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Iterable
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import geopandas as gpd


def fetch_layer_geojson(
    layer_url: str,
    *,
    out_fields: Iterable[str] | str = "*",
    where: str = "1=1",
    page_size: int = 2000,
    pause_s: float = 0.05,
) -> gpd.GeoDataFrame:
    """Download an entire FeatureServer layer via paginated GeoJSON queries."""
    if isinstance(out_fields, (list, tuple, set)):
        out_fields = ",".join(out_fields)

    features: list[dict] = []
    offset = 0
    while True:
        params = urlencode(
            {
                "where": where,
                "outFields": out_fields,
                "returnGeometry": "true",
                "outSR": "4326",
                "f": "geojson",
                "resultRecordCount": page_size,
                "resultOffset": offset,
            }
        )
        req = Request(f"{layer_url}/query?{params}", headers={"User-Agent": "tvs-ai/0.1"})
        with urlopen(req, timeout=120) as resp:
            payload = json.load(resp)

        batch = payload.get("features", [])
        if not batch:
            break

        features.extend(batch)
        print(f"  fetched {len(features):,} features...", flush=True)
        if len(batch) < page_size:
            break
        offset += page_size
        time.sleep(pause_s)

    if not features:
        raise RuntimeError(f"No features returned from {layer_url}")

    return gpd.GeoDataFrame.from_features(features, crs="EPSG:4326")


def load_or_fetch(
    cache_path: Path,
    layer_url: str,
    *,
    out_fields: Iterable[str] | str = "*",
    force: bool = False,
) -> gpd.GeoDataFrame:
    if cache_path.exists() and not force:
        print(f"loading cached geometry from {cache_path}")
        return gpd.read_file(cache_path)

    print(f"downloading geometry from {layer_url}")
    gdf = fetch_layer_geojson(layer_url, out_fields=out_fields)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    gdf.to_file(cache_path, driver="GeoJSON")
    print(f"cached {len(gdf):,} features -> {cache_path}")
    return gdf
