import { esc, fmt, injectCSS, makeDropZone, makeResultRow } from './_ui.js';
import { loadFFmpeg, ffExec, probeInfo, CRASHY_AUDIO, resetFFmpeg } from './_ffmpeg.js';
import { isVideo, buildVf, vcodecArgs, buildAudioArgs, videoSettingsHTML, readVideoSettings } from './_video.js';
import { injectGuide } from './guide.js';

function fmtT(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  const ss = (s % 60).toFixed(2).padStart(5, '0');
  return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${ss}` : `${String(m).padStart(2,'0')}:${ss}`;
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// -Segment model -------------------------------------------------------

function splitAt(segs, t) {
  const out = [];
  for (const s of segs) {
    if (t > s.start + 0.02 && t < s.end - 0.02) {
      out.push({ start: s.start, end: t, keep: s.keep });
      out.push({ start: t,       end: s.end, keep: s.keep });
    } else { out.push({ ...s }); }
  }
  return out;
}

function cutRange(segs, a, b) {
  if (b - a < 0.02) return segs;
  let s = splitAt(segs, a);
  s = splitAt(s, b);
  return mergeSegs(s.map(seg => seg.start >= a - 0.001 && seg.end <= b + 0.001 ? { ...seg, keep: false } : seg));
}

function mergeSegs(segs) {
  if (!segs.length) return segs;
  const out = [{ ...segs[0] }];
  for (let i = 1; i < segs.length; i++) {
    const last = out[out.length - 1];
    if (last.keep === segs[i].keep) last.end = segs[i].end;
    else out.push({ ...segs[i] });
  }
  return out;
}

// -FFmpeg export -------------------------------------------------------

function buildArgs(inName, outName, segs, toExt, withAudio, s = {}) {
  const keeps = segs.filter(k => k.keep);
  if (!keeps.length) throw new Error('No segments selected — click segments to toggle keep/cut');

  const isGif    = toExt === 'gif';
  const useAudio = withAudio && !isGif && s.abr !== '0';
  const vFilter  = buildVf(s, toExt);

  if (keeps.length === 1) {
    const args = ['-i', inName];
    if (keeps[0].start > 0.02) args.push('-ss', keeps[0].start.toFixed(3));
    args.push('-to', keeps[0].end.toFixed(3));
    args.push('-vf', vFilter, ...vcodecArgs(toExt, s), ...buildAudioArgs(toExt, s, !useAudio));
    return [...args, '-y', outName];
  }

  const n  = keeps.length;
  const vf = keeps.map((k, i) =>
    `[0:v]trim=start=${k.start.toFixed(3)}:end=${k.end.toFixed(3)},setpts=PTS-STARTPTS,${vFilter}[v${i}]`
  );
  const af = useAudio ? keeps.map((k, i) =>
    `[0:a]atrim=start=${k.start.toFixed(3)}:end=${k.end.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`
  ) : [];
  const ins    = keeps.map((_, i) => `[v${i}]${useAudio ? `[a${i}]` : ''}`).join('');
  const outs   = useAudio ? '[ov][oa]' : '[ov]';
  const concat = `${ins}concat=n=${n}:v=1:a=${useAudio ? 1 : 0}${outs}`;
  const fc     = [...vf, ...af, concat].join(';');

  const args = ['-i', inName, '-filter_complex', fc, '-map', '[ov]'];
  if (useAudio) args.push('-map', '[oa]', '-c:a', 'aac');
  return [...args, ...buildAudioArgs(toExt, s, !useAudio), ...vcodecArgs(toExt, s), '-y', outName];
}

// -CSS -----------------------------------------------------------------

function injectEdCSS() {
  if (document.getElementById('ed-css')) return;
  const s = document.createElement('style'); s.id = 'ed-css';
  s.textContent = `
    .ed{padding:16px;display:flex;flex-direction:column;gap:12px;box-sizing:border-box}
    .ed-cols{display:flex;gap:16px;align-items:flex-start}
    .ed-left{flex:1;min-width:0;display:flex;flex-direction:column;gap:10px}
    .ed-right{width:260px;flex-shrink:0;display:flex;flex-direction:column;gap:10px;position:sticky;top:16px}
    .ed-top{display:flex;align-items:center;gap:10px}
    .ed-fname{font-size:13px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
    .ed-vwrap{background:#000;border-radius:6px;overflow:hidden;line-height:0}
    .ed-video{width:100%;max-height:480px;object-fit:contain;display:block}
    .ed-timebar{display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);font-variant-numeric:tabular-nums}
    .ed-tl{position:relative;height:100px;border-radius:6px;overflow:hidden;cursor:crosshair;background:var(--surface);border:1px solid var(--divider);user-select:none;touch-action:none}
    .ed-film{position:absolute;inset:0;display:flex;pointer-events:none}
    .ed-film img{height:100%;object-fit:cover;opacity:.4;flex-shrink:0}
    .ed-seglayer{position:absolute;inset:0}
    .ed-so{position:absolute;top:0;bottom:0;transition:background .1s,box-shadow .1s}
    .ed-so.keep{cursor:pointer;background:rgba(255,255,255,.12);box-shadow:2px 0 0 0 rgba(0,0,0,.7),-2px 0 0 0 rgba(0,0,0,.7)}
    .ed-so.keep:hover{background:rgba(255,255,255,.22)}
    .ed-so.sel{background:rgba(255,255,255,.25)!important;box-shadow:inset 0 0 0 2px rgba(255,255,255,.9),2px 0 0 0 rgba(0,0,0,.7),-2px 0 0 0 rgba(0,0,0,.7)!important}
    .ed-so.cut{cursor:crosshair;background:var(--surface);pointer-events:none}
    .ed-inout{position:absolute;inset:0;pointer-events:none}
    .ed-range{position:absolute;top:0;bottom:0;background:rgba(80,160,255,.2)}
    .ed-inm,.ed-outm{position:absolute;top:0;bottom:0;width:2px;z-index:4}
    .ed-inm{background:#4a9} .ed-outm{background:#e84}
    .ed-inm::after{content:'I';position:absolute;top:1px;left:3px;font-size:9px;color:#4a9;font-weight:700;line-height:1}
    .ed-outm::after{content:'O';position:absolute;top:1px;right:3px;font-size:9px;color:#e84;font-weight:700;line-height:1}
    .ed-ph{position:absolute;top:-5px;bottom:0;width:2px;background:#f44;z-index:6;pointer-events:none}
    .ed-ph::before{content:'';position:absolute;top:0;left:-4px;border:5px solid transparent;border-top-width:8px;border-top-color:#f44}
    .ed-chips{display:flex;gap:4px;flex-wrap:wrap;align-items:center;min-height:22px;font-size:11px;color:var(--text-muted)}
    .ed-chip{padding:2px 8px;border-radius:20px;border:1px solid var(--divider);cursor:pointer;white-space:nowrap;font-variant-numeric:tabular-nums}
    .ed-chip.keep{border-color:var(--text);color:var(--text)}
    .ed-chip.cut{opacity:.45;text-decoration:line-through;border-style:dashed;color:var(--text-muted)}
    .ed-chip.cut:hover{opacity:.75;border-color:#e44;color:#e44}
    .ed-chip.sel{background:var(--text);color:var(--bg);border-color:var(--text)}
    .ed-tb{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
    .ed-btn{display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border:1px solid var(--divider);background:var(--bg);color:var(--text);border-radius:var(--radius);font-size:12px;font-family:inherit;cursor:pointer;white-space:nowrap}
    .ed-btn:hover{background:var(--surface);border-color:var(--text)}
    .ed-btn.del{border-color:#e44;color:#e44}
    .ed-btn .k{background:var(--surface);border:1px solid var(--divider);border-radius:3px;padding:1px 4px;font-size:10px;color:var(--text-muted)}
    .ed-exp{margin-left:auto;padding:6px 18px;background:var(--text);color:var(--bg);border:none;border-radius:var(--radius);font-size:13px;font-weight:600;font-family:inherit;cursor:pointer}
    .ed-exp:hover{opacity:.85} .ed-exp:disabled{opacity:.4;cursor:default}
    .ed-hints{font-size:10px;color:var(--text-muted);display:flex;flex-wrap:wrap;gap:6px;border-top:1px solid var(--divider);padding-top:8px}
    .ed-hints kbd{background:var(--surface);border:1px solid var(--divider);border-radius:3px;padding:1px 4px;font-family:inherit;font-size:9px}
  `;
  document.head.appendChild(s);
}

// -Tool export ---------------------------------------------------------

export default {
  id: 'video-editor',
  name: 'Video Editor',
  seoTitle: 'Free Online Video Editor - Cut & Trim Video in Browser | phil.tf',
  category: 'Video',
  description: 'Timeline-based video editor - cut, trim, and export entirely in your browser.',
  guide: `## Video Editor - Free Browser-Based Video Trimmer and Cutter
Timeline-based video editor - cut, trim, split, and export video clips without installing anything.

## How to use
- Drop a video file or click to browse
- Use the timeline to set in and out points
- Add cuts to split the video into segments
- Reorder or remove segments as needed
- Choose export format and quality, then export

## Keyboard shortcuts
- Space - play / pause
- Left / Right arrow - step one frame
- I - set in point at current position
- O - set out point at current position

## Notes
- Files never leave your browser - export runs locally using FFmpeg WebAssembly
- Large files may take time to process
- For simple trimming a single clip is fastest - adding many segments increases export time
`,

  _mainEl: null,
  _st: null,
  _keyH: null,
  _rafId: null,

  render(mainEl) {
    this._mainEl = mainEl;
    injectCSS();
    injectEdCSS();
    this._expandLayout();
    makeDropZone(mainEl, 'cv-body', 'video/*', 'MP4 · WebM · MKV · MOV · AVI', f => isVideo(f) && this._load(f));
    injectGuide(mainEl, this.guide);
  },

  destroy() {
    if (this._keyH)  window.removeEventListener('keydown', this._keyH);
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this._st?.videoUrl) URL.revokeObjectURL(this._st.videoUrl);
    this._st = null; this._keyH = null; this._rafId = null; this._mainEl = null;
    this._restoreLayout();
  },

  _expandLayout() {
    const layout  = document.getElementById('layout');
    const preview = document.getElementById('preview-panel');
    const toggle  = document.getElementById('preview-toggle-btn');
    if (layout)  layout.style.gridTemplateColumns = '240px 1fr';
    if (preview) preview.style.display = 'none';
    if (toggle)  toggle.style.display  = 'none';
  },

  _restoreLayout() {
    const layout  = document.getElementById('layout');
    const preview = document.getElementById('preview-panel');
    const toggle  = document.getElementById('preview-toggle-btn');
    if (layout)  layout.style.gridTemplateColumns = '';
    if (preview) preview.style.display = '';
    if (toggle)  toggle.style.display  = '';
  },

  async _load(file) {
    if (this._keyH)  { window.removeEventListener('keydown', this._keyH); this._keyH = null; }
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    if (this._st?.videoUrl) URL.revokeObjectURL(this._st.videoUrl);

    this._mainEl.innerHTML = '<div style="padding:24px;font-size:13px;color:var(--text-muted)">Loading…</div>';

    const videoUrl = URL.createObjectURL(file);
    const tmp = document.createElement('video');
    tmp.src = videoUrl; tmp.preload = 'metadata';
    const duration = await new Promise((res, rej) => {
      tmp.onloadedmetadata = () => res(tmp.duration);
      tmp.onerror = rej;
    });

    this._st = {
      file, videoUrl, duration,
      segments: [{ start: 0, end: duration, keep: true }],
      history: [], inPoint: null, outPoint: null, selIdx: 0,
    };

    this._buildUI(this._mainEl);
    this._bindTimeline();
    this._bindKeys();
    this._thumbs(videoUrl, duration);
    this._raf();
  },

  // -Helpers -------
  _el(id)   { return this._mainEl?.querySelector(`#${id}`); },
  _vid()    { return this._el('ed-v'); },
  _segs()   { return this._st?.segments ?? []; },

  _push() {
    const st = this._st;
    st.history.push({ segs: st.segments.map(s => ({ ...s })), inP: st.inPoint, outP: st.outPoint });
    if (st.history.length > 60) st.history.shift();
  },

  _remountDrop() {
    if (this._keyH)  { window.removeEventListener('keydown', this._keyH); this._keyH = null; }
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    if (this._st?.videoUrl) URL.revokeObjectURL(this._st.videoUrl);
    this._st = null;
    makeDropZone(this._mainEl, 'cv-body', 'video/*',
      'MP4 · WebM · MKV · MOV · AVI',
      f => isVideo(f) && this._load(f));
  },

  // -UI build ------
  _buildUI(container) {
    const st = this._st;
    container.innerHTML = `
      <div class="ed">
        <div class="ed-cols">
          <div class="ed-left">
            <div class="ed-vwrap">
              <video class="ed-video" id="ed-v" src="${esc(st.videoUrl)}" preload="auto" tabindex="-1"></video>
            </div>
            <div class="ed-timebar">
              <span id="ed-cur">00:00.00</span>
              <span id="ed-dur">${fmtT(st.duration)}</span>
            </div>
            <div class="ed-tl" id="ed-tl">
              <div class="ed-film" id="ed-film"></div>
              <div class="ed-seglayer" id="ed-sl"></div>
              <div class="ed-inout" id="ed-io"></div>
              <div class="ed-ph" id="ed-ph" style="left:0"></div>
            </div>
            <div class="ed-chips" id="ed-chips"></div>
            <div class="ed-tb">
              <button class="ed-btn" id="ed-play"><span class="k">Space</span> ▶ Play</button>
              <button class="ed-btn" id="ed-in"><span class="k">I</span> In</button>
              <button class="ed-btn" id="ed-out"><span class="k">O</span> Out</button>
              <button class="ed-btn" id="ed-cut"><span class="k">X</span> Cut In→Out</button>
              <button class="ed-btn" id="ed-split"><span class="k">C</span> Split</button>
              <button class="ed-btn del" id="ed-tog"><span class="k">Del</span> Toggle</button>
              <button class="ed-btn" id="ed-undo"><span class="k">Ctrl+Z</span> Undo</button>
            </div>
            <div class="ed-hints">
              <span><kbd>Space</kbd> play/pause</span>
              <span><kbd>I</kbd> in point</span><span><kbd>O</kbd> out point</span>
              <span><kbd>X</kbd> cut in→out</span><span><kbd>C</kbd> split</span>
              <span><kbd>Del</kbd> toggle keep/cut</span>
              <span><kbd>Ctrl+←/→</kbd> ±1 frame</span><span><kbd>←/→</kbd> ±1s</span><span><kbd>Shift+←/→</kbd> ±5s</span>
              <span><kbd>J/K/L</kbd> rew/pause/fwd</span>
              <span><kbd>Ctrl+Z</kbd> undo</span><span><kbd>Enter</kbd> export</span>
            </div>
          </div>

          <div class="ed-right">
            <div class="cv-sec-lbl">Export</div>
            <div class="cv-setting-row">
              <span class="cv-setting-lbl">Format</span>
              <select class="cv-select" id="ed-fmt">
                <option value="mp4">MP4</option>
                <option value="webm">WebM</option>
                <option value="mkv">MKV</option>
                <option value="mov">MOV</option>
                <option value="avi">AVI</option>
                <option value="gif">GIF</option>
              </select>
            </div>
            ${videoSettingsHTML('ed-s')}
            <button class="ed-exp" id="ed-exp" style="width:100%;margin-top:4px">Export</button>
          </div>
        </div>

        <div class="cv-results" id="cv-results"></div>
        <div style="display:flex;align-items:center;gap:8px;padding-top:6px;border-top:1px solid var(--divider)">
          <span style="font-size:11px;color:var(--text-muted);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(st.file.name)}</span>
          <button class="cv-change" id="ed-ch" style="font-size:11px">Change file</button>
        </div>
      </div>
    `;

    const v = this._vid();
    v.addEventListener('timeupdate', () => this._syncTime());
    v.addEventListener('seeked',     () => this._syncTime());
    v.addEventListener('play',  () => { const b = this._el('ed-play'); if (b) b.innerHTML = '<span class="k">Space</span> ⏸ Pause'; });
    v.addEventListener('pause', () => { const b = this._el('ed-play'); if (b) b.innerHTML = '<span class="k">Space</span> ▶ Play'; });

    this._el('ed-ch').addEventListener('click', () => this._remountDrop());
    this._el('ed-play').addEventListener('click', () => this._togglePlay());
    this._el('ed-in').addEventListener('click',   () => this._setIn());
    this._el('ed-out').addEventListener('click',  () => this._setOut());
    this._el('ed-cut').addEventListener('click',  () => this._cutSel());
    this._el('ed-split').addEventListener('click',() => this._split());
    this._el('ed-tog').addEventListener('click',  () => this._toggle());
    this._el('ed-undo').addEventListener('click', () => this._undo());
    this._el('ed-exp').addEventListener('click',  () => this._export());

    this._redraw();
  },

  // -Operations ----
  _togglePlay() { const v = this._vid(); if (!v) return; v.paused ? v.play() : v.pause(); },

  _setIn()  { this._push(); this._st.inPoint  = this._vid()?.currentTime ?? 0; this._renderIO(); },
  _setOut() { this._push(); this._st.outPoint = this._vid()?.currentTime ?? this._st.duration; this._renderIO(); },

  _cutSel() {
    const { inPoint: a, outPoint: b } = this._st;
    if (a === null || b === null) return;
    this._push();
    this._st.segments = cutRange(this._st.segments, Math.min(a,b), Math.max(a,b));
    this._st.inPoint = null; this._st.outPoint = null;
    this._redraw();
  },

  _split() {
    const t = this._vid()?.currentTime ?? 0;
    this._push();
    this._st.segments = splitAt(this._st.segments, t);
    this._redraw();
  },

  _toggle() {
    const segs = this._st.segments, idx = this._st.selIdx;
    if (idx < 0 || idx >= segs.length) return;
    this._push();
    segs[idx] = { ...segs[idx], keep: !segs[idx].keep };
    this._st.segments = mergeSegs(segs);
    this._redraw();
  },

  _undo() {
    if (!this._st.history.length) return;
    const h = this._st.history.pop();
    this._st.segments = h.segs; this._st.inPoint = h.inP; this._st.outPoint = h.outP;
    this._redraw();
  },

  // -Rendering -----
  _syncTime() {
    const v = this._vid(); if (!v) return;
    const t = v.currentTime;

    // Auto-skip cut segments during playback
    if (!v.paused) {
      const seg = this._st.segments.find(s => t >= s.start && t < s.end);
      if (seg && !seg.keep) {
        const next = this._st.segments.find(s => s.keep && s.start >= seg.end);
        if (next) { v.currentTime = next.start; this._renderPH(next.start); return; }
        else       { v.pause(); }
      }
    }

    const cur = this._el('ed-cur');
    if (cur) cur.textContent = fmtT(t);
    const idx = this._st.segments.findIndex(s => t >= s.start - 0.01 && t < s.end + 0.01);
    if (idx !== -1 && idx !== this._st.selIdx) { this._st.selIdx = idx; this._renderSegs(); this._renderChips(); }
    this._renderPH();
  },

  _renderPH(t) {
    const ph = this._el('ed-ph');
    if (!ph) return;
    const time = t ?? this._vid()?.currentTime ?? 0;
    ph.style.left = `${clamp(time / this._st.duration * 100, 0, 100)}%`;
  },

  _renderSegs() {
    const layer = this._el('ed-sl'); if (!layer) return;
    const dur = this._st.duration;
    layer.innerHTML = this._st.segments.map((s, i) => {
      const l = (s.start / dur * 100).toFixed(4);
      const w = ((s.end - s.start) / dur * 100).toFixed(4);
      if (!s.keep) {
        return `<div class="ed-so cut" style="left:${l}%;width:${w}%"></div>`;
      }
      return `<div class="ed-so keep${i === this._st.selIdx ? ' sel' : ''}" data-i="${i}" style="left:calc(${l}% + 1px);width:calc(${w}% - 2px)"></div>`;
    }).join('');
    // Click a keep segment: select it (seeking handled by timeline mousedown)
    layer.querySelectorAll('.ed-so').forEach(el => {
      el.addEventListener('mousedown', () => {
        this._st.selIdx = parseInt(el.dataset.i);
        this._renderSegs();
        this._renderChips();
      });
    });
  },

  _renderChips() {
    const el = this._el('ed-chips'); if (!el) return;
    const segs = this._st.segments;
    if (segs.length === 1 && segs[0].keep) { el.textContent = 'Full video — split or cut to create segments'; return; }
    el.innerHTML = segs.map((s, i) => {
      const label = s.keep ? `${fmtT(s.start)}–${fmtT(s.end)}` : `✂ ${fmtT(s.start)}–${fmtT(s.end)}`;
      return `<span class="ed-chip ${s.keep ? 'keep' : 'cut'}${i === this._st.selIdx ? ' sel' : ''}" data-i="${i}" title="${s.keep ? 'Click to jump here' : 'Click to restore this segment'}">${label}</span>`;
    }).join('');
    el.querySelectorAll('.ed-chip').forEach(c => {
      c.addEventListener('click', () => {
        const i   = parseInt(c.dataset.i);
        const seg = this._st.segments[i];
        const v   = this._vid();
        if (!seg.keep) {
          // Cut chip clicked → restore it
          this._push();
          this._st.segments[i] = { ...seg, keep: true };
          this._st.segments = mergeSegs(this._st.segments);
        }
        // Seek to segment start and select
        this._st.selIdx = i;
        if (v) v.currentTime = this._st.segments[i]?.start + 0.01 ?? 0;
        this._redraw();
      });
    });
  },

  _renderIO() {
    const layer = this._el('ed-io'); if (!layer) return;
    const { inPoint: a, outPoint: b, duration } = this._st;
    let h = '';
    if (a !== null) h += `<div class="ed-inm"  style="left:${(a/duration*100).toFixed(4)}%"></div>`;
    if (b !== null) h += `<div class="ed-outm" style="left:${(b/duration*100).toFixed(4)}%"></div>`;
    if (a !== null && b !== null) {
      const lo = Math.min(a,b)/duration*100, hi = Math.max(a,b)/duration*100;
      h += `<div class="ed-range" style="left:${lo.toFixed(4)}%;width:${(hi-lo).toFixed(4)}%"></div>`;
    }
    layer.innerHTML = h;
  },

  _redraw() { this._renderSegs(); this._renderChips(); this._renderIO(); this._renderPH(); },

  // -Timeline interaction ---
  _bindTimeline() {
    const tl = this._el('ed-tl'); if (!tl) return;
    const seek = e => {
      const r = tl.getBoundingClientRect();
      const t = clamp((e.clientX - r.left) / r.width, 0, 1) * this._st.duration;
      const v = this._vid(); if (v) v.currentTime = t;
      this._renderPH(t);
      const cur = this._el('ed-cur'); if (cur) cur.textContent = fmtT(t);
    };
    tl.addEventListener('mousedown', e => {
      // Seek everywhere on the timeline, including on segment overlays
      seek(e);
      const mv = e => { if (e.buttons & 1) seek(e); };
      const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', mv);
      window.addEventListener('mouseup', up);
    });
  },

  // -Keyboard ------
  _bindKeys() {
    this._keyH = e => {
      if (!this._st || !this._mainEl) return;
      if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
      const v = this._vid();
      switch (e.code) {
        case 'Space':      e.preventDefault(); this._togglePlay(); break;
        case 'KeyI':       this._setIn(); break;
        case 'KeyO':       this._setOut(); break;
        case 'KeyX':       this._cutSel(); break;
        case 'KeyC':       if (!e.ctrlKey && !e.metaKey) this._split(); break;
        case 'Delete':
        case 'Backspace':  e.preventDefault(); this._toggle(); break;
        case 'KeyJ':       if (v) { v.pause(); v.currentTime = Math.max(0, v.currentTime - 2); } break;
        case 'KeyK':       if (v) v.pause(); break;
        case 'KeyL':       if (v) { v.pause(); v.currentTime = Math.min(this._st.duration, v.currentTime + 2); } break;
        case 'ArrowLeft':  if (v) { e.preventDefault(); v.pause(); const tL = Math.max(0, v.currentTime - (e.ctrlKey || e.metaKey ? 1/30 : e.shiftKey ? 5 : 1)); v.currentTime = tL; this._renderPH(tL); } break;
        case 'ArrowRight': if (v) { e.preventDefault(); v.pause(); const tR = Math.min(this._st.duration, v.currentTime + (e.ctrlKey || e.metaKey ? 1/30 : e.shiftKey ? 5 : 1)); v.currentTime = tR; this._renderPH(tR); } break;
        case 'KeyZ':       if (e.ctrlKey || e.metaKey) { e.preventDefault(); this._undo(); } break;
        case 'Enter':      if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); this._export(); } break;
      }
    };
    window.addEventListener('keydown', this._keyH);
  },

  // -RAF loop for smooth playhead -----
  _raf() {
    const tick = () => {
      if (!this._mainEl) return;
      const v = this._vid();
      if (v && !v.paused) {
        const t = v.currentTime;
        const seg = this._st?.segments.find(s => t >= s.start && t < s.end);
        if (seg && !seg.keep) {
          const next = this._st.segments.find(s => s.keep && s.start >= seg.end);
          if (next) { v.currentTime = next.start; this._renderPH(next.start); }
          else       { v.pause(); }
        } else {
          this._renderPH(t);
          const c = this._el('ed-cur'); if (c) c.textContent = fmtT(t);
        }
      }
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  },

  // -Thumbnails -----
  async _thumbs(videoUrl, duration) {
    const film = this._el('ed-film'); if (!film) return;
    const tv = document.createElement('video');
    tv.src = videoUrl; tv.muted = true; tv.preload = 'metadata';
    await new Promise(res => { tv.onloadedmetadata = res; tv.onerror = res; });
    const N = 24;
    for (let i = 0; i < N; i++) {
      if (!this._mainEl) break;
      await new Promise(res => {
        tv.onseeked = () => {
          try {
            const c = document.createElement('canvas'); c.width = 160; c.height = 90;
            c.getContext('2d').drawImage(tv, 0, 0, 160, 90);
            const img = document.createElement('img');
            img.src = c.toDataURL('image/jpeg', 0.45);
            img.style.cssText = `width:${(100/N).toFixed(3)}%;flex-shrink:0;height:100%;object-fit:cover`;
            film.appendChild(img);
          } catch {}
          res();
        };
        tv.onerror = res;
        tv.currentTime = (duration * i) / N;
      });
    }
  },

  // -Export -------
  async _export() {
    const st = this._st; if (!st) return;
    const toExt   = this._el('ed-fmt')?.value || 'mp4';
    const s       = readVideoSettings(this._mainEl, 'ed-s');
    const btn     = this._el('ed-exp');
    const results = this._el('cv-results');
    const inExt   = (st.file.name.split('.').pop() || 'mp4').toLowerCase();
    const outName = `${st.file.name.replace(/\.[^.]+$/, '')}-edited.${toExt}`;
    const r = makeResultRow(results, outName);
    r.showProgress(); btn.disabled = true;

    try {
      const { ff, fetchFile } = await loadFFmpeg(msg => r.setStatus(msg));
      r.setStatus('Probing…');
      await ff.writeFile(`in.${inExt}`, await fetchFile(st.file));
      const { audioCodec } = await probeInfo(ff, `in.${inExt}`);
      const skipAudio = CRASHY_AUDIO.has(audioCodec) || s.abr === '0';
      if (CRASHY_AUDIO.has(audioCodec)) r.setStatus(`Audio (${audioCodec}) skipped — not decodable in browser`);

      r.setStatus('Encoding…');
      let args = buildArgs(`in.${inExt}`, `out.${toExt}`, st.segments, toExt, !skipAudio, s);
      try {
        await ffExec(ff, args, msg => r.setStatus(msg), p => r.setProgress(p));
      } catch (e1) {
        const msg = String(e1?.message ?? e1);
        if (!msg.includes('atrim') && !msg.includes('audio') && !msg.includes('[oa]')) throw e1;
        r.setStatus('Retrying without audio…');
        args = buildArgs(`in.${inExt}`, `out.${toExt}`, st.segments, toExt, false, s);
        await ffExec(ff, args, msg => r.setStatus(msg), p => r.setProgress(p));
      }

      const data = await ff.readFile(`out.${toExt}`);
      ff.deleteFile(`in.${inExt}`).catch(() => {});
      ff.deleteFile(`out.${toExt}`).catch(() => {});
      r.hideProgress();
      const mime = { mp4:'video/mp4', webm:'video/webm', mkv:'video/x-matroska', mov:'video/quicktime', avi:'video/x-msvideo', gif:'image/gif' };
      r.succeed(new Blob([data.buffer], { type: mime[toExt] || 'video/mp4' }), outName);
    } catch (e) {
      r.hideProgress();
      const msg = e?.message ?? String(e);
      if (msg.includes('RuntimeError') || msg.includes('memory access')) resetFFmpeg();
      r.fail(msg);
    } finally { btn.disabled = false; }
  },
};
