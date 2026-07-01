/*
 * map.js — Leaflet map + the government coverage overlays.
 *
 * The map is a visual ENHANCEMENT: the text results panel is the source of
 * truth, so the map failing (offline, blocked, JS-less) never hides the answer.
 *
 * Each active layer (a network×technology combo) is its OWN viewport-following
 * ArcGIS `export` image overlay, keyed by id. Toggling a layer off just removes
 * that one overlay (instant); toggling on fetches only that layer; layers that
 * didn't change are never re-requested. Each layer is recoloured/patterned via
 * an ArcGIS `dynamicLayers` renderer override.
 */
window.MapView = (function () {
  const cfg = window.APP_CONFIG;
  let map, markers, lines, sites;
  const overlays = {}; // key -> DynamicOverlay

  function init(elId) {
    map = L.map(elId, { zoomControl: true, scrollWheelZoom: true }).setView([-25.6, 134.4], 4);

    // Base map: OpenFreeMap vector tiles via MapLibre GL, wrapped as a Leaflet
    // layer so everything above it (image overlays, markers, lines) is unchanged.
    // If MapLibre/WebGL isn't available, fall back to OSM raster tiles; and if
    // even that fails the map just shows no base — the text results stay the
    // source of truth and the coverage overlays still render.
    function addRaster() {
      L.tileLayer(cfg.tiles.fallbackUrl, {
        attribution: cfg.tiles.fallbackAttribution,
        maxZoom: cfg.tiles.maxZoom,
      }).addTo(map);
    }
    if (L.maplibreGL && window.maplibregl) {
      var glLayer = L.maplibreGL({ style: cfg.tiles.style, attribution: cfg.tiles.attribution }).addTo(map);
      // Resilience: if the OpenFreeMap vector style can't load (host unreachable,
      // blocked, or offline) fall back to OSM raster tiles. Binding an `error`
      // handler ALSO suppresses MapLibre's default "Load failed" console spam —
      // it only logs to the console when nothing is listening.
      var fellBack = false;
      function toRaster() {
        if (fellBack) return;
        fellBack = true;
        try { map.removeLayer(glLayer); } catch (e) { /* already gone */ }
        addRaster();
      }
      try {
        var glMap = glLayer.getMaplibreMap && glLayer.getMaplibreMap();
        if (glMap) {
          // Fall back only when the base STYLE never loaded — not for a stray tile miss.
          glMap.on("error", function () { if (!glMap.isStyleLoaded()) toRaster(); });
        }
      } catch (e) { /* no handle yet — the timeout below still covers us */ }
      // Safety net: if the vector style still isn't up after a few seconds, use raster.
      setTimeout(function () {
        try {
          var m = glLayer.getMaplibreMap && glLayer.getMaplibreMap();
          if (!(m && m.isStyleLoaded())) toRaster();
        } catch (e) { toRaster(); }
      }, 7000);
    } else {
      addRaster();
    }

    markers = L.layerGroup().addTo(map);
    lines = L.layerGroup().addTo(map);
    sites = L.layerGroup().addTo(map);
    return map;
  }

  // One recoloured/patterned layer, following the viewport.
  const DynamicOverlay = L.Layer.extend({
    initialize: function (service, dynamic, zIndex) {
      this._service = service;
      this._dynamic = dynamic;
      this._z = zIndex || 400;
      this._img = null;
      this._lastUrl = null;
    },
    onAdd: function (m) {
      this._map = m;
      this._bound = this._update.bind(this);
      m.on("moveend zoomend resize", this._bound);
      this._update();
    },
    onRemove: function (m) {
      m.off("moveend zoomend resize", this._bound);
      this._clear();
    },
    setSource: function (service, dynamic) {
      this._service = service;
      this._dynamic = dynamic;
      this._lastUrl = null;
      if (this._map) this._update();
    },
    _clear: function () {
      if (this._img && this._map) this._map.removeLayer(this._img);
      this._img = null;
    },
    _update: function () {
      const m = this._map;
      const size = m.getSize();
      if (!size.x || !size.y) return; // container not laid out yet
      const b = m.getBounds();
      const nw = m.options.crs.project(b.getNorthWest());
      const se = m.options.crs.project(b.getSouthEast());
      const bbox = [
        Math.min(nw.x, se.x), Math.min(nw.y, se.y),
        Math.max(nw.x, se.x), Math.max(nw.y, se.y),
      ].join(",");
      const url =
        this._service + "/export?bbox=" + bbox +
        "&bboxSR=3857&imageSR=3857&size=" + Math.round(size.x) + "," + Math.round(size.y) +
        "&format=png32&transparent=true&dpi=96&dynamicLayers=" +
        encodeURIComponent(JSON.stringify(this._dynamic)) + "&f=image";

      if (url === this._lastUrl) return; // same view + spec — nothing to fetch
      this._lastUrl = url;

      const prev = this._img;
      const next = L.imageOverlay(url, b, { opacity: 0.9, interactive: false, pane: "overlayPane", zIndex: this._z });
      const drop = () => { if (prev && m) m.removeLayer(prev); };
      next.on("load", drop);
      next.on("error", drop);
      next.addTo(m);
      this._img = next;
    },
  });

  /**
   * Reconcile the set of overlays to `list` = [{key, service, dynamic, zIndex}].
   * Only added/removed/changed layers touch the network; unchanged ones are left
   * exactly as they are.
   */
  function setLayers(list) {
    const want = {};
    list.forEach((l) => (want[l.key] = l));

    Object.keys(overlays).forEach((k) => {
      if (!want[k]) { map.removeLayer(overlays[k]); delete overlays[k]; }
    });

    list.forEach((l) => {
      const specStr = JSON.stringify(l.dynamic);
      if (overlays[l.key]) {
        if (overlays[l.key]._specStr !== specStr) {
          overlays[l.key]._specStr = specStr;
          overlays[l.key].setSource(l.service, l.dynamic);
        }
      } else {
        const o = new DynamicOverlay(l.service, l.dynamic, l.zIndex);
        o._specStr = specStr;
        overlays[l.key] = o;
        o.addTo(map);
      }
    });
  }

  /** Place labelled pin markers. points = [{lat,lng,label}]. */
  function setPoints(points) {
    markers.clearLayers();
    points.forEach((p) => {
      L.marker([p.lat, p.lng], { title: p.label, alt: p.label, keyboard: true })
        .bindPopup(p.label)
        .addTo(markers);
    });
  }

  /** Straight dashed A→B line, or clear it when either point is missing. */
  function setLine(a, b) {
    lines.clearLayers();
    if (a && b) {
      L.polyline([[a.lat, a.lng], [b.lat, b.lng]], { color: "#1a1a1a", weight: 2, dashArray: "6 6" }).addTo(lines);
    }
  }

  /** Plot tower sites (each may carry its own `color`, e.g. by carrier). */
  function setSites(list) {
    sites.clearLayers();
    list.forEach((s) => {
      const col = s.color || "#c1121f";
      L.circleMarker([s.lat, s.lng], {
        radius: 4, color: "#333", weight: 0.6, fillColor: col, fillOpacity: 0.9,
      })
        .bindPopup((s.mno || "Site") + " site" + (s.has5G ? " · 5G" : s.has4G ? " · 4G" : ""))
        .addTo(sites);
    });
  }
  function clearSites() { sites.clearLayers(); }

  /** Current zoom level. */
  function getZoom() { return map ? map.getZoom() : 0; }
  /** Current view bounds as {west, south, east, north} in lat/lng. */
  function getViewBounds() {
    const b = map.getBounds();
    return { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
  }
  /** Register a callback for when the map stops moving/zooming. */
  function onMoveEnd(cb) { if (map) map.on("moveend", cb); }

  /** Fit the view to the given points. */
  function fit(points) {
    if (!points.length) return;
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 13);
    } else {
      map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])).pad(0.35));
    }
  }

  return { init, setLayers, setPoints, setLine, setSites, clearSites, fit, getZoom, getViewBounds, onMoveEnd };
})();
