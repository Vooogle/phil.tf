// -Helpers -------------------------------------------------------------------

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmt(n) { return n < 1024 ? `${n}B` : n < 1048576 ? `${(n/1024).toFixed(1)}KB` : `${(n/1048576).toFixed(2)}MB`; }

const MIME_OUT = {
  jpeg:'image/jpeg', png:'image/png', webp:'image/webp',
  mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg', flac:'audio/flac', aac:'audio/aac', opus:'audio/opus',
  mp4:'video/mp4', webm:'video/webm', mkv:'video/x-matroska', mov:'video/quicktime', avi:'video/x-msvideo', gif:'image/gif',
  txt:'text/plain', html:'text/html', md:'text/markdown', csv:'text/csv', json:'application/json', pdf:'application/pdf',
  xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function detectCategory(file) {
  const mime = file.type || '';
  const ext  = (file.name.split('.').pop() || '').toLowerCase();
  if (mime.startsWith('image/') || ['jpg','jpeg','png','gif','webp','bmp','avif','tiff','svg','ico'].includes(ext)) return 'image';
  if (mime.startsWith('audio/') || ['mp3','wav','ogg','flac','aac','m4a','opus','aiff'].includes(ext)) return 'audio';
  if (mime.startsWith('video/') || ['mp4','webm','mov','avi','mkv','m4v','ogv'].includes(ext)) return 'video';
  if (['text/plain','text/html','text/csv','application/json','text/markdown','application/pdf'].includes(mime) ||
      mime.includes('wordprocessingml') || mime.includes('spreadsheetml') || mime.includes('ms-excel') ||
      ['txt','html','htm','csv','json','md','markdown','pdf','docx','doc','xlsx','xls','ods'].includes(ext)) return 'document';
  return null;
}

function getOutputFormats(file) {
  const cat = detectCategory(file);
  if (cat === 'image')    return ['jpeg', 'png', 'webp'];
  if (cat === 'audio')    return ['mp3', 'wav', 'ogg', 'flac', 'aac'];
  if (cat === 'video')    return ['mp4', 'webm', 'mkv', 'mov', 'avi', 'gif'];
  if (cat === 'document') return getDocFormats(file);
  return [];
}

function getDocFormats(file) {
  const ext  = (file.name.split('.').pop() || '').toLowerCase();
  const mime = file.type || '';
  if (ext === 'pdf'  || mime === 'application/pdf')                                        return ['txt', 'html'];
  if (['docx','doc'].includes(ext) || mime.includes('wordprocessingml'))                   return ['html', 'txt', 'md', 'pdf'];
  if (['xlsx','xls','ods'].includes(ext) || mime.includes('spreadsheetml') || mime.includes('ms-excel')) return ['csv', 'json'];
  if (ext === 'csv'  || mime === 'text/csv')                                               return ['json', 'xlsx'];
  if (ext === 'json' || mime === 'application/json')                                       return ['csv'];
  if (['md','markdown'].includes(ext))                                                     return ['html', 'txt', 'pdf'];
  if (['html','htm'].includes(ext) || mime === 'text/html')                                return ['txt', 'md', 'pdf'];
  if (ext === 'txt'  || mime === 'text/plain')                                             return ['html', 'md', 'pdf'];
  return [];
}

// -Image conversion (Canvas) ------------------------------------------------

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
      const mime = MIME_OUT[toExt] || `image/${toExt}`;
      const q = (toExt === 'jpeg' || toExt === 'webp') ? (settings.quality ?? 0.92) : undefined;
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas toBlob failed')), mime, q);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
    img.src = url;
  });
}

// -Audio/Video conversion (ffmpeg.wasm) -------------------------------------

let _ffmod = null;

async function loadFFmpeg(onStatus) {
  if (_ffmod) return _ffmod;
  const mt = self.crossOriginIsolated === true;
  onStatus(`Loading FFmpeg (~${mt ? '32' : '30'} MB, cached after first load)…`);

  const { FFmpeg }               = await import('https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js');
  const { fetchFile, toBlobURL } = await import('https://unpkg.com/@ffmpeg/util@0.12.1/dist/esm/index.js');

  // FFmpeg creates the worker inside ff.load(), not new FFmpeg() — keep patch
  // active through load() so the cross-origin worker URL gets redirected.
  const _W = window.Worker;
  window.Worker = function(url, opts) {
    const href = url instanceof URL ? url.href : String(url);
    return new _W(href.includes('@ffmpeg/ffmpeg') ? '/assets/ffmpeg-worker.js' : url, opts);
  };
  const ff = new FFmpeg();

  const base = mt
    ? 'https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/esm'
    : 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
  const loadOpts = {
    coreURL: await toBlobURL(`${base}/ffmpeg-core.js`,  'text/javascript'),
    wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
  };
  if (mt) loadOpts.workerURL = await toBlobURL(`${base}/ffmpeg-core.worker.js`, 'text/javascript');

  try {
    await ff.load(loadOpts);
  } finally {
    window.Worker = _W;
  }
  _ffmod = { ff, fetchFile };
  return _ffmod;
}

function parseFFmpegProgress(msg) {
  if (!msg.includes('frame=') && !msg.includes('size=')) return null;
  const get = (key) => { const m = msg.match(new RegExp(key + '\\s*=\\s*([\\S]+)')); return m ? m[1] : null; };
  const parts = [];
  const frame = get('frame'); if (frame) parts.push(`frame ${frame}`);
  const fps   = get('fps');   if (fps && fps !== '0') parts.push(`${fps} fps`);
  const size  = get('size');  if (size) parts.push(size);
  const time  = get('time');  if (time && time !== 'N/A') parts.push(time);
  const speed = get('speed'); if (speed && speed !== '0x') parts.push(`${speed}`);
  return parts.length ? parts.join('  ·  ') : null;
}

async function convertAV(file, toExt, onStatus, onProgress, settings = {}) {
  const { ff, fetchFile } = await loadFFmpeg(onStatus);
  const inExt  = (file.name.split('.').pop() || 'in').toLowerCase();
  const inName  = `in.${inExt}`;
  const outName = `out.${toExt}`;

  ff.on('progress', ({ progress }) => onProgress(Math.max(0, Math.min(1, progress))));

  onStatus('Writing file…');
  await ff.writeFile(inName, await fetchFile(file));

  onStatus('Converting…');
  const args = ['-i', inName];

  const isVideoOut = ['mp4','webm','mkv','mov','avi','gif'].includes(toExt);

  if (isVideoOut) {
    const crf_x264 = { high:'18', medium:'23', low:'28', tiny:'35' }[settings.quality || 'medium'];
    const crf_vp9  = { high:'20', medium:'33', low:'40', tiny:'55' }[settings.quality || 'medium'];

    if (toExt === 'gif') {
      const gfps = settings.fps || '10';
      const gw   = settings.res || '480';
      args.push('-vf', `fps=${gfps},scale=${gw}:-1:flags=lanczos`, '-loop', '0');
    } else {
      const vf = [
        settings.fps ? `fps=${settings.fps}` : null,
        settings.res ? `scale=-2:${settings.res}` : 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      ].filter(Boolean).join(',');
      if (toExt === 'webm') {
        args.push('-vf', vf, '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-crf', crf_vp9, '-b:v', '0');
      } else {
        args.push('-vf', vf, '-c:v', 'libx264', '-preset', settings.preset || 'ultrafast', '-pix_fmt', 'yuv420p', '-crf', crf_x264);
      }
      if (settings.abr) args.push('-b:a', settings.abr);
    }
    if (settings.sr) args.push('-ar', settings.sr);
    if (settings.ch) args.push('-ac', settings.ch);
  } else {
    // audio-only output
    const abr = settings.abr || (toExt === 'opus' ? '128k' : '192k');
    if (!['wav','flac'].includes(toExt)) args.push('-b:a', abr);
    if (settings.sr) args.push('-ar', settings.sr);
    if (settings.ch) args.push('-ac', settings.ch);
  }

  args.push('-y', outName);

  const logs = [];
  const logHandler = ({ message }) => {
    logs.push(message);
    const parsed = parseFFmpegProgress(message);
    if (parsed) onStatus(parsed);
  };
  ff.on('log', logHandler);
  const ret = await ff.exec(args);
  ff.off('log', logHandler);
  if (ret !== 0) throw new Error(`FFmpeg failed: ${logs.filter(Boolean).slice(-6).join(' | ')}`);
  const data = await ff.readFile(outName);
  ff.deleteFile(inName).catch(() => {});
  ff.deleteFile(outName).catch(() => {});

  return new Blob([data.buffer], { type: MIME_OUT[toExt] || 'application/octet-stream' });
}

// -Document conversion -------------------------------------------------------

// Lazy library cache
const _docLibs = {};

function _loadScript(key, url, globalKey) {
  if (_docLibs[key]) return Promise.resolve(_docLibs[key]);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-lib="${key}"]`);
    if (existing) {
      const poll = setInterval(() => { if (window[globalKey]) { clearInterval(poll); _docLibs[key] = window[globalKey]; resolve(_docLibs[key]); } }, 50);
      return;
    }
    const s = document.createElement('script');
    s.src = url; s.dataset.lib = key;
    s.onload  = () => { _docLibs[key] = window[globalKey]; resolve(_docLibs[key]); };
    s.onerror = () => reject(new Error(`Failed to load ${key}`));
    document.head.appendChild(s);
  });
}

async function _loadPdfjs() {
  if (_docLibs.pdfjs) return _docLibs.pdfjs;
  const lib = await import('https://unpkg.com/pdfjs-dist@4.4.168/build/pdf.min.mjs');
  lib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs';
  _docLibs.pdfjs = lib;
  return lib;
}
async function _loadMammoth() {
  return _loadScript('mammoth', 'https://unpkg.com/mammoth@1.8.0/mammoth.browser.min.js', 'mammoth');
}
async function _loadXlsx() {
  if (_docLibs.xlsx) return _docLibs.xlsx;
  const lib = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.mjs');
  _docLibs.xlsx = lib;
  return lib;
}
async function _loadJsPdf() {
  const lib = await _loadScript('jspdf', 'https://unpkg.com/jspdf@2.5.2/dist/jspdf.umd.min.js', 'jspdf');
  return lib.jsPDF;
}

async function _pdfToText(file, onStatus) {
  onStatus('Loading PDF.js (~2 MB)…');
  const pdfjsLib = await _loadPdfjs();
  onStatus('Reading PDF…');
  const doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    onStatus(`Extracting text — page ${i} / ${doc.numPages}…`);
    const page    = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('').trim());
  }
  return pages.join('\n\n');
}

async function _docxToContent(file, toExt, onStatus) {
  onStatus('Loading mammoth.js…');
  const mammoth = await _loadMammoth();
  onStatus('Converting…');
  const buf = await file.arrayBuffer();
  if (toExt === 'html') return (await mammoth.convertToHtml({ arrayBuffer: buf })).value;
  return (await mammoth.extractRawText({ arrayBuffer: buf })).value;
}

async function _xlsxToContent(file, toExt, onStatus) {
  onStatus('Loading SheetJS…');
  const XLSX = await _loadXlsx();
  onStatus('Reading spreadsheet…');
  const wb = XLSX.read(await file.arrayBuffer());
  if (toExt === 'json') {
    const out = wb.SheetNames.length === 1
      ? XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])
      : Object.fromEntries(wb.SheetNames.map(n => [n, XLSX.utils.sheet_to_json(wb.Sheets[n])]));
    return JSON.stringify(out, null, 2);
  }
  if (toExt === 'csv') return XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
  // xlsx output (csv→xlsx)
  const ws = XLSX.utils.aoa_to_sheet(file._cachedAoa || []);
  const newWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(newWb, ws, 'Sheet1');
  return XLSX.write(newWb, { type: 'array', bookType: 'xlsx' });
}

async function _csvToXlsx(text, onStatus) {
  onStatus('Loading SheetJS…');
  const XLSX = await _loadXlsx();
  onStatus('Converting…');
  const ws = XLSX.utils.aoa_to_sheet(text.trim().split(/\r?\n/).map(l => {
    const r = []; let cur = '', q = false;
    for (let i = 0; i < l.length; i++) {
      if (l[i] === '"') { if (q && l[i+1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (l[i] === ',' && !q) { r.push(cur); cur = ''; }
      else cur += l[i];
    }
    r.push(cur); return r;
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

async function _toPdf(text, onStatus) {
  onStatus('Loading jsPDF…');
  const JsPDF = await _loadJsPdf();
  onStatus('Generating PDF…');
  const doc      = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const margin   = 15;
  const maxW     = doc.internal.pageSize.getWidth()  - margin * 2;
  const maxH     = doc.internal.pageSize.getHeight() - margin;
  const lineH    = 6;
  doc.setFontSize(11);
  let y = margin;
  for (const line of doc.splitTextToSize(text, maxW)) {
    if (y + lineH > maxH) { doc.addPage(); y = margin; }
    doc.text(line, margin, y);
    y += lineH;
  }
  return doc.output('blob');
}

async function convertDocument(file, toExt, onStatus = () => {}) {
  const ext  = (file.name.split('.').pop() || '').toLowerCase();
  const mime = file.type || '';

  // PDF input
  if (ext === 'pdf' || mime === 'application/pdf') {
    const text = await _pdfToText(file, onStatus);
    if (toExt === 'html') return new Blob([txtToHtml(text)], { type: 'text/html' });
    return new Blob([text], { type: 'text/plain' });
  }

  // DOCX/DOC input
  if (['docx','doc'].includes(ext) || mime.includes('wordprocessingml')) {
    const content = await _docxToContent(file, toExt, onStatus);
    if (toExt === 'html') return new Blob([content], { type: 'text/html' });
    if (toExt === 'md')   return new Blob([htmlToMd(content)], { type: 'text/markdown' });
    if (toExt === 'pdf')  return _toPdf(htmlToTxt(content), onStatus);
    return new Blob([content], { type: 'text/plain' });
  }

  // XLSX/XLS/ODS input
  if (['xlsx','xls','ods'].includes(ext) || mime.includes('spreadsheetml') || mime.includes('ms-excel')) {
    onStatus('Loading SheetJS…');
    const content = await _xlsxToContent(file, toExt, onStatus);
    if (toExt === 'json') return new Blob([content], { type: 'application/json' });
    return new Blob([content], { type: 'text/csv' });
  }

  // Plain text formats
  const text = await file.text();

  if (toExt === 'xlsx') return new Blob([await _csvToXlsx(text, onStatus)], { type: MIME_OUT.xlsx || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  if (toExt === 'pdf')  return _toPdf(['html','htm'].includes(ext) ? htmlToTxt(text) : text, onStatus);
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
      .fc-settings{display:flex;flex-direction:column;gap:7px}
      .fc-setting-row{display:flex;align-items:center;gap:10px}
      .fc-setting-lbl{font-size:12px;color:var(--text-muted);width:90px;flex-shrink:0}
      .fc-select{flex:1;background:var(--bg);border:1px solid var(--divider);color:var(--text);border-radius:var(--radius);font-size:12px;padding:4px 8px;font-family:inherit;cursor:pointer}
      .fc-select:focus{outline:none;border-color:var(--text)}
      .fc-slider-wrap{display:flex;align-items:center;gap:8px;flex:1}
      .fc-slider{flex:1;accent-color:var(--text);cursor:pointer}
      .fc-slider-val{font-size:12px;font-variant-numeric:tabular-nums;min-width:28px;text-align:right;color:var(--text-muted)}
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

  _settingsHTML(cat) {
    if (cat === 'document') return '';
    if (cat === 'image') return `
      <div class="fc-sec">
        <div class="fc-sec-lbl">Settings</div>
        <div class="fc-settings">
          <div class="fc-setting-row">
            <span class="fc-setting-lbl">Quality</span>
            <div class="fc-slider-wrap">
              <input type="range" class="fc-slider" id="fc-s-iq" min="10" max="100" value="92">
              <span class="fc-slider-val" id="fc-s-iq-val">92%</span>
            </div>
          </div>
          <div class="fc-setting-row">
            <span class="fc-setting-lbl">Max dimension</span>
            <select class="fc-select" id="fc-s-imax">
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
      </div>`;
    if (cat === 'audio') return `
      <div class="fc-sec">
        <div class="fc-sec-lbl">Settings</div>
        <div class="fc-settings">
          <div class="fc-setting-row">
            <span class="fc-setting-lbl">Bitrate</span>
            <select class="fc-select" id="fc-s-abr">
              <option value="320k">320 kbps</option>
              <option value="256k">256 kbps</option>
              <option value="192k" selected>192 kbps</option>
              <option value="128k">128 kbps</option>
              <option value="96k">96 kbps</option>
              <option value="64k">64 kbps</option>
              <option value="32k">32 kbps</option>
            </select>
          </div>
          <div class="fc-setting-row">
            <span class="fc-setting-lbl">Sample rate</span>
            <select class="fc-select" id="fc-s-sr">
              <option value="">Original</option>
              <option value="48000">48 kHz</option>
              <option value="44100">44.1 kHz</option>
              <option value="22050">22 kHz</option>
              <option value="16000">16 kHz</option>
            </select>
          </div>
          <div class="fc-setting-row">
            <span class="fc-setting-lbl">Channels</span>
            <select class="fc-select" id="fc-s-ch">
              <option value="">Original</option>
              <option value="2">Stereo</option>
              <option value="1">Mono</option>
            </select>
          </div>
        </div>
      </div>`;
    if (cat === 'video') return `
      <div class="fc-sec">
        <div class="fc-sec-lbl">Settings</div>
        <div class="fc-settings">
          <div class="fc-setting-row">
            <span class="fc-setting-lbl">Quality</span>
            <select class="fc-select" id="fc-s-vq">
              <option value="high">High</option>
              <option value="medium" selected>Medium</option>
              <option value="low">Low</option>
              <option value="tiny">Tiny</option>
            </select>
          </div>
          <div class="fc-setting-row">
            <span class="fc-setting-lbl">Resolution</span>
            <select class="fc-select" id="fc-s-res">
              <option value="">Original</option>
              <option value="2160">4K (2160p)</option>
              <option value="1080">1080p</option>
              <option value="720">720p</option>
              <option value="480">480p</option>
              <option value="360">360p</option>
              <option value="240">240p</option>
            </select>
          </div>
          <div class="fc-setting-row">
            <span class="fc-setting-lbl">Frame rate</span>
            <select class="fc-select" id="fc-s-fps">
              <option value="">Original</option>
              <option value="60">60 fps</option>
              <option value="30">30 fps</option>
              <option value="24">24 fps</option>
              <option value="15">15 fps</option>
              <option value="10">10 fps</option>
            </select>
          </div>
          <div class="fc-setting-row">
            <span class="fc-setting-lbl">Audio bitrate</span>
            <select class="fc-select" id="fc-s-vabr">
              <option value="">Auto</option>
              <option value="320k">320 kbps</option>
              <option value="256k">256 kbps</option>
              <option value="192k">192 kbps</option>
              <option value="128k">128 kbps</option>
              <option value="96k">96 kbps</option>
            </select>
          </div>
          <div class="fc-setting-row">
            <span class="fc-setting-lbl">Channels</span>
            <select class="fc-select" id="fc-s-vch">
              <option value="">Original</option>
              <option value="2">Stereo</option>
              <option value="1">Mono</option>
            </select>
          </div>
        </div>
      </div>`;
    return '';
  },

  _readSettings(cat) {
    const v = id => document.getElementById(id)?.value || '';
    if (cat === 'image') return {
      quality: parseInt(v('fc-s-iq') || '92') / 100,
      maxDim:  parseInt(v('fc-s-imax')) || 0,
    };
    if (cat === 'audio') return {
      abr: v('fc-s-abr') || '192k',
      sr:  v('fc-s-sr'),
      ch:  v('fc-s-ch'),
    };
    if (cat === 'video') return {
      quality: v('fc-s-vq')   || 'medium',
      res:     v('fc-s-res'),
      fps:     v('fc-s-fps'),
      abr:     v('fc-s-vabr'),
      ch:      v('fc-s-vch'),
    };
    return {};
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
      ${this._settingsHTML(cat)}
      <div class="fc-results" id="fc-results"></div>
    `;

    // wire quality slider display
    const iqSlider = main.querySelector('#fc-s-iq');
    if (iqSlider) {
      const iqVal = main.querySelector('#fc-s-iq-val');
      iqSlider.addEventListener('input', () => { iqVal.textContent = `${iqSlider.value}%`; });
    }

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
    const settings = this._readSettings(cat);
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
        blob = await convertImage(file, toExt, settings);

      } else if (cat === 'audio' || cat === 'video') {
        pgEl.style.display = '';
        const fill = pgEl.querySelector('.fc-prog-fill');
        blob = await convertAV(file, toExt,
          msg => setStatus(msg),
          pct => { fill.style.width = `${Math.round(pct * 100)}%`; },
          settings
        );
        pgEl.style.display = 'none';

      } else {
        setStatus('Converting…');
        blob = await convertDocument(file, toExt, msg => setStatus(msg));
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
