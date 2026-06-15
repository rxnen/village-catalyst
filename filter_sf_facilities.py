#!/usr/bin/env python3
"""Filter City_Facilities.csv in raw/ down to rows where city is San Francisco.

Also strips thousands-separator commas from land_id (e.g. "1,106" -> "1106").
Writes the kept rows to filtered/City_Facilities_SF.csv.
"""

import csv
import sys
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent
SRC = PROJECT_DIR / "raw" / "City_Facilities.csv"
DEST = PROJECT_DIR / "filtered" / "City_Facilities_SF.csv"


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
                row["land_id"] = row["land_id"].replace(",", "")
                kept += 1
                writer.writerow(row)
            else:
                dropped += 1

    print(f"{SRC.name}: kept {kept:,} San Francisco rows, "
          f"dropped {dropped:,} others -> {DEST}")


if __name__ == "__main__":
    main()
