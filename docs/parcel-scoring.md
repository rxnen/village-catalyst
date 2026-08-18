# Parcel elimination and prioritization reference

The system has **three layers**:

1. **Offline pipeline** — shrinks the raw county dataset before export
2. **Frontend visibility filters** — what appears on the map/list
3. **Prioritization** — how visible parcels are sorted (list) and colored (map outlines)

---

## Part 1: Offline pipeline elimination

These run in Python before data reaches the frontend.

### 1.1 Target city filter (`filter_parcels.py`)

**Rule:** keep only parcels where:

```
SitusCity ∈ {OAKLAND, BERKELEY, SAN LEANDRO, HAYWARD}
```

All other cities are dropped from `filtered/Parcels_Target_Cities.csv`.

---

### 1.2 Parcel acreage filter (`filter_parcel_acreage.py`)

Applied to target-city parcels with geometry from `processed/parcels.geojson`.

**Area calculation:**

```
shape_area_sqm = geometry.area          (EPSG:26910, meters)
area_acres     = shape_area_sqm / 4046.8564224
```

**Keep rule:**

```
MIN_ACRES ≤ area_acres ≤ MAX_ACRES
```

**Defaults:**

- `MIN_ACRES = 1.0`
- `MAX_ACRES = 10.0`
- `SQ_M_PER_ACRE = 4046.8564224`

Parcels with missing geometry are dropped.

Output: `filtered/Parcels_Suitable_Size.csv` (used in downstream pipeline scripts, **not** as the sole frontend source).

---

### 1.3 Junk zero-value exclusion (`metrics.py` → `evaluate_lead_tracks`)

Applied during export and acreage filtering.

**Exclude if all three are true:**

```
Land == 0  AND  Imps == 0  AND  UseCode ∈ JUNK_ZERO_VALUE_USE_CODES
```

**Junk use codes** (exact set from `config.py`):

`0, 400, 500, 840, 900, 940, 1166, 1190, 1590, 1595, 1690, 1890, 3990, 4191, 4500, 4600, 4601, 4700, 7390, 7391, 7392, 7395, 7790, 9491, 8300, 8400, 9999`

Parcels meeting this rule are **removed from `parcel_index.json`** at export time.

---

### 1.4 Building footprint pre-filter (`filter_building_footprints.py`)

Not a parcel filter, but defines which buildings are considered.

**County bounding box** (WGS84), derived from `parcels.geojson` total bounds:

```
longitude: -122.37384157 to -121.46933879
latitude:   37.45427760 to  37.90669456
```

Keeps Microsoft footprints whose geometry intersects this bbox.

---

### 1.5 Building-to-parcel spatial join (`join_buildings_to_parcels.py`)

**Per building–parcel pair** where geometries intersect (EPSG:26910):

```
overlap_sq_m = area(building ∩ parcel)
```

**Per parcel aggregation:**

```
building_footprint_sq_m = Σ overlap_sq_m   (across all intersecting buildings)
building_count          = count of unique buildings intersecting
```

**Coverage ratio:**

```
coverage_ratio = building_footprint_sq_m / parcel_area_sq_m
```

Where `parcel_area_sq_m = geometry.area` in EPSG:26910.

Parcels with no intersecting buildings get `building_footprint_sq_m = 0`, `building_count = 0`, `coverage_ratio = 0`.

Buildings not intersecting any parcel polygon are unmatched.

---

### 1.6 General Plan land-use match (`build_parcel_landuse_crosswalk.py`)

Not an elimination filter for parcels, but defines GPLU metadata.

**Per parcel–land-use polygon pair:**

```
overlap_frac = area(parcel ∩ land_use_polygon) / parcel_area
```

**Match kept only if:**

```
overlap_frac ≥ MIN_OVERLAP
MIN_OVERLAP = 0.5   (50%)
```

Best overlap per APN wins. Parcels below 50% overlap are labeled `unmatched` in the UI. **GPLU does not eliminate or score parcels** — popup/overlay only.

---

### 1.7 Zoning tier match (`join_parcels_to_zoning.py`)

Not an elimination filter. Joins every target-city parcel polygon to its city zoning layer, keeps the zone with greatest overlap, then resolves an A/B/C tier from `Zoning.xlsx` (via `zoning_tiers.json`).

**Overlay rule:** if `base/overlay` (or GIS full label) exists as a spreadsheet row, use that tier; otherwise fall back to the base zone row.

**Pipeline order:**

```
export_zoning_tiers.py → join_parcels_to_zoning.py → export_geojson.py
```

Output: `processed/parcel_zoning_crosswalk.csv` → baked onto each parcel as `zoning` in `parcel_index.json`.

---

### 1.8 Frontend export universe (`export_geojson.py`)

**Source:** `filtered/Parcels_Target_Cities.csv` (all 4 target cities, **not** pre-filtered to 1–10 acres).

**Eliminated at export:**

- Junk zero-value parcels (rule 1.3)

**Included per parcel in `parcel_index.json`:**

- `city`, `area_acres`, `track_a`, `track_b`, `tracks`
- `imps_land_ratio` (when computable)
- `coverage_ratio` (from building join)
- `use_code`, `use_code_label`
- `land_use` (GPLU match or `{category: "unmatched"}`)
- `zoning` (tier A/B/C match, or omitted when unmatched)

**Export defaults baked into JSON:**

| Setting | Default |
|---------|---------|
| `minAcres` | 1.0 |
| `maxAcres` | 10.0 |
| `maxCoverageRatio` | 0.2 |
| `onlyLeads` | false |
| `requireBothTracks` | false |

---

## Part 2: Lead track signals (computed, not always eliminating)

Defined in `metrics.py`, stored on each exported parcel.

### Track A — institutional / absentee owner

```
track_a = (OTEX > 0)
       OR (HOEX == 0 AND mailing_city ≠ situs_city)
```

Where `mailing_city` is parsed from `MailingAddressCityState` by stripping the trailing 2-letter state (e.g. `"PIEDMONT CA"` → `"PIEDMONT"`).

### Track B — vacant taxable land

```
imps_land_ratio = Imps / Land    (only when Land > 0)

track_b = (Land > 50,000)
      AND (imps_land_ratio < 0.2)
      AND (EconomicUnit is empty or "0")
```

**Constants:**

- `TRACK_B_MIN_LAND = 50,000` (assessor dollars)
- `TRACK_B_MAX_IMPS_LAND_RATIO = 0.2` (20%)

### Lead status

```
isLead = track_a OR track_b
passesBothTracks = track_a AND track_b
```

---

## Part 3: Frontend visibility filters (elimination)

A parcel is **hidden** from the map and list unless `passesFilters()` returns true.

### 3.1 City filter

```
parcel.city ∈ filters.cities
```

**Default:** all 4 target cities checked.

### 3.2 Acreage filter

```
filters.minAcres ≤ parcel.area_acres ≤ filters.maxAcres
```

**Defaults:** `1.0 ≤ area_acres ≤ 10.0`

Also requires `area_acres != null`.

### 3.3 Use code cluster filter

15 assessor use-code **clusters** in `useCodeClusters.js`. Checked clusters are **shown**; unchecked clusters are **hidden**.

**Default included (visible):**

- Vacant developable land
- Government vacant land
- Schools, churches & cemeteries

**Default excluded (hidden):**

- Occupied single-family, multi-family, townhouses, apartments
- Commercial, industrial, hospitality, mobile homes, recreation
- Active rural, utilities, common areas/unknown

**Exclusion logic:**

```
hidden if use_code ∈ excludedUseCodes
```

**Exception — use code 300:**

```
if use_code == 300
   AND coverage_ratio < maxCoverageRatio:
     NOT hidden (even though 300 is in the excluded "common_areas_unknown" cluster)
else:
     normal cluster rules apply
```

Code 300 can become **visible** with low footprint coverage, but is **never** treated as a top-tier use signal (see Part 5).

### 3.4 Optional lead track filters (off by default)

**Only lead parcels:**

```
if onlyLeads: require track_a OR track_b
```

**Only both tracks:**

```
if requireBothTracks: require track_a AND track_b
(requires onlyLeads to be enabled in UI)
```

### 3.5 Coverage ratio — NOT a visibility filter

`maxCoverageRatio` (default **0.2**) does **not** hide parcels. It is used only for **ranking** and **scoring** (and the code-300 visibility exception above).

### 3.6 Slope tier filter

Checked mean-grade bands (from USGS 3DEP `slope_mean_pct`) stay visible; unchecked bands are hidden.

| Tier | Mean grade | Default |
|------|------------|---------|
| Flat | &lt; 5% | shown |
| Gentle | 5–10% | shown |
| Moderate | 10–15% | shown |
| Steep | 15–25% | shown |
| Very steep | ≥ 25% | **hidden** |

Parcels with missing slope stay visible. Turn the Slope group off in Filter control to ignore this filter entirely.

### 3.7 Viewport / list cap (soft limit)

```
QUERY_LIMIT = 2000 parcels per map view
```

Parcels beyond 2000 in the current viewport are computed but not shown in the list (map still renders all passing filters at detail zoom).

---

## Part 4: Use code tier system (ranking input)

Each use code maps to tier **0–5** (lower = better vacancy signal). Unknown/missing codes → tier **5**.

| Tier | Label | Points (scoring) | Codes |
|------|-------|------------------|-------|
| **0** | Vacant public land | +18 | 6000, 6001, 6100 |
| **1** | Vacant developable | +15 | 800, 1000, 1040, 3000, 4000, 5000, 5700, 5900, 7000, 7040 |
| **2** | Institutional surplus | +7 | 6200, 6300, 6400, 6500, 6590, 6600, 6700, 6800, 7090, 7900, 9910 |
| **3** | Marginal / common | +2 | 0, 300, 840, 900, 940, 1166, 1190, 1590, 1595, 1690, 1890, 3990, 4191, 4500, 4600, 4601, 4700, 7390–7395, 7790, 8300, 8400, 9491, 9999 |
| **4** | Low-intensity occupied | 0 | 400, 500, 600, 700, 750, 5100–5600, 5800, 9100 |
| **5** | Active buildings / unknown | **−5** | everything else |

**Top-tier use code** (for ranking/scoring):

```
effectiveUseCodeRank ≤ 1
TOP_USE_CODE_MAX_RANK = 1
```

**Code 300 override:**

```
effectiveUseCodeRank(300) = 3   (always, regardless of raw tier)
```

So 300 can appear on the map with low coverage, but never counts as tier 0–1.

---

## Part 5: Parcel list prioritization (`parcelListRank`)

Lower sort value = higher in list. Tie-break: address alphabetical.

### Step 1: Define sub-signals

```
lowCoverage  = coverage_ratio != null AND coverage_ratio < maxCoverageRatio
topUseCode   = effectiveUseCodeRank ≤ 1
bothTracks   = track_a AND track_b
tierA        = zoning.tier === "A"
leadRank     = 0 if bothTracks
             = 1 if track_a OR track_b (but not both)
             = 2 if neither
```

### Step 2: Assign band (0 = best)

| Band | Condition |
|------|-----------|
| **0** | `bothTracks AND topUseCode AND lowCoverage AND tierA` |
| **1** | `(bothTracks AND topUseCode AND lowCoverage)` (no Tier A) **OR** `bothTracks AND topUseCode` |
| **2** | `(bothTracks AND lowCoverage) OR (topUseCode AND lowCoverage)` |
| **3** | `bothTracks` only |
| **4** | `topUseCode OR lowCoverage` (but not band 0–3) |
| **5** | everything else |

### Step 3: Final list rank

```
parcelListRank = band × 1000 + leadRank × 10 + effectiveUseCodeRank
```

**Example:** both tracks + tier-1 vacant + low coverage + Tier A zoning:

```
band=0, leadRank=0, useCodeRank=1 → rank = 1
```

---

## Part 6: Map outline scoring (`parcelScore`)

Drives **outline color and weight only**. All parcels use the same neutral fill (`#94a3b8`).

### 6.1 Score components

**Lead tracks (max 30):**

| Condition | Points |
|-----------|--------|
| Both tracks | **30** |
| Track B only | **12** |
| Track A only | **8** |
| Neither | **0** |

**Use code tier (max 18, min −5):** see tier table in Part 4, using `effectiveUseCodeRank`.

**Footprint coverage — stepped (max 25):**

Let `r = coverage_ratio`, `T = maxCoverageRatio` (default 0.2):

| Condition | Points |
|-----------|--------|
| `r == 0` | **25** |
| `0 < r < 0.05` | **22** |
| `0.05 ≤ r < 0.10` | **18** |
| `0.10 ≤ r < 0.15` | **14** |
| `0.15 ≤ r < T` | **10** |
| `T ≤ r < 0.40` | **3** |
| `r ≥ 0.40` | **0** |
| `r == null` | **0** |

**Imps/Land ratio (max 5):**

| Condition | Points |
|-----------|--------|
| `ratio < 0.05` | **5** |
| `0.05 ≤ ratio < 0.10` | **3** |
| `0.10 ≤ ratio < 0.20` | **1** |
| `ratio ≥ 0.20` or null | **0** |

**Zoning tier (max 15, min −5)** from `parcel.zoning.tier` (`Zoning.xlsx`):

| Tier | Points | Meaning |
|------|--------|---------|
| **A** | **+15** | Shelter by right / SB2 zone |
| **B** | **+8** | CUP / discretionary or TH-as-residential path |
| **C** | **−5** | Rezone needed |
| missing / null | **0** | No zoning match |

**Synergy bonus (+5):**

```
+5 if (track_a AND track_b)
   AND (effectiveUseCodeRank ≤ 1)
   AND (coverage_ratio < maxCoverageRatio)
   AND (zoning.tier === "A")
```

### 6.2 Total score

```
raw_score = leadTracks + useCode + coverage + impsLand + zoning + synergy
total_score = max(0, raw_score)
```

**Theoretical max:** 30 + 18 + 25 + 5 + 15 + 5 = **98**  
**Theoretical min (before floor):** 0 + (−5) + 0 + 0 + (−5) + 0 = **−10** → floored to **0**

### 6.3 Outline hierarchy tiers

| Tier | Score | Label | Outline color | Weight |
|------|-------|-------|---------------|--------|
| 1 | ≥ 60 | Prime vacant | `#1b5e20` | 3.0 |
| 2 | 45–59 | Strong candidate | `#00897b` | 2.8 |
| 3 | 30–44 | Promising | `#1565c0` | 2.5 |
| 4 | 15–29 | Watchlist | `#ef6c00` | 2.0 |
| 5 | 1–14 | Background | `#78909c` | 1.5 |
| 6 | 0 | No signal | `#bdbdbd` | 1.0 |

Prime vacant implies synergy-eligible stacks (both tracks, top use code, low coverage, **and Tier A zoning**).

---

## Part 7: What does NOT filter or score

| Signal | Role |
|--------|------|
| **GPLU / General Plan category** | Popup and optional map overlay only |
| **Zoning polygons on the map** | Visual A/B/C tint; scoring uses the per-parcel `zoning` field from the crosswalk |
| **Slope** | Visibility via Slope tier checkboxes (Part 3.6). Tier + mean grade in popup/detail text. No map fill. Not a score input |
| **Land / Imps raw dollar values** | Not in frontend; only derived ratios/tracks |
| **HOEX / OTEX raw values** | Only used to compute Track A |
| **EconomicUnit** | Only used to compute Track B |
| **Building count** | Stored in CSV, not used in UI scoring |
| **Acreage sweet-spot** | Not in current scoring |

---

## Part 8: End-to-end flow summary

```
Raw county parcels (~490k)
  ↓ city filter (4 cities)
  ↓ export: drop junk $0/$0 + junk use code
  ↓ zoning join → parcel.zoning tier A/B/C
  ↓ parcel_index.json (~203k parcels)
  ↓ frontend city filter
  ↓ frontend acreage filter (1.0–10.0 ac default)
  ↓ frontend use-code cluster filter (+ 300 exception)
  ↓ frontend slope tier filter (Very steep hidden by default)
  ↓ optional: onlyLeads / requireBothTracks
  = VISIBLE PARCELS
  ↓ list: parcelListRank (bands + leadRank + useCodeRank; band 0 needs Tier A)
  ↓ map: parcelScore → outline tier color
```

---

## Part 9: Key equations quick reference

```
area_acres           = parcel_geometry_area_m² / 4046.8564224
coverage_ratio       = Σ building∩parcel areas / parcel_area_m²
imps_land_ratio      = Imps / Land                    (Land > 0)
gplu_overlap_frac    = parcel∩gplu area / parcel_area  (kept if ≥ 0.5)
track_a              = OTEX > 0 OR (HOEX = 0 AND mail_city ≠ situs_city)
track_b              = Land > 50000 AND imps/land < 0.2 AND no econ unit
low_coverage         = coverage_ratio < maxCoverageRatio   (default 0.2)
top_use_code         = effectiveUseCodeRank ≤ 1
parcelListRank       = band×1000 + leadRank×10 + useCodeRank
vacancy_score        = max(0, leadPts + usePts + covPts + impsPts + zoningPts + synergy)
```
