/*
 * services.js — all network I/O.
 *   • geocode()      : address → coordinates (OpenStreetMap Nominatim)
 *   • isCovered()    : is a point inside a carrier's government coverage polygon?
 *   • nearbySites()  : mobile tower/base-station sites near a point, for a carrier
 *
 * All endpoints are keyless and CORS-open, so these run straight from the browser
 * on GitHub Pages with no backend.
 */
window.Services = (function () {
  const cfg = window.APP_CONFIG;

  // ---------------------------------------------------------------------------
  // Geocoding — Nominatim usage policy: ≤1 req/sec, no autocomplete, cache results.
  // ---------------------------------------------------------------------------
  let lastGeocodeAt = 0;

  function cacheGet(q) {
    try {
      const v = localStorage.getItem(cfg.geocoder.cachePrefix + q);
      return v ? JSON.parse(v) : null;
    } catch (e) {
      return null;
    }
  }
  function cacheSet(q, v) {
    try {
      localStorage.setItem(cfg.geocoder.cachePrefix + q, JSON.stringify(v));
    } catch (e) {
      /* storage full / unavailable — non-fatal */
    }
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Classify a Nominatim result by how precise its coordinate is.
  const PLACE_TYPES = [
    "city", "town", "village", "hamlet", "suburb", "neighbourhood",
    "locality", "isolated_dwelling", "quarter", "allotments", "borough",
  ];
  function precisionOf(r) {
    if (r.address && r.address.house_number) return "address"; // a specific street address
    // `addresstype` is the reliable discriminator: a town can be modelled as
    // class=boundary/type=administrative yet have addresstype "town" — distinct
    // from an LGA/shire whose addresstype is "administrative".
    var kind = r.addresstype || r.type;
    if (PLACE_TYPES.indexOf(kind) > -1) return "place"; // town/suburb point
    if (kind === "administrative" || r.class === "boundary") return "area"; // LGA/region centroid
    return "other"; // road, POI, etc.
  }
  function rankOf(r) {
    const p = precisionOf(r);
    return p === "address" ? 3 : p === "place" ? 2 : p === "other" ? 1 : 0; // "area" ranks worst
  }

  /**
   * Geocode an Australian address to {lat, lng, displayName, precision}.
   * Asks Nominatim for several candidates and prefers a precise address or a
   * town/suburb POINT over an administrative-boundary CENTROID — typing a bare
   * town name (e.g. "Cobar NSW") otherwise returns the shire centroid, which can
   * be tens of km from the town. Throws on failure.
   */
  async function geocode(query) {
    const q = query.trim().toLowerCase();
    if (!q) throw new Error("Please enter an address.");

    const cached = cacheGet(q);
    if (cached) return cached;

    // Serialise + throttle to honour Nominatim's 1 request/second limit.
    const wait = cfg.geocoder.minIntervalMs - (Date.now() - lastGeocodeAt);
    if (wait > 0) await sleep(wait);
    lastGeocodeAt = Date.now();

    const url =
      cfg.geocoder.url +
      "?format=jsonv2&limit=5&addressdetails=1&dedupe=1&countrycodes=au&q=" +
      encodeURIComponent(query.trim());

    let res;
    try {
      res = await fetch(url, { headers: { Accept: "application/json" } });
    } catch (e) {
      throw new Error("Could not reach the address lookup service. Check your connection.");
    }
    if (!res.ok) throw new Error("Address lookup failed (HTTP " + res.status + ").");
    const data = await res.json();
    if (!data.length) throw new Error('No Australian address found for "' + query.trim() + '".');

    // Pick the most precise candidate; ties keep Nominatim's own (importance) order.
    let best = data[0], bestRank = rankOf(data[0]);
    for (let i = 1; i < data.length; i++) {
      const rk = rankOf(data[i]);
      if (rk > bestRank) { best = data[i]; bestRank = rk; }
    }

    const r = {
      lat: parseFloat(best.lat),
      lng: parseFloat(best.lon),
      displayName: best.display_name,
      precision: precisionOf(best),
    };
    cacheSet(q, r);
    return r;
  }

  // ---------------------------------------------------------------------------
  // Coverage — point-in-polygon against the chosen data version's layer(s).
  // `layerIds` may hold more than one layer (e.g. Vodafone/TPG own network +
  // its coverage on Optus under MOCN); covered if the point is inside ANY.
  // ---------------------------------------------------------------------------
  async function isCovered(service, layerIds, pt) {
    async function inLayer(id) {
      const url =
        service + "/" + id + "/query?geometry=" + pt.lng + "%2C" + pt.lat +
        "&geometryType=esriGeometryPoint&inSR=4326" +
        "&spatialRel=esriSpatialRelIntersects&returnCountOnly=true&f=json";
      const res = await fetch(url);
      if (!res.ok) throw new Error("Coverage service error (HTTP " + res.status + ").");
      const data = await res.json();
      if (data.error) throw new Error("Coverage service error.");
      return (data.count || 0) > 0;
    }
    const results = await Promise.all(layerIds.map(inLayer));
    return results.some(Boolean);
  }

  // ---------------------------------------------------------------------------
  // Mobile tower sites inside a map viewport (bounds = {west,south,east,north}).
  // `mnoLike` filters to one carrier (e.g. "Telstr%"); null = all carriers.
  // Intended to be called only when the map is zoomed in (bounded area).
  // ---------------------------------------------------------------------------
  async function sitesInBounds(bounds, mnoLike, maxRecords) {
    const envelope = bounds.west + "," + bounds.south + "," + bounds.east + "," + bounds.north;
    const where = mnoLike ? "MNO LIKE '" + mnoLike + "'" : "1=1";
    const url =
      cfg.gov.sitesService +
      "/0/query?geometry=" + encodeURIComponent(envelope) +
      "&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&where=" +
      encodeURIComponent(where) +
      "&outFields=MNO,LTE700,NR3500&returnGeometry=true&outSR=4326&resultRecordCount=" +
      (maxRecords || 800) + "&f=json";

    const res = await fetch(url);
    if (!res.ok) throw new Error("Sites service error (HTTP " + res.status + ").");
    const data = await res.json();
    return (data.features || [])
      .filter((f) => f.geometry)
      .map((f) => ({
        lat: f.geometry.y,
        lng: f.geometry.x,
        mno: f.attributes.MNO,
        has5G: f.attributes.NR3500 === "Y",
        has4G: f.attributes.LTE700 === "Y",
      }));
  }

  return { geocode, isCovered, sitesInBounds };
})();
