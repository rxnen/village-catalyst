#!/usr/bin/env python3
"""Join parcel blklots onto Recreation & Parks properties via the
land_id <-> blklot crosswalk.

Left join: every park row is kept. Parks whose land_id has matching
parcels fan out to one row per blklot; the rest get an empty blklot
(e.g. properties outside San Francisco, which the crosswalk does not
cover). The bulky WKT shape column is dropped from the output.

Writes processed/Recreation_Parks_with_blklot.csv.
"""

import sys
from pathlib import Path

import pandas as pd

PROJECT_DIR = Path(__file__).resolve().parent
SRC = PROJECT_DIR / "raw" / "Recreation_Parks.csv"
XWALK = PROJECT_DIR / "processed" / "land_parcel_crosswalk.csv"
DEST = PROJECT_DIR / "processed" / "Recreation_Parks_with_blklot.csv"


def main() -> None:
    for path in (SRC, XWALK):
        if not path.exists():
            sys.exit(f"Input file not found: {path}")

    df = pd.read_csv(SRC, dtype=str).drop(columns=["shape"])
    xw = pd.read_csv(XWALK, dtype=str)

    has_id = df["land_id"].notna() & (df["land_id"].str.strip() != "")
    matched = has_id & df["land_id"].isin(set(xw["land_id"]))
    print(f"{SRC.name}: {len(df):,} properties; {has_id.sum():,} have a "
          f"land_id, {matched.sum():,} match parcels in the crosswalk")

    out = df.merge(xw, on="land_id", how="left")

    DEST.parent.mkdir(exist_ok=True)
    out.to_csv(DEST, index=False)
    print(f"wrote {len(out):,} rows ({out['blklot'].notna().sum():,} with a "
          f"blklot) -> {DEST}")


if __name__ == "__main__":
    main()
