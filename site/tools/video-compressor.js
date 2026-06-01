import { esc, fmt, injectCSS, makeDropZone, makeResultRow } from './_ui.js';
import { loadFFmpeg, ffExec, parseFFmpegProgress, probeInfo, CRASHY_AUDIO, resetFFmpeg } from './_ffmpeg.js';
import { injectGuide } from './guide.js';

function isVideo(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return file.type.startsWith('video/') || ['mp4','webm','mov','avi','mkv','m4v','ogv'].includes(ext);
}

export default {
  id: 'video-compressor',
  name: 'Video Compressor',
  category: 'Video',
  description: 'Compress video to a target file size using 2-pass encoding.',
  guide: `## Video Compressor - Free Browser-Based Video Size Reduction
Compress video to a target file size using 2-pass FFmpeg encoding - runs entirely in your browser, no upload needed.

## How it works
2-pass encoding calculates the exact bitrate needed in the first pass, then encodes with that bitrate in the second pass. Much more accurate than single-pass compression.

## How to use
- Drop a video file or click to browse
- Set your target file size in MB
- Hit compress and wait for both passes to complete
- Download the compressed file

## Notes
- Files never leave your browser
- 2-pass encoding takes roughly 2x longer than single-pass
- Very aggressive targets (e.g. 10MB for a 1-hour video) will result in low quality - there are physical limits to compression
- Audio is also compressed to fit the target size
`,

  _mainEl: null,

  render(mainEl) {
    this._mainEl = mainEl;
    injectCSS();
    makeDropZone(mainEl, 'cv-body', 'video/*',
      'MP4 · WebM · MKV · MOV · AVI',
      f => isVideo(f) && this._loadFile(f));
    injectGuide(mainEl, this.guide);
  },

  destroy() { this._mainEl = null; },

  _loadFile(file) {
    const body = this._mainEl.querySelector('#cv-body');
    body.innerHTML = `
      <div class="cv-card">
        <span style="font-size:22px;flex-shrink:0">🎬</span>
        <div style="flex:1;min-width:0">
          <div class="cv-card-name" title="${esc(file.name)}">${esc(file.name)}</div>
          <div class="cv-card-meta">Original: ${fmt(file.size)}</div>
        </div>
        <button class="cv-change" id="cv-change">Change file</button>
      </div>

      <div class="cv-sec">
        <div class="cv-sec-lbl">Target size</div>
        <div class="cv-settings">
          <div class="cv-setting-row">
            <span class="cv-setting-lbl">Target (MB)</span>
            <input type="number" class="cv-input" id="cv-target-mb" value="10" min="0.1" max="9999" step="0.5" style="max-width:100px">
            <div style="display:flex;gap:4px;flex-wrap:wrap">
              ${[['8 MB','8'],['10 MB','10'],['25 MB','25'],['50 MB','50'],['100 MB','100']].map(([label, v]) =>
                `<button class="cv-tab" data-val="${v}" style="padding:3px 10px;font-size:11px">${label}</button>`
              ).join('')}
            </div>
          </div>
          <div class="cv-setting-row">
            <span class="cv-setting-lbl">Output format</span>
            <select class="cv-select" id="cv-fmt">
              <option value="mp4">MP4</option>
              <option value="mkv">MKV</option>
            </select>
          </div>
          <div class="cv-setting-row">
            <span class="cv-setting-lbl">Audio bitrate</span>
            <select class="cv-select" id="cv-abr">
              <option value="128k" selected>128 kbps</option>
              <option value="192k">192 kbps</option>
              <option value="96k">96 kbps</option>
              <option value="64k">64 kbps</option>
              <option value="0">Remove audio</option>
            </select>
          </div>
        </div>
      </div>

      <div class="cv-sec">
        <button class="cv-btn" id="cv-compress">Compress</button>
      </div>
      <div class="cv-results" id="cv-results"></div>
    `;

    // Preset buttons
    body.querySelectorAll('[data-val]').forEach(btn => {
      btn.addEventListener('click', () => {
        body.querySelector('#cv-target-mb').value = btn.dataset.val;
      });
    });

    body.querySelector('#cv-change').addEventListener('click', () => { body.innerHTML = ''; });
    body.querySelector('#cv-compress').addEventListener('click', () => {
      this._compress(file, body.querySelector('#cv-compress'));
    });
  },

  async _compress(file, btn) {
    const b = id => this._mainEl.querySelector(id);
    const targetMB = parseFloat(b('#cv-target-mb')?.value || '10');
    const toExt    = b('#cv-fmt')?.value   || 'mp4';
    const abr      = b('#cv-abr')?.value   || '128k';

    if (isNaN(targetMB) || targetMB <= 0) return;

    const results = this._mainEl.querySelector('#cv-results');
    const inExt   = (file.name.split('.').pop() || 'mp4').toLowerCase();
    const outName = `${file.name.replace(/\.[^.]+$/, '')}-compressed.${toExt}`;
    const r = makeResultRow(results, outName);
    r.showProgress();
    btn.disabled = true;

    try {
      const { ff, fetchFile } = await loadFFmpeg(msg => r.setStatus(msg));
      r.setStatus('Writing file…');
      await ff.writeFile(`in.${inExt}`, await fetchFile(file));

      r.setStatus('Probing…');
      const { duration, audioCodec } = await probeInfo(ff, `in.${inExt}`);
      const withAudio = abr !== '0' && !CRASHY_AUDIO.has(audioCodec);
      if (!withAudio && audioCodec) r.setStatus(`Note: audio (${audioCodec}) skipped — not decodable in browser`);

      const targetBits  = targetMB * 8 * 1024 * 1024;
      const audioBitNum = withAudio ? parseInt(abr) * 1000 : 0;
      const videoBits   = Math.max(50000, targetBits - audioBitNum * duration);
      const vBitrate    = Math.floor(videoBits / duration / 1000);

      r.setStatus(`Pass 1 / 2 — analyzing (target ${vBitrate} kbps video)…`);
      const pass1Logs = [];
      const logH1 = ({ message }) => {
        pass1Logs.push(message);
        const p = parseFFmpegProgress(message);
        if (p) r.setStatus(`Pass 1/2 — ${p}`);
      };
      const progH1 = ({ progress }) => r.setProgress(Math.max(0, Math.min(1, progress)) * 0.5);
      ff.on('log', logH1);
      ff.on('progress', progH1);
      // Use null muxer so pass 1 doesn't write/seek a real file — just generates passlog
      const ret1 = await ff.exec([
        '-y', '-i', `in.${inExt}`,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', `${vBitrate}k`,
        '-pass', '1', '-passlogfile', 'passlog',
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-pix_fmt', 'yuv420p',
        '-an', '-f', 'null', 'pass1.null',
      ]);
      ff.off('log', logH1);
      ff.off('progress', progH1);
      if (ret1 !== 0) {
        const isBanner = s => /^\s*(lib(av|sw|post)|  built |  config|Copyright|ffmpeg version \d)/.test(s);
        const clean = pass1Logs.filter(s => s && !isBanner(s));
        const errLines = clean.filter(s => /error|fail|invalid|cannot|not found|Abort/i.test(s));
        throw new Error(`Pass 1 failed: ${(errLines.length ? errLines : clean).slice(-6).join(' | ')}`);
      }

      r.setStatus('Pass 2 / 2 — encoding…');
      const logs2 = [];
      const logH2 = ({ message }) => {
        logs2.push(message);
        const p = parseFFmpegProgress(message);
        if (p) r.setStatus(`Pass 2/2 — ${p}`);
      };
      const progH2 = ({ progress }) => r.setProgress(0.5 + Math.max(0, Math.min(1, progress)) * 0.5);
      ff.on('log', logH2);
      ff.on('progress', progH2);

      const pass2Args = [
        '-i', `in.${inExt}`,
        '-c:v', 'libx264', '-preset', 'medium', '-b:v', `${vBitrate}k`,
        '-pass', '2', '-passlogfile', 'passlog',
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-pix_fmt', 'yuv420p',
      ];
      if (withAudio) {
        pass2Args.push('-c:a', 'aac', '-b:a', abr);
      } else {
        pass2Args.push('-an');
      }
      pass2Args.push('-y', `out.${toExt}`);

      const ret = await ff.exec(pass2Args);
      ff.off('log', logH2);
      ff.off('progress', progH2);

      if (ret !== 0) throw new Error(`FFmpeg failed: ${logs2.filter(Boolean).slice(-6).join(' | ')}`);

      const data = await ff.readFile(`out.${toExt}`);
      for (const f of [`in.${inExt}`, `out.${toExt}`, 'pass1out.mp4', 'passlog-0.log', 'passlog-0.log.mbtree']) {
        ff.deleteFile(f).catch(() => {});
      }

      r.hideProgress();
      const blob = new Blob([data.buffer], { type: 'video/mp4' });
      r.succeed(blob, outName);

      // Show actual vs target size
      const actualMB = (blob.size / 1024 / 1024).toFixed(2);
      const row = results.lastElementChild;
      const meta = row.querySelector('.cv-row-status');
      if (meta) meta.textContent += `  (target ${targetMB} MB, actual ${actualMB} MB)`;

    } catch (e) {
      r.hideProgress();
      const msg = e?.message ?? String(e);
      if (msg.includes('RuntimeError') || msg.includes('memory access')) resetFFmpeg();
      r.fail(msg);
    } finally { btn.disabled = false; }
  },
};
