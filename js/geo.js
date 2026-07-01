/*
 * geo.js — pure geographic maths. No network, no DOM. Fully client-side.
 */
window.Geo = (function () {
  const R = 6371; // Earth radius, km
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;

  /** Great-circle distance between two {lat,lng} points, in kilometres. */
  function haversineKm(a, b) {
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  /**
   * n evenly-spaced intermediate points along the great-circle path from a→b
   * (endpoints excluded). Uses spherical interpolation so long routes stay on
   * the true shortest path rather than a naive lat/lng straight line.
   */
  function intermediatePoints(a, b, n) {
    const phi1 = toRad(a.lat),
      lam1 = toRad(a.lng),
      phi2 = toRad(b.lat),
      lam2 = toRad(b.lng);
    const d =
      2 *
      Math.asin(
        Math.sqrt(
          Math.sin((phi2 - phi1) / 2) ** 2 +
            Math.cos(phi1) * Math.cos(phi2) * Math.sin((lam2 - lam1) / 2) ** 2
        )
      );
    const pts = [];
    if (d === 0) {
      for (let i = 0; i < n; i++) pts.push({ lat: a.lat, lng: a.lng });
      return pts;
    }
    for (let i = 1; i <= n; i++) {
      const f = i / (n + 1);
      const A = Math.sin((1 - f) * d) / Math.sin(d);
      const B = Math.sin(f * d) / Math.sin(d);
      const x = A * Math.cos(phi1) * Math.cos(lam1) + B * Math.cos(phi2) * Math.cos(lam2);
      const y = A * Math.cos(phi1) * Math.sin(lam1) + B * Math.cos(phi2) * Math.sin(lam2);
      const z = A * Math.sin(phi1) + B * Math.sin(phi2);
      pts.push({
        lat: toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))),
        lng: toDeg(Math.atan2(y, x)),
      });
    }
    return pts;
  }

  /** Human-friendly distance string. */
  function fmtKm(km) {
    return km < 1 ? Math.round(km * 1000) + " m" : km.toFixed(1) + " km";
  }

  /** Coordinate string, 5 dp (~1 m). */
  function fmtLatLng(p) {
    return p.lat.toFixed(5) + ", " + p.lng.toFixed(5);
  }

  return { haversineKm, intermediatePoints, fmtKm, fmtLatLng };
})();
