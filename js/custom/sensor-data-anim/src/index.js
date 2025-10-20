/*
  Sensor Data Animation (vanilla JS)
  - Animates pedestrian counts per sensor over time (15 min intervals)
  - Circles: activity level -> size and color (yellow -> red)
  - Missing data (value === -1): gray X marker with constant size
  - Exposes window.SensorAnim.mount(selectorOrEl)
*/
(function () {
  console.debug("[SensorAnim] bundle executing");
  const DATA_URL = "js/custom/sensor-data-anim/data/animation_data.geojson";

  const mounts = new Map();
  let cached = null; // { frames: Map<string, Feature[]>, times: string[], bbox, minVal, maxVal, sensors }

  function injectStylesOnce() {
    if (document.getElementById("sensor-anim-styles")) return;
    const style = document.createElement("style");
    style.id = "sensor-anim-styles";
    style.textContent = `
      .sensor-anim-root { display: grid; grid-template-rows: auto 1fr auto; gap: 6px; height: 100%; font-family: var(--r-main-font, system-ui, -apple-system, Segoe UI, Roboto, sans-serif); color: var(--r-main-color, #222); }
      .sensor-anim-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; background: rgba(255,255,255,0.7); padding: 6px 8px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); font-size: 12px; }
      .sensor-anim-controls .btn { padding: 6px 10px; border: 0; border-radius: 6px; background: #ef4444; color: #fff; font-weight: 600; cursor: pointer; }
      .sensor-anim-controls .btn[aria-pressed="true"] { background: #f97316; }
      .sensor-anim-controls .btn:disabled { opacity: 0.6; cursor: not-allowed; }
      .sensor-anim-controls .group { display: inline-flex; align-items: center; gap: 4px; }
      .sensor-anim-controls input[type="range"] { width: 260px; }
      .sensor-anim-canvas-wrap { position: relative; background: #fafafa; border-radius: 10px; overflow: hidden; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.05); }
      .sensor-anim-overlay { position: absolute; left: 8px; top: 8px; background: rgba(255,255,255,0.85); padding: 4px 8px; border-radius: 6px; font-size: 12px; box-shadow: 0 2px 6px rgba(0,0,0,0.05); }
      .sensor-anim-legend { display: flex; align-items: center; gap: 16px; background: rgba(255,255,255,0.7); padding: 6px 10px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); font-size: 12px; }
      .legend-gradient { width: 160px; height: 12px; border-radius: 999px; background: linear-gradient(90deg, #fde047 0%, #f59e0b 50%, #ef4444 100%); box-shadow: inset 0 0 0 1px rgba(0,0,0,0.1); }
      .legend-item { display: inline-flex; align-items: center; gap: 6px; }
      .legend-x { width: 14px; height: 14px; position: relative; }
      .legend-x::before, .legend-x::after { content: ""; position: absolute; left: 6px; top: 1px; width: 2px; height: 12px; background: #9ca3af; border-radius: 1px; }
      .legend-x::before { transform: rotate(45deg); }
      .legend-x::after { transform: rotate(-45deg); }
      .sensor-anim-mount { width: 80%; height: 100%; align-self: center; justify-self: center;}
    `;
    document.head.appendChild(style);
  }

  async function loadData() {
    if (cached) return cached;
    console.debug("[SensorAnim] loadData: fetching", DATA_URL);
    const res = await fetch(DATA_URL);
    if (!res.ok) {
      console.error("[SensorAnim] fetch failed", res.status, res.statusText);
      throw new Error(`Failed to load ${DATA_URL}: ${res.status}`);
    }
    const gj = await res.json();
    console.debug(
      "[SensorAnim] loadData: features",
      Array.isArray(gj.features) ? gj.features.length : 0
    );

    const frames = new Map(); // dt -> features[]
    const sensors = new Map(); // normalized lon/lat key -> {lon, lat}
    let minLon = Infinity,
      maxLon = -Infinity,
      minLat = Infinity,
      maxLat = -Infinity;
    let minVal = Infinity,
      maxVal = -Infinity;

    const feats = gj.features || [];
    for (const f of feats) {
      const p = f.properties || {};
      const g = f.geometry || {};
      const dt = String(p.dt);
      const lonRaw = (g.coordinates && g.coordinates[0]) ?? p.lon;
      const latRaw = (g.coordinates && g.coordinates[1]) ?? p.lat;
      const lon = Number(lonRaw);
      const lat = Number(latRaw);
      const value = typeof p.value === "number" ? p.value : Number(p.value);
      // Build a stable key from coordinates to avoid collapsing multiple sensors with same label
      const normLon = isFinite(lon) ? Number(lon.toFixed(6)) : null;
      const normLat = isFinite(lat) ? Number(lat.toFixed(6)) : null;
      const sensorKey =
        normLon !== null && normLat !== null
          ? `${normLon},${normLat}`
          : `${lonRaw},${latRaw}`;
      if (!frames.has(dt)) frames.set(dt, []);
      frames.get(dt).push({ lon, lat, value, sensorKey });

      if (!sensors.has(sensorKey) && isFinite(lon) && isFinite(lat))
        sensors.set(sensorKey, { lon, lat });
      if (isFinite(lon) && isFinite(lat)) {
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
      }
      if (typeof value === "number" && value >= 0) {
        minVal = Math.min(minVal, value);
        maxVal = Math.max(maxVal, value);
      }
    }

    const times = Array.from(frames.keys()).sort(
      (a, b) => new Date(a) - new Date(b)
    );
    console.debug("[SensorAnim] loadData: unique timestamps", times.length);
    if (!isFinite(minVal) || !isFinite(maxVal)) {
      minVal = 0;
      maxVal = 1;
    }

    // Fallback if bbox is invalid
    if (
      !isFinite(minLon) ||
      !isFinite(maxLon) ||
      !isFinite(minLat) ||
      !isFinite(maxLat)
    ) {
      for (const v of sensors.values()) {
        if (!isFinite(v.lon) || !isFinite(v.lat)) continue;
        minLon = Math.min(minLon, v.lon);
        maxLon = Math.max(maxLon, v.lon);
        minLat = Math.min(minLat, v.lat);
        maxLat = Math.max(maxLat, v.lat);
      }
    }

    cached = {
      frames,
      times,
      bbox: { minLon, maxLon, minLat, maxLat },
      minVal,
      maxVal,
      sensors,
    };
    return cached;
  }

  function createScaler(bbox, width, height, padding = 24) {
    const lonSpan = bbox.maxLon - bbox.minLon || 1;
    const latSpan = bbox.maxLat - bbox.minLat || 1;
    const innerW = Math.max(1, width - 2 * padding);
    const innerH = Math.max(1, height - 2 * padding);
    // preserve aspect by fitting to the smaller scale
    const sx = innerW / lonSpan;
    const sy = innerH / latSpan;
    const s = Math.min(sx, sy);
    const extraX = innerW - s * lonSpan;
    const extraY = innerH - s * latSpan;
    const offsetX = padding + extraX / 2;
    const offsetY = padding + extraY / 2;

    return {
      x: (lon) => offsetX + (lon - bbox.minLon) * s,
      y: (lat) => height - (offsetY + (lat - bbox.minLat) * s), // invert Y
    };
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function clamp01(t) {
    return Math.max(0, Math.min(1, t));
  }
  function valueToColor(v, minV, maxV) {
    if (maxV <= minV) return "#ef4444"; // red
    const t = clamp01((v - minV) / (maxV - minV));
    const hue = lerp(50, 0, t); // 50=yellow -> 0=red
    // Use CSS Color 3 compatible comma syntax for broader support
    return "hsl(" + hue + ",95%,50%)";
  }

  // Web Mercator helpers for basemap tiles and zoom selection
  function lonLatToMercatorPx(lon, lat, z) {
    const tileSize = 256;
    const scale = tileSize * Math.pow(2, z);
    const x = ((lon + 180) / 360) * scale;
    const rad = (lat * Math.PI) / 180;
    const y =
      (0.5 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / (2 * Math.PI)) *
      scale;
    return { x, y };
  }
  function fitZoomForBbox(bbox, width, height, maxZoom = 18, minZoom = 2) {
    // binary search zoom to fit bbox in given pixel size with small margin
    const margin = 32; // px
    const w = Math.max(1, width - margin * 2);
    const h = Math.max(1, height - margin * 2);
    let lo = minZoom,
      hi = maxZoom,
      best = minZoom;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      const a = lonLatToMercatorPx(bbox.minLon, bbox.minLat, mid);
      const b = lonLatToMercatorPx(bbox.maxLon, bbox.maxLat, mid);
      const spanX = Math.abs(b.x - a.x);
      const spanY = Math.abs(b.y - a.y);
      if (spanX <= w && spanY <= h) {
        best = mid; // can zoom in more
        lo = mid;
      } else {
        hi = mid;
      }
    }
    return Math.floor(best);
  }

  function lon2tileX(lon, z) {
    return Math.floor(((lon + 180) / 360) * Math.pow(2, z));
  }
  function lat2tileY(lat, z) {
    const rad = (lat * Math.PI) / 180;
    return Math.floor(
      ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) *
        Math.pow(2, z)
    );
  }
  function tileX2lon(x, z) {
    return (x / Math.pow(2, z)) * 360 - 180;
  }
  function tileY2lat(y, z) {
    const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
    return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  }

  function computeSensorsBBox() {
    if (!cached) return null;
    let minLon = Infinity,
      maxLon = -Infinity,
      minLat = Infinity,
      maxLat = -Infinity;
    for (const { lon, lat } of cached.sensors.values()) {
      if (!isFinite(lon) || !isFinite(lat)) continue;
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
    if (
      !isFinite(minLon) ||
      !isFinite(maxLon) ||
      !isFinite(minLat) ||
      !isFinite(maxLat)
    )
      return null;
    return { minLon, maxLon, minLat, maxLat };
  }

  // Draw a simple lat/lon graticule grid and bbox outline for orientation
  function drawBackground(ctx, scaler, bbox, width, height, dpr) {
    if (!scaler || !bbox) return;
    // Do NOT fill a background here; it would cover basemap

    // Compute "nice" tick step aiming for ~6 lines per axis
    const computeStep = (span, target = 6) => {
      const raw = span / target;
      const pow10 = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-12))));
      const norm = raw / pow10;
      let stepNorm = 1;
      if (norm >= 5) stepNorm = 5;
      else if (norm >= 2) stepNorm = 2;
      else stepNorm = 1;
      return stepNorm * pow10;
    };
    const lonSpan = bbox.maxLon - bbox.minLon || 1;
    const latSpan = bbox.maxLat - bbox.minLat || 1;
    const lonStep = computeStep(lonSpan, 6);
    const latStep = computeStep(latSpan, 6);

    // Grid style
    ctx.save();
    ctx.strokeStyle = "rgba(2,6,23,0.12)"; // slightly more visible
    ctx.lineWidth = 1;

    // Vertical (longitude) lines
    let lonStart = Math.ceil(bbox.minLon / lonStep) * lonStep;
    for (let lon = lonStart; lon <= bbox.maxLon + 1e-12; lon += lonStep) {
      const x = scaler.x(lon);
      ctx.beginPath();
      ctx.moveTo(x, scaler.y(bbox.minLat));
      ctx.lineTo(x, scaler.y(bbox.maxLat));
      ctx.stroke();
    }

    // Horizontal (latitude) lines
    let latStart = Math.ceil(bbox.minLat / latStep) * latStep;
    for (let lat = latStart; lat <= bbox.maxLat + 1e-12; lat += latStep) {
      const y = scaler.y(lat);
      ctx.beginPath();
      ctx.moveTo(scaler.x(bbox.minLon), y);
      ctx.lineTo(scaler.x(bbox.maxLon), y);
      ctx.stroke();
    }

    // Labels: lon at bottom, lat at left
    ctx.fillStyle = "#334155"; // slate-700
    ctx.font = "10px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let lon = lonStart; lon <= bbox.maxLon + 1e-12; lon += lonStep) {
      const x = scaler.x(lon);
      const label =
        lon.toFixed(Math.max(0, -Math.floor(Math.log10(lonStep)))) + "°";
      ctx.fillText(label, x, Math.min(height - 12, scaler.y(bbox.minLat) + 4));
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let lat = latStart; lat <= bbox.maxLat + 1e-12; lat += latStep) {
      const y = scaler.y(lat);
      const label =
        lat.toFixed(Math.max(0, -Math.floor(Math.log10(latStep)))) + "°";
      ctx.fillText(label, Math.max(0, scaler.x(bbox.minLon) - 6), y);
    }
    ctx.restore();
  }

  // Draw only the data points (and X markers); assumes background already drawn
  function drawPoints(ctx, scaler, frame, minV, maxV, dpr, useLogScale) {
    const minR = 3 * dpr;
    const maxR = 14 * dpr;
    const xSize = 2 * dpr; // reduced half-length of X arms

    const linDen = maxV > minV ? maxV - minV : 1;
    const logMin = Math.log1p(Math.max(0, minV));
    const logMax = Math.log1p(Math.max(0, maxV));
    const logDen = logMax > logMin ? logMax - logMin : 1;

    for (const f of frame) {
      const lon = f.lon;
      const lat = f.lat;
      const x = scaler.x(lon);
      const y = scaler.y(lat);
      if (f.value < 0) {
        ctx.strokeStyle = "#9ca3af"; // gray-400
        ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath();
        ctx.moveTo(x - xSize, y - xSize);
        ctx.lineTo(x + xSize, y + xSize);
        ctx.moveTo(x + xSize, y - xSize);
        ctx.lineTo(x - xSize, y + xSize);
        ctx.stroke();
      } else {
        let t;
        if (useLogScale) {
          const lv = Math.log1p(Math.max(0, f.value));
          t = (lv - logMin) / logDen;
        } else {
          t = (f.value - minV) / linDen;
        }
        const r = minR + clamp01(t) * (maxR - minR);
        const fill = valueToColor(
          useLogScale ? Math.log1p(Math.max(0, f.value)) : f.value,
          useLogScale ? logMin : minV,
          useLogScale ? logMax : maxV
        );
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        // white halo for contrast
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 1.5 * dpr;
        ctx.stroke();
      }
    }
  }

  function mount(selectorOrEl) {
    console.debug("[SensorAnim] mount called with", selectorOrEl);
    const el =
      typeof selectorOrEl === "string"
        ? document.querySelector(selectorOrEl)
        : selectorOrEl;
    if (!el) {
      console.error("[SensorAnim] mount: container not found", selectorOrEl);
      return null;
    }
    console.debug("[SensorAnim] mount: container found", el);
    if (mounts.has(el)) return mounts.get(el);

    injectStylesOnce();

    el.classList.add("sensor-anim-mount");
    el.innerHTML = `
      <div class="sensor-anim-root">
        <div class="sensor-anim-controls">
          <button class="btn" data-role="play">Play</button>
          <div class="group">
            <label>Time:</label>
            <input type="range" min="0" max="0" value="0" step="1" data-role="slider" />
            <span data-role="time-label">--</span>
          </div>
          <div class="group">
            <label>Speed:</label>
            <select data-role="speed">
              <option value="1">1×</option>
              <option value="2">2×</option>
              <option value="4" selected>4×</option>
              <option value="8">8×</option>
              <option value="16">16×</option>
            </select>
          </div>
          <div class="group">
            <label><input type="checkbox" data-role="basemap" checked /> Basemap</label>
          </div>
          <div class="group">
            <label>Style:</label>
            <select data-role="style">
              <option value="light_nolabels" selected>Light (no labels)</option>
              <option value="light_all">Light (labels)</option>
              <option value="dark_all">Dark</option>
              <option value="voyager">Voyager</option>
            </select>
          </div>
          <div class="group">
            <label><input type="checkbox" data-role="tile-outlines" /> Tile outlines</label>
          </div>
          <div class="group">
            <label><input type="checkbox" data-role="sensors" /> Sensors</label>
          </div>
          <div class="group">
            <label><input type="checkbox" data-role="log-scale" /> Log scale</label>
          </div>
          <div class="group">
            <label><input type="checkbox" data-role="console-toggle" /> Debug logs</label>
          </div>
        </div>
        <div class="sensor-anim-canvas-wrap">
          <canvas></canvas>
          <div class="sensor-anim-overlay" data-role="overlay">Loading…</div>
          <div class="sensor-anim-overlay" style="right:8px; left:auto; bottom:8px; top:auto; opacity:0.9">© OpenStreetMap contributors</div>
          <div class="sensor-anim-overlay" data-role="console" style="right:8px; left:auto; top:8px; bottom:auto; max-width: 50%; max-height: 45%; overflow:auto; font-family: ui-monospace, Menlo, monospace; white-space: pre-wrap; opacity: 0.95; display:none"></div>
        </div>
        <div class="sensor-anim-legend">
          <div class="legend-item"><div class="legend-gradient"></div><span>Low → High activity</span></div>
          <div class="legend-item"><div class="legend-x"></div><span>Missing (value = -1)</span></div>
        </div>
      </div>
    `;

    const canvas = el.querySelector("canvas");
    if (!canvas) {
      console.error("[SensorAnim] mount: canvas not found in container");
    }
    const overlay = el.querySelector('[data-role="overlay"]');
    const consolePanel = el.querySelector('[data-role="console"]');
    const wrap = el.querySelector(".sensor-anim-canvas-wrap");
    const slider = el.querySelector('[data-role="slider"]');
    const timeLabel = el.querySelector('[data-role="time-label"]');
    const playBtn = el.querySelector('[data-role="play"]');
    const speedSel = el.querySelector('[data-role="speed"]');
    const gridCbx = el.querySelector('[data-role="grid"]');
    const basemapCbx = el.querySelector('[data-role="basemap"]');
    const styleSel = el.querySelector('[data-role="style"]');
    const tileOutlinesCbx = el.querySelector('[data-role="tile-outlines"]');
    const sensorsCbx = el.querySelector('[data-role="sensors"]');
    const logScaleCbx = el.querySelector('[data-role="log-scale"]');
    const consoleToggleCbx = el.querySelector('[data-role="console-toggle"]');

    const state = {
      playing: false,
      speed: 1,
      index: 0,
      rafId: 0,
      lastTs: 0,
      msPerFrameBase: 500, // 0.5s per 15-min by default
      scaler: null,
      dpr: Math.max(1, Math.min(2, window.devicePixelRatio || 1)),
      showBasemap: true,
      showSensors: false,
      logScale: false,
      tiles: {
        zoom: 0,
        minX: 0,
        maxX: -1,
        minY: 0,
        maxY: -1,
        cache: new Map(), // key: `${z}/${x}/${y}` -> HTMLImageElement | 'error'
        loading: new Set(),
      },
      tileStyle: "light_nolabels",
      tileServer:
        "https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png",
      disposeFns: [],
      showTileOutlines: false,
    };

    // Resolve Carto basemap style to URL template
    function resolveTileServer(style) {
      switch (style) {
        case "light_all":
          return "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png";
        case "dark_all":
          return "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png";
        case "voyager":
          return "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png";
        case "light_nolabels":
        default:
          return "https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png";
      }
    }

    function setCanvasSize() {
      const rectBase =
        wrap && wrap.getBoundingClientRect
          ? wrap.getBoundingClientRect()
          : el.getBoundingClientRect();
      const w = Math.max(320, Math.floor(rectBase.width));
      const h = Math.max(240, Math.floor(rectBase.height));
      console.debug("[SensorAnim] setCanvasSize", {
        w: w,
        h: h,
        dpr: state.dpr,
      });
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      canvas.width = Math.floor(w * state.dpr);
      canvas.height = Math.floor(h * state.dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        console.error("[SensorAnim] setCanvasSize: 2D context is null");
        return;
      }
      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      if (cached) {
        const useBBox = computeSensorsBBox() || cached.bbox;
        state.scaler = createScaler(
          useBBox,
          canvas.width / state.dpr,
          canvas.height / state.dpr,
          24
        );
        // Basemap may need to be refreshed on size change
        if (state.showBasemap) ensureBasemapTiles();
      }
    }
    function getEffectiveBBox() {
      if (!cached) return null;
      return computeSensorsBBox() || cached.bbox;
    }

    function ensureBasemapTiles() {
      if (!cached) return;
      const width = Math.floor(canvas.width / state.dpr);
      const height = Math.floor(canvas.height / state.dpr);
      if (width < 64 || height < 64) return;
      const bbox = computeSensorsBBox() || cached.bbox; // basemap uses normal lon/lat
      let zoom = fitZoomForBbox(bbox, width, height, 17, 4);
      let minX = lon2tileX(bbox.minLon, zoom);
      let maxX = lon2tileX(bbox.maxLon, zoom);
      let minY = lat2tileY(bbox.maxLat, zoom); // y increases southward
      let maxY = lat2tileY(bbox.minLat, zoom);
      // cap tile count to avoid spikes
      const cap = 256;
      let count = (maxX - minX + 1) * (maxY - minY + 1);
      while (count > cap && zoom > 4) {
        zoom -= 1;
        minX = lon2tileX(bbox.minLon, zoom);
        maxX = lon2tileX(bbox.maxLon, zoom);
        minY = lat2tileY(bbox.maxLat, zoom);
        maxY = lat2tileY(bbox.minLat, zoom);
        count = (maxX - minX + 1) * (maxY - minY + 1);
      }
      state.tiles.zoom = zoom;
      state.tiles.minX = minX;
      state.tiles.maxX = maxX;
      state.tiles.minY = minY;
      state.tiles.maxY = maxY;
      console.debug("[SensorAnim] basemap tiles compute", {
        width,
        height,
        bbox,
        zoom,
        minX,
        maxX,
        minY,
        maxY,
        count,
      });
      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          const key = `${zoom}/${x}/${y}`;
          if (state.tiles.cache.has(key) || state.tiles.loading.has(key))
            continue;
          const url = state.tileServer
            .replace("{z}", String(zoom))
            .replace("{x}", String(x))
            .replace("{y}", String(y));
          const img = new Image();
          state.tiles.loading.add(key);
          img.onload = () => {
            state.tiles.loading.delete(key);
            state.tiles.cache.set(key, img);
            console.debug("[SensorAnim] basemap tile loaded", key);
            drawCurrent();
          };
          img.onerror = () => {
            state.tiles.loading.delete(key);
            state.tiles.cache.set(key, "error");
            console.warn("[SensorAnim] basemap tile failed", key);
          };
          console.debug("[SensorAnim] basemap request", { key, url });
          img.src = url;
        }
      }
    }

    function drawBasemapTiles(ctx) {
      const t = state.tiles;
      const zoom = t.zoom;
      if (t.maxX < t.minX || t.maxY < t.minY) return;
      let drawn = 0,
        missing = 0,
        skipped = 0;
      for (let x = t.minX; x <= t.maxX; x++) {
        for (let y = t.minY; y <= t.maxY; y++) {
          const key = `${zoom}/${x}/${y}`;
          const img = t.cache.get(key);
          if (!img || img === "error") {
            missing++;
            continue;
          }
          const lonLeft = tileX2lon(x, zoom);
          const lonRight = tileX2lon(x + 1, zoom);
          const latTop = tileY2lat(y, zoom);
          const latBottom = tileY2lat(y + 1, zoom);
          const dx = state.scaler.x(lonLeft);
          const dyTop = state.scaler.y(latTop);
          const dx2 = state.scaler.x(lonRight);
          const dyBottom = state.scaler.y(latBottom);
          const dw = dx2 - dx;
          const dh = dyBottom - dyTop;
          if (dw <= 0 || dh <= 0) {
            skipped++;
            continue;
          }
          ctx.drawImage(img, dx, dyTop, dw, dh);
          if (state.showTileOutlines) {
            ctx.save();
            ctx.strokeStyle = "rgba(0,0,0,0.35)";
            ctx.lineWidth = 0.75 * state.dpr;
            ctx.strokeRect(dx, dyTop, dw, dh);
            ctx.restore();
          }
          drawn++;
        }
      }
      console.debug("[SensorAnim] basemap draw", { drawn, missing, skipped });
    }

    // In-app console capture for [SensorAnim] logs
    const consoleBuffer = [];
    const maxConsoleLines = 500;
    const orig = {
      log: console.log,
      debug: console.debug,
      warn: console.warn,
      error: console.error,
    };
    function capture(line) {
      const ts = new Date().toISOString().split("T")[1].replace("Z", "");
      consoleBuffer.push(`${ts} ${line}`);
      if (consoleBuffer.length > maxConsoleLines) consoleBuffer.shift();
      if (consolePanel && consolePanel.style.display !== "none") {
        consolePanel.textContent = consoleBuffer.join("\n");
        consolePanel.scrollTop = consolePanel.scrollHeight;
      }
    }
    function patchConsole() {
      const safeToString = (a) => {
        if (a instanceof Error) {
          return a.stack || `${a.name || "Error"}: ${a.message || ""}`;
        }
        if (typeof a === "string") return a;
        if (typeof a === "number" || typeof a === "boolean") return String(a);
        if (a === null || a === undefined) return String(a);
        try {
          return JSON.stringify(a);
        } catch {
          return Object.prototype.toString.call(a);
        }
      };
      ["log", "debug", "warn", "error"].forEach((lvl) => {
        console[lvl] = function (...args) {
          try {
            const text = args.map(safeToString).join(" ");
            if (text.includes("[SensorAnim]")) capture(text);
          } catch {}
          return orig[lvl].apply(console, args);
        };
      });
    }
    function restoreConsole() {
      Object.assign(console, orig);
    }

    function drawSensorsBaseline(ctx) {
      if (!cached || !state.scaler) return;
      ctx.save();
      ctx.fillStyle = "rgba(30,41,59,0.6)"; // slate-800
      for (const { lon, lat } of cached.sensors.values()) {
        const x = state.scaler.x(lon);
        const y = state.scaler.y(lat);
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    function formatTimeLabel(ts) {
      const d = new Date(ts);
      if (isNaN(d)) return String(ts);
      return d.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    }

    function drawCurrent() {
      if (!cached) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        console.error("[SensorAnim] drawCurrent: 2D context is null");
        return;
      }
      const timeKey = cached.times[state.index];
      const frame = cached.frames.get(timeKey) || [];
      console.debug("[SensorAnim] drawCurrent", {
        index: state.index,
        timeKey: timeKey,
        points: frame.length,
      });
      // Clear and draw basemap and grid
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (state.showBasemap) {
        drawBasemapTiles(ctx);
      }
      const effBbox = getEffectiveBBox();
      // Draw the data points on top
      drawPoints(
        ctx,
        state.scaler,
        frame,
        cached.minVal,
        cached.maxVal,
        state.dpr,
        !!state.logScale
      );
      // Optional: show all sensor positions
      if (state.showSensors) drawSensorsBaseline(ctx);
      // Overlay diagnostics: time | pts | canvas size
      overlay.textContent =
        formatTimeLabel(timeKey) +
        " | pts: " +
        frame.length +
        " | " +
        canvas.width / state.dpr +
        "x" +
        canvas.height / state.dpr;
      // Visual debug: draw border and center dot in CSS pixel coords
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.strokeStyle = "#64748b";
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);
      ctx.restore();
      ctx.beginPath();
      ctx.arc(
        canvas.width / state.dpr / 2,
        canvas.height / state.dpr / 2,
        3,
        0,
        Math.PI * 2
      );
      ctx.fillStyle = "#22c55e";
      ctx.fill();
    }

    function step(now) {
      state.rafId = 0;
      const speed = Math.max(0.01, Number(state.speed) || 1);
      const msPerFrame = state.msPerFrameBase / speed;

      if (!state.lastTs) state.lastTs = now;
      const elapsed = now - state.lastTs;
      if (elapsed >= msPerFrame) {
        state.index = (state.index + 1) % cached.times.length;
        slider.value = String(state.index);
        timeLabel.textContent = formatTimeLabel(cached.times[state.index]);
        state.lastTs = now;
        drawCurrent();
      }
      if (state.playing) state.rafId = requestAnimationFrame(step);
    }

    function play() {
      if (!cached) return;
      if (state.playing) return;
      state.playing = true;
      playBtn.textContent = "Pause";
      playBtn.setAttribute("aria-pressed", "true");
      state.lastTs = 0;
      state.rafId = requestAnimationFrame(step);
    }

    function pause() {
      state.playing = false;
      playBtn.textContent = "Play";
      playBtn.setAttribute("aria-pressed", "false");
      if (state.rafId) cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }

    // Event wiring
    playBtn.addEventListener("click", () => {
      if (state.playing) pause();
      else play();
    });
    speedSel.addEventListener("change", () => {
      state.speed = Number(speedSel.value);
    });
    slider.addEventListener("input", () => {
      state.index = Number(slider.value) || 0;
      timeLabel.textContent = cached
        ? formatTimeLabel(cached.times[state.index])
        : "--";
      drawCurrent();
    });
    if (gridCbx) {
      gridCbx.addEventListener("change", () => {
        state.showGrid = !!gridCbx.checked;
        drawCurrent();
      });
    }
    if (basemapCbx) {
      basemapCbx.addEventListener("change", () => {
        state.showBasemap = !!basemapCbx.checked;
        console.debug("[SensorAnim] toggle basemap", state.showBasemap);
        if (state.showBasemap) ensureBasemapTiles();
        drawCurrent();
      });
    }
    if (styleSel) {
      styleSel.addEventListener("change", () => {
        state.tileStyle = styleSel.value;
        state.tileServer = resolveTileServer(state.tileStyle);
        // Clear tile cache when style changes
        state.tiles.cache.clear();
        state.tiles.loading.clear();
        console.debug("[SensorAnim] style change", state.tileStyle);
        ensureBasemapTiles();
        drawCurrent();
      });
    }
    if (tileOutlinesCbx) {
      tileOutlinesCbx.addEventListener("change", () => {
        state.showTileOutlines = !!tileOutlinesCbx.checked;
        console.debug(
          "[SensorAnim] toggle tile outlines",
          state.showTileOutlines
        );
        drawCurrent();
      });
    }
    if (sensorsCbx) {
      sensorsCbx.addEventListener("change", () => {
        state.showSensors = !!sensorsCbx.checked;
        drawCurrent();
      });
    }
    if (logScaleCbx) {
      logScaleCbx.addEventListener("change", () => {
        state.logScale = !!logScaleCbx.checked;
        console.debug("[SensorAnim] toggle logScale", state.logScale);
        drawCurrent();
      });
    }
    if (consoleToggleCbx) {
      consoleToggleCbx.addEventListener("change", () => {
        const show = !!consoleToggleCbx.checked;
        console.debug("[SensorAnim] toggle debug console", show);
        if (show) {
          consolePanel.style.display = "block";
          consolePanel.textContent = consoleBuffer.join("\n");
          consolePanel.scrollTop = consolePanel.scrollHeight;
        } else {
          consolePanel.style.display = "none";
        }
      });
    }

    const onResize = () => {
      setCanvasSize();
      drawCurrent();
    };
    window.addEventListener("resize", onResize);
    state.disposeFns.push(() => window.removeEventListener("resize", onResize));
    // Patch console to capture SensorAnim logs
    patchConsole();
    state.disposeFns.push(restoreConsole);

    // Load and start
    (async () => {
      try {
        overlay.textContent = "Loading data…";
        console.debug("[SensorAnim] async init start");
        await loadData();
        setCanvasSize();
        // slider bounds
        slider.max = String(Math.max(0, cached.times.length - 1));
        // Jump to first non-empty frame for visibility
        let startIndex = 0;
        for (let i = 0; i < cached.times.length; i++) {
          const key = cached.times[i];
          const f = cached.frames.get(key) || [];
          if (f.length > 0) {
            startIndex = i;
            break;
          }
        }
        slider.value = String(startIndex);
        state.index = startIndex;
        const effB = getEffectiveBBox() || cached.bbox;
        state.scaler = createScaler(
          effB,
          canvas.width / state.dpr,
          canvas.height / state.dpr,
          24
        );
        if (state.showBasemap) ensureBasemapTiles();
        try {
          timeLabel.textContent = formatTimeLabel(cached.times[state.index]);
        } catch (e) {
          console.warn("[SensorAnim] time label update failed", e);
        }
        drawCurrent();
        try {
          overlay.textContent = formatTimeLabel(cached.times[state.index]);
        } catch (e) {
          console.warn("[SensorAnim] overlay update failed", e);
        }
        console.debug("[SensorAnim] async init done");
      } catch (err) {
        console.error("[SensorAnim] init error", err);
        // If data loaded and we have frames, treat as non-fatal UI error
        if (cached && cached.times && cached.times.length > 0) {
          const label = formatTimeLabel(cached.times[state.index] || "");
          try {
            overlay.textContent = label || "";
          } catch {}
          try {
            timeLabel.textContent = label || "";
          } catch {}
          playBtn.disabled = false;
        } else {
          overlay.textContent = "Failed to load sensor data. See console.";
          playBtn.disabled = true;
        }
      }
    })();

    const api = {
      unmount() {
        pause();
        for (const d of state.disposeFns)
          try {
            d();
          } catch {}
        mounts.delete(el);
        el.innerHTML = "";
      },
      showConsole(show = true) {
        if (!consolePanel) return;
        consolePanel.style.display = show ? "block" : "none";
        if (show) {
          consolePanel.textContent = consoleBuffer.join("\n");
          consolePanel.scrollTop = consolePanel.scrollHeight;
        }
      },
    };
    mounts.set(el, api);
    return api;
  }

  // Assign global and keep a resilient backup in case something overwrites it
  const api = { mount };
  try {
    Object.defineProperty(window, "SensorAnim", {
      value: api,
      writable: false,
      configurable: false,
    });
  } catch (e) {
    window.SensorAnim = api;
  }
  window.__SensorAnimRef = api;
  console.debug("[SensorAnim] global assigned", window.SensorAnim);

  // Self-heal if someone deletes/overwrites the global
  try {
    setInterval(() => {
      if (!window.SensorAnim || typeof window.SensorAnim.mount !== "function") {
        console.warn(
          "[SensorAnim] global missing/changed; restoring reference"
        );
        try {
          Object.defineProperty(window, "SensorAnim", {
            value: window.__SensorAnimRef,
            writable: false,
            configurable: false,
          });
        } catch (e) {
          window.SensorAnim = window.__SensorAnimRef;
        }
      }
    }, 2000);
  } catch {}
  return window.SensorAnim;
})();
