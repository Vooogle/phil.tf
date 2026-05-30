import { esc, fmt, injectCSS, makeDropZone, makeResultRow } from './_ui.js';
import { loadFFmpeg, ffExec } from './_ffmpeg.js';

const MIME = { mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg', flac:'audio/flac', aac:'audio/aac', opus:'audio/opus' };
const FORMATS = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'opus'];

function isAudio(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return file.type.startsWith('audio/') || ['mp3','wav','ogg','flac','aac','m4a','opus','aiff'].includes(ext);
}

export default {
  id: 'audio-converter',
  name: 'Audio Converter',
  category: 'Media',
  description: 'Convert audio between MP3, WAV, OGG, FLAC, AAC, and Opus.',

  _mainEl: null,

  render(mainEl) {
    this._mainEl = mainEl;
    injectCSS();
    makeDropZone(mainEl, 'cv-body', 'audio/*',
      'MP3 · WAV · OGG · FLAC · AAC · M4A · Opus · AIFF',
      f => isAudio(f) && this._loadFile(f));
  },

  destroy() { this._mainEl = null; },

  _loadFile(file) {
    const body = this._mainEl.querySelector('#cv-body');
    body.innerHTML = `
      <div class="cv-card">
        <span style="font-size:22px;flex-shrink:0">🎵</span>
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
        <div class="cv-settings">
          <div class="cv-setting-row">
            <span class="cv-setting-lbl">Bitrate</span>
            <select class="cv-select" id="cv-s-abr">
              <option value="320k">320 kbps</option>
              <option value="256k">256 kbps</option>
              <option value="192k" selected>192 kbps</option>
              <option value="128k">128 kbps</option>
              <option value="96k">96 kbps</option>
              <option value="64k">64 kbps</option>
              <option value="32k">32 kbps</option>
            </select>
          </div>
          <div class="cv-setting-row">
            <span class="cv-setting-lbl">Sample rate</span>
            <select class="cv-select" id="cv-s-sr">
              <option value="">Original</option>
              <option value="48000">48 kHz</option>
              <option value="44100">44.1 kHz</option>
              <option value="22050">22 kHz</option>
              <option value="16000">16 kHz</option>
            </select>
          </div>
          <div class="cv-setting-row">
            <span class="cv-setting-lbl">Channels</span>
            <select class="cv-select" id="cv-s-ch">
              <option value="">Original</option>
              <option value="2">Stereo</option>
              <option value="1">Mono</option>
            </select>
          </div>
        </div>
      </div>
      <div class="cv-results" id="cv-results"></div>
    `;
    body.querySelector('#cv-change').addEventListener('click', () => { body.innerHTML = ''; });
    body.querySelectorAll('.cv-fmt').forEach(btn => {
      btn.addEventListener('click', () => this._convert(file, btn.dataset.fmt, btn));
    });
  },

  _settings() {
    const g = id => this._mainEl.querySelector(id)?.value || '';
    return { abr: g('#cv-s-abr') || '192k', sr: g('#cv-s-sr'), ch: g('#cv-s-ch') };
  },

  async _convert(file, toExt, btn) {
    const results = this._mainEl.querySelector('#cv-results');
    const s       = this._settings();
    const inExt   = (file.name.split('.').pop() || 'in').toLowerCase();
    const outName = `${file.name.replace(/\.[^.]+$/, '')}.${toExt}`;
    const r = makeResultRow(results, outName);
    r.showProgress();
    btn.disabled = true;
    try {
      const { ff, fetchFile } = await loadFFmpeg(msg => r.setStatus(msg));
      r.setStatus('Writing file…');
      await ff.writeFile(`in.${inExt}`, await fetchFile(file));

      const args = ['-i', `in.${inExt}`];
      if (!['wav','flac'].includes(toExt)) args.push('-b:a', s.abr);
      if (s.sr) args.push('-ar', s.sr);
      if (s.ch) args.push('-ac', s.ch);
      args.push('-y', `out.${toExt}`);

      await ffExec(ff, args, msg => r.setStatus(msg), p => r.setProgress(p));
      const data = await ff.readFile(`out.${toExt}`);
      ff.deleteFile(`in.${inExt}`).catch(() => {});
      ff.deleteFile(`out.${toExt}`).catch(() => {});

      r.hideProgress();
      r.succeed(new Blob([data.buffer], { type: MIME[toExt] || 'audio/mpeg' }), outName);
    } catch (e) { r.hideProgress(); r.fail(e?.message ?? String(e)); }
    finally     { btn.disabled = false; }
  },
};
