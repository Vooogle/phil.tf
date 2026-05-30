export function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
export function fmt(n) { return n < 1024 ? `${n}B` : n < 1048576 ? `${(n/1024).toFixed(1)}KB` : `${(n/1048576).toFixed(2)}MB`; }

export function injectCSS() {
  if (document.getElementById('conv-css')) return;
  const s = document.createElement('style'); s.id = 'conv-css';
  s.textContent = `
    .cv-wrap{padding:24px;max-width:600px;margin:0 auto}
    .cv-drop{border:2px dashed var(--divider);border-radius:10px;padding:48px 24px;text-align:center;cursor:pointer;transition:border-color .15s,background .15s;user-select:none}
    .cv-drop.on,.cv-drop:hover{border-color:var(--text);background:var(--surface)}
    .cv-drop-icon{margin-bottom:12px}
    .cv-drop-icon img{width:28px;height:28px;opacity:.4}
    .cv-drop-text{font-size:14px;color:var(--text)}
    .cv-browse{color:var(--text);cursor:pointer;text-decoration:underline}
    .cv-drop-sub{font-size:12px;color:var(--text-muted);margin-top:6px}
    .cv-card{background:var(--surface);border:1px solid var(--divider);border-radius:8px;padding:12px 16px;margin-top:16px;display:flex;align-items:center;gap:12px}
    .cv-card-name{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
    .cv-card-meta{font-size:11px;color:var(--text-muted);margin-top:2px}
    .cv-change{margin-left:auto;font-size:11px;color:var(--text-muted);cursor:pointer;text-decoration:underline;flex-shrink:0;background:none;border:none;font-family:inherit;padding:0}
    .cv-sec{margin-top:18px}
    .cv-sec-lbl{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:8px}
    .cv-fmts{display:flex;flex-wrap:wrap;gap:6px}
    .cv-fmt{padding:6px 16px;border:1px solid var(--divider);background:var(--bg);color:var(--text);border-radius:var(--radius);font-size:12px;font-family:inherit;cursor:pointer;transition:background .1s,border-color .1s;font-weight:600;text-transform:uppercase;letter-spacing:.06em}
    .cv-fmt:hover{background:var(--surface);border-color:var(--text)}
    .cv-fmt:disabled{opacity:.4;cursor:default}
    .cv-results{margin-top:10px;display:flex;flex-direction:column;gap:6px}
    .cv-row{padding:10px 14px;background:var(--surface);border:1px solid var(--divider);border-radius:var(--radius);display:flex;align-items:center;gap:10px;font-size:13px}
    .cv-row-info{flex:1;min-width:0}
    .cv-row-status{font-size:12px;color:var(--text-muted);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .cv-dl{color:var(--text);font-weight:600;text-decoration:none;padding:5px 12px;border:1px solid var(--divider);border-radius:var(--radius);background:var(--bg);font-size:12px;white-space:nowrap;flex-shrink:0}
    .cv-dl:hover{background:var(--surface-hover)}
    .cv-err{color:#e44}
    .cv-prog{height:3px;background:var(--divider);border-radius:2px;overflow:hidden;margin-top:5px}
    .cv-prog-fill{height:100%;background:var(--text);border-radius:2px;transition:width .2s}
    @keyframes cv-pulse{0%,100%{opacity:.3}50%{opacity:1}}
    .cv-spin{animation:cv-pulse 1.2s ease-in-out infinite}
    .cv-settings{display:flex;flex-direction:column;gap:7px}
    .cv-setting-row{display:flex;align-items:center;gap:10px}
    .cv-setting-lbl{font-size:12px;color:var(--text-muted);width:100px;flex-shrink:0}
    .cv-select{flex:1;background:var(--bg);border:1px solid var(--divider);color:var(--text);border-radius:var(--radius);font-size:12px;padding:4px 8px;font-family:inherit;cursor:pointer}
    .cv-select:focus{outline:none;border-color:var(--text)}
    .cv-slider-wrap{display:flex;align-items:center;gap:8px;flex:1}
    .cv-slider{flex:1;accent-color:var(--text);cursor:pointer}
    .cv-slider-val{font-size:12px;font-variant-numeric:tabular-nums;min-width:32px;text-align:right;color:var(--text-muted)}
    .cv-input{flex:1;background:var(--bg);border:1px solid var(--divider);color:var(--text);border-radius:var(--radius);font-size:12px;padding:4px 8px;font-family:inherit}
    .cv-input:focus{outline:none;border-color:var(--text)}
    .cv-btn{padding:8px 20px;background:var(--text);color:var(--bg);border:none;border-radius:var(--radius);font-size:13px;font-family:inherit;font-weight:600;cursor:pointer;transition:opacity .1s}
    .cv-btn:hover{opacity:.85}
    .cv-btn:disabled{opacity:.4;cursor:default}
    .cv-tabs{display:flex;gap:4px;flex-wrap:wrap}
    .cv-tab{padding:5px 14px;border:1px solid var(--divider);background:var(--bg);color:var(--text-muted);border-radius:var(--radius);font-size:12px;font-family:inherit;cursor:pointer}
    .cv-tab.active{background:var(--text);color:var(--bg);border-color:var(--text)}
    .cv-tab-panel{display:none;margin-top:12px}
    .cv-tab-panel.active{display:flex;flex-direction:column;gap:7px}
    .cv-check-row{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-muted);cursor:pointer}
    .cv-check-row input{cursor:pointer;accent-color:var(--text)}
  `;
  document.head.appendChild(s);
}

export function makeDropZone(main, bodyId, accept, subText, onFile) {
  main.innerHTML = `
    <div class="cv-wrap">
      <div class="cv-drop" id="cv-drop">
        <div class="cv-drop-icon"><img src="/assets/icons/up.svg" alt="Upload"></div>
        <div class="cv-drop-text">Drop a file or <label class="cv-browse">browse<input type="file" id="cv-file" accept="${accept}" style="display:none"></label></div>
        <div class="cv-drop-sub">${subText}</div>
      </div>
      <div id="${bodyId}"></div>
    </div>
  `;
  const drop  = main.querySelector('#cv-drop');
  const input = main.querySelector('#cv-file');
  drop.addEventListener('dragover',  e => { e.preventDefault(); drop.classList.add('on'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('on'));
  drop.addEventListener('drop',      e => { e.preventDefault(); drop.classList.remove('on'); const f = e.dataTransfer.files[0]; if (f) onFile(f); });
  drop.addEventListener('click',     e => { if (e.target !== input) input.click(); });
  input.addEventListener('change',   e => { const f = e.target.files[0]; if (f) { onFile(f); e.target.value = ''; } });
}

export function makeResultRow(results, outName, onStatus) {
  const rowId = `cv-r-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const row = document.createElement('div');
  row.className = 'cv-row';
  row.innerHTML = `
    <div class="cv-row-info">
      <div style="font-size:13px;font-weight:600">${esc(outName)}</div>
      <div class="cv-row-status cv-spin" id="${rowId}">Working…</div>
      <div class="cv-prog" id="${rowId}-pg" style="display:none"><div class="cv-prog-fill" style="width:0%"></div></div>
    </div>
  `;
  results.appendChild(row);
  const stEl = row.querySelector(`#${rowId}`);
  const pgEl = row.querySelector(`#${rowId}-pg`);
  const fill = pgEl.querySelector('.cv-prog-fill');
  return {
    row,
    setStatus: s => { stEl.textContent = s; },
    showProgress: () => { pgEl.style.display = ''; },
    hideProgress: () => { pgEl.style.display = 'none'; },
    setProgress: p => { fill.style.width = `${Math.round(p * 100)}%`; },
    succeed(blob, outName) {
      const url = URL.createObjectURL(blob);
      stEl.classList.remove('cv-spin');
      stEl.textContent = `✓  ${fmt(blob.size)}`;
      const a = document.createElement('a');
      a.href = url; a.download = outName; a.className = 'cv-dl'; a.textContent = 'Download';
      a.addEventListener('click', () => setTimeout(() => URL.revokeObjectURL(url), 60000));
      row.appendChild(a);
    },
    fail(msg) {
      stEl.classList.remove('cv-spin');
      stEl.innerHTML = `<span class="cv-err">Error: ${esc(msg)}</span>`;
    },
  };
}
