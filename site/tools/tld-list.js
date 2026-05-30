import { injectGuide } from './guide.js';

const TLDS = [
  // A
  'ab.ca','ac','academy','accountant','accountants','actor','adult','ae','agency','ag',
  'ai','airforce','am','apartments','app','ar','archi','army','art','asia','at',
  'attorney','au','auction','audio',
  // B
  'baby','band','bar','bargains','bc.ca','be','beauty','beer','best','bet','bg','bid',
  'bike','bingo','bio','biz','black','blog','blue','bm','boo','boston','boutique',
  'br','broker','build','builders','business','buzz','bz',
  // C
  'ca','cab','cafe','cam','camera','camp','capital','cards','care','careers','casa',
  'cash','casino','catering','cc','center','ceo','ch','charity','chat','cheap',
  'christmas','church','city','claims','cleaning','click','clinic','clothing','cloud',
  'club','cl','cn','co','co.in','co.jp','co.kr','co.nz','co.th','co.uk','coach',
  'codes','coffee','college','com','com.ai','com.ar','com.au','com.br','com.co',
  'com.mx','community','company','compare','computer','condos','construction',
  'consulting','contact','contractors','cooking','cool','coupons','credit','creditcard',
  'cricket','cruises','cy','cz',
  // D
  'dad','dance','date','dating','day','de','dealer','deals','degree','delivery',
  'democrat','dental','dentist','design','dev','diamonds','diet','digital','direct',
  'directory','discount','dk','do','doctor','dog','domains','download',
  // E
  'earth','eco','education','ee','email','energy','engineer','engineering',
  'enterprises','equipment','es','esq','estate','events','exchange','expert',
  'exposed','express',
  // F
  'fail','faith','family','fan','fans','farm','fashion','feedback','fi','film',
  'finance','financial','fish','fishing','fit','fitness','flights','florist',
  'flowers','fm','foo','football','forex','forsale','forum','foundation','fr',
  'fun','fund','furniture','futbol','fyi',
  // G
  'gallery','game','games','garden','geek.nz','gg','gh','gi','gifts','gives',
  'giving','gl','glass','global','gmbh','gold','golf','gr','graphics','gratis',
  'green','gripe','group','guide','guitars','guru',
  // H
  'haus','health','healthcare','help','hk','hockey','holdings','holiday','homes',
  'horse','hospital','host','hosting','house','how','hr','hu',
  // I
  'id','icu','ie','il','im','immo','immobilien','in','inc','industries','info',
  'ing','ink','institute','insure','international','investments','io','irish','is','it',
  // J
  'je','jetzt','jewelry','jo','jp',
  // K
  'kaufen','ke','kim','kitchen','kr',
  // L
  'la','land','law','lawyer','lc','lease','legal','lgbt','li','life','lighting',
  'limited','limo','link','live','lk','loan','loans','lol','love','lt','ltd','lu',
  'lv','luxe','ly',
  // M
  'ma','maison','management','market','marketing','markets','mb.ca','mba','mc',
  'md','me','me.uk','media','meme','memorial','men','miami','mn','mobi','moda',
  'mom','money','monster','mortgage','mov','movie','ms','mu','my','mx',
  // N
  'name','navy','nb.ca','net','net.ai','net.au','net.co','net.nz','net.uk',
  'network','new','news','nexus','ng','ngo','ninja','nl','nl.ca','no','nom.co',
  'ns.ca','nt.ca','nu','nu.ca','nz',
  // O
  'observer','off.ai','om','on.ca','one','ong','online','org','org.ai','org.au',
  'org.mx','org.nz','org.uk','organic',
  // P
  'pa','page','partners','parts','party','pe','pe.ca','pet','ph','phd','phone',
  'photo','photography','photos','pics','pictures','pink','pizza','pk','place',
  'play','pl','plumbing','plus','poker','porn','pr','press','pro','productions',
  'prof','promo','properties','protection','pt','pub','pw',
  // Q
  'qa','qc.ca',
  // R
  'racing','realty','recipes','red','rehab','reise','reisen','rent','rentals',
  'repair','report','republican','rest','restaurant','review','reviews','rip','ro',
  'rocks','rodeo','rs','rsvp','ru','run','rw',
  // S
  'sa','sale','salon','sarl','sc','school','schule','science','se','security',
  'select','services','sex','sg','sh','shoes','shop','shopping','show','singles',
  'site','sk','sk.ca','ski','sm','sn','so','soccer','social','software','solar',
  'solutions','soy','space','st','storage','store','stream','studio','style',
  'supplies','supply','support','surf','surgery','systems',
  // T
  'tax','taxi','tc','team','tech','technology','tel','tennis','th','theater',
  'theatre','tienda','tips','tires','tn','to','today','tools','toronto.on.ca',
  'tours','town','toys','tr','trade','trading','training','travel','tt','tw','tv',
  'tz',
  // U
  'ua','ug','uk','university','uno','us','uy','uz',
  // V
  'vacations','vc','ve','ventures','vet','viajes','video','villas','vin','vip',
  'vision','vn','vodka','voyage',
  // W
  'watch','webcam','website','wedding','wiki','win','wine','work','works','world',
  'ws','wtf',
  // X
  'xxx','xyz',
  // Y
  'yk.ca','yoga','yt.ca',
  // Z
  'za','zm','zone','zw',
];

const NOT_CF = new Set([
  'adult','porn','sex','xxx',
  // Canadian provincial/city SLDs
  'ab.ca','bc.ca','mb.ca','nb.ca','nl.ca','ns.ca','nt.ca','nu.ca','on.ca','pe.ca',
  'qc.ca','sk.ca','yk.ca','yt.ca','toronto.on.ca',
  // Anguilla / non-standard SLDs
  'com.ai','net.ai','org.ai','off.ai',
  // specialty SLDs
  'geek.nz','nom.co','co.in','co.jp','co.kr','co.th','com.au','net.au','org.au',
  'com.ar','com.br',
  // small / restricted ccTLD
  'ac',
  // Google registry
  'boo','dad','foo','how','mov','rsvp','nexus','new','boston',
  // ccTLDs not on CF registrar
  'ae','ag','am','ar','at','au','be','bg','bm','br','bz','ch','cl','cn','cy','cz',
  'de','dk','do','ee','es','fi','fr','gh','gi','gl','gr','hk','hr','hu','id','ie',
  'il','im','in','is','it','je','jo','jp','ke','kr','la','lc','li','lk','lt','lu',
  'lv','ly','ma','mc','md','mn','ms','mu','my','ng','nl','no','nu','om','pa','pe',
  'ph','pk','pl','pr','pt','pw','qa','ro','rs','ru','rw','sa','sc','se','sg','sk',
  'sl','sm','sn','so','st','tc','th','tn','to','tr','tt','tw','tz','ua','ug','uy',
  'uz','vc','ve','vn','ws','za','zm','zw',
]);

function tldLen(t) { return t.length; }

function tldType(t) {
  if (t.includes('.')) return 'sld';
  if (t.length === 2)  return 'cctld';
  return 'gtld';
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function checkDomain(domain, signal) {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=NS`;
  const res = await fetch(url, { headers: { Accept: 'application/dns-json' }, signal });
  const data = await res.json();
  if (data.Status === 3) return 'available';
  if (data.Status === 0) return 'taken';
  return 'unknown';
}

async function runPool(tasks, n) {
  let i = 0;
  const w = async () => { while (i < tasks.length) { await tasks[i++](); } };
  await Promise.all(Array.from({ length: n }, w));
}

export default {
  id: 'tld-list',
  name: 'TLD List',
  category: 'Web',
  description: 'Check domain availability across TLDs. Filter by length, type, CF, layout.',
  guide: `## Free Domain Availability Checker — Search All TLDs at Once
This is a free bulk domain availability checker that searches across hundreds of TLDs simultaneously. Use it to find available domain names, check .com availability, browse country-code TLDs, and filter by TLD type or Cloudflare registrar support. Results are DNS-based — always confirm with a registrar before purchasing.
## How to use
- Type a domain name (without any extension) into the input field.
- Press **Check** — domain availability results populate as DNS lookups complete.
- Filter results by TLD type (gTLD, ccTLD, SLD), name length, or Cloudflare support.
- Copy all available domains with one click.
## Choosing the right domain name
- **.com domains** consistently earn the highest click-through rate in search results and carry the strongest brand trust.
- **Shorter domain names** are easier to type, share, and remember. Under 15 characters is a good target.
- **Avoid hyphens** — hyphenated domains look spammy, are harder to say aloud, and underperform in search CTR.
- **Keyword-rich domain names** — a domain that contains your primary keyword can improve search visibility and relevance signals.
- **Country code TLDs** like **.co.uk**, **.de**, or **.com.au** signal geographic relevance to search engines and users in those regions.
- **Niche TLDs** like **.io**, **.app**, **.dev**, or **.ai** work well for tech products and are widely recognized by developer audiences.
## Notes
- Available means no NS record was found via DNS. A domain with no NS record may still be registered but not yet pointed.
- Parked, monetized, and recently expired domains often have NS records and will show as taken.
- This tool checks hundreds of TLDs at once — use length and type filters to narrow results quickly.`,

  _abort: null,
  _timer: null,

  render(mainEl, previewEl) {
    const self = this;
    let cfMode     = 'all';
    let statusMode = 'all';
    let sortMode   = 'alpha';
    let layout     = 'wrap';
    let typeFilter = 'all';   // 'all' | 'gtld' | 'cctld' | 'sld'
    let lenMin     = 1;
    let lenMax     = 32;
    let tldSearch  = '';
    let domName    = '';
    const results  = {};
    const chipMap  = new Map();

    const bdr = 'border-left:1px solid var(--divider)';
    const grp = 'display:inline-flex;border:1px solid var(--divider);border-radius:var(--radius);overflow:hidden';

    mainEl.innerHTML = `
      <div class="tool-content">
        <h2>TLD List</h2>
        <p class="tool-desc">Enter a name to check availability. Accuracy is not Guaranteed.</p>

        <div style="display:flex;gap:8px;margin-bottom:12px;align-items:center">
          <input type="text" id="tld-name" placeholder="Domain name to check" autocomplete="off" spellcheck="false"
            style="flex:1;max-width:340px">
          <button class="btn" id="tld-clear" style="padding:7px 12px;display:none">Clear</button>
        </div>

        <div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;align-items:center">
          <div style="${grp}">
            <button class="pt-filter-btn pt-filter-active" data-status="all">All</button>
            <button class="pt-filter-btn" data-status="available" style="${bdr}">Available</button>
            <button class="pt-filter-btn" data-status="taken" style="${bdr}">Taken</button>
          </div>
          <div style="${grp}">
            <button class="pt-filter-btn pt-filter-active" data-cf="all">All TLDs</button>
            <button class="pt-filter-btn" data-cf="cf" style="${bdr}">CF Only</button>
          </div>
          <div style="${grp}">
            <button class="pt-filter-btn pt-filter-active" data-sort="alpha">AZ</button>
            <button class="pt-filter-btn" data-sort="len-asc" style="${bdr}">Short</button>
            <button class="pt-filter-btn" data-sort="len-desc" style="${bdr}">Long</button>
          </div>
          <div style="${grp}">
            <button class="pt-filter-btn pt-filter-active" data-layout="wrap">Wrap</button>
            <button class="pt-filter-btn" data-layout="row" style="${bdr}">Row</button>
            <button class="pt-filter-btn" data-layout="list" style="${bdr}">List</button>
          </div>
          <span id="tld-count" style="font-size:12px;color:var(--text-muted);margin-left:auto"></span>
        </div>

        <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;align-items:center">
          <input type="text" id="tld-search" placeholder="Filter TLDs" autocomplete="off" spellcheck="false"
            style="width:160px;padding:4px 8px;background:var(--bg);border:1px solid var(--input-border);border-radius:var(--radius);color:var(--text);font-size:13px;font-family:inherit;outline:none">
          <div style="${grp}">
            <button class="pt-filter-btn pt-filter-active" data-type="all">All types</button>
            <button class="pt-filter-btn" data-type="gtld" style="${bdr}">gTLD</button>
            <button class="pt-filter-btn" data-type="cctld" style="${bdr}">ccTLD</button>
            <button class="pt-filter-btn" data-type="sld" style="${bdr}">SLD</button>
          </div>
        </div>

        <div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap;align-items:center">
          <span style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;white-space:nowrap">Length</span>
          <input type="range" id="len-min" min="1" max="32" value="1" style="width:110px">
          <span id="len-label" style="font-size:12px;color:var(--text-muted);min-width:38px;text-align:center;font-variant-numeric:tabular-nums">132</span>
          <input type="range" id="len-max" min="1" max="32" value="32" style="width:110px">
        </div>

        <div id="tld-grid"></div>
      </div>
    `;

    const grid      = mainEl.querySelector('#tld-grid');
    const countEl   = mainEl.querySelector('#tld-count');
    const nameEl    = mainEl.querySelector('#tld-name');
    const clearBtn  = mainEl.querySelector('#tld-clear');
    const searchEl  = mainEl.querySelector('#tld-search');
    const lenMinEl  = mainEl.querySelector('#len-min');
    const lenMaxEl  = mainEl.querySelector('#len-max');
    const lenLabel  = mainEl.querySelector('#len-label');

    // - preview panel -

    function updatePreview() {
      if (!domName) { previewEl.innerHTML = ''; return; }

      const avail   = TLDS.filter(t => results[t] === 'available');
      const taken   = TLDS.filter(t => results[t] === 'taken').length;
      const pending = TLDS.filter(t => results[t] === 'checking' || !results[t]).length;

      const domainRows = avail.slice(0, 80).map(t =>
        `<div style="font-family:ui-monospace,'Cascadia Code','Fira Code',monospace;font-size:12px;padding:2px 0;color:var(--text)">${esc(domName)}.${esc(t)}</div>`
      ).join('');

      previewEl.innerHTML = `
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">
          Checking <span style="font-family:ui-monospace,'Cascadia Code','Fira Code',monospace;color:var(--text);font-weight:600">${esc(domName)}.*</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px">
          <div style="background:var(--surface);border-radius:var(--radius);padding:10px 8px;text-align:center">
            <div style="font-size:22px;font-weight:700;color:#22c55e;line-height:1">${avail.length}</div>
            <div style="font-size:10px;color:var(--text-muted);margin-top:3px;text-transform:uppercase;letter-spacing:0.05em">Avail</div>
          </div>
          <div style="background:var(--surface);border-radius:var(--radius);padding:10px 8px;text-align:center">
            <div style="font-size:22px;font-weight:700;color:var(--text-faint);line-height:1">${taken}</div>
            <div style="font-size:10px;color:var(--text-muted);margin-top:3px;text-transform:uppercase;letter-spacing:0.05em">Taken</div>
          </div>
          <div style="background:var(--surface);border-radius:var(--radius);padding:10px 8px;text-align:center">
            <div style="font-size:22px;font-weight:700;color:var(--text-muted);line-height:1">${pending}</div>
            <div style="font-size:10px;color:var(--text-muted);margin-top:3px;text-transform:uppercase;letter-spacing:0.05em">Left</div>
          </div>
        </div>
        ${avail.length > 0 ? `
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <span style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em">Available</span>
            <button id="copy-avail" class="btn" style="padding:3px 8px;font-size:11px">Copy all</button>
          </div>
          <div>${domainRows}</div>
          ${avail.length > 80 ? `<div style="font-size:11px;color:var(--text-faint);margin-top:6px">and ${avail.length - 80} more</div>` : ''}
        ` : pending > 0 ? `<div style="font-size:12px;color:var(--text-muted)">Checking</div>` : `<div style="font-size:12px;color:var(--text-muted)">No available domains found.</div>`}
      `;

      const copyBtn = previewEl.querySelector('#copy-avail');
      if (copyBtn) {
        copyBtn.addEventListener('click', async () => {
          const text = avail.map(t => `${domName}.${t}`).join('\n');
          try {
            await navigator.clipboard.writeText(text);
            copyBtn.textContent = 'Copied!';
            setTimeout(() => { copyBtn.textContent = 'Copy all'; }, 1500);
          } catch {}
        });
      }
    }

    // - chip helpers -

    function chipDisplay() { return layout === 'list' ? 'flex' : 'inline-flex'; }

    function chipBaseCSS() {
      const base = [
        'align-items:center;gap:5px;padding:3px 9px',
        'border-radius:var(--radius);border:1px solid var(--divider)',
        'background:var(--surface);font-size:12px',
        'font-family:ui-monospace,"Cascadia Code","Fira Code",monospace',
        'color:var(--text);transition:opacity 0.1s',
      ].join(';');
      return layout === 'list'
        ? `display:flex;${base};justify-content:space-between`
        : `display:inline-flex;${base};white-space:nowrap`;
    }

    function chipVisible(tld) {
      if (cfMode === 'cf' && NOT_CF.has(tld)) return false;
      const l = tldLen(tld);
      if (l < lenMin || l > lenMax) return false;
      if (tldSearch && !tld.includes(tldSearch)) return false;
      if (typeFilter !== 'all' && tldType(tld) !== typeFilter) return false;
      if (!domName || statusMode === 'all') return true;
      const st = results[tld];
      if (!st || st === 'checking') return false;
      if (statusMode === 'available') return st === 'available';
      if (statusMode === 'taken')     return st === 'taken';
      return false;
    }

    function sorted() {
      const list = [...TLDS];
      if (sortMode === 'len-asc')  list.sort((a, b) => tldLen(a) - tldLen(b) || a.localeCompare(b));
      if (sortMode === 'len-desc') list.sort((a, b) => tldLen(b) - tldLen(a) || a.localeCompare(b));
      return list;
    }

    function setChipContent(chip, tld) {
      const st = results[tld];
      chip.style.opacity = (domName && st === 'taken') ? '0.35' : '1';
      const label = domName ? `${esc(domName)}.${esc(tld)}` : `.${esc(tld)}`;

      let badges = '';
      if (cfMode === 'cf') {
        badges += `<span style="font-size:9px;font-weight:700;padding:1px 4px;border-radius:3px;background:#f6821f;color:#fff;font-family:system-ui,sans-serif;line-height:1.5">CF</span>`;
      }
      if (domName && st) {
        if      (st === 'checking')  badges += `<span style="color:var(--text-faint);font-size:10px"></span>`;
        else if (st === 'available') badges += `<span style="color:#22c55e;font-size:10px;font-weight:600">avail</span>`;
        else if (st === 'taken')     badges += `<span style="color:var(--text-faint);font-size:10px">taken</span>`;
        else                          badges += `<span style="color:var(--text-faint);font-size:10px">?</span>`;
      }
      chip.innerHTML = badges
        ? `<span>${label}</span><span style="display:flex;align-items:center;gap:4px">${badges}</span>`
        : `<span>${label}</span>`;
    }

    function applyGridLayout() {
      if (layout === 'list') {
        grid.style.cssText = 'display:flex;flex-direction:column;gap:3px';
      } else if (layout === 'row') {
        grid.style.cssText = 'display:flex;flex-wrap:nowrap;overflow-x:auto;gap:5px;padding-bottom:6px';
      } else {
        grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px';
      }
    }

    function updateChip(tld) {
      const chip = chipMap.get(tld);
      if (!chip) return;
      const vis = chipVisible(tld);
      chip.style.display = vis ? chipDisplay() : 'none';
      if (vis) setChipContent(chip, tld);
      refreshCount();
      updatePreview();
    }

    function refreshCount() {
      const n = [...chipMap.values()].filter(c => c.style.display !== 'none').length;
      countEl.textContent = `${n} TLD${n !== 1 ? 's' : ''}`;
    }

    function renderGrid() {
      applyGridLayout();
      for (const tld of sorted()) {
        let chip = chipMap.get(tld);
        if (!chip) {
          chip = document.createElement('div');
          chipMap.set(tld, chip);
        }
        chip.style.cssText = chipBaseCSS();
        grid.appendChild(chip);
        const vis = chipVisible(tld);
        chip.style.display = vis ? chipDisplay() : 'none';
        if (vis) setChipContent(chip, tld);
      }
      refreshCount();
      updatePreview();
    }

    // - checks -

    function abort() {
      if (self._abort) { self._abort.abort(); self._abort = null; }
      clearTimeout(self._timer);
    }

    function startChecks(name) {
      abort();
      for (const tld of TLDS) results[tld] = 'checking';
      renderGrid();
      self._abort = new AbortController();
      const { signal } = self._abort;
      const tasks = TLDS.map(tld => async () => {
        if (signal.aborted || domName !== name) return;
        try {
          const st = await checkDomain(`${name}.${tld}`, signal);
          if (signal.aborted || domName !== name) return;
          results[tld] = st;
        } catch {
          if (!signal.aborted) results[tld] = 'error';
          return;
        }
        updateChip(tld);
      });
      runPool(tasks, 30).catch(() => {});
    }

    // - events -

    nameEl.addEventListener('input', () => {
      domName = nameEl.value.trim().toLowerCase();
      clearBtn.style.display = domName ? '' : 'none';
      abort();
      for (const tld of TLDS) delete results[tld];
      renderGrid();
      if (!domName) return;
      self._timer = setTimeout(() => startChecks(domName), 400);
    });

    clearBtn.addEventListener('click', () => {
      nameEl.value = ''; domName = '';
      clearBtn.style.display = 'none';
      abort();
      for (const tld of TLDS) delete results[tld];
      renderGrid();
    });

    searchEl.addEventListener('input', () => {
      tldSearch = searchEl.value.trim().toLowerCase();
      renderGrid();
    });

    function bindGroup(attr, setter) {
      mainEl.querySelectorAll(`[data-${attr}]`).forEach(btn => {
        btn.addEventListener('click', () => {
          setter(btn.dataset[attr]);
          mainEl.querySelectorAll(`[data-${attr}]`).forEach(b =>
            b.classList.toggle('pt-filter-active', b === btn));
          renderGrid();
        });
      });
    }

    bindGroup('status', v => { statusMode = v; });
    bindGroup('cf',     v => { cfMode = v; });
    bindGroup('sort',   v => { sortMode = v; });
    bindGroup('layout', v => { layout = v; });
    bindGroup('type',   v => { typeFilter = v; });

    lenMinEl.addEventListener('input', () => {
      lenMin = Number(lenMinEl.value);
      if (lenMin > lenMax) { lenMax = lenMin; lenMaxEl.value = lenMax; }
      lenLabel.textContent = `${lenMin}${lenMax}`;
      renderGrid();
    });

    lenMaxEl.addEventListener('input', () => {
      lenMax = Number(lenMaxEl.value);
      if (lenMax < lenMin) { lenMin = lenMax; lenMinEl.value = lenMin; }
      lenLabel.textContent = `${lenMin}${lenMax}`;
      renderGrid();
    });

    renderGrid();
    injectGuide(mainEl, this.guide);
  },

  destroy() {
    if (this._abort) { this._abort.abort(); this._abort = null; }
    clearTimeout(this._timer);
  },
};
