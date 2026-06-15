#!/usr/bin/env python3
"""Filter City_Lands.csv in raw/ down to rows where city is San Francisco.

Writes the kept rows to filtered/City_Lands_SF.csv.
"""

import csv
import sys
from pathlib import Path

# Geometry fields exceed the default csv field size limit
csv.field_size_limit(sys.maxsize)

PROJECT_DIR = Path(__file__).resolve().parent
SRC = PROJECT_DIR / "raw" / "City_Lands.csv"
DEST = PROJECT_DIR / "filtered" / "City_Lands_SF.csv"


def main() -> None:
    if not SRC.exists():
        sys.exit(f"Source file not found: {SRC}")

    DEST.parent.mkdir(exist_ok=True)
    kept = dropped = 0

    with open(SRC, newline="", encoding="utf-8") as fin, \
         open(DEST, "w", newline="", encoding="utf-8") as fout:
        reader = csv.DictReader(fin)
        if "city" not in (reader.fieldnames or []):
            sys.exit(f"{SRC.name}: no 'city' column found")

        writer = csv.DictWriter(fout, fieldnames=reader.fieldnames,
                                quoting=csv.QUOTE_ALL)
        writer.writeheader()

        for row in reader:
            if row["city"].strip().lower() == "san francisco":
                kept += 1
                writer.writerow(row)
            else:
                dropped += 1

    print(f"{SRC.name}: kept {kept:,} San Francisco rows, "
          f"dropped {dropped:,} others -> {DEST}")


if __name__ == "__main__":
    main()
