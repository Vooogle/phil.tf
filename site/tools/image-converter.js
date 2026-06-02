import { esc, fmt, injectCSS, makeDropZone, makeResultRow } from './_ui.js';
import { injectGuide } from './guide.js';

const MIME = { jpeg:'image/jpeg', png:'image/png', webp:'image/webp' };

function isImage(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return file.type.startsWith('image/') || ['jpg','jpeg','png','gif','webp','bmp','avif','tiff','svg','ico'].includes(ext);
}

async function convertImage(file, toExt, settings = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.naturalWidth, h = img.naturalHeight;
      const max = settings.maxDim || 0;
      if (max && (w > max || h > max)) {
        if (w >= h) { h = Math.round(h * max / w); w = max; }
        else        { w = Math.round(w * max / h); h = max; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (toExt === 'jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
      ctx.drawImage(img, 0, 0, w, h);
      const mime = MIME[toExt] || `image/${toExt}`;
      const q = (toExt === 'jpeg' || toExt === 'webp') ? (settings.quality ?? 0.92) : undefined;
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas toBlob failed')), mime, q);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
    img.src = url;
  });
}

export default {
  id: 'image-converter',
  name: 'Image Converter',
  seoTitle: 'Free Image Converter Online - JPEG PNG WebP | phil.tf',
  category: 'Media',
  description: 'Convert images between JPEG, PNG, and WebP with quality and resize controls.',
  guide: `## Image Converter - Free Browser-Based Image Format Conversion
Convert images between JPEG, PNG, WebP, GIF, BMP, AVIF, and TIFF - no upload, no server, all in your browser.

## Supported formats
- JPEG - best for photos, lossy compression
- PNG - lossless, supports transparency
- WebP - modern format, smaller files than JPEG/PNG
- GIF, BMP, AVIF, TIFF also supported as input

## How to use
- Drop an image file or click to browse
- Choose output format and quality
- Optionally resize by width or height
- Download the converted file

## Notes
- Files never leave your browser - conversion runs locally
- Quality slider only applies to JPEG and WebP output
- Resize preserves aspect ratio when only one dimension is set
`,

  _mainEl: null,

  render(mainEl) {
    this._mainEl = mainEl;
    injectCSS();
    makeDropZone(mainEl, 'cv-body', 'image/*',
      'JPEG · PNG · WebP · GIF · BMP · AVIF · TIFF',
      f => isImage(f) && this._loadFile(f));
    injectGuide(mainEl, this.guide);
  },

  destroy() { this._mainEl = null; },

  _loadFile(file) {
    const body = this._mainEl.querySelector('#cv-body');
    body.innerHTML = `
      <div class="cv-card">
        <span style="font-size:22px;flex-shrink:0">🖼</span>
        <div style="flex:1;min-width:0">
          <div class="cv-card-name" title="${esc(file.name)}">${esc(file.name)}</div>
          <div class="cv-card-meta">${fmt(file.size)}</div>
        </div>
        <button class="cv-change" id="cv-change">Change file</button>
      </div>
      <div class="cv-sec">
        <div class="cv-sec-lbl">Convert to</div>
        <div class="cv-fmts">
          <button class="cv-fmt" data-fmt="jpeg">JPEG</button>
          <button class="cv-fmt" data-fmt="png">PNG</button>
          <button class="cv-fmt" data-fmt="webp">WebP</button>
        </div>
      </div>
      <div class="cv-sec">
        <div class="cv-sec-lbl">Settings</div>
        <div class="cv-settings">
          <div class="cv-setting-row">
            <span class="cv-setting-lbl">Quality</span>
            <div class="cv-slider-wrap">
              <input type="range" class="cv-slider" id="cv-s-q" min="10" max="100" value="92">
              <span class="cv-slider-val" id="cv-s-q-val">92%</span>
            </div>
          </div>
          <div class="cv-setting-row">
            <span class="cv-setting-lbl">Max dimension</span>
            <select class="cv-select" id="cv-s-max">
              <option value="0">Original</option>
              <option value="3840">3840 px</option>
              <option value="2000">2000 px</option>
              <option value="1500">1500 px</option>
              <option value="1000">1000 px</option>
              <option value="800">800 px</option>
              <option value="500">500 px</option>
            </select>
          </div>
        </div>
      </div>
      <div class="cv-results" id="cv-results"></div>
    `;
    const sl = body.querySelector('#cv-s-q');
    const vl = body.querySelector('#cv-s-q-val');
    sl.addEventListener('input', () => { vl.textContent = `${sl.value}%`; });
    body.querySelector('#cv-change').addEventListener('click', () => { body.innerHTML = ''; });
    body.querySelectorAll('.cv-fmt').forEach(btn => {
      btn.addEventListener('click', () => this._convert(file, btn.dataset.fmt, btn));
    });
  },

  async _convert(file, toExt, btn) {
    const results  = this._mainEl.querySelector('#cv-results');
    const settings = {
      quality: parseInt(this._mainEl.querySelector('#cv-s-q')?.value || '92') / 100,
      maxDim:  parseInt(this._mainEl.querySelector('#cv-s-max')?.value || '0'),
    };
    const outName = `${file.name.replace(/\.[^.]+$/, '')}.${toExt}`;
    const r = makeResultRow(results, outName);
    btn.disabled = true;
    try {
      r.setStatus('Converting…');
      const blob = await convertImage(file, toExt, settings);
      r.succeed(blob, outName);
    } catch (e) { r.fail(e?.message ?? String(e)); }
    finally     { btn.disabled = false; }
  },
};
