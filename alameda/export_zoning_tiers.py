#!/usr/bin/env python3
"""Export Zoning.xlsx tiers to JSON for the map frontend."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

ALAMEDA_DIR = Path(__file__).resolve().parent
XLSX = ALAMEDA_DIR / "raw" / "zoning" / "Zoning.xlsx"
OUT = (
    ALAMEDA_DIR.parent
    / "frontend"
    / "public"
    / "alameda"
    / "zoning"
    / "zoning_tiers.json"
)


def main() -> None:
    df = pd.read_excel(XLSX, sheet_name="zoning_tiers")
    rows = []
    by_city: dict[str, dict[str, dict]] = {}
    for _, row in df.iterrows():
        city = str(row["city"]).strip()
        zone = str(row["base_zone"]).strip()
        tier = str(row["tier"]).strip().upper()
        entry = {
            "city": city,
            "zone": zone,
            "tier": tier,
            "allows_shelter_by_right": str(row["allows_shelter_by_right"]).strip().lower()
            == "yes",
            "allows_transitional_housing": str(row["allows_transitional_housing"])
            .strip()
            .lower()
            == "yes",
            "notes": None if pd.isna(row["notes"]) else str(row["notes"]).strip(),
        }
        rows.append(entry)
        by_city.setdefault(city, {})[zone] = {
            "tier": tier,
            "allows_shelter_by_right": entry["allows_shelter_by_right"],
            "allows_transitional_housing": entry["allows_transitional_housing"],
            "notes": entry["notes"],
        }

    payload = {"rows": rows, "by_city": by_city}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=2))
    print(f"wrote {len(rows)} tier rows -> {OUT}")


if __name__ == "__main__":
    main()
