import { tools } from './tools/registry.js';

//  State 

const state = {
  currentToolId: null,
  currentToolInstance: null,
  favorites: new Set(JSON.parse(localStorage.getItem('ptk-favorites') || '[]')),
  expandedCategories: new Set(JSON.parse(localStorage.getItem('ptk-expanded-cats') || '[]')),
  searchQuery: '',
};

//  DOM refs 

const toolNav = document.getElementById('tool-nav');
const toolView = document.getElementById('tool-view');
const previewContent = document.getElementById('preview-content');
const searchInput = document.getElementById('tool-search');
const homeLink = document.getElementById('home-link');
const themeToggle = document.getElementById('theme-toggle');

//  Persistence 

function saveFavorites() {
  localStorage.setItem('ptk-favorites', JSON.stringify([...state.favorites]));
}

function saveExpandedCategories() {
  localStorage.setItem('ptk-expanded-cats', JSON.stringify([...state.expandedCategories]));
}

//  Routing 

function navigate(path) {
  history.pushState(null, '', path);
  closeSidebar();
  route(path);
}

function route(path) {
  const match = path.match(/^\/tool\/([^/?#]+)/);
  if (match) {
    loadTool(match[1]);
  } else {
    loadLanding();
  }
  renderNav();
}

function loadTool(id) {
  const tool = tools.find(t => t.id === id);
  if (!tool) { loadLanding(); return; }

  teardown();
  state.currentToolInstance = tool;
  state.currentToolId = id;

  toolView.innerHTML = '';
  previewContent.innerHTML = '';
  document.title = `${tool.name} — phil.tf`;

  tool.render(toolView, previewContent);
}

function loadLanding() {
  teardown();
  document.title = 'phil.tf';
  toolView.innerHTML = '';
  previewContent.innerHTML = '';
  renderLanding();
}

function teardown() {
  if (state.currentToolInstance?.destroy) {
    state.currentToolInstance.destroy();
  }
  state.currentToolInstance = null;
  state.currentToolId = null;
}

//  RSS + Markdown landing uhh

const RSS_URL = 'https://raw.githubusercontent.com/Vooogle/rss-feed/refs/heads/main/tools-rss.xml';

function renderMarkdown(raw) {
  let md = String(raw);

  // $$tool1,tool2$$ → tool card grid
  md = md.replace(/\$\$([^$]+)\$\$/g, (_, body) => {
    const ids = body.split(',').map(s => s.trim()).filter(Boolean);
    const cards = ids.map(id => {
      const t = tools.find(t => t.id === id);
      if (!t) return '';
      return `<div class="tool-card rss-tool-card" data-tool-id="${esc(t.id)}">
        <div class="tool-card-name">${esc(t.name)}</div>
        <div class="tool-card-cat">${esc(t.category)}</div>
        <div class="tool-card-desc">${esc(t.description)}</div>
      </div>`;
    }).join('');
    return `<div class="tool-grid" style="margin:12px 0">${cards}</div>`;
  });

  // Fenced code blocks (generic)
  md = md.replace(/```(\w*)\r?\n([\s\S]*?)```/g, (_, lang, code) =>
    `<pre><code${lang ? ` class="lang-${esc(lang)}"` : ''}>${esc(code.trim())}</code></pre>`
  );

  // Inline code (before other inline transforms)
  md = md.replace(/`([^`]+)`/g, (_, c) => `<code>${esc(c)}</code>`);

  // Headings
  md = md.replace(/^###### (.+)$/gm, '<h6>$1</h6>');
  md = md.replace(/^##### (.+)$/gm,  '<h5>$1</h5>');
  md = md.replace(/^#### (.+)$/gm,   '<h4>$1</h4>');
  md = md.replace(/^### (.+)$/gm,    '<h3>$1</h3>');
  md = md.replace(/^## (.+)$/gm,     '<h2>$1</h2>');
  md = md.replace(/^# (.+)$/gm,      '<h1>$1</h1>');

  // Horizontal rule
  md = md.replace(/^---+$/gm, '<hr>');

  // Blockquote
  md = md.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

  // Bold & italic
  md = md.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  md = md.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  md = md.replace(/\*(.+?)\*/g, '<em>$1</em>');
  md = md.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
  md = md.replace(/__(.+?)__/g, '<strong>$1</strong>');
  md = md.replace(/_([^_]+)_/g, '<em>$1</em>');

  // Images before links
  md = md.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,
    (_, alt, src) => `<img src="${esc(src)}" alt="${esc(alt)}" style="max-width:100%;border-radius:4px">`);

  // Links
  md = md.replace(/\[([^\]]+)\]\(([^)]+)\)/g,
    (_, text, href) => `<a href="${esc(href)}" target="_blank" rel="noopener">${text}</a>`);

  // Strikethrough
  md = md.replace(/~~(.+?)~~/g, '<s>$1</s>');

  // Protect iframes from paragraph splitting
  const iframes = [];
  md = md.replace(/<iframe[\s\S]*?<\/iframe>/gi, match => {
    iframes.push(match);
    return `\n\nIFRAME_PLACEHOLDER_${iframes.length - 1}\n\n`;
  });

  // Paragraphs — split on blank lines, wrap non-block content
  const BLOCK = /^<(h[1-6]|ul|ol|pre|div|blockquote|hr|img|iframe)/;
  const chunks = md.split(/\n{2,}/);
  md = chunks.map(chunk => {
    chunk = chunk.trim();
    if (!chunk) return '';
    if (BLOCK.test(chunk)) return chunk;

    // List items
    if (/^[-*] /m.test(chunk)) {
      const items = chunk.split('\n').filter(Boolean).map(line =>
        `<li>${line.replace(/^[-*] /, '')}</li>`
      ).join('');
      return `<ul>${items}</ul>`;
    }
    if (/^\d+\. /m.test(chunk)) {
      const items = chunk.split('\n').filter(Boolean).map(line =>
        `<li>${line.replace(/^\d+\. /, '')}</li>`
      ).join('');
      return `<ol>${items}</ol>`;
    }

    return `<p>${chunk.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');

  // Restore iframes
  md = md.replace(/IFRAME_PLACEHOLDER_(\d+)/g, (_, i) => iframes[+i]);

  return md;
}

async function renderLanding() {
  const el = document.createElement('div');
  el.className = 'rss-landing';
  el.innerHTML = '<div class="rss-status">Loading feed…</div>';
  toolView.appendChild(el);

  try {
    const res  = await fetch(RSS_URL);
    const text = await res.text();
    const xml  = new DOMParser().parseFromString(text, 'application/xml');

    const chan  = xml.querySelector('channel');
    const title = chan?.querySelector('channel > title')?.textContent?.trim() || '';
    const desc  = chan?.querySelector('channel > description')?.textContent?.trim() || '';
    const items = [...xml.querySelectorAll('item')].map(item => {
      const content =
        item.getElementsByTagNameNS('http://purl.org/rss/1.0/modules/content/', 'encoded')[0]?.textContent ||
        item.querySelector('description')?.textContent || '';
      return {
        title:   item.querySelector('title')?.textContent?.trim() || '(untitled)',
        link:    item.querySelector('link')?.textContent?.trim() || '',
        content,
        pubDate: item.querySelector('pubDate')?.textContent || '',
      };
    }).sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    el.innerHTML = '';

    // Channel header
    const hdr = document.createElement('div');
    hdr.className = 'rss-header';
    hdr.innerHTML = `
      <h1 class="landing-title">Feed</h1>
      <p class="landing-sub"><a href="${esc(RSS_URL)}" target="_blank" rel="noopener" style="color:inherit">${esc(RSS_URL)}</a></p>
    `;
    el.appendChild(hdr);

    if (!items.length) {
      el.appendChild(Object.assign(document.createElement('div'), { className: 'rss-status', textContent: 'No items in feed.' }));
    }

    const list = document.createElement('div');
    list.className = 'rss-feed-list';

    for (const item of items) {
      const art = document.createElement('article');
      art.className = 'rss-item';

      const date = item.pubDate
        ? new Date(item.pubDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        : '';

      const titleHtml = item.link
        ? `<a class="rss-item-title" href="${esc(item.link)}" target="_blank" rel="noopener">${esc(item.title)}</a>`
        : `<div class="rss-item-title">${esc(item.title)}</div>`;

      art.innerHTML = `
        <div class="rss-item-header">
          ${titleHtml}
          ${date ? `<div class="rss-item-date">${esc(date)}</div>` : ''}
        </div>
        <div class="rss-item-body">${renderMarkdown(item.content)}</div>
      `;

      art.querySelectorAll('.rss-tool-card').forEach(card => {
        card.addEventListener('click', () => navigate(`/tool/${card.dataset.toolId}`));
      });

      list.appendChild(art);
    }

    el.appendChild(list);
  } catch(e) {
    el.innerHTML = `<div class="rss-status rss-error">Failed to load feed — ${esc(e.message)}</div>`;
  }
}

//  Sidebar 

function renderNav() {
  toolNav.innerHTML = '';

  const query = state.searchQuery.trim().toLowerCase();
  const visible = query
    ? tools.filter(t =>
        t.name.toLowerCase().includes(query) ||
        t.category.toLowerCase().includes(query) ||
        (t.description || '').toLowerCase().includes(query)
      )
    : tools;

  if (query) {
    for (const tool of visible) toolNav.appendChild(makeToolItem(tool));
    return;
  }

  // Favorites
  const favTools = tools.filter(t => state.favorites.has(t.id));
  if (favTools.length > 0) {
    const section = document.createElement('div');
    section.className = 'fav-section';
    section.innerHTML = `
      <div class="fav-header">
        <span class="fav-header-icon"><img src="/assets/icons/star.svg" class="icon"></span>
        <span>Favorites</span>
      </div>
    `;
    for (const tool of favTools) section.appendChild(makeToolItem(tool));
    toolNav.appendChild(section);

    const divider = document.createElement('div');
    divider.className = 'nav-divider';
    toolNav.appendChild(divider);
  }

  // Categories
  const categories = [...new Set(tools.map(t => t.category))].sort();
  for (const cat of categories) {
    const catTools = tools.filter(t => t.category === cat);
    const isOpen = state.expandedCategories.has(cat);

    const catEl = document.createElement('div');
    catEl.className = `category${isOpen ? ' open' : ''}`;

    const header = document.createElement('div');
    header.className = 'category-header';
    header.innerHTML = `
      <svg class="category-chevron" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 2L6.5 5L3 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span>${esc(cat)}</span>
    `;
    header.addEventListener('click', () => {
      const opening = !state.expandedCategories.has(cat);
      if (opening) {
        state.expandedCategories.add(cat);
        catEl.classList.add('open');
      } else {
        state.expandedCategories.delete(cat);
        catEl.classList.remove('open');
      }
      saveExpandedCategories();
    });

    const items = document.createElement('div');
    items.className = 'category-items';
    for (const tool of catTools) items.appendChild(makeToolItem(tool));

    catEl.appendChild(header);
    catEl.appendChild(items);
    toolNav.appendChild(catEl);
  }
}

function makeToolItem(tool) {
  const item = document.createElement('div');
  item.className = `tool-item${state.currentToolId === tool.id ? ' active' : ''}`;

  const name = document.createElement('span');
  name.className = 'tool-item-name';
  name.textContent = tool.name;

  const isFav = state.favorites.has(tool.id);
  const star = document.createElement('button');
  star.className = `tool-item-star${isFav ? ' starred' : ''}`;
  star.innerHTML = isFav ? '<img src="/assets/icons/star.svg" class="icon">' : '<img src="/assets/icons/notstar.svg" class="icon">';
  star.title = isFav ? 'Remove from favorites' : 'Add to favorites';
  star.addEventListener('click', e => {
    e.stopPropagation();
    if (state.favorites.has(tool.id)) {
      state.favorites.delete(tool.id);
    } else {
      state.favorites.add(tool.id);
    }
    saveFavorites();
    renderNav();
  });

  item.appendChild(name);
  item.appendChild(star);
  item.addEventListener('click', () => navigate(`/tool/${tool.id}`));

  return item;
}

//  Util 

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

//  Events 

searchInput.addEventListener('input', e => {
  state.searchQuery = e.target.value;
  renderNav();
});

homeLink.addEventListener('click', e => {
  e.preventDefault();
  navigate('/');
});

window.addEventListener('popstate', () => route(window.location.pathname));

//  Theme 

function applyTheme(dark) {
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.classList.toggle('light', !dark);
  themeToggle.innerHTML = dark ? '<img src="/assets/icons/dark.svg" class="icon">' : '<img src="/assets/icons/light.svg" class="icon">';
  themeToggle.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
}

const storedTheme = localStorage.getItem('ptk-theme');
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
applyTheme(storedTheme === 'dark' || (storedTheme === null && prefersDark));

themeToggle.addEventListener('click', () => {
  const isDark = document.documentElement.classList.contains('dark');
  localStorage.setItem('ptk-theme', isDark ? 'light' : 'dark');
  applyTheme(!isDark);
});

//  Mobile nav

const hamburger = document.getElementById('hamburger');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');
const previewToggleBtn = document.getElementById('preview-toggle-btn');
const panelCloseBtn = document.getElementById('panel-close-btn');
const sidebar = document.getElementById('sidebar');
const previewPanel = document.getElementById('preview-panel');

function closeSidebar() {
  sidebar.classList.remove('open');
  sidebarBackdrop.classList.remove('visible');
}

hamburger.addEventListener('click', () => {
  const isOpen = sidebar.classList.toggle('open');
  sidebarBackdrop.classList.toggle('visible', isOpen);
});

sidebarBackdrop.addEventListener('click', closeSidebar);

previewToggleBtn.addEventListener('click', () => {
  previewPanel.classList.toggle('mobile-open');
});

panelCloseBtn.addEventListener('click', () => {
  previewPanel.classList.remove('mobile-open');
});

//  Init

renderNav();
route(window.location.pathname);
