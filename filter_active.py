#!/usr/bin/env python3
"""Filter out rows where `active` is false from the parcels CSV in raw/.

Writes the kept rows (active == true) to filtered/<same filename>.
"""

import csv
import sys
from pathlib import Path

# Geometry fields exceed the default csv field size limit
csv.field_size_limit(sys.maxsize)

PROJECT_DIR = Path(__file__).resolve().parent
RAW_DIR = PROJECT_DIR / "raw"
OUT_DIR = PROJECT_DIR / "filtered"


def main() -> None:
    csv_files = sorted(RAW_DIR.glob("*.csv"))
    if not csv_files:
        sys.exit(f"No CSV files found in {RAW_DIR}")

    OUT_DIR.mkdir(exist_ok=True)

    for src in csv_files:
        dest = OUT_DIR / src.name
        kept = dropped = 0

        with open(src, newline="", encoding="utf-8") as fin, \
             open(dest, "w", newline="", encoding="utf-8") as fout:
            reader = csv.DictReader(fin)
            if "active" not in (reader.fieldnames or []):
                sys.exit(f"{src.name}: no 'active' column found")

            writer = csv.DictWriter(fout, fieldnames=reader.fieldnames,
                                    quoting=csv.QUOTE_ALL)
            writer.writeheader()

            for row in reader:
                if row["active"].strip().lower() == "false":
                    dropped += 1
                else:
                    kept += 1
                    writer.writerow(row)

        print(f"{src.name}: kept {kept:,} rows, dropped {dropped:,} inactive -> {dest}")


if __name__ == "__main__":
    main()
