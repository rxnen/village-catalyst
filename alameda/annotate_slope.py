#!/usr/bin/env python3
"""Annotate parcel_index.json with USGS 3DEP slope statistics.

Downloads percent-rise slope from the 3DEP Elevation ImageServer
(https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer),
caches a mosaic under processed/, then for each parcel stores:

  slope_mean_pct:     mean percent grade of DEM cells intersecting the parcel
  slope_steep_frac:   share of those cells at or above STEEP_PCT (default 15%)

Usage:
  python annotate_slope.py
  python annotate_slope.py --cell-size 10 --steep-pct 15
  python annotate_slope.py --force-fetch
"""

from __future__ import annotations

import argparse
import io
import json
import sys
import time
import zipfile
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import geopandas as gpd
import numpy as np
import shapely
import tifffile

ALAMEDA_DIR = Path(__file__).resolve().parent
PROCESSED = ALAMEDA_DIR / "processed"
PARCELS_GEOM = PROCESSED / "parcels.geojson"
OUT_INDEX = ALAMEDA_DIR.parent / "frontend" / "public" / "alameda" / "parcel_index.json"
SLOPE_CACHE = PROCESSED / "slope_pct_mosaic.npz"

ELEVATION_URL = (
    "https://elevation.nationalmap.gov/arcgis/rest/services/"
    "3DEPElevation/ImageServer"
)

AREA_CRS = "EPSG:3857"  # Web Mercator — matches ImageServer native SR
DEFAULT_CELL_SIZE_M = 10.0
DEFAULT_STEEP_PCT = 15.0
MAX_TILE_PX = 2500
BBOX_PAD_M = 50.0
USER_AGENT = "tvs-ai/0.1"


def _export_slope_tile(
    xmin: float,
    ymin: float,
    xmax: float,
    ymax: float,
    *,
    width: int,
    height: int,
) -> tuple[dict, np.ndarray]:
    """Fetch one Slope (percent rise) tile; return (meta, float32 array)."""
    rendering_rule = {
        "rasterFunction": "Slope",
        "rasterFunctionArguments": {"SlopeType": 2},  # percent rise
        "outputPixelType": "F32",
    }
    params = {
        "bbox": f"{xmin},{ymin},{xmax},{ymax}",
        "bboxSR": 3857,
        "imageSR": 3857,
        "size": f"{width},{height}",
        "format": "tiff",
        "pixelType": "F32",
        "interpolation": "RSP_BilinearInterpolation",
        "renderingRule": json.dumps(rendering_rule),
        "f": "json",
    }
    req = Request(
        f"{ELEVATION_URL}/exportImage?{urlencode(params)}",
        headers={"User-Agent": USER_AGENT},
    )
    with urlopen(req, timeout=180) as resp:
        meta = json.load(resp)
    href = meta.get("href")
    if not href:
        raise RuntimeError(f"exportImage returned no href: {meta}")

    req = Request(href, headers={"User-Agent": USER_AGENT})
    with urlopen(req, timeout=180) as resp:
        data = resp.read()

    # Some responses are zip-wrapped; most are raw GeoTIFF.
    if data[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            names = [n for n in zf.namelist() if n.lower().endswith((".tif", ".tiff"))]
            if not names:
                raise RuntimeError(f"No TIFF in export zip: {zf.namelist()}")
            data = zf.read(names[0])

    arr = tifffile.imread(io.BytesIO(data))
    if arr.ndim == 3:
        arr = arr[0]
    arr = np.asarray(arr, dtype=np.float32)
    if arr.shape != (height, width):
        # Server may adjust size slightly; trust the array dims + returned extent.
        height, width = arr.shape
        meta["height"] = height
        meta["width"] = width
    return meta, arr


def _tile_bounds(
    xmin: float,
    ymin: float,
    xmax: float,
    ymax: float,
    *,
    cell_size: float,
    max_px: int,
) -> list[tuple[float, float, float, float, int, int]]:
    """Split bbox into tiles of at most max_px on a side."""
    width_m = xmax - xmin
    height_m = ymax - ymin
    full_w = max(1, int(np.ceil(width_m / cell_size)))
    full_h = max(1, int(np.ceil(height_m / cell_size)))
    tiles: list[tuple[float, float, float, float, int, int]] = []
    for row0 in range(0, full_h, max_px):
        for col0 in range(0, full_w, max_px):
            tw = min(max_px, full_w - col0)
            th = min(max_px, full_h - row0)
            tx0 = xmin + col0 * cell_size
            ty1 = ymax - row0 * cell_size
            tx1 = tx0 + tw * cell_size
            ty0 = ty1 - th * cell_size
            tiles.append((tx0, ty0, tx1, ty1, tw, th))
    return tiles


def fetch_slope_mosaic(
    bounds_3857: tuple[float, float, float, float],
    *,
    cell_size: float = DEFAULT_CELL_SIZE_M,
    cache_path: Path = SLOPE_CACHE,
    force: bool = False,
) -> dict:
    """Download / load a percent-rise slope mosaic covering bounds.

    Returns dict with keys: slope (2d float32), xmin, ymax, cell_size.
    Row 0 is north (ymax).
    """
    xmin, ymin, xmax, ymax = bounds_3857
    xmin -= BBOX_PAD_M
    ymin -= BBOX_PAD_M
    xmax += BBOX_PAD_M
    ymax += BBOX_PAD_M
    # Snap to cell grid so mosaic dimensions are exact.
    xmin = np.floor(xmin / cell_size) * cell_size
    ymin = np.floor(ymin / cell_size) * cell_size
    xmax = np.ceil(xmax / cell_size) * cell_size
    ymax = np.ceil(ymax / cell_size) * cell_size

    width = int(round((xmax - xmin) / cell_size))
    height = int(round((ymax - ymin) / cell_size))

    if cache_path.exists() and not force:
        cached = np.load(cache_path)
        if (
            float(cached["xmin"]) == xmin
            and float(cached["ymax"]) == ymax
            and float(cached["cell_size"]) == cell_size
            and cached["slope"].shape == (height, width)
        ):
            print(f"Loading cached slope mosaic from {cache_path}")
            return {
                "slope": cached["slope"],
                "xmin": xmin,
                "ymax": ymax,
                "cell_size": cell_size,
            }
        print("Cache params differ; re-fetching slope mosaic…")

    print(
        f"Fetching 3DEP slope (% rise) mosaic {width}×{height} @ {cell_size:g} m…"
    )
    mosaic = np.full((height, width), np.nan, dtype=np.float32)
    tiles = _tile_bounds(xmin, ymin, xmax, ymax, cell_size=cell_size, max_px=MAX_TILE_PX)
    for i, (tx0, ty0, tx1, ty1, tw, th) in enumerate(tiles, start=1):
        print(f"  tile {i}/{len(tiles)}: {tw}×{th}", flush=True)
        meta, arr = _export_slope_tile(tx0, ty0, tx1, ty1, width=tw, height=th)
        # Map returned extent into mosaic indices (handles server rounding).
        ext = meta["extent"]
        col0 = int(round((ext["xmin"] - xmin) / cell_size))
        row0 = int(round((ymax - ext["ymax"]) / cell_size))
        h, w = arr.shape
        # Clamp into mosaic.
        c0 = max(0, col0)
        r0 = max(0, row0)
        c1 = min(width, col0 + w)
        r1 = min(height, row0 + h)
        if c1 > c0 and r1 > r0:
            mosaic[r0:r1, c0:c1] = arr[r0 - row0 : r1 - row0, c0 - col0 : c1 - col0]
        time.sleep(0.15)

    # Treat absurd / nodata sentinels as missing.
    mosaic = np.where(np.isfinite(mosaic) & (mosaic >= 0) & (mosaic < 500), mosaic, np.nan)
    mosaic = mosaic.astype(np.float32)

    cache_path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        cache_path,
        slope=mosaic,
        xmin=np.float64(xmin),
        ymax=np.float64(ymax),
        cell_size=np.float64(cell_size),
    )
    print(f"  cached mosaic → {cache_path} ({cache_path.stat().st_size / 1e6:.1f} MB)")
    return {
        "slope": mosaic,
        "xmin": xmin,
        "ymax": ymax,
        "cell_size": cell_size,
    }


def _parcel_slope_stats(
    geom,
    mosaic: dict,
    *,
    steep_pct: float,
) -> tuple[float, float] | None:
    """Return (mean_pct, steep_frac) for cells whose centers fall in geom."""
    if geom is None or geom.is_empty:
        return None

    slope = mosaic["slope"]
    xmin = mosaic["xmin"]
    ymax = mosaic["ymax"]
    cell = mosaic["cell_size"]
    height, width = slope.shape

    minx, miny, maxx, maxy = geom.bounds
    col0 = max(0, int(np.floor((minx - xmin) / cell)))
    col1 = min(width, int(np.ceil((maxx - xmin) / cell)))
    row0 = max(0, int(np.floor((ymax - maxy) / cell)))
    row1 = min(height, int(np.ceil((ymax - miny) / cell)))
    if col1 <= col0 or row1 <= row0:
        return None

    window = slope[row0:row1, col0:col1]
    if window.size == 0:
        return None

    rows = np.arange(row0, row1)
    cols = np.arange(col0, col1)
    # Cell centers.
    xs = xmin + (cols + 0.5) * cell
    ys = ymax - (rows + 0.5) * cell
    xx, yy = np.meshgrid(xs, ys)

    prepared = shapely.prepare(geom)
    inside = shapely.contains_xy(prepared, xx, yy)
    vals = window[inside]
    vals = vals[np.isfinite(vals)]
    if vals.size == 0:
        # Fallback: any finite cell overlapping the bbox window that intersects
        # the parcel envelope (tiny parcels / thin slivers).
        vals = window[np.isfinite(window)]
        if vals.size == 0:
            return None
        # Prefer cells whose centers are within a half-cell of the geom.
        # If still empty after contains, use nearest cell to centroid.
        c = geom.centroid
        col = int(np.clip(np.floor((c.x - xmin) / cell), 0, width - 1))
        row = int(np.clip(np.floor((ymax - c.y) / cell), 0, height - 1))
        v = slope[row, col]
        if not np.isfinite(v):
            return None
        vals = np.array([v], dtype=np.float32)

    mean_pct = float(np.mean(vals))
    steep_frac = float(np.mean(vals >= steep_pct))
    return mean_pct, steep_frac


def annotate_slope(
    parcels: dict[str, dict],
    geom_gdf: gpd.GeoDataFrame,
    mosaic: dict,
    *,
    steep_pct: float = DEFAULT_STEEP_PCT,
) -> dict[str, int | float]:
    """Mutate parcels with slope_mean_pct / slope_steep_frac. Return stats."""
    for parcel in parcels.values():
        parcel.pop("slope_mean_pct", None)
        parcel.pop("slope_steep_frac", None)

    if geom_gdf.empty:
        return {"hit_parcels": 0, "steep_ge_half": 0}

    apns = set(parcels.keys())
    parcels_gdf = geom_gdf[geom_gdf["APN"].isin(apns)].copy()
    if parcels_gdf.crs is None:
        parcels_gdf = parcels_gdf.set_crs("EPSG:4326")
    parcels_gdf = parcels_gdf.to_crs(AREA_CRS)

    hit = 0
    steep_ge_half = 0
    mean_sum = 0.0
    n = len(parcels_gdf)
    for i, row in enumerate(parcels_gdf.itertuples(index=False), start=1):
        apn = row.APN
        if apn not in parcels:
            continue
        stats = _parcel_slope_stats(row.geometry, mosaic, steep_pct=steep_pct)
        if stats is None:
            continue
        mean_pct, steep_frac = stats
        parcels[apn]["slope_mean_pct"] = round(mean_pct, 2)
        parcels[apn]["slope_steep_frac"] = round(steep_frac, 4)
        hit += 1
        mean_sum += mean_pct
        if steep_frac >= 0.5:
            steep_ge_half += 1
        if i % 20000 == 0 or i == n:
            print(f"  scored {i:,}/{n:,} geometries ({hit:,} with slope)", flush=True)

    return {
        "hit_parcels": hit,
        "steep_ge_half": steep_ge_half,
        "mean_of_means": (mean_sum / hit) if hit else 0.0,
    }


def annotate_index_file(
    index_path: Path = OUT_INDEX,
    parcels_geom_path: Path = PARCELS_GEOM,
    *,
    cell_size: float = DEFAULT_CELL_SIZE_M,
    steep_pct: float = DEFAULT_STEEP_PCT,
    force_fetch: bool = False,
) -> dict:
    if not index_path.exists():
        sys.exit(f"Missing {index_path}")
    if not parcels_geom_path.exists():
        sys.exit(f"Missing {parcels_geom_path}")

    print(f"Loading parcel index {index_path}…")
    index = json.loads(index_path.read_text())
    parcels = index["parcels"]
    print(f"  {len(parcels):,} parcels")

    print(f"Loading geometries {parcels_geom_path}…")
    geom = gpd.read_file(parcels_geom_path, columns=["APN", "geometry"])
    apns = set(parcels.keys())
    subset = geom[geom["APN"].isin(apns)].copy()
    if subset.crs is None:
        subset = subset.set_crs("EPSG:4326")
    subset_m = subset.to_crs(AREA_CRS)
    bounds = tuple(float(x) for x in subset_m.total_bounds)
    print(f"  {len(subset):,} geometries; bounds {bounds}")

    mosaic = fetch_slope_mosaic(
        bounds, cell_size=cell_size, force=force_fetch
    )
    print(
        f"  mosaic {mosaic['slope'].shape[1]}×{mosaic['slope'].shape[0]}; "
        f"finite cells {int(np.isfinite(mosaic['slope']).sum()):,}"
    )

    print(f"Computing per-parcel slope stats (steep ≥ {steep_pct:g}%)…")
    stats = annotate_slope(parcels, geom, mosaic, steep_pct=steep_pct)
    print(
        f"  {stats['hit_parcels']:,} parcels annotated; "
        f"{stats['steep_ge_half']:,} have ≥50% of cells steep; "
        f"avg mean slope {stats['mean_of_means']:.2f}%"
    )

    defaults = index.setdefault("defaults", {})
    defaults["slopeCellSizeM"] = cell_size
    defaults["slopeSteepPct"] = steep_pct

    index_path.write_text(json.dumps(index))
    print(f"Wrote {index_path} ({index_path.stat().st_size / 1e6:.1f} MB)")
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cell-size",
        type=float,
        default=DEFAULT_CELL_SIZE_M,
        help="DEM / slope cell size in meters (default 10)",
    )
    parser.add_argument(
        "--steep-pct",
        type=float,
        default=DEFAULT_STEEP_PCT,
        help="Percent grade threshold for slope_steep_frac (default 15)",
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
        help="Re-download slope mosaic even if cache exists",
    )
    args = parser.parse_args()
    annotate_index_file(
        index_path=args.index,
        cell_size=args.cell_size,
        steep_pct=args.steep_pct,
        force_fetch=args.force_fetch,
    )


if __name__ == "__main__":
    main()
