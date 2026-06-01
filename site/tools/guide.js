function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(text) {
  return escHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function mdToHtml(md) {
  const lines = md.trim().split('\n');
  const out = [];
  let inList = false;

  for (const raw of lines) {
    if (raw.startsWith('## ')) {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<h3>${inline(raw.slice(3))}</h3>`);
    } else if (raw.startsWith('- ')) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(raw.slice(2))}</li>`);
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      if (raw.trim()) out.push(`<p>${inline(raw)}</p>`);
    }
  }

  if (inList) out.push('</ul>');
  return out.join('');
}

export function injectGuide(mainEl, markdown) {
  const target = mainEl.querySelector('.tool-content') || mainEl;
  const details = document.createElement('details');
  details.className = 'tool-guide';
  details.innerHTML = `<summary class="tool-guide-toggle">Guide</summary><div class="tool-guide-body">${mdToHtml(markdown)}</div>`;
  target.appendChild(details);
}
