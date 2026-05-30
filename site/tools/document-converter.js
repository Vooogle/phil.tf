import { esc, fmt, injectCSS, makeDropZone, makeResultRow } from './_ui.js';

const MIME = {
  txt:  'text/plain',
  html: 'text/html',
  md:   'text/markdown',
  csv:  'text/csv',
  json: 'application/json',
  pdf:  'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

// -Library loaders (lazy) -----------------------------------------------

const _libs = {};

function _loadScript(key, url, globalKey) {
  if (_libs[key]) return Promise.resolve(_libs[key]);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-lib="${key}"]`);
    if (existing) {
      const poll = setInterval(() => { if (window[globalKey]) { clearInterval(poll); _libs[key] = window[globalKey]; resolve(_libs[key]); } }, 50);
      return;
    }
    const s = document.createElement('script'); s.src = url; s.dataset.lib = key;
    s.onload  = () => { _libs[key] = window[globalKey]; resolve(_libs[key]); };
    s.onerror = () => reject(new Error(`Failed to load ${key}`));
    document.head.appendChild(s);
  });
}

async function loadPdfjs() {
  if (_libs.pdfjs) return _libs.pdfjs;
  const lib = await import('https://unpkg.com/pdfjs-dist@4.4.168/build/pdf.min.mjs');
  lib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs';
  _libs.pdfjs = lib; return lib;
}
async function loadMammoth() {
  return _loadScript('mammoth', 'https://unpkg.com/mammoth@1.8.0/mammoth.browser.min.js', 'mammoth');
}
async function loadXlsx() {
  if (_libs.xlsx) return _libs.xlsx;
  const lib = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.mjs');
  _libs.xlsx = lib; return lib;
}
async function loadJsPdf() {
  const lib = await _loadScript('jspdf', 'https://unpkg.com/jspdf@2.5.2/dist/jspdf.umd.min.js', 'jspdf');
  return lib.jsPDF;
}
async function loadJSZip() {
  return _loadScript('jszip', 'https://unpkg.com/jszip@3.10.1/dist/jszip.min.js', 'JSZip');
}

// -Extractors -----------------------------------------------------------

async function pdfToText(file, onStatus) {
  onStatus('Loading PDF.js (~2 MB)…');
  const lib = await loadPdfjs();
  onStatus('Reading PDF…');
  const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    onStatus(`Extracting text — page ${i} / ${doc.numPages}…`);
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('').trim());
  }
  return pages.join('\n\n');
}

async function pdfToDocx(file, onStatus) {
  onStatus('Loading PDF.js (~2 MB)…');
  const lib = await loadPdfjs();
  const JSZip = await loadJSZip();
  const pdfDoc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;

  const zip = new JSZip();
  const wordDir  = zip.folder('word');
  const mediaDir = wordDir.folder('media');
  const relsDir  = wordDir.folder('_rels');

  const imgRels   = [];
  const bodyParts = [];
  const SCALE = 2;

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    onStatus(`Rendering page ${i} / ${pdfDoc.numPages}…`);
    const page     = await pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale: SCALE });
    const canvas   = document.createElement('canvas');
    canvas.width   = viewport.width;
    canvas.height  = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    mediaDir.file(`page${i}.png`, await blob.arrayBuffer());

    const rId = `rImg${i}`;
    imgRels.push(`<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/page${i}.png"/>`);

    const emuPx   = 914400 / (96 * SCALE);
    const maxW    = 5943300;
    const wEmu    = Math.min(Math.round(viewport.width  * emuPx), maxW);
    const hEmu    = Math.round(viewport.height * emuPx * (wEmu / Math.round(viewport.width * emuPx)));

    bodyParts.push(`<w:p><w:r><w:drawing>
  <wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
    <wp:extent cx="${wEmu}" cy="${hEmu}"/>
    <wp:docPr id="${i}" name="Page${i}"/>
    <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
        <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
          <pic:nvPicPr><pic:cNvPr id="${i}" name="Page${i}"/><pic:cNvPicPr/></pic:nvPicPr>
          <pic:blipFill>
            <a:blip r:embed="${rId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>
            <a:stretch><a:fillRect/></a:stretch>
          </pic:blipFill>
          <pic:spPr>
            <a:xfrm><a:off x="0" y="0"/><a:ext cx="${wEmu}" cy="${hEmu}"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          </pic:spPr>
        </pic:pic>
      </a:graphicData>
    </a:graphic>
  </wp:inline>
</w:drawing></w:r></w:p>`);

    if (i < pdfDoc.numPages) bodyParts.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
  }

  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml"  ContentType="application/xml"/>
  <Default Extension="png"  ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);

  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);

  wordDir.file('document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${bodyParts.join('\n    ')}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/>
    </w:sectPr>
  </w:body>
</w:document>`);

  relsDir.file('document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${imgRels.join('\n  ')}
</Relationships>`);

  return zip.generateAsync({ type: 'blob', mimeType: MIME.docx });
}

async function docxToHtml(file, onStatus) {
  onStatus('Loading mammoth.js…');
  const mammoth = await loadMammoth();
  onStatus('Converting…');
  return (await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() })).value;
}

async function docxToText(file, onStatus) {
  onStatus('Loading mammoth.js…');
  const mammoth = await loadMammoth();
  onStatus('Converting…');
  return (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
}

async function pptxToText(file, onStatus) {
  onStatus('Loading JSZip…');
  const JSZip = await loadJSZip();
  onStatus('Reading PPTX…');
  const zip   = await JSZip.loadAsync(await file.arrayBuffer());
  const names = Object.keys(zip.files)
    .filter(n => /ppt\/slides\/slide\d+\.xml/.test(n))
    .sort((a, b) => parseInt(a.match(/(\d+)\.xml$/)[1]) - parseInt(b.match(/(\d+)\.xml$/)[1]));
  const slides = [];
  for (let i = 0; i < names.length; i++) {
    onStatus(`Extracting slide ${i + 1} / ${names.length}…`);
    const xml  = await zip.files[names[i]].async('text');
    const doc  = new DOMParser().parseFromString(xml, 'text/xml');
    const text = [...doc.querySelectorAll('t')].map(t => t.textContent).join(' ').trim();
    if (text) slides.push(`Slide ${i + 1}:\n${text}`);
  }
  return slides.join('\n\n');
}

async function odtToText(file, onStatus) {
  onStatus('Loading JSZip…');
  const JSZip = await loadJSZip();
  onStatus('Reading ODT…');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const xml = await zip.files['content.xml'].async('text');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  return [...doc.querySelectorAll('text\\:p, *|p')].map(p => p.textContent).filter(Boolean).join('\n');
}

async function xlsxToSheets(file, onStatus) {
  onStatus('Loading SheetJS…');
  const XLSX = await loadXlsx();
  onStatus('Reading spreadsheet…');
  const wb = XLSX.read(await file.arrayBuffer());
  return wb.SheetNames.map(name => ({
    name,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 }),
  }));
}

// -Table renderers -------------------------------------------------------

const CELL = 'padding:4px 8px;border:1px solid #ccc';

function sheetsToHtml(sheets) {
  const tables = sheets.map(({ name, rows }) => {
    if (!rows.length) return `<h2>${esc(name)}</h2><p>(empty)</p>`;
    const cols  = Math.max(...rows.map(r => r.length));
    const th    = rows[0].map(c => `<th style="${CELL}">${esc(String(c ?? ''))}</th>`).join('');
    const tbody = rows.slice(1).map(r =>
      `<tr>${Array.from({ length: cols }, (_, i) => `<td style="${CELL}">${esc(String(r[i] ?? ''))}</td>`).join('')}</tr>`
    ).join('');
    return `<h2>${esc(name)}</h2><table style="border-collapse:collapse"><thead><tr>${th}</tr></thead><tbody>${tbody}</tbody></table>`;
  }).join('\n');
  return `<!DOCTYPE html>\n<html>\n<body>\n${tables}\n</body>\n</html>`;
}

function sheetsToTxt(sheets) {
  return sheets.map(({ name, rows }) =>
    `=== ${name} ===\n` + rows.map(r => r.join('\t')).join('\n')
  ).join('\n\n');
}

function sheetsToCsv(sheets) {
  const q = v => { const s = String(v ?? ''); return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s; };
  return (sheets[0]?.rows ?? []).map(r => r.map(q).join(',')).join('\n');
}

function sheetsToJson(sheets) {
  const toObjs = ({ rows }) => {
    const [headers = [], ...data] = rows;
    return data.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
  };
  if (sheets.length === 1) return JSON.stringify(toObjs(sheets[0]), null, 2);
  return JSON.stringify(Object.fromEntries(sheets.map(s => [s.name, toObjs(s)])), null, 2);
}

async function sheetsToXlsx(sheets, onStatus) {
  onStatus('Loading SheetJS…');
  const XLSX = await loadXlsx();
  onStatus('Converting…');
  const wb = XLSX.utils.book_new();
  for (const { name, rows } of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

// -CSV / JSON parsers ----------------------------------------------------

function csvToRows(text) {
  const parseLine = line => {
    const r = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (line[i] === ',' && !q) { r.push(cur); cur = ''; }
      else cur += line[i];
    }
    r.push(cur); return r;
  };
  return text.trim().split(/\r?\n/).filter(Boolean).map(parseLine);
}

function jsonToRows(text) {
  let data; try { data = JSON.parse(text); } catch { throw new Error('Invalid JSON'); }
  if (!Array.isArray(data)) {
    if (typeof data === 'object' && data !== null) {
      return [Object.keys(data), Object.values(data).map(String)];
    }
    throw new Error('JSON must be an array or object');
  }
  if (!data.length) return [[]];
  if (typeof data[0] !== 'object') return [['value'], ...data.map(v => [v])];
  const headers = [...new Set(data.flatMap(Object.keys))];
  return [headers, ...data.map(r => headers.map(h => r[h] ?? ''))];
}

// -Text transformers -----------------------------------------------------

function mdToHtml(md) {
  let h = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>').replace(/^## (.+)$/gm, '<h2>$1</h2>').replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>').replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
  const blocks = h.split(/\n{2,}/).map(b => {
    b = b.trim(); if (!b) return '';
    return /^<(h[1-6]|pre)/.test(b) ? b : `<p>${b.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  return `<!DOCTYPE html>\n<html>\n<body>\n${blocks}\n</body>\n</html>`;
}

function txtToHtml(text) {
  const e = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!DOCTYPE html>\n<html>\n<body>\n${e(text).split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('\n')}\n</body>\n</html>`;
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
      case 'h1': return `# ${kids}\n\n`; case 'h2': return `## ${kids}\n\n`; case 'h3': return `### ${kids}\n\n`;
      case 'p': return `${kids}\n\n`; case 'br': return '\n';
      case 'strong': case 'b': return `**${kids}**`; case 'em': case 'i': return `*${kids}*`;
      case 'a': return `[${kids}](${n.getAttribute('href') || ''})`; case 'code': return `\`${kids}\``;
      case 'li': return `- ${kids}\n`; default: return kids;
    }
  }
  return walk(doc.body).trim();
}

// -Plain DOCX builder (text only) ----------------------------------------

function escXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function textToDocx(text, onStatus) {
  onStatus('Loading JSZip…');
  const JSZip = await loadJSZip();
  onStatus('Building DOCX…');
  const paras = text.split(/\n/).map(l =>
    `<w:p><w:r><w:t xml:space="preserve">${escXml(l)}</w:t></w:r></w:p>`
  ).join('\n');

  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml"  ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.folder('word').file('document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${paras}<w:sectPr/></w:body>
</w:document>`);
  zip.folder('word/_rels').file('document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`);

  return zip.generateAsync({ type: 'blob', mimeType: MIME.docx });
}

// -PDF builder ----------------------------------------------------------

async function textToPdf(text, onStatus) {
  onStatus('Loading jsPDF…');
  const JsPDF = await loadJsPdf();
  onStatus('Generating PDF…');
  const doc    = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const margin = 15, lineH = 6;
  const maxW   = doc.internal.pageSize.getWidth()  - margin * 2;
  const maxH   = doc.internal.pageSize.getHeight() - margin;
  doc.setFontSize(11);
  let y = margin;
  for (const line of doc.splitTextToSize(text, maxW)) {
    if (y + lineH > maxH) { doc.addPage(); y = margin; }
    doc.text(line, margin, y); y += lineH;
  }
  return doc.output('blob');
}

// -Classification -------------------------------------------------------

function fileType(file) {
  const ext  = (file.name.split('.').pop() || '').toLowerCase();
  const mime = file.type || '';
  if (ext === 'pdf'  || mime === 'application/pdf')                                                 return 'pdf';
  if (['docx','doc'].includes(ext) || mime.includes('wordprocessingml'))                            return 'docx';
  if (ext === 'pptx' || mime.includes('presentationml'))                                            return 'pptx';
  if (ext === 'odt'  || mime.includes('opendocument.text'))                                         return 'odt';
  if (['xlsx','xls'].includes(ext) || mime.includes('spreadsheetml') || mime.includes('ms-excel')) return 'xlsx';
  if (ext === 'ods'  || mime.includes('opendocument.spreadsheet'))                                  return 'xlsx';
  if (ext === 'csv'  || mime === 'text/csv')                                                        return 'csv';
  if (ext === 'json' || mime === 'application/json')                                                return 'json';
  if (['md','markdown'].includes(ext))                                                              return 'md';
  if (['html','htm'].includes(ext) || mime === 'text/html')                                        return 'html';
  if (ext === 'txt'  || mime === 'text/plain')                                                      return 'txt';
  return null;
}

const DOC_TYPES = new Set(['pdf','docx','pptx','odt','md','html','txt']);
const TAB_TYPES = new Set(['xlsx','csv','json']);
const DOC_OUTS  = ['txt','html','md','pdf','docx'];
const TAB_OUTS  = ['csv','json','xlsx','html','txt','docx','pdf'];

function getFormats(file) {
  const t = fileType(file);
  if (!t) return [];
  if (DOC_TYPES.has(t)) return DOC_OUTS.filter(f => f !== t);
  if (TAB_TYPES.has(t)) return TAB_OUTS.filter(f => f !== t);
  return [];
}

function isDoc(file) { return !!fileType(file); }

// -Preview --------------------------------------------------------------

const PREVIEW_CSS = `
  .dc-preview{position:relative;width:100%;height:100%;display:flex;flex-direction:column}
  .dc-preview-bar{display:flex;align-items:center;justify-content:flex-end;padding:6px 8px;gap:6px;flex-shrink:0}
  .dc-preview-btn{background:var(--surface);border:1px solid var(--divider);color:var(--text);border-radius:var(--radius);font-size:11px;padding:3px 9px;cursor:pointer;font-family:inherit}
  .dc-preview-btn:hover{background:var(--surface-hover)}
  .dc-preview-body{flex:1;overflow:auto;min-height:0}
  .dc-preview-body iframe{width:100%;height:100%;border:none;background:#fff}
  .dc-preview-body embed{width:100%;height:100%;border:none}
  .dc-preview-pages{display:flex;flex-direction:column;gap:8px;padding:8px;align-items:center}
  .dc-preview-pages canvas{max-width:100%;box-shadow:0 1px 6px rgba(0,0,0,.2);border-radius:2px}
  .dc-preview-pre{margin:0;padding:12px;font-size:12px;font-family:monospace;white-space:pre-wrap;word-break:break-all;color:var(--text);background:var(--bg)}
  .dc-preview-table{width:100%;border-collapse:collapse;font-size:12px}
  .dc-preview-table th,.dc-preview-table td{padding:4px 8px;border:1px solid var(--divider);text-align:left}
  .dc-preview-table th{background:var(--surface);font-weight:600}
`;

function injectPreviewCSS() {
  if (document.getElementById('dc-preview-css')) return;
  const s = document.createElement('style'); s.id = 'dc-preview-css';
  s.textContent = PREVIEW_CSS;
  document.head.appendChild(s);
}

async function renderPreview(file, previewEl) {
  if (!previewEl) return;
  injectPreviewCSS();
  const t = fileType(file);

  const wrap = document.createElement('div');
  wrap.className = 'dc-preview';

  const bar  = document.createElement('div'); bar.className = 'dc-preview-bar';
  const body = document.createElement('div'); body.className = 'dc-preview-body';
  wrap.appendChild(bar); wrap.appendChild(body);

  const fsBtn = document.createElement('button');
  fsBtn.className = 'dc-preview-btn'; fsBtn.textContent = '⛶ Fullscreen';
  fsBtn.addEventListener('click', () => {
    const target = previewEl.closest('#preview-panel') ?? previewEl;
    (target.requestFullscreen ?? target.webkitRequestFullscreen ?? (() => {})).call(target);
  });
  bar.appendChild(fsBtn);

  previewEl.innerHTML = '';
  previewEl.appendChild(wrap);

  if (t === 'pdf') {
    body.innerHTML = '<div class="dc-preview-pages" id="dc-pages"><div style="padding:16px;font-size:12px;color:var(--text-muted)">Rendering…</div></div>';
    const pages = body.querySelector('#dc-pages');
    try {
      const lib = await loadPdfjs();
      const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
      pages.innerHTML = '';
      for (let i = 1; i <= doc.numPages; i++) {
        const page     = await doc.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas   = document.createElement('canvas');
        canvas.width   = viewport.width;
        canvas.height  = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        pages.appendChild(canvas);
      }
    } catch (e) {
      pages.innerHTML = `<div style="padding:16px;font-size:12px;color:#e44">Preview failed: ${esc(e.message)}</div>`;
    }
    return;
  }

  if (t === 'docx') {
    body.innerHTML = '<iframe sandbox="allow-same-origin"></iframe>';
    const iframe = body.querySelector('iframe');
    try {
      const html = await docxToHtml(file, () => {});
      iframe.srcdoc = `<!DOCTYPE html><html><head><style>body{font-family:sans-serif;padding:16px;font-size:14px;line-height:1.6}</style></head><body>${html}</body></html>`;
    } catch {}
    return;
  }

  if (TAB_TYPES.has(t)) {
    try {
      let sheets;
      if (t === 'xlsx') {
        sheets = await xlsxToSheets(file, () => {});
      } else if (t === 'csv') {
        sheets = [{ name: 'Sheet1', rows: csvToRows(await file.text()) }];
      } else {
        sheets = [{ name: 'Sheet1', rows: jsonToRows(await file.text()) }];
      }
      const container = document.createElement('div');
      container.style.cssText = 'padding:8px;overflow:auto';
      for (const { name, rows } of sheets) {
        if (sheets.length > 1) {
          const h = document.createElement('div');
          h.style.cssText = 'font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin:8px 0 4px';
          h.textContent = name; container.appendChild(h);
        }
        const table = document.createElement('table');
        table.className = 'dc-preview-table';
        const thead = document.createElement('thead');
        const hrow  = document.createElement('tr');
        (rows[0] ?? []).forEach(c => { const th = document.createElement('th'); th.textContent = String(c ?? ''); hrow.appendChild(th); });
        thead.appendChild(hrow); table.appendChild(thead);
        const tbody = document.createElement('tbody');
        rows.slice(1).forEach(r => {
          const tr = document.createElement('tr');
          (rows[0] ?? []).forEach((_, i) => { const td = document.createElement('td'); td.textContent = String(r[i] ?? ''); tr.appendChild(td); });
          tbody.appendChild(tr);
        });
        table.appendChild(tbody); container.appendChild(table);
      }
      body.appendChild(container);
    } catch {}
    return;
  }

  // Text-like: html, md, txt, etc.
  try {
    const raw = await file.text();
    if (t === 'html') {
      body.innerHTML = '<iframe sandbox="allow-same-origin"></iframe>';
      body.querySelector('iframe').srcdoc = raw;
    } else if (t === 'md') {
      body.innerHTML = '<iframe sandbox="allow-same-origin"></iframe>';
      body.querySelector('iframe').srcdoc = `<!DOCTYPE html><html><head><style>body{font-family:sans-serif;padding:16px;font-size:14px;line-height:1.6}</style></head><body>${mdToHtml(raw).replace(/^[\s\S]*<body>|<\/body>[\s\S]*$/g,'')}</body></html>`;
    } else {
      const pre = document.createElement('pre');
      pre.className = 'dc-preview-pre';
      pre.textContent = raw.slice(0, 50000) + (raw.length > 50000 ? '\n…(truncated)' : '');
      body.appendChild(pre);
    }
  } catch {}
}

// -Master converter ------------------------------------------------------

async function convert(file, toExt, onStatus) {
  const t = fileType(file);

  if (TAB_TYPES.has(t)) {
    let sheets;
    if (t === 'xlsx') {
      sheets = await xlsxToSheets(file, onStatus);
    } else if (t === 'csv') {
      onStatus('Parsing CSV…');
      sheets = [{ name: 'Sheet1', rows: csvToRows(await file.text()) }];
    } else {
      onStatus('Parsing JSON…');
      sheets = [{ name: 'Sheet1', rows: jsonToRows(await file.text()) }];
    }
    if (toExt === 'html')  return new Blob([sheetsToHtml(sheets)],  { type: MIME.html });
    if (toExt === 'txt')   return new Blob([sheetsToTxt(sheets)],   { type: MIME.txt });
    if (toExt === 'csv')   return new Blob([sheetsToCsv(sheets)],   { type: MIME.csv });
    if (toExt === 'json')  return new Blob([sheetsToJson(sheets)],  { type: MIME.json });
    if (toExt === 'xlsx') return new Blob([await sheetsToXlsx(sheets, onStatus)], { type: MIME.xlsx });
    if (toExt === 'docx') return textToDocx(sheetsToTxt(sheets), onStatus);
    if (toExt === 'pdf')  return textToPdf(sheetsToTxt(sheets), onStatus);
  }

  if (t === 'pdf') {
    if (toExt === 'docx') return pdfToDocx(file, onStatus);
    const text = await pdfToText(file, onStatus);
    if (toExt === 'txt')  return new Blob([text], { type: MIME.txt });
    if (toExt === 'html') return new Blob([txtToHtml(text)], { type: MIME.html });
    if (toExt === 'md')   return new Blob([text], { type: MIME.md });
    if (toExt === 'pdf')  return textToPdf(text, onStatus);
  }

  let text = '', html = '';

  if (t === 'docx') {
    if (toExt === 'html' || toExt === 'md') {
      html = await docxToHtml(file, onStatus);
      text = htmlToTxt(html);
    } else {
      text = await docxToText(file, onStatus);
    }
  } else if (t === 'pptx') {
    text = await pptxToText(file, onStatus);
  } else if (t === 'odt') {
    text = await odtToText(file, onStatus);
  } else {
    const raw = await file.text();
    if (t === 'html') { html = raw; text = htmlToTxt(raw); }
    else if (t === 'md') { text = raw; html = mdToHtml(raw); }
    else { text = raw; }
  }

  if (toExt === 'txt')  return new Blob([text], { type: MIME.txt });
  if (toExt === 'html') return new Blob([html || txtToHtml(text)], { type: MIME.html });
  if (toExt === 'md')   return new Blob([html ? htmlToMd(html) : text], { type: MIME.md });
  if (toExt === 'pdf')  return textToPdf(text, onStatus);
  if (toExt === 'docx') return textToDocx(text, onStatus);
  throw new Error(`No converter for → ${toExt}`);
}

// -Tool export ----------------------------------------------------------

export default {
  id: 'document-converter',
  name: 'Document Converter',
  category: 'Utilities',
  description: 'Convert between PDF, DOCX, PPTX, ODT, XLSX, CSV, JSON, HTML, Markdown, and TXT.',

  _mainEl:    null,
  _previewEl: null,

  render(mainEl, previewEl) {
    this._mainEl    = mainEl;
    this._previewEl = previewEl ?? null;
    injectCSS();
    makeDropZone(mainEl, 'cv-body', '',
      'PDF · DOCX · PPTX · ODT · XLSX · CSV · JSON · HTML · Markdown · TXT',
      f => isDoc(f) && this._loadFile(f));
  },

  destroy() {
    this._mainEl    = null;
    this._previewEl = null;
  },

  _loadFile(file) {
    const formats = getFormats(file);
    const body    = this._mainEl.querySelector('#cv-body');
    if (!formats.length) {
      body.innerHTML = `<div class="cv-card"><span style="font-size:22px">?</span><div><div class="cv-card-name">${esc(file.name)}</div><div class="cv-card-meta" style="color:#e44">Unsupported format.</div></div></div>`;
      return;
    }
    body.innerHTML = `
      <div class="cv-card">
        <span style="font-size:22px;flex-shrink:0">📄</span>
        <div style="flex:1;min-width:0">
          <div class="cv-card-name" title="${esc(file.name)}">${esc(file.name)}</div>
          <div class="cv-card-meta">${fmt(file.size)}</div>
        </div>
        <button class="cv-change" id="cv-change">Change file</button>
      </div>
      <div class="cv-sec">
        <div class="cv-sec-lbl">Convert to</div>
        <div class="cv-fmts">
          ${formats.map(f => `<button class="cv-fmt" data-fmt="${f}">${f.toUpperCase()}</button>`).join('')}
        </div>
      </div>
      <div class="cv-results" id="cv-results"></div>
    `;
    body.querySelector('#cv-change').addEventListener('click', () => {
      body.innerHTML = '';
      if (this._previewEl) this._previewEl.innerHTML = '';
    });
    body.querySelectorAll('.cv-fmt').forEach(btn => {
      btn.addEventListener('click', () => this._convert(file, btn.dataset.fmt, btn));
    });
    renderPreview(file, this._previewEl);
  },

  async _convert(file, toExt, btn) {
    const results = this._mainEl.querySelector('#cv-results');
    const outName = `${file.name.replace(/\.[^.]+$/, '')}.${toExt}`;
    const r       = makeResultRow(results, outName);
    btn.disabled  = true;
    try {
      const blob = await convert(file, toExt, msg => r.setStatus(msg));
      r.succeed(blob, outName);
    } catch (e) { r.fail(e?.message ?? String(e)); }
    finally     { btn.disabled = false; }
  },
};
