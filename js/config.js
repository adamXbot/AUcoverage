/*
 * config.js — data sources, network mappings and tunables.
 *
 * Everything the app needs to talk to the Australian Government open coverage
 * services, the geocoder and the base map lives here, so URLs / layer IDs /
 * carrier brand lists can be updated in one place.
 *
 * Coverage data © Commonwealth of Australia — ACCC "Audit of Telecommunications
 * Infrastructure Assets (Infrastructure RKR) / Mobile Infrastructure Report",
 * served via the Department of Infrastructure spatial portal. CC BY 2.5 AU.
 */
(function () {
  var ROOT = "https://spatial.infrastructure.gov.au/server/rest/services/";
  // 2025 ACCC Mobile Infrastructure Report — per-carrier, per-technology, outdoor/EA.
  var SVC_2025 = ROOT + "Mobile_Coverages_and_Sites_ACCC/MapServer";
  // 2021–22 Infrastructure RKR — per-carrier, all-technology merged.
  var SVC_RKR = ROOT + "Communications/Mobile_Phone_Coverage_by_provider/MapServer";
  // 2022 tower/base-station sites (points), with an MNO field.
  var SVC_SITES = ROOT + "Communications/Mobile_Phone_Sites/MapServer";

  window.APP_CONFIG = {
    // --- Australian Government open coverage services (ArcGIS REST, CORS-open, no key) ---
    gov: {
      // Selectable data vintages. Each maps a network id → the coverage layer id(s),
      // and carries a per-technology descriptor for the advanced overlays.
      // Vodafone/TPG in 2025 = own network PLUS its coverage on the Optus network
      // under the MOCN network-sharing agreement, so it uses two layers.
      defaultVersion: "latest",
      versions: {
        latest: {
          id: "latest",
          label: "2025 — latest",
          vintage: "2025",
          service: SVC_2025,
          layers: { telstra: [20], optus: [14], vodafone: [25, 31] }, // "Total Outdoor" per carrier
          // Per-technology "Outdoor" coverage, per carrier (2025), for the
          // colour-coded map comparison. (3G is retired across all carriers.)
          tech: {
            perCarrier: true,
            byNetwork: {
              telstra: { "5g": [18], "4g": [19] },
              optus: { "5g": [12], "4g": [13] },
              vodafone: { "5g": [23, 29], "4g": [24, 30] }, // own + MOCN (on Optus)
            },
          },
          note:
            "Source: ACCC Mobile Infrastructure Report 2025 (outdoor coverage on a standard handset). " +
            "Vodafone (TPG) includes coverage on the Optus network under the MOCN network-sharing agreement.",
        },
        baseline: {
          id: "baseline",
          label: "2021–22 — earlier",
          vintage: "2021–22",
          service: SVC_RKR,
          layers: { telstra: [2], optus: [1], vodafone: [0] },
          // The 2021–22 vintage has no per-carrier technology split, so the
          // colour-coded 5G/4G map comparison is unavailable on this version.
          tech: { perCarrier: false },
          note:
            "Source: earlier ACCC Infrastructure RKR dataset (2021–2022). Note it predates Vodafone/TPG’s " +
            "regional expansion via the Optus network-sharing deal, so it understates Vodafone.",
        },
      },

      sitesService: SVC_SITES, // tower sites (2022), independent of the version toggle
      attributionHtml:
        'Coverage estimate &copy; Commonwealth of Australia ' +
        '(<a href="https://www.accc.gov.au/by-industry/telecommunications-and-internet/mobile-services-regulation/mobile-infrastructure-report" target="_blank" rel="noopener">ACCC Mobile Infrastructure Report / Infrastructure RKR</a>), ' +
        '<a href="https://creativecommons.org/licenses/by/2.5/au/" target="_blank" rel="noopener">CC BY 2.5 AU</a>',
    },

    // --- Geocoding: OpenStreetMap Nominatim (free, keyless). Usage policy: ---
    //   max 1 request/second, NO autocomplete, cache results, attribution required.
    geocoder: {
      url: "https://nominatim.openstreetmap.org/search",
      minIntervalMs: 1100,
      cachePrefix: "aucov:geo2:", // bump when the cached result shape changes
    },

    // --- Base map: OpenFreeMap vector tiles (openfreemap.org), rendered via
    //     MapLibre GL inside Leaflet (see map.js). Keyless, no registration, no
    //     usage limits, commercial use allowed. Data © OpenMapTiles / OpenStreetMap.
    //     Replaced CARTO Voyager, whose hosted tiles are enterprise/grant-only and
    //     NOT licensed for free public use. "liberty" keeps the old colourful feel;
    //     swap to ".../styles/positron" for a muted base if overlays need to pop.
    tiles: {
      style: "https://tiles.openfreemap.org/styles/liberty",
      attribution:
        '&copy; <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
        '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">&copy; OpenMapTiles</a> ' +
        'Data &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      // Raster fallback when WebGL/MapLibre is unavailable: OpenStreetMap standard
      // tiles (permitted for light, attributed, non-commercial use).
      fallbackUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      fallbackAttribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      maxZoom: 19,
    },

    overlayOpacity: 0.55,
    betweenSamples: 7, // intermediate points sampled along the A→B line (plus the 2 endpoints)
    sitesRadiusM: 5000,

    // --- The three mobile networks and the brands that ride them. ---
    networks: {
      telstra: {
        id: "telstra",
        label: "Telstra",
        mnoLike: "Telstr%", // matches "Telstr"/"Telstra" in the tower-sites MNO field
        swatch: "rgb(158,187,215)", // matches the official government map colour
        overlayColor: [0, 90, 181], // distinct colour for the multi-network map overlay
        // Colour-blind pattern mode: a distinct fill shape per technology, so every
        // network×technology combo is distinguishable by shape alone.
        hatch: { "4g": "esriSFSForwardDiagonal", "5g": "esriSFSBackwardDiagonal" }, // ╱ / ╲
        official: {
          name: "Telstra",
          url: "https://www.telstra.com.au/coverage-networks/our-coverage",
          note: 'Telstra’s checker accepts a typed address or a "latitude, longitude" pair.',
        },
        // Telstra is the one network where MVNOs may get LESS than the shaded footprint.
        wholesale: {
          name: "Telstra Wholesale coverage map",
          url: "https://www.telstrawholesale.com.au/products/mobiles/coverage.html",
        },
      },
      optus: {
        id: "optus",
        label: "Optus",
        mnoLike: "Optus%",
        swatch: "rgb(223,193,228)",
        overlayColor: [116, 186, 40], // Optus green (logo-inspired lime)
        hatch: { "4g": "esriSFSHorizontal", "5g": "esriSFSVertical" }, // — / |
        official: {
          name: "Optus",
          url: "https://www.optus.com.au/living-network/coverage",
          note: "Optus’s map has no address link — paste the coordinates into its search box.",
        },
      },
      vodafone: {
        id: "vodafone",
        label: "Vodafone (TPG)",
        mnoLike: "TPG%",
        swatch: "rgb(215,215,158)",
        overlayColor: [228, 40, 95], // Vodafone red-pink
        hatch: { "4g": "esriSFSDiagonalCross", "5g": "esriSFSCross" }, // ✕ / ＋(grid)
        official: {
          name: "Vodafone",
          url: "https://www.vodafone.com.au/network/coverage-checker",
          note: "Paste the coordinates into Vodafone’s search box.",
        },
      },
    },
  };
})();
