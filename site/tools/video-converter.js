import { esc, fmt, injectCSS, makeDropZone, makeResultRow } from './_ui.js';
import { loadFFmpeg, ffExec, probeInfo, CRASHY_AUDIO, resetFFmpeg } from './_ffmpeg.js';
import { isVideo, buildVf, vcodecArgs, buildAudioArgs, videoSettingsHTML, readVideoSettings } from './_video.js';

const MIME = {
  mp4:'video/mp4', webm:'video/webm', mkv:'video/x-matroska',
  mov:'video/quicktime', avi:'video/x-msvideo', gif:'image/gif',
};
const FORMATS = ['mp4', 'webm', 'mkv', 'mov', 'avi', 'gif'];

export default {
  id: 'video-converter',
  name: 'Video Converter',
  category: 'Video',
  description: 'Convert video between MP4, WebM, MKV, MOV, AVI, and GIF.',

  _mainEl: null,

  render(mainEl) {
    this._mainEl = mainEl;
    injectCSS();
    makeDropZone(mainEl, 'cv-body', 'video/*',
      'MP4 · WebM · MKV · MOV · AVI · M4V',
      f => isVideo(f) && this._loadFile(f));
  },

  destroy() { this._mainEl = null; },

  _loadFile(file) {
    const body = this._mainEl.querySelector('#cv-body');
    body.innerHTML = `
      <div class="cv-card">
        <span style="font-size:22px;flex-shrink:0">🎬</span>
        <div style="flex:1;min-width:0">
          <div class="cv-card-name" title="${esc(file.name)}">${esc(file.name)}</div>
          <div class="cv-card-meta">${fmt(file.size)}</div>
        </div>
        <button class="cv-change" id="cv-change">Change file</button>
      </div>
      <div class="cv-sec">
        <div class="cv-sec-lbl">Convert to</div>
        <div class="cv-fmts">
          ${FORMATS.map(f => `<button class="cv-fmt" data-fmt="${f}">${f.toUpperCase()}</button>`).join('')}
        </div>
      </div>
      <div class="cv-sec">
        <div class="cv-sec-lbl">Settings</div>
        ${videoSettingsHTML('vc')}
      </div>
      <div class="cv-results" id="cv-results"></div>
    `;
    body.querySelector('#cv-change').addEventListener('click', () => { body.innerHTML = ''; });
    body.querySelectorAll('.cv-fmt').forEach(btn => {
      btn.addEventListener('click', () => this._convert(file, btn.dataset.fmt, btn));
    });
  },

  async _convert(file, toExt, btn) {
    const results = this._mainEl.querySelector('#cv-results');
    const s       = readVideoSettings(this._mainEl, 'vc');
    const inExt   = (file.name.split('.').pop() || 'in').toLowerCase();
    const outName = `${file.name.replace(/\.[^.]+$/, '')}.${toExt}`;
    const r = makeResultRow(results, outName);
    r.showProgress();
    btn.disabled = true;

    try {
      const { ff, fetchFile } = await loadFFmpeg(msg => r.setStatus(msg));
      r.setStatus('Writing file…');
      await ff.writeFile(`in.${inExt}`, await fetchFile(file));

      r.setStatus('Probing…');
      const { audioCodec } = await probeInfo(ff, `in.${inExt}`);
      const skipAudio = CRASHY_AUDIO.has(audioCodec);
      if (skipAudio) r.setStatus(`Audio (${audioCodec}) skipped — not decodable in browser`);

      r.setStatus('Converting…');
      const vf   = buildVf(s, toExt);
      const args = ['-i', `in.${inExt}`, '-vf', vf, ...vcodecArgs(toExt, s), ...buildAudioArgs(toExt, s, skipAudio), '-y', `out.${toExt}`];

      await ffExec(ff, args, msg => r.setStatus(msg), p => r.setProgress(p));
      const data = await ff.readFile(`out.${toExt}`);
      ff.deleteFile(`in.${inExt}`).catch(() => {});
      ff.deleteFile(`out.${toExt}`).catch(() => {});

      r.hideProgress();
      r.succeed(new Blob([data.buffer], { type: MIME[toExt] || 'video/mp4' }), outName);
    } catch (e) {
      r.hideProgress();
      const msg = e?.message ?? String(e);
      if (msg.includes('RuntimeError') || msg.includes('memory access')) resetFFmpeg();
      r.fail(msg);
    } finally { btn.disabled = false; }
  },
};
