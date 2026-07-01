/*
 * app.js — UI controller. Wires the form, the network toggles and the advanced
 * layers to the services + map, and renders the accessible, text-first results.
 *
 * On each check it queries ALL THREE networks so the difference is visible at a
 * glance in a comparison table. Switching the network toggle afterwards is
 * instant — it only swaps the map overlay and the focused detail cards; the
 * coverage is already computed, so there is no re-query lag.
 */
(function () {
  const cfg = window.APP_CONFIG;
  const NET_IDS = Object.keys(cfg.networks);
  const state = { A: null, B: null, results: null }; // results[netId] = {a, b, between}

  // --- DOM refs ---
  const form = document.getElementById("coverage-form");
  const addrA = document.getElementById("addrA");
  const addrB = document.getElementById("addrB");
  const submitBtn = document.getElementById("submitBtn");
  const statusEl = document.getElementById("status");
  const resultsEl = document.getElementById("results");
  const legendEl = document.getElementById("legend");
  const mapSection = document.getElementById("map-section");
  const sitesToggle = document.getElementById("sites-toggle");
  const sitesInfo = document.getElementById("sites-info");

  let mapReady = false;

  // --- small DOM helpers ---
  function el(tag, props, children) {
    const n = document.createElement(tag);
    if (props) for (const k in props) {
      if (k === "class") n.className = props[k];
      else if (k === "text") n.textContent = props[k];
      else if (k === "html") n.innerHTML = props[k];
      else n.setAttribute(k, props[k]);
    }
    (children || []).forEach((c) => n.appendChild(c));
    return n;
  }
  function announce(msg) { statusEl.textContent = msg; }
  // Layer toggle buttons: the network coverage buttons plus the advanced 5G/4G
  // buttons, each an aria-pressed <button>. They drive the map overlay directly.
  function pressedToggles() {
    return [].slice.call(
      document.querySelectorAll('.net-toggle[aria-pressed="true"], .tech-toggle[aria-pressed="true"]')
    );
  }
  // Networks with any layer toggled on, in canonical (config) order.
  function activeNetIds() {
    const on = {};
    pressedToggles().forEach((b) => (on[b.getAttribute("data-net")] = true));
    return NET_IDS.filter((id) => on[id]);
  }
  function currentVersion() {
    const r = document.querySelector('input[name="dataversion"]:checked');
    return cfg.gov.versions[r ? r.value : cfg.gov.defaultVersion];
  }
  function updateVersionNote() {
    const n = document.getElementById("data-footnote");
    if (!n) return;
    const v = currentVersion();
    n.innerHTML =
      '<sup>†</sup> Coverage layer (<strong>' + v.vintage + '</strong> data): ' + v.note +
      ' Served via <a href="https://spatial.infrastructure.gov.au" target="_blank" rel="noopener">spatial.infrastructure.gov.au</a> ' +
      '(ACCC), licensed <a href="https://creativecommons.org/licenses/by/2.5/au/" target="_blank" rel="noopener">CC BY 2.5 AU</a>.';
  }
  function setBusy(b) {
    submitBtn.disabled = b;
    submitBtn.textContent = b ? "Checking…" : "Check coverage";
    resultsEl.setAttribute("aria-busy", b ? "true" : "false");
  }

  // --- coverage lookup that never throws (so one failure can't blank the page) ---
  async function safeCovered(net, pt) {
    const v = currentVersion();
    try {
      return { covered: await window.Services.isCovered(v.service, v.layers[net.id], pt), error: null };
    } catch (e) {
      return { covered: null, error: e.message };
    }
  }

  // --- compute one network's coverage for the current address(es) ---
  async function computeNetwork(net) {
    const a = await safeCovered(net, state.A);
    let b = null, between = null;
    if (state.B) {
      b = await safeCovered(net, state.B);
      const pts = [state.A]
        .concat(window.Geo.intermediatePoints(state.A, state.B, cfg.betweenSamples))
        .concat([state.B]);
      const rs = await Promise.all(pts.map((p) => safeCovered(net, p)));
      let covered = 0, failed = 0;
      rs.forEach((r) => (r.covered === null ? failed++ : r.covered && covered++));
      between = { covered: covered, total: pts.length - failed };
    }
    return { a: a, b: b, between: between };
  }

  // --- comparison table (all networks side by side) ---
  function cellState(res) {
    if (!res || res.covered === null) return { sym: "⚠", text: "Unknown", cls: "c-unknown" };
    if (res.covered) return { sym: "✓", text: "Covered", cls: "c-yes" };
    return { sym: "✕", text: "No", cls: "c-no" };
  }

  function renderComparison() {
    const table = el("table", { class: "compare" });
    const dist = state.B ? window.Geo.fmtKm(window.Geo.haversineKm(state.A, state.B)) : null;
    table.appendChild(
      el("caption", {
        text:
          "Coverage comparison — open-gov estimate, " + currentVersion().vintage + " data" +
          (dist ? " · A→B straight line " + dist : ""),
      })
    );

    const hr = el("tr", {}, [el("th", { scope: "col", text: "Location" })]);
    NET_IDS.forEach((id) =>
      hr.appendChild(
        el("th", { scope: "col", "data-net": id, class: "net-col" }, [
          el("span", { class: "sw", "aria-hidden": "true", style: "background:rgba(" + cfg.networks[id].overlayColor.join(",") + ",0.8)" }),
          el("span", { text: " " + cfg.networks[id].label }),
        ])
      )
    );
    table.appendChild(el("thead", {}, [hr]));

    const tb = el("tbody");
    function row(label, sublabel, getter) {
      const th = el("th", { scope: "row" }, [document.createTextNode(label)]);
      if (sublabel) th.appendChild(el("span", { class: "muted", text: " " + sublabel }));
      const tr = el("tr", {}, [th]);
      NET_IDS.forEach((id) => tr.appendChild(getter(id)));
      tb.appendChild(tr);
    }

    row("Address A", "", (id) => {
      const c = cellState(state.results[id].a);
      return el("td", { "data-net": id, class: "cmp " + c.cls }, [
        el("span", { class: "sym", "aria-hidden": "true", text: c.sym + " " }),
        el("span", { text: c.text }),
      ]);
    });

    if (state.B) {
      row("Address B", "", (id) => {
        const c = cellState(state.results[id].b);
        return el("td", { "data-net": id, class: "cmp " + c.cls }, [
          el("span", { class: "sym", "aria-hidden": "true", text: c.sym + " " }),
          el("span", { text: c.text }),
        ]);
      });
      row("Between", "(sampled)", (id) => {
        const bt = state.results[id].between;
        const ok = bt && bt.total > 0;
        return el("td", { "data-net": id, class: "cmp c-count" }, [
          el("span", { text: ok ? bt.covered + " / " + bt.total : "—" }),
        ]);
      });
    }
    table.appendChild(tb);
    return el("div", { id: "compare-wrap", class: "table-wrap" }, [table]);
  }

  function highlightColumns(netIds) {
    const set = netIds || [];
    const cells = document.querySelectorAll("#compare-wrap [data-net]");
    cells.forEach((c) => c.classList.toggle("sel", set.indexOf(c.getAttribute("data-net")) > -1));
  }

  function mvnoNote() {
    return el("p", {
      class: "note mvno",
      html:
        "<strong>Network vs MVNO:</strong> Optus and Vodafone (TPG) MVNOs get the <em>same</em> " +
        "coverage as the network. Most <strong>Telstra</strong> MVNOs use the smaller " +
        '<a href="' + cfg.networks.telstra.wholesale.url + '" target="_blank" rel="noopener">Telstra Wholesale</a> ' +
        "footprint (less than shown here) — Boost is the exception.",
    });
  }

  // --- focused detail card(s) for the selected network (from cached results) ---
  function verdictCard(net, label, pt, res) {
    let symbol, verdict, cls;
    if (!res || res.covered === null) { symbol = "⚠"; verdict = "Coverage estimate unavailable"; cls = "v-unknown"; }
    else if (res.covered) { symbol = "✓"; verdict = "Appears covered"; cls = "v-yes"; }
    else { symbol = "✕"; verdict = "No coverage in the estimate"; cls = "v-no"; }

    const card = el("article", { class: "card " + cls });
    card.appendChild(el("h3", { text: net.label + " — " + label }));
    card.appendChild(
      el("p", { class: "verdict" }, [
        el("span", { class: "sym", "aria-hidden": "true", text: symbol + " " }),
        el("span", { text: verdict }),
      ])
    );
    if (res && res.error) card.appendChild(el("p", { class: "muted", text: res.error }));
    card.appendChild(el("p", { class: "muted addr", text: pt.displayName }));

    const coordRow = el("p", { class: "coord" }, [
      el("span", { text: "Coordinates: " + window.Geo.fmtLatLng(pt) + " " }),
    ]);
    const copyBtn = el("button", { type: "button", class: "copy" }, [document.createTextNode("Copy")]);
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(window.Geo.fmtLatLng(pt));
        copyBtn.textContent = "Copied ✓";
        setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
      } catch (e) { copyBtn.textContent = "Copy failed"; }
    });
    coordRow.appendChild(copyBtn);
    card.appendChild(coordRow);

    const links = el("p", { class: "links" }, [
      el("a", { href: net.official.url, target: "_blank", rel: "noopener", class: "official",
        text: "Open the official " + net.official.name + " coverage map ↗" }),
    ]);
    card.appendChild(links);
    if (net.wholesale) {
      card.appendChild(
        el("p", { class: "links" }, [
          el("a", { href: net.wholesale.url, target: "_blank", rel: "noopener",
            text: net.wholesale.name + " (for most Telstra MVNOs) ↗" }),
        ])
      );
    }
    card.appendChild(el("p", { class: "note", text: net.official.note }));
    return card;
  }

  function betweenCard(net) {
    const bt = state.results[net.id].between;
    const dist = window.Geo.fmtKm(window.Geo.haversineKm(state.A, state.B));
    const card = el("article", { class: "card v-between" });
    card.appendChild(el("h3", { text: "Between the two addresses" }));
    card.appendChild(el("p", { text: "Straight-line distance: " + dist + "." }));
    if (bt && bt.total > 0) {
      card.appendChild(el("p", { class: "verdict",
        text: bt.covered + " of " + bt.total + " points sampled along the straight line appear covered by " + net.label + "." }));
    } else {
      card.appendChild(el("p", { class: "muted", text: "Could not sample coverage along the route right now." }));
    }
    card.appendChild(el("p", { class: "note",
      text: "Sampling follows the direct line between the two points, not the road route." }));
    return card;
  }

  function renderFocused() {
    const ids = activeNetIds();
    const host = document.getElementById("focused");
    host.innerHTML = "";
    if (!ids.length) {
      // Nothing toggled — still give the authoritative hand-off to every carrier.
      host.appendChild(el("p", { class: "focus-h",
        text: "Toggle a network on the map for its full detail, or open an official coverage map:" }));
      const links = el("p", { class: "links" });
      NET_IDS.forEach((id, i) => {
        if (i) links.appendChild(document.createTextNode("   ·   "));
        links.appendChild(el("a", { href: cfg.networks[id].official.url, target: "_blank",
          rel: "noopener", text: cfg.networks[id].official.name + " ↗" }));
      });
      host.appendChild(links);
      host.appendChild(el("p", { class: "note",
        text: "Coordinates — A: " + window.Geo.fmtLatLng(state.A) +
          (state.B ? "   ·   B: " + window.Geo.fmtLatLng(state.B) : "") }));
      return;
    }
    ids.forEach((id) => {
      const net = cfg.networks[id];
      host.appendChild(el("h3", { class: "focus-h", text: "Details — " + net.label }));
      host.appendChild(verdictCard(net, "Address A", state.A, state.results[net.id].a));
      if (state.B) {
        host.appendChild(verdictCard(net, "Address B", state.B, state.results[net.id].b));
        host.appendChild(betweenCard(net));
      }
    });
  }

  function word(res) { return !res || res.covered === null ? "unknown" : res.covered ? "covered" : "no coverage"; }
  function summaryAll() {
    return "Address A — " + NET_IDS.map((id) => cfg.networks[id].label + " " + word(state.results[id].a)).join(", ") + ".";
  }

  // --- map helpers ---
  function placeMap() {
    if (!mapReady) return;
    const pts = [Object.assign({ label: "Address A" }, state.A)];
    if (state.B) pts.push(Object.assign({ label: "Address B" }, state.B));
    try {
      window.MapView.setPoints(pts);
      window.MapView.setLine(state.A, state.B);
      window.MapView.fit(pts);
    } catch (e) { /* map optional */ }
  }
  // --- map coverage overlay (driven by the layer toggle buttons) ---

  // Colour/pattern encoding: hue = network; technology = shade (colour mode) or a
  // diagonal hatch (colour-blind pattern mode: 4G ╱, 5G ╲, so overlap reads as ╳).
  function patternMode() {
    const cb = document.getElementById("cb-patterns");
    return !!(cb && cb.checked);
  }
  function lighten(rgb, f) {
    return [Math.round(rgb[0] + (255 - rgb[0]) * f),
            Math.round(rgb[1] + (255 - rgb[1]) * f),
            Math.round(rgb[2] + (255 - rgb[2]) * f)];
  }
  // Symbol for a {network, technology}. In pattern mode the FILL SHAPE encodes the
  // exact network×technology combo (config `network.hatch[col]`), so every combo is
  // distinguishable by shape alone (colour still groups by network); total coverage
  // stays solid. In colour mode everything is solid: hue = network, shade = technology.
  function styleFor(netId, col, pattern) {
    const net = cfg.networks[netId];
    const base = net.overlayColor;
    const z = col === "5g" ? 430 : col === "4g" ? 410 : 420;
    if (pattern) {
      const style = col === "coverage" ? "esriSFSSolid" : ((net.hatch && net.hatch[col]) || "esriSFSSolid");
      return { style: style, rgb: base, a: col === "coverage" ? 205 : 235, z: z };
    }
    if (col === "5g") return { style: "esriSFSSolid", rgb: base, a: 165, z: z };
    if (col === "4g") return { style: "esriSFSSolid", rgb: lighten(base, 0.5), a: 150, z: z };
    return { style: "esriSFSSolid", rgb: base, a: 110, z: z };
  }
  function symbolFor(st) {
    return { type: "esriSFS", style: st.style, color: [st.rgb[0], st.rgb[1], st.rgb[2], st.a],
      outline: { type: "esriSLS", style: "esriSLSSolid",
        color: [st.rgb[0], st.rgb[1], st.rgb[2], Math.min(255, st.a + 60)], width: 0.4 } };
  }

  // One keyed overlay spec per active {net,col} — so the map can add/remove them
  // independently and never re-render a layer that didn't change.
  function buildLayerSpecs(v, active, pattern) {
    return active.map((c) => {
      const ids = c.col === "coverage"
        ? (v.layers[c.net] || [])
        : (v.tech.perCarrier ? (v.tech.byNetwork[c.net] || {})[c.col] || [] : []);
      const st = styleFor(c.net, c.col, pattern);
      const sym = symbolFor(st);
      const dynamic = ids.map((lid, i) => ({
        id: i + 1, source: { type: "mapLayer", mapLayerId: lid },
        drawingInfo: { renderer: { type: "simple", symbol: sym } },
      }));
      return { key: c.net + "-" + c.col, service: v.service, dynamic: dynamic, zIndex: st.z };
    }).filter((l) => l.dynamic.length);
  }

  // Which layers the map draws: exactly the toggled buttons (network coverage +
  // any 5G/4G). Nothing toggled → a clean map to explore.
  function activeLayers() {
    return pressedToggles().map((b) => ({ net: b.getAttribute("data-net"), col: b.getAttribute("data-col") }));
  }

  function updateOverlay() {
    const layers = activeLayers();
    const pattern = patternMode();
    if (mapReady) {
      try { window.MapView.setLayers(buildLayerSpecs(currentVersion(), layers, pattern)); } catch (e) { /* map optional */ }
    }
    renderLegend(layers, pattern);
  }

  // 5G/4G layers only exist in the 2025 data; disable those toggles otherwise.
  function updateTechAvailability() {
    const perCarrier = currentVersion().tech.perCarrier;
    document.querySelectorAll(".tech-toggle").forEach((b) => {
      b.disabled = !perCarrier;
      if (!perCarrier) b.setAttribute("aria-pressed", "false");
    });
    const note = document.getElementById("matrix-note");
    if (note) note.textContent = perCarrier
      ? "Tap 5G or 4G for any network — layers overlap in each network’s colour."
      : "Per-network 5G/4G layers are only in the 2025 data — switch to 2025 to compare them.";
  }

  // --- query all networks for the current version + addresses, then render ---
  async function computeAndRender() {
    announce("Comparing Telstra, Optus and Vodafone (" + currentVersion().vintage + " data)…");
    const datas = await Promise.all(NET_IDS.map((id) => computeNetwork(cfg.networks[id])));
    state.results = {};
    NET_IDS.forEach((id, i) => (state.results[id] = datas[i]));
    renderAll();
  }

  // --- full render after a check ---
  function renderAll() {
    const v = currentVersion();
    resultsEl.innerHTML = "";
    resultsEl.appendChild(
      el("p", { class: "estimate-note", html:
        "Open Australian Government estimate — <strong>" + v.vintage + " data</strong>. " + v.note +
        " It is approximate and predictive; each carrier’s own map is the authoritative, current source." })
    );
    const pw = precisionWarn();
    if (pw) resultsEl.appendChild(pw);
    resultsEl.appendChild(renderComparison());
    resultsEl.appendChild(mvnoNote());
    resultsEl.appendChild(el("div", { id: "focused" }));
    renderFocused();
    highlightColumns(activeNetIds());
    placeMap(); // its moveend refreshes tower sites if the toggle is on
    updateOverlay();
    announce(summaryAll());
  }

  // --- nearby sites (advanced) ---
  const SITES_MIN_ZOOM = 11; // below this, too many sites to query/plot
  function mnoColor(mno) {
    const m = (mno || "").toLowerCase();
    if (m.indexOf("telstr") === 0) return "rgb(0,90,181)";
    if (m.indexOf("optus") === 0) return "rgb(116,186,40)";
    if (m.indexOf("tpg") === 0) return "rgb(228,40,95)";
    return "#c1121f";
  }
  // Tower sites for whatever is in the current map view — no address needed, and
  // only loaded once zoomed in enough to keep the query bounded.
  async function refreshSites() {
    if (!mapReady) return;
    if (!sitesToggle.checked) { window.MapView.clearSites(); sitesInfo.textContent = ""; return; }
    if (window.MapView.getZoom() < SITES_MIN_ZOOM) {
      window.MapView.clearSites();
      sitesInfo.textContent = "Zoom in on the map to load tower sites.";
      return;
    }
    const active = activeNetIds(); // filter to a single toggled carrier, else show all
    const net = active.length === 1 ? cfg.networks[active[0]] : null;
    sitesInfo.textContent = "Loading tower sites…";
    try {
      const list = await window.Services.sitesInBounds(window.MapView.getViewBounds(), net ? net.mnoLike : null);
      list.forEach((s) => (s.color = mnoColor(s.mno)));
      window.MapView.setSites(list);
      sitesInfo.textContent =
        list.length + (net ? " " + net.label : "") + " tower site" + (list.length === 1 ? "" : "s") +
        " in view (2022 data)" + (list.length >= 800 ? " — zoom in for more" : "") +
        (net ? "" : " · coloured by carrier");
    } catch (e) {
      sitesInfo.textContent = "Could not load sites: " + e.message;
    }
  }

  // Warn when a geocoded point is only an administrative-area centroid.
  function precisionWarn() {
    const flags = [];
    if (state.A && state.A.precision === "area") flags.push("A");
    if (state.B && state.B.precision === "area") flags.push("B");
    if (!flags.length) return null;
    return el("p", { class: "warn", text:
      "⚠ Address " + flags.join(" & ") + " matched an area (its centroid), not a specific street — " +
      "this can be far from the town. Enter a full street address for a precise result." });
  }

  // --- legend (mirrors whatever the overlay is drawing, in the same colours/shapes) ---
  function hatchCss(style, rgb) {
    const c = "rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")";
    switch (style) {
      case "esriSFSForwardDiagonal": return "background:repeating-linear-gradient(45deg," + c + " 0 1.5px,transparent 1.5px 5px)";
      case "esriSFSBackwardDiagonal": return "background:repeating-linear-gradient(-45deg," + c + " 0 1.5px,transparent 1.5px 5px)";
      case "esriSFSVertical": return "background:repeating-linear-gradient(90deg," + c + " 0 1.5px,transparent 1.5px 5px)";
      case "esriSFSHorizontal": return "background:repeating-linear-gradient(0deg," + c + " 0 1.5px,transparent 1.5px 5px)";
      case "esriSFSCross": return "background:repeating-linear-gradient(0deg," + c + " 0 1px,transparent 1px 5px),repeating-linear-gradient(90deg," + c + " 0 1px,transparent 1px 5px)";
      case "esriSFSDiagonalCross": return "background:repeating-linear-gradient(45deg," + c + " 0 1px,transparent 1px 5px),repeating-linear-gradient(-45deg," + c + " 0 1px,transparent 1px 5px)";
      default: return "background:rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",0.65)";
    }
  }
  function swatchStyle(net, col, pattern) {
    if (pattern) {
      const style = col === "coverage" ? "esriSFSSolid" : ((net.hatch && net.hatch[col]) || "esriSFSSolid");
      if (style === "esriSFSSolid") return "background:rgba(" + net.overlayColor.join(",") + ",0.6)";
      return hatchCss(style, net.overlayColor);
    }
    const base = net.overlayColor;
    const c = (col === "4g") ? lighten(base, 0.5) : base;
    return "background:rgba(" + c[0] + "," + c[1] + "," + c[2] + ",0.65)";
  }
  function renderLegend(layers, pattern) {
    layers = layers || activeLayers();
    if (pattern === undefined) pattern = patternMode();
    legendEl.innerHTML = "";
    layers.forEach((c) => {
      const net = cfg.networks[c.net];
      const lbl = net.label + " " + (c.col === "coverage" ? "coverage" : c.col.toUpperCase()) +
        " (" + currentVersion().vintage + ")";
      legendEl.appendChild(el("span", { class: "legend-item" }, [
        el("span", { class: "sw", style: swatchStyle(net, c.col, pattern) }),
        el("span", { text: lbl }),
      ]));
    });
    if (layers.length > 1) {
      legendEl.appendChild(el("span", { class: "legend-item muted",
        text: pattern ? "each shape = one network + technology" : "overlaps blend" }));
    }
  }

  // --- events ---
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const aRaw = addrA.value.trim();
    const bRaw = addrB.value.trim();
    if (!aRaw) { announce("Enter an address to check a specific location — or use the map layer toggles above to explore coverage."); addrA.focus(); return; }

    setBusy(true);
    announce("Finding address" + (bRaw ? "es" : "") + "…");
    try {
      const A = await window.Services.geocode(aRaw);
      const B = bRaw ? await window.Services.geocode(bRaw) : null;
      state.A = A;
      state.B = B;
      await computeAndRender();
    } catch (err) {
      state.A = null; state.B = null; state.results = null;
      resultsEl.innerHTML = "";
      resultsEl.appendChild(el("p", { class: "error", text: err.message }));
      resultsEl.appendChild(
        el("p", { class: "note" }, [
          document.createTextNode("You can still open the official maps: "),
          el("a", { href: cfg.networks.telstra.official.url, target: "_blank", rel: "noopener", text: "Telstra" }),
          document.createTextNode(", "),
          el("a", { href: cfg.networks.optus.official.url, target: "_blank", rel: "noopener", text: "Optus" }),
          document.createTextNode(", "),
          el("a", { href: cfg.networks.vodafone.official.url, target: "_blank", rel: "noopener", text: "Vodafone" }),
          document.createTextNode("."),
        ])
      );
      announce(err.message);
    } finally {
      setBusy(false);
    }
  });

  // Layer toggle buttons (network coverage + advanced 5G/4G): instant — they drive
  // the map overlay, the focused detail cards and the highlighted comparison columns.
  function onLayersChanged() {
    updateOverlay();
    if (state.results) {
      renderFocused();
      highlightColumns(activeNetIds());
    }
    if (sitesToggle.checked) refreshSites();
  }
  document.querySelectorAll(".net-toggle, .tech-toggle").forEach((btn) =>
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      btn.setAttribute("aria-pressed", btn.getAttribute("aria-pressed") === "true" ? "false" : "true");
      onLayersChanged();
    })
  );

  // Data version toggle: coverage differs by vintage, so this re-queries.
  document.querySelectorAll('input[name="dataversion"]').forEach((r) =>
    r.addEventListener("change", async () => {
      updateVersionNote();
      updateTechAvailability();
      updateOverlay(); // overlay service/layers differ per version
      if (state.A) {
        setBusy(true);
        try { await computeAndRender(); } finally { setBusy(false); }
      }
    })
  );

  const patternsBox = document.getElementById("cb-patterns");
  if (patternsBox) patternsBox.addEventListener("change", updateOverlay);

  sitesToggle.addEventListener("change", refreshSites);

  // Paint each toggle's colour swatch from config (single source of truth for the
  // overlay colours), so the buttons never drift from what the map actually draws.
  function paintSwatches() {
    document.querySelectorAll(".net-toggle[data-net], .tech-net[data-net]").forEach((elm) => {
      const net = cfg.networks[elm.getAttribute("data-net")];
      const sw = elm.querySelector(".sw");
      if (net && sw) sw.style.background = "rgb(" + net.overlayColor.join(",") + ")";
    });
  }

  // --- boot ---
  paintSwatches();
  updateVersionNote();
  updateTechAvailability();
  try {
    window.MapView.init("map");
    mapReady = true;
    // Re-load tower sites (if toggled on) whenever the map view changes.
    window.MapView.onMoveEnd(() => { if (sitesToggle.checked) refreshSites(); });
  } catch (e) {
    if (mapSection) mapSection.hidden = true;
  }
  updateOverlay(); // initial overlay (nothing toggled = clean map) + map legend
})();
