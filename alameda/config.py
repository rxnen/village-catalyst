"""Shared Alameda county pipeline settings."""

TARGET_CITIES = (
    "OAKLAND",
    "BERKELEY",
    "SAN LEANDRO",
    "HAYWARD",
)

MIN_ACRES = 1.0
MAX_ACRES = 2.5
SQ_M_PER_ACRE = 4046.8564224

# Track B: vacant taxable land
TRACK_B_MIN_LAND = 50_000
TRACK_B_MAX_IMPS_LAND_RATIO = 0.2

# $0 Land + $0 Imps is only excludable with a junk use code — never value alone.
# Public, government, institutional, and vacant codes are intentionally absent.
JUNK_ZERO_VALUE_USE_CODES = frozenset({
    "0",    # Unknown use
    "400",  # Property leased to a public utility
    "500",  # Property owned by a public utility
    "840", "900", "940",
    "1166", "1190",
    "1590", "1595", "1690", "1890",
    "3990", "4191",
    "4500", "4600", "4601", "4700",
    "7390", "7391", "7392", "7395", "7790", "9491",
    "8300", "8400",
    "9999",
})

# Esri SQL WHERE clause for the county Parcels FeatureServer
PARCELS_WHERE = "SitusCity IN ('" + "','".join(TARGET_CITIES) + "')"
