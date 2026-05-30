// -Helpers -------------------------------------------------------------------

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmt(n) { return n < 1024 ? `${n}B` : n < 1048576 ? `${(n/1024).toFixed(1)}KB` : `${(n/1048576).toFixed(2)}MB`; }

const MIME_OUT = {
  jpeg:'image/jpeg', png:'image/png', webp:'image/webp',
  mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg', flac:'audio/flac', aac:'audio/aac', opus:'audio/opus',
  mp4:'video/mp4', webm:'video/webm', gif:'image/gif',
  txt:'text/plain', html:'text/html', md:'text/markdown', csv:'text/csv', json:'application/json',
};

function detectCategory(file) {
  const mime = file.type || '';
  const ext  = (file.name.split('.').pop() || '').toLowerCase();
  if (mime.startsWith('image/') || ['jpg','jpeg','png','gif','webp','bmp','avif','tiff','svg','ico'].includes(ext)) return 'image';
  if (mime.startsWith('audio/') || ['mp3','wav','ogg','flac','aac','m4a','opus','aiff'].includes(ext)) return 'audio';
  if (mime.startsWith('video/') || ['mp4','webm','mov','avi','mkv','m4v','ogv'].includes(ext)) return 'video';
  if (['text/plain','text/html','text/csv','application/json','text/markdown'].includes(mime) ||
      ['txt','html','htm','csv','json','md','markdown'].includes(ext)) return 'document';
  return null;
}

function getOutputFormats(file) {
  const cat = detectCategory(file);
  if (cat === 'image')    return ['jpeg', 'png', 'webp'];
  if (cat === 'audio')    return ['mp3', 'wav', 'ogg', 'flac', 'aac'];
  if (cat === 'video')    return ['mp4', 'webm', 'gif'];
  if (cat === 'document') return getDocFormats(file);
  return [];
}

function getDocFormats(file) {
  const ext  = (file.name.split('.').pop() || '').toLowerCase();
  const mime = file.type || '';
  if (ext === 'csv'  || mime === 'text/csv')            return ['json'];
  if (ext === 'json' || mime === 'application/json')    return ['csv'];
  if (['md','markdown'].includes(ext))                  return ['html', 'txt'];
  if (['html','htm'].includes(ext) || mime === 'text/html') return ['txt', 'md'];
  if (ext === 'txt'  || mime === 'text/plain')          return ['html', 'md'];
  return [];
}

// -Image conversion (Canvas) ------------------------------------------------

async function convertImage(file, toExt) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (toExt === 'jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      ctx.drawImage(img, 0, 0);
      const mime = MIME_OUT[toExt] || `image/${toExt}`;
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas toBlob failed')), mime, toExt === 'jpeg' ? 0.92 : undefined);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
    img.src = url;
  });
}

// -Audio/Video conversion (ffmpeg.wasm) -------------------------------------

let _ffmod = null;

async function loadFFmpeg(onStatus) {
  if (_ffmod) return _ffmod;
  onStatus('Loading FFmpeg (~30 MB, cached after first load)…');

  const { FFmpeg }               = await import('https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js');
  const { fetchFile, toBlobURL } = await import('https://unpkg.com/@ffmpeg/util@0.12.1/dist/esm/index.js');

  // FFmpeg constructor calls `new Worker(cdnUrl, {type:'module'})` which browsers
  // block as cross-origin. Intercept it and redirect to our same-origin proxy.
  const _W = window.Worker;
  window.Worker = function(url, opts) {
    const href = url instanceof URL ? url.href : String(url);
    return new _W(href.includes('@ffmpeg/ffmpeg') ? '/assets/ffmpeg-worker.js' : url, opts);
  };
  const ff = new FFmpeg();
  window.Worker = _W;

  const base = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
  await ff.load({
    coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  _ffmod = { ff, fetchFile };
  return _ffmod;
}

async function convertAV(file, toExt, onStatus, onProgress) {
  const { ff, fetchFile } = await loadFFmpeg(onStatus);
  const inExt  = (file.name.split('.').pop() || 'in').toLowerCase();
  const inName  = `in.${inExt}`;
  const outName = `out.${toExt}`;

  ff.on('progress', ({ progress }) => onProgress(Math.max(0, Math.min(1, progress))));

  onStatus('Writing file…');
  await ff.writeFile(inName, await fetchFile(file));

  onStatus('Converting…');
  const args = ['-i', inName];
  if      (toExt === 'gif')  args.push('-vf', 'fps=10,scale=480:-1:flags=lanczos', '-loop', '0');
  else if (toExt === 'mp3')  args.push('-q:a', '2');
  else if (toExt === 'aac')  args.push('-b:a', '192k');
  else if (toExt === 'opus') args.push('-b:a', '128k');
  args.push('-y', outName);

  await ff.exec(args);
  const data = await ff.readFile(outName);
  ff.deleteFile(inName).catch(() => {});
  ff.deleteFile(outName).catch(() => {});

  return new Blob([data.buffer], { type: MIME_OUT[toExt] || 'application/octet-stream' });
}

// -Document conversion (pure JS) --------------------------------------------

async function convertDocument(file, toExt) {
  const text = await file.text();
  const ext  = (file.name.split('.').pop() || '').toLowerCase();

  if (toExt === 'json') return new Blob([csvToJson(text)],  { type: 'application/json' });
  if (toExt === 'csv')  return new Blob([jsonToCsv(text)],  { type: 'text/csv' });
  if (toExt === 'html') return new Blob([['md','markdown'].includes(ext) ? mdToHtml(text) : txtToHtml(text)], { type: 'text/html' });
  if (toExt === 'txt')  return new Blob([['html','htm'].includes(ext) ? htmlToTxt(text) : text], { type: 'text/plain' });
  if (toExt === 'md')   return new Blob([['html','htm'].includes(ext) ? htmlToMd(text) : text],  { type: 'text/markdown' });
  throw new Error(`No converter for → ${toExt}`);
}

function parseCsvLine(line) {
  const r = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { if (q && line[i+1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (line[i] === ',' && !q) { r.push(cur); cur = ''; }
    else cur += line[i];
  }
  r.push(cur); return r;
}

function csvToJson(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error('CSV needs a header row + data');
  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).filter(Boolean).map(l => {
    const v = parseCsvLine(l); const o = {};
    headers.forEach((h, i) => { o[h.trim()] = v[i] ?? ''; });
    return o;
  });
  return JSON.stringify(rows, null, 2);
}

function jsonToCsv(text) {
  let data; try { data = JSON.parse(text); } catch { throw new Error('Invalid JSON'); }
  if (!Array.isArray(data) || !data.length) throw new Error('JSON must be a non-empty array of objects');
  const headers = Object.keys(data[0]);
  const esc2 = v => { const s = String(v ?? ''); return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g,'""')}"` : s; };
  return [headers.join(','), ...data.map(r => headers.map(h => esc2(r[h])).join(','))].join('\n');
}

function mdToHtml(md) {
  let h = md.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/^### (.+)$/gm,'<h3>$1</h3>').replace(/^## (.+)$/gm,'<h2>$1</h2>').replace(/^# (.+)$/gm,'<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/`(.+?)`/g,'<code>$1</code>').replace(/\[(.+?)\]\((.+?)\)/g,'<a href="$2">$1</a>');
  const blocks = h.split(/\n{2,}/).map(b => {
    b = b.trim(); if (!b) return '';
    return /^<(h[1-6]|pre)/.test(b) ? b : `<p>${b.replace(/\n/g,'<br>')}</p>`;
  }).join('\n');
  return `<!DOCTYPE html>\n<html>\n<body>\n${blocks}\n</body>\n</html>`;
}

function txtToHtml(text) {
  const e = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const blocks = e(text).split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g,'<br>')}</p>`).join('\n');
  return `<!DOCTYPE html>\n<html>\n<body>\n${blocks}\n</body>\n</html>`;
}

function htmlToTxt(html) {
  try { return new DOMParser().parseFromString(html, 'text/html').body.innerText; }
  catch { return html.replace(/<[^>]+>/g, ''); }
}

function htmlToMd(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  function walk(n) {
    if (n.nodeType === 3) return n.textContent;
    if (n.nodeType !== 1) return '';
    const kids = [...n.childNodes].map(walk).join('');
    switch (n.tagName?.toLowerCase()) {
      case 'h1': return `# ${kids}\n\n`;
      case 'h2': return `## ${kids}\n\n`;
      case 'h3': return `### ${kids}\n\n`;
      case 'p':  return `${kids}\n\n`;
      case 'br': return '\n';
      case 'strong': case 'b': return `**${kids}**`;
      case 'em':     case 'i': return `*${kids}*`;
      case 'a':  return `[${kids}](${n.getAttribute('href') || ''})`;
      case 'code': return `\`${kids}\``;
      case 'li': return `- ${kids}\n`;
      default:   return kids;
    }
  }
  return walk(doc.body).trim();
}

// -Tool export ---------------------------------------------------------------

export default {
  id: 'file-converter',
  name: 'File Converter',
  category: 'Utilities',
  description: 'Convert images, audio, video, and documents entirely in your browser — nothing is uploaded.',

  _mainEl: null,

  render(mainEl) {
    this._mainEl = mainEl;
    this._injectCSS();
    this._mount();
  },

  destroy() {
    this._mainEl = null;
    document.getElementById('fc-css')?.remove();
  },

  _injectCSS() {
    if (document.getElementById('fc-css')) return;
    const s = document.createElement('style'); s.id = 'fc-css';
    s.textContent = `
      .fc-wrap{padding:24px;max-width:580px;margin:0 auto}
      .fc-drop{border:2px dashed var(--divider);border-radius:10px;padding:48px 24px;text-align:center;cursor:pointer;transition:border-color .15s,background .15s;user-select:none}
      .fc-drop.on,.fc-drop:hover{border-color:var(--text);background:var(--surface)}
      .fc-drop-icon{margin-bottom:12px}
      .fc-drop-icon img{width:28px;height:28px;opacity:.4}
      .fc-drop-text{font-size:14px;color:var(--text)}
      .fc-browse{color:var(--text);cursor:pointer;text-decoration:underline}
      .fc-drop-sub{font-size:12px;color:var(--text-muted);margin-top:6px}
      .fc-card{background:var(--surface);border:1px solid var(--divider);border-radius:8px;padding:12px 16px;margin-top:16px;display:flex;align-items:center;gap:12px}
      .fc-card-name{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
      .fc-card-meta{font-size:11px;color:var(--text-muted);margin-top:2px}
      .fc-change{margin-left:auto;font-size:11px;color:var(--text-muted);cursor:pointer;text-decoration:underline;flex-shrink:0;background:none;border:none;font-family:inherit;padding:0}
      .fc-sec{margin-top:18px}
      .fc-sec-lbl{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:8px}
      .fc-fmts{display:flex;flex-wrap:wrap;gap:6px}
      .fc-fmt{padding:6px 16px;border:1px solid var(--divider);background:var(--bg);color:var(--text);border-radius:var(--radius);font-size:12px;font-family:inherit;cursor:pointer;transition:background .1s,border-color .1s;font-weight:600;text-transform:uppercase;letter-spacing:.06em}
      .fc-fmt:hover{background:var(--surface);border-color:var(--text)}
      .fc-fmt:disabled{opacity:.4;cursor:default}
      .fc-results{margin-top:10px;display:flex;flex-direction:column;gap:6px}
      .fc-row{padding:10px 14px;background:var(--surface);border:1px solid var(--divider);border-radius:var(--radius);display:flex;align-items:center;gap:10px;font-size:13px}
      .fc-row-info{flex:1;min-width:0}
      .fc-row-status{font-size:12px;color:var(--text-muted);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .fc-dl{color:var(--text);font-weight:600;text-decoration:none;padding:5px 12px;border:1px solid var(--divider);border-radius:var(--radius);background:var(--bg);font-size:12px;white-space:nowrap;flex-shrink:0}
      .fc-dl:hover{background:var(--surface-hover)}
      .fc-err{color:#e44}
      .fc-prog{height:3px;background:var(--divider);border-radius:2px;overflow:hidden;margin-top:5px}
      .fc-prog-fill{height:100%;background:var(--text);border-radius:2px;transition:width .2s}
      @keyframes fc-pulse{0%,100%{opacity:.3}50%{opacity:1}}
      .fc-spin{animation:fc-pulse 1.2s ease-in-out infinite}
    `;
    document.head.appendChild(s);
  },

  _mount() {
    const main = this._mainEl;
    main.innerHTML = `
      <div class="fc-wrap">
        <div class="fc-drop" id="fc-drop">
          <div class="fc-drop-icon"><img src="/assets/icons/up.svg" alt="Upload"></div>
          <div class="fc-drop-text">Drop a file here or <label class="fc-browse">browse<input type="file" id="fc-file" style="display:none"></label></div>
          <div class="fc-drop-sub">Images · Audio · Video · Documents</div>
        </div>
        <div id="fc-body"></div>
      </div>
    `;
    const drop  = main.querySelector('#fc-drop');
    const input = main.querySelector('#fc-file');
    drop.addEventListener('dragover',  e => { e.preventDefault(); drop.classList.add('on'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('on'));
    drop.addEventListener('drop',      e => { e.preventDefault(); drop.classList.remove('on'); const f = e.dataTransfer.files[0]; if (f) this._loadFile(f); });
    drop.addEventListener('click',     e => { if (e.target !== input) input.click(); });
    input.addEventListener('change',   e => { const f = e.target.files[0]; if (f) { this._loadFile(f); e.target.value = ''; } });
  },

  _loadFile(file) {
    const main    = this._mainEl;
    const body    = main.querySelector('#fc-body');
    const cat     = detectCategory(file);
    const formats = getOutputFormats(file);
    const icons   = { image: '🖼', audio: '🎵', video: '🎬', document: '📄' };
    const labels  = { image: 'Image', audio: 'Audio', video: 'Video', document: 'Document' };

    if (!cat || !formats.length) {
      body.innerHTML = `
        <div class="fc-card">
          <span style="font-size:22px">${cat ? icons[cat] : '?'}</span>
          <div><div class="fc-card-name">${esc(file.name)}</div>
          <div class="fc-card-meta fc-err">${cat ? 'No conversions available for this format.' : 'Unsupported file type.'}</div></div>
        </div>`;
      return;
    }

    body.innerHTML = `
      <div class="fc-card">
        <span style="font-size:22px;flex-shrink:0">${icons[cat]}</span>
        <div style="flex:1;min-width:0">
          <div class="fc-card-name" title="${esc(file.name)}">${esc(file.name)}</div>
          <div class="fc-card-meta">${labels[cat]} · ${fmt(file.size)}</div>
        </div>
        <button class="fc-change" id="fc-change">Change file</button>
      </div>
      <div class="fc-sec">
        <div class="fc-sec-lbl">Convert to</div>
        <div class="fc-fmts">
          ${formats.map(f => `<button class="fc-fmt" data-fmt="${f}">${f.toUpperCase()}</button>`).join('')}
        </div>
      </div>
      <div class="fc-results" id="fc-results"></div>
    `;

    main.querySelector('#fc-change').addEventListener('click', () => {
      body.innerHTML = '';
      main.querySelector('#fc-file').value = '';
    });

    main.querySelectorAll('.fc-fmt').forEach(btn => {
      btn.addEventListener('click', () => this._convert(file, cat, btn.dataset.fmt, btn));
    });
  },

  async _convert(file, cat, toExt, btn) {
    const results  = this._mainEl.querySelector('#fc-results');
    const baseName = file.name.replace(/\.[^.]+$/, '');
    const outName  = `${baseName}.${toExt}`;

    const row = document.createElement('div');
    row.className = 'fc-row';
    row.innerHTML = `
      <div class="fc-row-info">
        <div style="font-size:13px;font-weight:600">${esc(outName)}</div>
        <div class="fc-row-status fc-spin" id="fc-st-${toExt}">Working…</div>
        <div class="fc-prog" id="fc-pg-${toExt}" style="display:none"><div class="fc-prog-fill" style="width:0%"></div></div>
      </div>
    `;
    results.appendChild(row);
    btn.disabled = true;

    const stEl = row.querySelector(`#fc-st-${toExt}`);
    const pgEl = row.querySelector(`#fc-pg-${toExt}`);
    const setStatus = s => { stEl.textContent = s; };

    try {
      let blob;

      if (cat === 'image') {
        setStatus('Converting…');
        blob = await convertImage(file, toExt);

      } else if (cat === 'audio' || cat === 'video') {
        pgEl.style.display = '';
        const fill = pgEl.querySelector('.fc-prog-fill');
        blob = await convertAV(file, toExt,
          msg => setStatus(msg),
          pct => { fill.style.width = `${Math.round(pct * 100)}%`; }
        );
        pgEl.style.display = 'none';

      } else {
        setStatus('Converting…');
        blob = await convertDocument(file, toExt);
      }

      const url = URL.createObjectURL(blob);
      stEl.classList.remove('fc-spin');
      setStatus(`✓  ${fmt(blob.size)}`);

      const a = document.createElement('a');
      a.href = url; a.download = outName; a.className = 'fc-dl'; a.textContent = 'Download';
      a.addEventListener('click', () => setTimeout(() => URL.revokeObjectURL(url), 60000));
      row.appendChild(a);

    } catch (e) {
      stEl.classList.remove('fc-spin');
      stEl.innerHTML = `<span class="fc-err">Error: ${esc(e.message)}</span>`;
    } finally {
      btn.disabled = false;
    }
  },
};
