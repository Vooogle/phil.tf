import { injectGuide } from './guide.js';

// Tile math
// Each function returns { cx, cy, u, v } where:
//   cx, cy = tile center in pixel space (used for tiling-safe variation hash)
//   u, v   = local coords within tile [0, 1]

function squareTile(x, y, s) {
  const col = Math.floor(x / s), row = Math.floor(y / s);
  return { cx: (col + 0.5) * s, cy: (row + 0.5) * s, u: (x / s) - col, v: (y / s) - row };
}

function brickTile(x, y, bW, bH) {
  const row = Math.floor(y / bH);
  const ox  = (row & 1) * bW * 0.5;
  const ax  = x + ox;
  const col = Math.floor(ax / bW);
  return {
    cx: (col + 0.5) * bW - ox,
    cy: (row + 0.5) * bH,
    u: (ax / bW) - col,
    v: (y  / bH) - row,
  };
}

function diamondTile(x, y, s) {
  const uf = (x + y) / (2 * s), vf = (x - y) / (2 * s);
  const col = Math.floor(uf), row = Math.floor(vf);
  // Center in pixel space (inverse of (x+y)/2s, (x-y)/2s)
  const ucx = col + 0.5, vcx = row + 0.5;
  return {
    cx: (ucx + vcx) * s,
    cy: (ucx - vcx) * s,
    u: uf - col,
    v: vf - row,
  };
}

const SQ3 = Math.sqrt(3);

// Hex Voronoi lookup - takes pre-fitted spacings so the grid divides imgSize exactly.
// Returns nearest center cx1/cy1, Voronoi gap (d2-d1), and face normal direction.
function hexVoronoi(px, py, effCS, effRS, nCols, nRows, imgSize) {
  let d1 = Infinity, d2 = Infinity;
  let cx1 = 0, cy1 = 0, fnx = 0, fny = 0;

  const c0 = Math.round(px / effCS);
  for (let dc = -2; dc <= 2; dc++) {
    const col    = c0 + dc;
    const colMod = ((col % nCols) + nCols) % nCols;
    const yOff   = (colMod & 1) ? effRS * 0.5 : 0;
    const r0     = Math.round((py - yOff) / effRS);

    for (let dr = -2; dr <= 2; dr++) {
      const row = r0 + dr;
      const cx  = colMod * effCS;
      const cy  = (((row % nRows) + nRows) % nRows) * effRS + yOff;

      // Torus distance so edges of image match up
      let ddx = px - cx, ddy = py - cy;
      if (ddx >  imgSize * 0.5) ddx -= imgSize;
      if (ddx < -imgSize * 0.5) ddx += imgSize;
      if (ddy >  imgSize * 0.5) ddy -= imgSize;
      if (ddy < -imgSize * 0.5) ddy += imgSize;
      const d = Math.hypot(ddx, ddy);

      if (d < d1) {
        d2 = d1;
        d1 = d; cx1 = cx; cy1 = cy;
        const inv = d > 0 ? 1 / d : 0;
        fnx = ddx * inv; fny = ddy * inv;
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  return { cx: cx1, cy: cy1, gap: d2 - d1, fnx, fny };
}

function herringboneTile(x, y, s) {
  const b = 2 * s;
  const scx = Math.floor(x / b), scy = Math.floor(y / b);
  const lx = x - scx * b, ly = y - scy * b;
  if ((scx + scy) % 2 === 0) {
    const row = Math.floor(ly / s);
    return { cx: scx * b + b * 0.5, cy: scy * b + (row + 0.5) * s, u: lx / b, v: (ly - row * s) / s };
  } else {
    const col = Math.floor(lx / s);
    return { cx: scx * b + (col + 0.5) * s, cy: scy * b + b * 0.5, u: (lx - col * s) / s, v: ly / b };
  }
}

function chevronTile(x, y, s, ratio) {
  const tW = s * ratio, tH = s;
  const rx = (x - y) * 0.5, ry = (x + y) * 0.5;
  const row = Math.floor(ry / tH);
  const ox  = (row & 1) * tW * 0.5;
  const ax  = rx + ox;
  const col = Math.floor(ax / tW);
  // Center in rotated space → back to pixel space
  const rcx = (col + 0.5) * tW - ox, rcy = (row + 0.5) * tH;
  return {
    cx: rcx + rcy,   // inverse of rx=(x-y)/2, ry=(x+y)/2
    cy: rcy - rcx,
    u: (ax / tW) - col,
    v: (ry / tH) - row,
  };
}

// Variation hash
// cx, cy are wrapped tile-center coords → tileable variation

function tileHash(cx, cy, seed) {
  let h = (Math.imul(cx | 0, 1619) + Math.imul(cy | 0, 31337) + (seed | 0)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1540483477) | 0;
  return (h >>> 0) / 4294967295;
}

// Image generation

function generateTileImage({
  imgSize, tileType, tileSize, ratio,
  groutPct, variation, bevelStrength, bevelWidth, bevelInvert,
  lightAngle, invert, seed,
}) {
  const buf  = new Uint8ClampedArray(imgSize * imgSize * 4);
  const bW   = tileSize * ratio;
  const gf   = groutPct / 100;
  const gh   = gf * 0.5;
  const groutPx = gf * tileSize;
  const bevelPx = bevelWidth * tileSize;
  const lx  = Math.cos(lightAngle), ly = Math.sin(lightAngle);

  for (let py = 0; py < imgSize; py++) {
    for (let px = 0; px < imgSize; px++) {
      let tile;
      switch (tileType) {
        case 'square':      tile = squareTile(px, py, tileSize); break;
        case 'brick':       tile = brickTile(px, py, bW, tileSize); break;
        case 'diamond':     tile = diamondTile(px, py, tileSize); break;
        case 'hex':         tile = hexTile(px, py, tileSize); break;
        case 'herringbone': tile = herringboneTile(px, py, tileSize); break;
        case 'chevron':     tile = chevronTile(px, py, tileSize, ratio); break;
        default:            tile = squareTile(px, py, tileSize);
      }

      const { cx, cy, u, v, faceDistPx, faceNx, faceNy } = tile;

      // Grout
      const isGrout = tileType === 'hex'
        ? faceDistPx < groutPx
        : u < gh || u > 1 - gh || v < gh || v > 1 - gh;

      let value;
      if (isGrout) {
        value = 0.18;
      } else {
        // Tileable variation: wrap center to image period
        const wcx = Math.round(((cx % imgSize) + imgSize) % imgSize);
        const wcy = Math.round(((cy % imgSize) + imgSize) % imgSize);
        value = 0.76 + variation * (tileHash(wcx, wcy, seed) - 0.5);

        // Bevel / light simulation
        if (bevelStrength > 0 && bevelPx > 0) {
          let slopeFactor, nx, ny;

          if (tileType === 'hex') {
            // Distance from nearest grout edge inward
            const bevelDist = faceDistPx - groutPx;
            if (bevelDist < bevelPx) {
              slopeFactor = 1 - bevelDist / bevelPx;
              nx = faceNx; ny = faceNy;
            } else {
              slopeFactor = 0;
            }
          } else {
            const du = Math.min(u, 1 - u);
            const dv = Math.min(v, 1 - v);
            const dMin = Math.min(du, dv);
            const edgePx = dMin * tileSize;
            const innerEdgePx = Math.max(0, edgePx - groutPx * 0.5);

            if (innerEdgePx < bevelPx) {
              slopeFactor = 1 - innerEdgePx / bevelPx;
              if (du <= dv) { nx = u < 0.5 ? -1 :  1; ny = 0; }
              else          { nx = 0;                   ny = v < 0.5 ? -1 : 1; }
            } else {
              slopeFactor = 0;
            }
          }

          if (slopeFactor > 0) {
            const light = (nx * lx + ny * ly) * slopeFactor * bevelStrength;
            value += bevelInvert ? -light : light;
          }
        }

        value = Math.max(0, Math.min(1, value));
      }

      if (invert) value = 1 - value;
      const g = Math.round(value * 255);
      const idx = (py * imgSize + px) * 4;
      buf[idx] = g; buf[idx + 1] = g; buf[idx + 2] = g; buf[idx + 3] = 255;
    }
  }
  return new ImageData(buf, imgSize, imgSize);
}

// Constants

const PREVIEW_SIZE = 216;
const STORAGE_KEY  = 'ptk-tile-generator';

// Tool

export default {
  id: 'tile-generator',
  name: 'Tile Generator',
  category: 'Texturing',
  description: 'Math-based tileable patterns - brick, hex, diamond, herringbone, chevron.',
  guide: `## Free Online Seamless Tile Pattern Generator
This is a free browser-based seamless tile pattern generator. Create tileable brick patterns, hexagon tile textures, diamond grid patterns, herringbone tile designs, and chevron patterns at any resolution. Useful for CSS backgrounds, game textures, architectural visualizations, and print design. No download required.
## Pattern types
- **Brick Pattern** - Classic offset brick tile layout. Available in horizontal and vertical orientations. A staple seamless background pattern for walls and floors.
- **Hex / Honeycomb Pattern** - Hexagonal tile grid, also called a honeycomb pattern. Widely used in game maps, UI backgrounds, and decorative surface textures.
- **Diamond Pattern** - A rotated square grid forming a seamless diamond tile lattice. Great for flooring and geometric backgrounds.
- **Herringbone Pattern** - Interlocking V-shaped tile rows in the classic herringbone flooring arrangement. Popular for parquet, brick, and textile patterns.
- **Chevron Pattern** - A continuous arrow-shaped zigzag tile pattern with aligned joints, similar to herringbone but without offset breaks.
## Tips
- Increase **gap** to add grout lines or visible spacing between tiles.
- Set gap to zero for flush, solid color-block grid patterns.
- Use **variation** to add subtle per-tile brightness differences for a more natural look.
- The exported PNG tiles seamlessly - use CSS **background-repeat: repeat** with a matching **background-size**.
## Exporting
Download as a seamless PNG texture at any size. Drop it directly into CSS, Unity, Unreal Engine, Godot, Figma, or Photoshop.`,

  render(mainEl, previewEl) {
    this._cleanups = [];
    const onWindow = (type, fn) => {
      window.addEventListener(type, fn);
      this._cleanups.push(() => window.removeEventListener(type, fn));
    };

    mainEl.innerHTML = `
      <div class="tool-content">
        <h2>Tile Generator</h2>
        <p class="tool-desc">Math-based tileable patterns. Works at any resolution.</p>

        <div class="field">
          <label>Pattern</label>
          <select id="tg-type">
            <option value="brick">Brick</option>
            <option value="square">Square</option>
            <option value="hex">Hexagon</option>
            <option value="diamond">Diamond</option>
            <option value="herringbone">Herringbone</option>
            <option value="chevron">Chevron</option>
          </select>
        </div>

        <div class="field">
          <label>Size (px, square)</label>
          <input type="number" id="tg-imgsize" value="128" min="1" max="4096" style="width:90px">
        </div>

        <div class="field">
          <label>Tile size - <span id="tg-tile-val">16</span>px</label>
          <input type="range" id="tg-tile" min="3" max="128" value="16">
        </div>

        <div class="field">
          <label>Ratio - <span id="tg-ratio-val">2.0</span></label>
          <input type="range" id="tg-ratio" min="10" max="60" value="20">
        </div>

        <div class="field">
          <label>Grout - <span id="tg-grout-val">15</span>%</label>
          <input type="range" id="tg-grout" min="0" max="40" value="15">
        </div>

        <div class="field">
          <label>Variation - <span id="tg-var-val">0.20</span></label>
          <input type="range" id="tg-var" min="0" max="100" value="20">
        </div>

        <div class="field">
          <label>Bevel strength - <span id="tg-bevel-val">0.40</span></label>
          <input type="range" id="tg-bevel" min="0" max="100" value="40">
        </div>

        <div class="field">
          <label>Bevel width - <span id="tg-bevel-w-val">30</span>%</label>
          <input type="range" id="tg-bevel-w" min="0" max="50" value="30">
        </div>

        <div class="field">
          <label>Light direction</label>
          <div style="display:flex;align-items:center;gap:14px">
            <canvas id="tg-light-picker" width="52" height="52"
              style="cursor:crosshair;border-radius:50%;flex-shrink:0"></canvas>
            <label class="check-label">
              <input type="checkbox" id="tg-bevel-invert"> Concave
            </label>
          </div>
        </div>

        <div class="field">
          <label>Seed</label>
          <div style="display:flex;gap:6px">
            <input type="number" id="tg-seed" value="1" style="width:90px">
            <button class="btn" id="tg-random"><img src="/assets/icons/random.svg" class="icon"></button>
          </div>
        </div>

        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
          <button class="btn" id="tg-invert">Invert</button>
          <button class="btn" id="tg-dl" disabled>Export PNG</button>
          <button class="btn" id="tg-clear">Reset</button>
        </div>
        <div id="tg-status" style="margin-top:10px;font-size:12px;color:var(--text-muted);min-height:16px"></div>
      </div>
    `;

    previewEl.innerHTML = `
      <div style="position:relative;display:inline-block;line-height:0">
        <canvas id="tg-canvas"
          style="display:block;width:${PREVIEW_SIZE}px;height:${PREVIEW_SIZE}px;border-radius:3px;background:var(--divider)">
        </canvas>
        <button id="tg-view-large" title="View full size"
          style="position:absolute;top:6px;right:6px;padding:3px 7px;font-size:11px;line-height:1.4"></button>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">
        <label class="check-label">
          <input type="checkbox" id="tg-tiled"> 2×2 tiled
        </label>
        <div style="display:flex;gap:0;border-radius:var(--radius);overflow:hidden;width:fit-content;border:1px solid var(--divider)">
          <button id="tg-filter-raw" class="pt-filter-btn pt-filter-active">Raw</button>
          <button id="tg-filter-smooth" class="pt-filter-btn">Filtered</button>
        </div>
      </div>
    `;

    // Refs
    const $ = id => mainEl.querySelector(`#${id}`) ?? previewEl.querySelector(`#${id}`);
    const typeSel      = $('tg-type'),      imgSizeInput  = $('tg-imgsize');
    const tileRange    = $('tg-tile'),      tileSpan      = $('tg-tile-val');
    const ratioRange   = $('tg-ratio'),     ratioSpan     = $('tg-ratio-val');
    const groutRange   = $('tg-grout'),     groutSpan     = $('tg-grout-val');
    const varRange     = $('tg-var'),       varSpan       = $('tg-var-val');
    const bevelRange   = $('tg-bevel'),     bevelSpan     = $('tg-bevel-val');
    const bevelWRange  = $('tg-bevel-w'),   bevelWSpan    = $('tg-bevel-w-val');
    const lightPicker  = $('tg-light-picker');
    const bevelInvertChk = $('tg-bevel-invert');
    const seedInput    = $('tg-seed'),      randBtn       = $('tg-random');
    const invertBtn    = $('tg-invert'),    dlBtn         = $('tg-dl');
    const clearBtn     = $('tg-clear'),     statusEl      = $('tg-status');
    const canvas       = $('tg-canvas'),    tiledChk      = $('tg-tiled');
    const viewLargeBtn = $('tg-view-large');
    const filterRaw    = $('tg-filter-raw'), filterSmooth = $('tg-filter-smooth');

    let lastImageData    = null;
    let debounceTimer    = null;
    let filterMode       = 'raw';
    let inverted         = false;
    let lightAngle       = -Math.PI * 0.75; // upper-left
    let pickerDragging   = false;

    // Light picker

    function drawLightPicker() {
      const s = lightPicker.width;
      const r = s / 2;
      const ctx = lightPicker.getContext('2d');
      const css = getComputedStyle(document.documentElement);
      ctx.clearRect(0, 0, s, s);

      ctx.beginPath();
      ctx.arc(r, r, r - 1, 0, Math.PI * 2);
      ctx.fillStyle = css.getPropertyValue('--surface').trim();
      ctx.fill();
      ctx.strokeStyle = css.getPropertyValue('--divider').trim();
      ctx.lineWidth = 1;
      ctx.stroke();

      // Subtle gradient showing "lit side"
      const gx = r + Math.cos(lightAngle) * r * 0.6;
      const gy = r + Math.sin(lightAngle) * r * 0.6;
      const grad = ctx.createRadialGradient(gx, gy, 0, r, r, r);
      grad.addColorStop(0, 'rgba(255,255,255,0.18)');
      grad.addColorStop(1, 'rgba(0,0,0,0.10)');
      ctx.beginPath();
      ctx.arc(r, r, r - 1, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      // Arrow
      const arrowLen = r - 8;
      const ax = r + Math.cos(lightAngle) * arrowLen;
      const ay = r + Math.sin(lightAngle) * arrowLen;
      const accent = css.getPropertyValue('--accent').trim();
      ctx.beginPath();
      ctx.moveTo(r, r);
      ctx.lineTo(ax, ay);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(ax, ay, 4, 0, Math.PI * 2);
      ctx.fillStyle = accent;
      ctx.fill();
    }

    function getLightAngleFromEvent(e) {
      const rect = lightPicker.getBoundingClientRect();
      return Math.atan2(e.clientY - rect.top - rect.height / 2,
                        e.clientX - rect.left  - rect.width  / 2);
    }

    lightPicker.addEventListener('mousedown', e => {
      pickerDragging = true;
      lightAngle = getLightAngleFromEvent(e);
      drawLightPicker(); scheduleLive(); e.preventDefault();
    });
    onWindow('mousemove', e => {
      if (!pickerDragging) return;
      lightAngle = getLightAngleFromEvent(e);
      drawLightPicker(); scheduleLive();
    });
    onWindow('mouseup', () => { pickerDragging = false; });

    // Labels

    function syncLabels() {
      tileSpan.textContent  = tileRange.value;
      ratioSpan.textContent = (parseInt(ratioRange.value) / 10).toFixed(1);
      groutSpan.textContent = groutRange.value;
      varSpan.textContent   = (parseInt(varRange.value) / 100).toFixed(2);
      bevelSpan.textContent = (parseInt(bevelRange.value) / 100).toFixed(2);
      bevelWSpan.textContent= bevelWRange.value;
    }

    // Draw

    function drawToCanvas(cvs, imageData) {
      if (!imageData) return;
      const { width: w, height: h } = imageData;
      const tiles = tiledChk.checked ? 2 : 1;
      cvs.width = w * tiles; cvs.height = h * tiles;
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

    function redraw() { drawToCanvas(canvas, lastImageData); }

    // Generate

    function doGenerate() {
      saveSettings();
      const opts = {
        imgSize:      Math.max(1, Math.min(4096, parseInt(imgSizeInput.value) || 128)),
        tileType:     typeSel.value,
        tileSize:     Math.max(1, parseInt(tileRange.value)),
        ratio:        parseInt(ratioRange.value) / 10,
        groutPct:     parseInt(groutRange.value),
        variation:    parseInt(varRange.value) / 100,
        bevelStrength:parseInt(bevelRange.value) / 100,
        bevelWidth:   parseInt(bevelWRange.value) / 100,
        bevelInvert:  bevelInvertChk.checked,
        lightAngle,
        invert:       inverted,
        seed:         parseInt(seedInput.value) | 0,
      };

      statusEl.textContent = 'Generating…';
      dlBtn.disabled = true;

      setTimeout(() => {
        try {
          lastImageData = generateTileImage(opts);
          redraw();
          statusEl.textContent =
            `${opts.imgSize}×${opts.imgSize}  ·  ${opts.tileType}  ·  ${opts.tileSize}px tiles`;
          dlBtn.disabled = false;
        } catch (e) { statusEl.textContent = e.message; }
      }, 16);
    }

    function scheduleLive() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(doGenerate, 250);
    }

    // localStorage

    function saveSettings() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          type: typeSel.value, imgSize: imgSizeInput.value,
          tile: tileRange.value, ratio: ratioRange.value,
          grout: groutRange.value, variation: varRange.value,
          bevel: bevelRange.value, bevelW: bevelWRange.value,
          bevelInvert: bevelInvertChk.checked,
          lightAngle, invert: inverted, filterMode, tiled: tiledChk.checked,
          seed: seedInput.value,
        }));
      } catch {}
    }

    function loadSettings() {
      try {
        const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        if (!s) return;
        if (s.type)    typeSel.value        = s.type;
        if (s.imgSize) imgSizeInput.value   = s.imgSize;
        if (s.tile)    tileRange.value      = s.tile;
        if (s.ratio)   ratioRange.value     = s.ratio;
        if (s.grout)   groutRange.value     = s.grout;
        if (s.variation) varRange.value     = s.variation;
        if (s.bevel)   bevelRange.value     = s.bevel;
        if (s.bevelW)  bevelWRange.value    = s.bevelW;
        if (s.seed)    seedInput.value      = s.seed;
        if (typeof s.lightAngle === 'number') lightAngle = s.lightAngle;
        bevelInvertChk.checked = !!s.bevelInvert;
        inverted = !!s.invert;
        invertBtn.style.background = inverted ? 'var(--accent)' : '';
        invertBtn.style.color      = inverted ? '#fff'          : '';
        tiledChk.checked = !!s.tiled;
        filterMode = s.filterMode || 'raw';
        filterRaw.classList.toggle('pt-filter-active', filterMode === 'raw');
        filterSmooth.classList.toggle('pt-filter-active', filterMode === 'smooth');
      } catch {}
    }

    function applyReset() {
      localStorage.removeItem(STORAGE_KEY);
      typeSel.value        = 'brick';
      imgSizeInput.value   = '128';
      tileRange.value      = '16';
      ratioRange.value     = '20';
      groutRange.value     = '15';
      varRange.value       = '20';
      bevelRange.value     = '40';
      bevelWRange.value    = '30';
      bevelInvertChk.checked = false;
      lightAngle           = -Math.PI * 0.75;
      inverted             = false;
      invertBtn.style.background = ''; invertBtn.style.color = '';
      filterMode           = 'raw';
      tiledChk.checked     = false;
      seedInput.value      = '1';
      filterRaw.classList.add('pt-filter-active');
      filterSmooth.classList.remove('pt-filter-active');
      syncLabels(); drawLightPicker(); doGenerate();
    }

    // View large

    function openModal() {
      if (!lastImageData) return;
      const { width: w, height: h } = lastImageData;
      const tiles = tiledChk.checked ? 2 : 1;
      const modal = document.createElement('div');
      modal.className = 'fullscreen-modal';
      const c = document.createElement('canvas');
      c.width = w * tiles; c.height = h * tiles;
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
      info.textContent = `${c.width}×${c.height}px - click to close`;
      modal.appendChild(c); modal.appendChild(info);
      modal.addEventListener('click', () => modal.remove());
      document.body.appendChild(modal);
    }

    // Events

    [typeSel, tileRange, ratioRange, groutRange, varRange, bevelRange, bevelWRange].forEach(el =>
      el.addEventListener('input', () => { syncLabels(); scheduleLive(); }));

    imgSizeInput.addEventListener('change', scheduleLive);
    bevelInvertChk.addEventListener('change', scheduleLive);

    invertBtn.addEventListener('click', () => {
      inverted = !inverted;
      invertBtn.style.background = inverted ? 'var(--accent)' : '';
      invertBtn.style.color      = inverted ? '#fff'          : '';
      scheduleLive();
    });

    tiledChk.addEventListener('change', redraw);

    function setFilter(mode) {
      filterMode = mode;
      filterRaw.classList.toggle('pt-filter-active', mode === 'raw');
      filterSmooth.classList.toggle('pt-filter-active', mode === 'smooth');
      redraw();
    }
    filterRaw.addEventListener('click', () => setFilter('raw'));
    filterSmooth.addEventListener('click', () => setFilter('smooth'));

    randBtn.addEventListener('click', () => { seedInput.value = Math.floor(Math.random() * 1e6); doGenerate(); });

    dlBtn.addEventListener('click', () => {
      if (!lastImageData) return;
      const tmp = document.createElement('canvas');
      tmp.width = lastImageData.width; tmp.height = lastImageData.height;
      tmp.getContext('2d').putImageData(lastImageData, 0, 0);
      tmp.toBlob(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `tile-${typeSel.value}-${lastImageData.width}px-${Date.now()}.png`;
        a.click(); URL.revokeObjectURL(a.href);
      });
    });

    clearBtn.addEventListener('click', applyReset);
    viewLargeBtn.addEventListener('click', openModal);

    // Init

    loadSettings();
    syncLabels();
    drawLightPicker();
    doGenerate();

    this._cleanups.push(() => clearTimeout(debounceTimer));
    injectGuide(mainEl, this.guide);
  },

  destroy() {
    (this._cleanups || []).forEach(fn => fn());
  },
};
