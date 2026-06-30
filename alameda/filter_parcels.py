#!/usr/bin/env python3
"""Filter Parcels.csv to target East Bay cities.

Writes the kept rows to filtered/Parcels_Target_Cities.csv.
"""

import csv
import sys
from pathlib import Path

from config import TARGET_CITIES

ALAMEDA_DIR = Path(__file__).resolve().parent
SRC = ALAMEDA_DIR / "raw" / "Parcels.csv"
DEST = ALAMEDA_DIR / "filtered" / "Parcels_Target_Cities.csv"

TARGET_SET = {c.upper() for c in TARGET_CITIES}


def main() -> None:
    if not SRC.exists():
        sys.exit(f"Source file not found: {SRC}")

    DEST.parent.mkdir(exist_ok=True)
    kept = dropped = 0

    with open(SRC, newline="", encoding="utf-8-sig") as fin, \
         open(DEST, "w", newline="", encoding="utf-8") as fout:
        reader = csv.DictReader(fin)
        if "SitusCity" not in (reader.fieldnames or []):
            sys.exit(f"{SRC.name}: no 'SitusCity' column found")

        writer = csv.DictWriter(fout, fieldnames=reader.fieldnames, quoting=csv.QUOTE_ALL)
        writer.writeheader()

        for row in reader:
            city = (row.get("SitusCity") or "").strip().upper()
            if city in TARGET_SET:
                kept += 1
                writer.writerow(row)
            else:
                dropped += 1

    cities = ", ".join(TARGET_CITIES)
    print(f"{SRC.name}: kept {kept:,} rows in [{cities}], "
          f"dropped {dropped:,} others -> {DEST}")


if __name__ == "__main__":
    main()
