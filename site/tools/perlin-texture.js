// - Noise math -

function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(a, b, t) { return a + t * (b - a); }

function grad2(h, x, y) {
  switch (h & 3) {
    case 0: return  x + y;
    case 1: return -x + y;
    case 2: return  x - y;
    default: return -x - y;
  }
}

function hash2(x, y, seed) {
  let h = (Math.imul(x | 0, 1619) + Math.imul(y | 0, 31337) + Math.imul(seed | 0, 1013904223)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1540483477) | 0;
  return (h ^ (h >>> 15)) & 255;
}

function tiledNoise(x, y, px, py, seed) {
  const X = Math.floor(x), Y = Math.floor(y);
  const xf = x - X, yf = y - Y;
  const xi  = ((X % px) + px) % px, yi  = ((Y % py) + py) % py;
  const xi1 = (xi + 1) % px,        yi1 = (yi + 1) % py;
  const u = fade(xf), v = fade(yf);
  return lerp(
    lerp(grad2(hash2(xi,  yi,  seed), xf,     yf    ),
         grad2(hash2(xi1, yi,  seed), xf - 1, yf    ), u),
    lerp(grad2(hash2(xi,  yi1, seed), xf,     yf - 1),
         grad2(hash2(xi1, yi1, seed), xf - 1, yf - 1), u),
    v
  );
}

function fbm(x, y, period, octaves, persistence, seed) {
  let value = 0, amp = 1, freq = 1, maxAmp = 0;
  for (let o = 0; o < octaves; o++) {
    value += tiledNoise(x * freq, y * freq, period * freq, period * freq, seed + o * 1299709) * amp;
    maxAmp += amp;
    amp *= persistence;
    freq *= 2;
  }
  return value / maxAmp;
}

// - Helpers -

function getImageMinMax(imageData) {
  const d = imageData.data;
  let min = 255, max = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] < min) min = d[i];
    if (d[i] > max) max = d[i];
  }
  return [min / 255, max / 255];
}

// - Image generation -

function generateImageData({ size, period, octaves, persistence, brightness, colors, stepValues, seed }) {
  const buf = new Uint8ClampedArray(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let v = fbm((px / size) * period, (py / size) * period, period, octaves, persistence, seed);
      v = Math.max(0, Math.min(1, (v + 1) * 0.5 * brightness));
      if (colors > 1 && stepValues) {
        // Nearest-neighbor: assign pixel to whichever step center is closest
        let best = 0, bestDist = Infinity;
        for (let s = 0; s < colors; s++) {
          const center = stepValues[s] ?? s / (colors - 1);
          const dist = Math.abs(v - center);
          if (dist < bestDist) { bestDist = dist; best = s; }
        }
        v = stepValues[best] ?? best / (colors - 1);
      }
      const g = Math.round(v * 255);
      const idx = (py * size + px) * 4;
      buf[idx] = g; buf[idx + 1] = g; buf[idx + 2] = g; buf[idx + 3] = 255;
    }
  }
  return new ImageData(buf, size, size);
}

// - Constants -

const PERIODS      = [1, 2, 4, 8, 16];
const PREVIEW_SIZE = 216;
const STORAGE_KEY  = 'ptk-perlin-texture';
const SWATCH_H     = 48;

// - Tool -

export default {
  id: 'perlin-texture',
  name: 'Perlin Texture',
  category: 'Texturing',
  description: 'Tileable Perlin noise map generator. Pixel art or high-res.',

  render(mainEl, previewEl) {
    this._cleanups = [];
    const onWindow = (type, fn) => {
      window.addEventListener(type, fn);
      this._cleanups.push(() => window.removeEventListener(type, fn));
    };

    mainEl.innerHTML = `
      <div class="tool-content">
        <h2>Perlin Texture</h2>
        <p class="tool-desc">Tileable noise map. All changes preview live.</p>

        <div class="field">
          <label>Size (px, square)</label>
          <input type="number" id="pt-size" value="128" min="1" max="4096" step="1" style="width:90px">
        </div>

        <div class="field">
          <label>Scale — <span id="pt-scale-val">4</span></label>
          <input type="range" id="pt-scale" min="1" max="5" value="3">
        </div>

        <div class="field">
          <label>Octaves — <span id="pt-oct-val">4</span></label>
          <input type="range" id="pt-oct" min="1" max="8" value="4">
        </div>

        <div class="field">
          <label>Roughness — <span id="pt-rough-val">0.50</span></label>
          <input type="range" id="pt-rough" min="5" max="95" step="5" value="50">
        </div>

        <div class="field">
          <label>Brightness — <span id="pt-bright-val">1.00</span></label>
          <input type="range" id="pt-bright" min="10" max="300" step="5" value="100">
        </div>

        <div class="field">
          <label class="check-label" style="margin-bottom:8px">
            <input type="checkbox" id="pt-quantize"> Quantize colors
          </label>
          <div id="pt-colors-wrap" style="opacity:0.4;pointer-events:none">
            <input type="range" id="pt-colors" min="2" max="32" value="8" style="margin-bottom:6px">
            <canvas id="pt-colors-swatch" height="${SWATCH_H}"
              style="width:100%;display:block;border-radius:3px 3px 0 0;cursor:ns-resize"></canvas>
            <canvas id="pt-gradient-swatch" height="8"
              style="width:100%;display:block;border-radius:0 0 3px 3px;margin-bottom:4px"></canvas>
            <div style="display:flex;justify-content:space-between;margin-top:3px;font-size:10px;color:var(--text-faint)">
              <span>drag steps to adjust brightness</span>
              <button class="btn" id="pt-reset-steps" style="padding:1px 6px;font-size:10px">Reset</button>
            </div>
          </div>
        </div>

        <div class="field">
          <label>Seed</label>
          <div style="display:flex;gap:6px">
            <input type="number" id="pt-seed" value="42" style="width:90px">
            <button class="btn" id="pt-random" title="Random seed + regenerate">🎲 New seed</button>
          </div>
        </div>

        <div style="display:flex;gap:8px;margin-top:4px">
          <button class="btn" id="pt-dl" disabled>Export PNG</button>
          <button class="btn" id="pt-clear">Reset all</button>
        </div>
        <div id="pt-status" style="margin-top:10px;font-size:12px;color:var(--text-muted);min-height:16px"></div>
      </div>
    `;

    previewEl.innerHTML = `
      <div style="position:relative;display:inline-block;line-height:0">
        <canvas id="pt-canvas"
          style="display:block;width:${PREVIEW_SIZE}px;height:${PREVIEW_SIZE}px;border-radius:3px;background:var(--divider)">
        </canvas>
        <button id="pt-view-large" title="View full size"
          style="position:absolute;top:6px;right:6px;padding:3px 7px;font-size:11px;line-height:1.4">⛶</button>
      </div>
      <div id="pt-unquant-wrap" style="display:none;margin-top:10px">
        <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-faint);margin-bottom:4px">Without quantize</div>
        <canvas id="pt-canvas-unquant"
          style="display:block;width:${PREVIEW_SIZE}px;height:${PREVIEW_SIZE}px;border-radius:3px;background:var(--divider)">
        </canvas>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">
        <label class="check-label">
          <input type="checkbox" id="pt-tiled"> 2×2 tiled
        </label>
        <div style="display:flex;align-items:center;gap:0;border-radius:var(--radius);overflow:hidden;width:fit-content;border:1px solid var(--divider)">
          <button id="pt-filter-raw" class="pt-filter-btn pt-filter-active">Raw</button>
          <button id="pt-filter-smooth" class="pt-filter-btn">Filtered</button>
        </div>
      </div>
    `;

    // - Refs -
    const $ = id => mainEl.querySelector(`#${id}`) ?? previewEl.querySelector(`#${id}`);
    const sizeInput    = $('pt-size');
    const scaleRange   = $('pt-scale'),   scaleSpan   = $('pt-scale-val');
    const octRange     = $('pt-oct'),     octSpan     = $('pt-oct-val');
    const roughRange   = $('pt-rough'),   roughSpan   = $('pt-rough-val');
    const brightRange  = $('pt-bright'),  brightSpan  = $('pt-bright-val');
    const quantChk     = $('pt-quantize'),colorsWrap  = $('pt-colors-wrap');
    const colorsRange  = $('pt-colors');
    const colorsSwatch = $('pt-colors-swatch');
    const gradientSwatch = $('pt-gradient-swatch');
    const resetStepsBtn  = $('pt-reset-steps');
    const seedInput    = $('pt-seed'),    randBtn     = $('pt-random');
    const dlBtn        = $('pt-dl'),      clearBtn    = $('pt-clear'), statusEl = $('pt-status');
    const canvas        = $('pt-canvas'),      tiledChk      = $('pt-tiled');
    const canvasUnquant = $('pt-canvas-unquant'), unquantWrap = $('pt-unquant-wrap');
    const viewLargeBtn  = $('pt-view-large');
    const filterRawBtn = $('pt-filter-raw'), filterSmooth = $('pt-filter-smooth');

    let lastImageData        = null;
    let lastUnquantImageData = null;
    let debounceTimer        = null;
    let filterMode           = 'raw';
    let swatchDrag           = null;

    // Per-step output values — each step's direct output gray level
    const stepValues = new Array(32).fill(0);
    let imageMin = 0, imageMax = 1;

    function initStepValues(n) {
      const lo = imageMin, hi = imageMax;
      for (let i = 0; i < n; i++)
        stepValues[i] = n === 1 ? lo : lo + (i / (n - 1)) * (hi - lo);
    }

    // - Swatch -

    function drawGradientSwatch() {
      const w   = gradientSwatch.offsetWidth || 200;
      gradientSwatch.width = w;
      const ctx = gradientSwatch.getContext('2d');
      const lo  = Math.round(imageMin * 255), hi = Math.round(imageMax * 255);
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, `rgb(${lo},${lo},${lo})`);
      grad.addColorStop(1, `rgb(${hi},${hi},${hi})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, 8);
    }

    function drawColorsSwatch() {
      const n   = parseInt(colorsRange.value);
      const w   = colorsSwatch.offsetWidth || 200;
      colorsSwatch.width = w;
      const h   = SWATCH_H;
      const ctx = colorsSwatch.getContext('2d');
      ctx.clearRect(0, 0, w, h);

      const range = imageMax - imageMin || 1;
      for (let i = 0; i < n; i++) {
        const val  = stepValues[i] ?? (n === 1 ? imageMin : imageMin + (i / (n - 1)) * range);
        const gray = Math.round(Math.max(0, Math.min(1, val)) * 255);
        const x    = Math.round(i * w / n);
        const bw   = Math.max(1, Math.round((i + 1) * w / n) - x);
        // Bar height within image range (imageMin=bottom, imageMax=top)
        const barH = Math.round(((val - imageMin) / range) * h);

        // Track above bar
        ctx.fillStyle = 'rgba(128,128,128,0.15)';
        ctx.fillRect(x, 0, bw, h - barH);

        // Bar — color is the actual output gray
        ctx.fillStyle = `rgb(${gray},${gray},${gray})`;
        ctx.fillRect(x, h - barH, bw, barH);

        // Separator
        if (i > 0) {
          ctx.fillStyle = 'rgba(128,128,128,0.2)';
          ctx.fillRect(x, 0, 1, h);
        }
      }
    }

    // Drag sets value directly — Y maps to [imageMin, imageMax], paints across steps
    function applySwatchDrag(e) {
      const rect  = colorsSwatch.getBoundingClientRect();
      const n     = parseInt(colorsRange.value);
      const step  = Math.max(0, Math.min(n - 1,
        Math.floor((e.clientX - rect.left) / rect.width * n)));
      const frac  = 1 - Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      const val   = imageMin + frac * (imageMax - imageMin);
      stepValues[step] = Math.max(imageMin, Math.min(imageMax, val));
      drawColorsSwatch();
      scheduleLive();
    }

    colorsSwatch.addEventListener('mousedown', e => {
      swatchDrag = true;
      applySwatchDrag(e);
      e.preventDefault();
    });

    onWindow('mousemove', e => { if (swatchDrag) applySwatchDrag(e); });
    onWindow('mouseup',   () => { swatchDrag = false; });

    resetStepsBtn.addEventListener('click', () => {
      initStepValues(parseInt(colorsRange.value));
      drawColorsSwatch();
      scheduleLive();
    });

    // - Label sync -

    function syncLabels() {
      scaleSpan.textContent = PERIODS[parseInt(scaleRange.value) - 1];
      octSpan.textContent   = octRange.value;
      roughSpan.textContent = (parseInt(roughRange.value) / 100).toFixed(2);
      brightSpan.textContent= (parseInt(brightRange.value) / 100).toFixed(2);
    }

    // - Draw preview canvas -

    function drawToCanvas(cvs, imageData) {
      if (!imageData) return;
      const { width: w, height: h } = imageData;
      const tiles = tiledChk.checked ? 2 : 1;
      cvs.width  = w * tiles;
      cvs.height = h * tiles;
      const tmp = document.createElement('canvas');
      tmp.width = w; tmp.height = h;
      tmp.getContext('2d').putImageData(imageData, 0, 0);
      const ctx = cvs.getContext('2d');
      for (let ty = 0; ty < tiles; ty++)
        for (let tx = 0; tx < tiles; tx++)
          ctx.drawImage(tmp, tx * w, ty * h);
      cvs.style.width  = PREVIEW_SIZE + 'px';
      cvs.style.height = PREVIEW_SIZE * (tiles > 1 ? 1 : h / w) + 'px';
      cvs.style.imageRendering = filterMode === 'raw' ? 'pixelated' : 'auto';
    }

    function redraw() {
      drawToCanvas(canvas, lastImageData);
      const showUnquant = quantChk.checked && lastUnquantImageData;
      unquantWrap.style.display = showUnquant ? 'block' : 'none';
      if (showUnquant) drawToCanvas(canvasUnquant, lastUnquantImageData);
    }

    // - Generate -

    function doGenerate() {
      saveSettings();
      const size = Math.max(1, Math.min(4096, parseInt(sizeInput.value) || 128));
      const opts = {
        size,
        period:      PERIODS[parseInt(scaleRange.value) - 1],
        octaves:     parseInt(octRange.value),
        persistence: parseInt(roughRange.value) / 100,
        brightness:  parseInt(brightRange.value) / 100,
        colors:     quantChk.checked ? parseInt(colorsRange.value) : 0,
        stepValues: quantChk.checked ? stepValues.slice() : null,
        seed:        parseInt(seedInput.value) | 0,
      };

      statusEl.textContent = 'Generating…';
      dlBtn.disabled = true;

      setTimeout(() => {
        try {
          // Always generate unquantized first to get actual image range
          const unquantOpts = { ...opts, colors: 0, stepValues: null };
          lastUnquantImageData = generateImageData(unquantOpts);

          if (opts.colors > 1) {
            // Update range, clamp existing step values, redraw swatch
            [imageMin, imageMax] = getImageMinMax(lastUnquantImageData);
            const n = opts.colors;
            for (let i = 0; i < n; i++)
              stepValues[i] = Math.max(imageMin, Math.min(imageMax, stepValues[i]));
            drawColorsSwatch();
            drawGradientSwatch();
            lastImageData = generateImageData(opts);
          } else {
            lastImageData = lastUnquantImageData;
            lastUnquantImageData = null;
          }

          redraw();
          statusEl.textContent =
            `${size}×${size}  ·  ${opts.period}× scale  ·  ${opts.octaves} octaves`;
          dlBtn.disabled = false;
        } catch (e) {
          statusEl.textContent = e.message;
        }
      }, 16);
    }

    function scheduleLive() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(doGenerate, 350);
    }

    // - localStorage -

    function saveSettings() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          size:            sizeInput.value,
          scale:           scaleRange.value,
          oct:             octRange.value,
          rough:           roughRange.value,
          bright:          brightRange.value,
          quantize:        quantChk.checked,
          colors:          colorsRange.value,
          stepValues: stepValues.slice(0, 32),
          stepsN:     parseInt(colorsRange.value),
          seed:            seedInput.value,
          filterMode,
          tiled:           tiledChk.checked,
        }));
      } catch {}
    }

    function loadSettings() {
      try {
        const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        if (!s) return false;
        if (s.size)   sizeInput.value   = s.size;
        if (s.scale)  scaleRange.value  = s.scale;
        if (s.oct)    octRange.value     = s.oct;
        if (s.rough)  roughRange.value  = s.rough;
        if (s.bright) brightRange.value = s.bright;
        if (s.colors) colorsRange.value = s.colors;
        if (s.seed)   seedInput.value   = s.seed;
        quantChk.checked = !!s.quantize;
        tiledChk.checked = !!s.tiled;
        filterMode       = s.filterMode || 'raw';
        if (Array.isArray(s.stepValues) && s.stepsN === parseInt(colorsRange.value)) {
          s.stepValues.forEach((v, i) => { stepValues[i] = v; });
        } else {
          initStepValues(parseInt(colorsRange.value));
        }
        const on = quantChk.checked;
        colorsWrap.style.opacity      = on ? '1'  : '0.4';
        colorsWrap.style.pointerEvents = on ? ''   : 'none';
        filterRawBtn.classList.toggle('pt-filter-active', filterMode === 'raw');
        filterSmooth.classList.toggle('pt-filter-active', filterMode === 'smooth');
        return true;
      } catch { return false; }
    }

    function applyReset() {
      localStorage.removeItem(STORAGE_KEY);
      sizeInput.value    = '128';
      scaleRange.value   = '3';
      octRange.value     = '4';
      roughRange.value   = '50';
      brightRange.value  = '100';
      quantChk.checked   = false;
      colorsRange.value  = '8';
      initStepValues(parseInt(colorsRange.value));
      seedInput.value    = '42';
      filterMode         = 'raw';
      tiledChk.checked   = false;
      colorsWrap.style.opacity       = '0.4';
      colorsWrap.style.pointerEvents = 'none';
      filterRawBtn.classList.add('pt-filter-active');
      filterSmooth.classList.remove('pt-filter-active');
      syncLabels();
      drawColorsSwatch();
      doGenerate();
    }

    // - View large modal -

    function openModal() {
      if (!lastImageData) return;
      const { width: w, height: h } = lastImageData;
      const modal = document.createElement('div');
      modal.className = 'fullscreen-modal';

      const c = document.createElement('canvas');
      const tiles = tiledChk.checked ? 2 : 1;
      c.width  = w * tiles;
      c.height = h * tiles;

      const vw = window.innerWidth, vh = window.innerHeight;
      const scale = c.height / c.width > vh / vw ? vh / c.height : vw / c.width;
      c.style.width  = Math.round(c.width  * scale) + 'px';
      c.style.height = Math.round(c.height * scale) + 'px';
      c.style.imageRendering = filterMode === 'raw' ? 'pixelated' : 'auto';

      const tmp = document.createElement('canvas');
      tmp.width = w; tmp.height = h;
      tmp.getContext('2d').putImageData(lastImageData, 0, 0);
      const ctx = c.getContext('2d');
      for (let ty = 0; ty < tiles; ty++)
        for (let tx = 0; tx < tiles; tx++)
          ctx.drawImage(tmp, tx * w, ty * h);

      const info = document.createElement('div');
      info.className = 'fullscreen-modal-info';
      info.textContent = `${c.width}×${c.height}px — click to close`;

      modal.appendChild(c);
      modal.appendChild(info);
      modal.addEventListener('click', () => modal.remove());
      document.body.appendChild(modal);
    }

    // - Events -

    [scaleRange, octRange, roughRange, brightRange, colorsRange].forEach(el =>
      el.addEventListener('input', () => { syncLabels(); scheduleLive(); }));

    sizeInput.addEventListener('change', scheduleLive);

    quantChk.addEventListener('change', () => {
      const on = quantChk.checked;
      colorsWrap.style.opacity       = on ? '1'  : '0.4';
      colorsWrap.style.pointerEvents = on ? ''   : 'none';
      if (on) { drawColorsSwatch(); drawGradientSwatch(); }
      scheduleLive();
    });

    colorsRange.addEventListener('input', () => {
      initStepValues(parseInt(colorsRange.value));
      drawColorsSwatch();
    });

    tiledChk.addEventListener('change', redraw);

    function setFilter(mode) {
      filterMode = mode;
      filterRawBtn.classList.toggle('pt-filter-active', mode === 'raw');
      filterSmooth.classList.toggle('pt-filter-active', mode === 'smooth');
      redraw();
    }
    filterRawBtn.addEventListener('click', () => setFilter('raw'));
    filterSmooth.addEventListener('click', () => setFilter('smooth'));

    randBtn.addEventListener('click', () => {
      seedInput.value = Math.floor(Math.random() * 1e6);
      doGenerate();
    });

    dlBtn.addEventListener('click', () => {
      if (!lastImageData) return;
      const tmp = document.createElement('canvas');
      tmp.width  = lastImageData.width;
      tmp.height = lastImageData.height;
      tmp.getContext('2d').putImageData(lastImageData, 0, 0);
      tmp.toBlob(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `perlin-${lastImageData.width}x${lastImageData.height}-${Date.now()}.png`;
        a.click();
        URL.revokeObjectURL(a.href);
      });
    });

    clearBtn.addEventListener('click', applyReset);
    viewLargeBtn.addEventListener('click', openModal);

    // - Init -

    initStepValues(parseInt(colorsRange.value));
    loadSettings();
    syncLabels();
    drawColorsSwatch();
    drawGradientSwatch();
    doGenerate();

    this._cleanups.push(() => clearTimeout(debounceTimer));
  },

  destroy() {
    (this._cleanups || []).forEach(fn => fn());
  },
};
