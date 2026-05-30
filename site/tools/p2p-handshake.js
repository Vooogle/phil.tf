import { injectGuide } from './guide.js';

// -Crypto --------------------------------------------------------------------

async function genKeyPair() {
  return crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
}
async function exportPub(key) {
  const raw = await crypto.subtle.exportKey('raw', key);
  return u8b64(new Uint8Array(raw));
}
async function importPub(b64) {
  return crypto.subtle.importKey('raw', b64u8(b64), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
}
async function deriveSharedKey(priv, peerPub) {
  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: peerPub },
    priv, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}
async function seal(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(JSON.stringify(obj));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pt));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return u8b64(out);
}
async function open(key, b64) {
  const bytes = b64u8(b64);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12));
  return JSON.parse(new TextDecoder().decode(pt));
}

// -Util ----------------------------------------------------------------------

function u8b64(u8) { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s); }
function b64u8(b64) { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)); }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function hms() { const d = new Date(); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
function fmt(n) { return n < 1024 ? `${n}B` : n < 1048576 ? `${(n/1024).toFixed(1)}KB` : `${(n/1048576).toFixed(1)}MB`; }
async function encBlob(desc, pub) {
  const bytes = new TextEncoder().encode(JSON.stringify({ type: desc.type, sdp: desc.sdp, pub }));
  const cs = new CompressionStream('deflate-raw');
  const w = cs.writable.getWriter(); w.write(bytes); w.close();
  const buf = await new Response(cs.readable).arrayBuffer();
  return u8b64(new Uint8Array(buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
async function decBlob(s) {
  s = s.trim();
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
    const bytes = b64u8(padded);
    const ds = new DecompressionStream('deflate-raw');
    const w = ds.writable.getWriter(); w.write(bytes); w.close();
    const buf = await new Response(ds.readable).arrayBuffer();
    return JSON.parse(new TextDecoder().decode(buf));
  } catch {
    try { return JSON.parse(atob(s)); } catch { return null; }
  }
}

const ICE = { iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.services.mozilla.com' },
] };
const CHUNK = 12 * 1024;

async function gatherIce(pc) {
  if (pc.iceGatheringState === 'complete') return;
  return new Promise(res => {
    const done = () => { pc.removeEventListener('icegatheringstatechange', h); res(); };
    const h = () => { if (pc.iceGatheringState === 'complete') done(); };
    pc.addEventListener('icegatheringstatechange', h);
    setTimeout(done, 4000);
  });
}

function svgBtn(id, src, title, extra = '') {
  return `<button class="btn p2p-ibtn" id="${id}" title="${title}" ${extra}>
    <img class="icon p2p-bicon" src="/assets/icons/${src}" alt="${title}">
  </button>`;
}

// -Module-level persistence (survives tool unmount) --------------------------
let _live = null;

// -Tool ----------------------------------------------------------------------

export default {
  id: 'p2p-handshake',
  name: 'P2P Connect',
  category: 'Network',
  description: 'Serverless P2P via copy-paste WebRTC handshake. E2EE. Voice, screen share, file transfer.',
  guide: `## P2P Connect - No Server Required
Connect directly by exchanging short codes. No account, no server, no install.

## Caller flow (you start)
1. Copy your invite code and send it via any channel (chat, email, SMS, whatever).
2. They paste it, generate a response, and send it back.
3. Paste their response and click Connect.

## Receiver flow (they started)
1. Click "I got invited".
2. Paste their invite code and click Generate Response.
3. Copy your response and send it back. Wait for connection.

## Once connected
Set your display name, then use the toolbar at the bottom for voice and screen share.
Drag files into the drop zone to transfer them peer-to-peer.

## Encryption
ECDH P-256 + AES-GCM-256 per message. Keys are ephemeral and never leave your browser.
WebRTC DTLS encrypts the transport on top of that.

## Navigating away
The connection persists while you use other tools. A badge in the top bar shows it's still active.

## Notes
- No TURN relay - symmetric NAT may prevent direct connection.
- Blobs are base64 SDP + EC public key (~1–3 KB).
`,

  // -state -
  _kp: null,
  _pub: null,
  _peers: null,
  _mic: null,
  _screen: null,
  _micMuted: false,
  _audMuted: false,
  _myName: '',
  _analysers: null,   // Map<peerId, { ctx, analyser }>
  _myAnalyser: null,
  _streamRes: 1.0,
  _streamFps: 30,
  _mainEl: null,
  _previewEl: null,
  _cleanups: [],

  render(mainEl, previewEl) {
    this._mainEl   = mainEl;
    this._previewEl = previewEl;
    this._cleanups = [];
    this._injectCSS();

    if (_live) {
      this._kp         = _live.kp;
      this._pub        = _live.pub;
      this._peers      = _live.peers;
      this._mic        = _live.mic;
      this._screen     = _live.screen;
      this._micMuted   = _live.micMuted;
      this._audMuted   = _live.audMuted;
      this._myName     = _live.myName;
      this._analysers  = _live.analysers;
      this._myAnalyser = _live.myAnalyser;
      this._streamRes  = _live.streamRes;
      this._streamFps  = _live.streamFps;
      _live = null;
      this._mountConnected();
      injectGuide(mainEl, this.guide);
      return;
    }

    this._peers      = new Map();
    this._mic        = null;
    this._screen     = null;
    this._micMuted   = false;
    this._audMuted   = false;
    this._myName     = '';
    this._analysers  = new Map();
    this._myAnalyser = null;

    mainEl.innerHTML = `<div style="color:var(--text-muted);font-size:13px;padding:20px">Initializing…</div>`;
    genKeyPair().then(async kp => {
      this._kp  = kp;
      this._pub = await exportPub(kp.publicKey);
      this._mountCaller();
      injectGuide(mainEl, this.guide);
    });
  },

  destroy() {
    const isLive = this._peers && [...this._peers.values()].some(p => p.pc?.connectionState === 'connected');
    if (isLive) {
      _live = { kp: this._kp, pub: this._pub, peers: this._peers, mic: this._mic, screen: this._screen, micMuted: this._micMuted, audMuted: this._audMuted, myName: this._myName, analysers: this._analysers, myAnalyser: this._myAnalyser, streamRes: this._streamRes, streamFps: this._streamFps };
      this._cleanups.forEach(fn => fn()); this._cleanups = [];
      this._mainEl = null; this._previewEl = null;
      // Badge stays - connection is live
    } else {
      _live = null;
      this._teardown();
      this._removeHeaderBadge();
    }
  },

  // -CSS ------------------------------------------------------------------

  _injectCSS() {
    if (document.getElementById('p2p-css')) return;
    const s = document.createElement('style'); s.id = 'p2p-css';
    s.textContent = `
      .p2p-center{display:flex;align-items:center;justify-content:center;padding:20px;min-height:300px}
      .p2p-card{width:100%;max-width:420px;background:var(--surface);border:1px solid var(--divider);border-radius:10px;padding:24px;box-sizing:border-box}
      .p2p-card-title{font-size:15px;font-weight:700;margin-bottom:18px}
      .p2p-blob{width:100%;resize:vertical;font-family:ui-monospace,'Cascadia Code',monospace;font-size:11px;padding:8px;background:var(--bg);border:1px solid var(--input-border);border-radius:var(--radius);color:var(--text);outline:none;box-sizing:border-box;line-height:1.45}
      .p2p-lbl{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:6px}
      .p2p-hint{font-size:12px;color:var(--text-muted)}
      .p2p-row{display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap}
      .p2p-sec{margin-bottom:14px}
      .p2p-divider{display:flex;align-items:center;gap:10px;margin:14px 0;color:var(--text-muted);font-size:12px}
      .p2p-divider::before,.p2p-divider::after{content:'';flex:1;height:1px;background:var(--divider)}
      .p2p-namedlg{background:var(--surface);border:1px solid var(--divider);border-radius:8px;padding:14px 16px;margin-bottom:10px}
      .p2p-msgs{flex:1;overflow-y:auto;padding:6px 8px;display:flex;flex-direction:column;gap:2px;min-height:0}
      .p2p-msg{font-size:13px;line-height:1.5;padding:5px 10px;border-radius:6px;background:var(--surface)}
      .p2p-mine{background:color-mix(in srgb,var(--surface) 85%,var(--text) 15%)}
      .p2p-sys{text-align:center;color:var(--text-muted);font-size:11px;padding:2px 0;background:transparent!important}
      .p2p-who{font-weight:700;margin-right:6px;color:var(--text)}
      .p2p-mts{font-size:10px;color:var(--text-muted);margin-left:6px}
      .p2p-connected{position:relative}
      .p2p-screen-overlay{position:absolute;inset:0;background:#000;z-index:20;display:none;flex-direction:column}
      .p2p-screen-overlay video{flex:1;width:100%;object-fit:contain;display:block}
      .p2p-screen-overlay-bar{display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(0,0,0,.7);flex-shrink:0}
      .p2p-sharing-bar{background:rgba(42,157,42,.15);border-bottom:1px solid rgba(42,157,42,.3);padding:5px 12px;font-size:12px;display:flex;align-items:center;gap:8px;flex-shrink:0}
      .p2p-lvlbar{flex:1;height:3px;background:var(--divider);border-radius:2px;overflow:hidden;min-width:30px}
      .p2p-lvlfill{height:100%;background:#2a9d2a;border-radius:2px;transition:width .05s}
      .p2p-drop{border:2px dashed var(--divider);border-radius:var(--radius);padding:10px 14px;text-align:center;font-size:13px;color:var(--text-muted);cursor:pointer;transition:border-color .15s,background .15s}
      .p2p-drop.on{border-color:var(--text);background:var(--surface)}
      .p2p-frow{display:flex;align-items:center;gap:8px;padding:4px 8px;background:var(--surface);border-radius:var(--radius);font-size:12px}
      .p2p-fname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .p2p-fbar{width:56px;height:4px;background:var(--divider);border-radius:2px;overflow:hidden;flex-shrink:0}
      .p2p-ffill{height:100%;background:var(--text);border-radius:2px;transition:width .08s}
      .p2p-bottombar{display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface);border-top:1px solid var(--divider);flex-shrink:0}
      .p2p-userinfo{display:flex;flex-direction:column;gap:1px;margin-right:4px;min-width:0}
      .p2p-username{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:90px}
      .p2p-userstatus{font-size:10px;color:var(--text-muted)}
      .p2p-voicegrp{display:flex;align-items:center;gap:2px}
      .p2p-ibtn{padding:5px!important;display:flex;align-items:center;justify-content:center;min-width:28px}
      .p2p-srcbtn{padding:3px 4px!important;min-width:18px;border-left:1px solid var(--divider)!important;border-radius:0 var(--radius) var(--radius) 0!important;opacity:.7}
      .p2p-ibtn.off{opacity:.45}
      .p2p-ibtn.active{background:var(--text)!important;color:var(--bg)!important}
      .p2p-ibtn.active img{filter:invert(1)}
      .p2p-msginput{display:flex;gap:6px;padding:8px 10px;flex-shrink:0;border-top:1px solid var(--divider)}
      .p2p-connected{display:flex;flex-direction:column;height:100%;min-height:0;box-sizing:border-box}
      .p2p-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;display:inline-block}
      .p2p-pulse{animation:p2pp 1.4s ease-in-out infinite}
      .p2p-reqbox{padding:12px;background:var(--surface);border:1px solid var(--divider);border-radius:var(--radius)}
      .p2p-peer-row{display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px}
      .p2p-screen-thumb{position:relative;cursor:pointer;border-radius:var(--radius);overflow:hidden;background:#111;margin-bottom:8px}
      .p2p-screen-thumb video{width:100%;display:block;max-height:160px;object-fit:contain}
      .p2p-screen-thumb-label{position:absolute;bottom:4px;right:6px;font-size:10px;background:rgba(0,0,0,.6);color:#fff;padding:2px 6px;border-radius:3px}
      @keyframes p2pp{0%,100%{opacity:.3}50%{opacity:1}}
    `;
    document.head.appendChild(s);
    this._cleanups.push(() => document.getElementById('p2p-css')?.remove());
  },

  // -Header badge ----------------------------------------------------------

  _showHeaderBadge() {
    if (document.getElementById('p2p-hbadge')) return;
    const header = document.getElementById('header');
    if (!header) return;
    const badge = document.createElement('div');
    badge.id = 'p2p-hbadge';
    badge.title = 'P2P Connect - active';
    badge.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:11px;font-weight:600;padding:3px 9px;background:var(--surface);border:1px solid var(--divider);border-radius:20px;cursor:pointer;user-select:none;color:var(--text)';
    badge.innerHTML = `<span style="width:6px;height:6px;border-radius:50%;background:#2a9d2a;display:inline-block;flex-shrink:0"></span>P2P`;
    badge.addEventListener('click', () => {
      // Try to navigate back to the tool via the sidebar nav
      const navLink = [...document.querySelectorAll('#tool-nav a, #tool-nav [data-id], #tool-nav button')].find(
        el => el.textContent.includes('P2P') || el.getAttribute('href')?.includes('p2p') || el.dataset?.id?.includes('p2p')
      );
      navLink?.click();
    });
    header.appendChild(badge);
  },

  _removeHeaderBadge() {
    document.getElementById('p2p-hbadge')?.remove();
  },

  // -Teardown --------------------------------------------------------------

  _teardown() {
    this._cleanups.forEach(fn => fn()); this._cleanups = [];
    if (this._peers) {
      for (const p of this._peers.values()) {
        try { p.dc?.close(); } catch {} try { p.pc?.close(); } catch {}
        p._aud && (p._aud.srcObject = null);
      }
      this._peers.clear();
    }
    if (this._analysers) {
      for (const a of this._analysers.values()) try { a.ctx.close(); } catch {}
      this._analysers.clear();
    }
    if (this._myAnalyser) { try { this._myAnalyser.ctx.close(); } catch {} this._myAnalyser = null; }
    this._mic?.getTracks().forEach(t => t.stop()); this._mic = null;
    this._screen?.getTracks().forEach(t => t.stop()); this._screen = null;
  },

  // -Audio visualiser ------------------------------------------------------

  _makeAnalyser(stream) {
    try {
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.7;
      src.connect(analyser);
      return { ctx, analyser, buf: new Uint8Array(analyser.frequencyBinCount) };
    } catch { return null; }
  },

  _getLevel(a) {
    a.analyser.getByteFrequencyData(a.buf);
    let sum = 0; for (const v of a.buf) sum += v;
    return sum / a.buf.length / 255;
  },

  _startVizLoop() {
    const self = this;
    let running = true;
    self._cleanups.push(() => { running = false; });
    const tick = () => {
      if (!running) return;
      // Peer levels
      if (self._analysers) {
        for (const [id, a] of self._analysers) {
          const lvl = self._getLevel(a);
          const el = self._previewEl?.querySelector(`#p2pvl-${id}`);
          if (el) el.style.width = `${Math.round(lvl * 100)}%`;
          // Talking dot: glow if above threshold
          const dot = self._previewEl?.querySelector(`#p2pvd-${id}`);
          if (dot) dot.style.boxShadow = lvl > 0.05 ? `0 0 0 3px rgba(42,157,42,${Math.min(lvl * 4, 0.6)})` : '';
        }
      }
      // Own mic level
      if (self._myAnalyser) {
        const lvl = self._getLevel(self._myAnalyser);
        const el = self._mainEl?.querySelector('#p2p-mylvl');
        if (el) el.style.width = `${Math.round(lvl * 100)}%`;
        const dot = self._mainEl?.querySelector('.p2p-dot');
        if (dot && self._mic && !self._micMuted) dot.style.boxShadow = lvl > 0.05 ? `0 0 0 3px rgba(42,157,42,${Math.min(lvl * 4, 0.6)})` : '';
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  },

  // -Handshake: caller -----------------------------------------------------

  _mountCaller() {
    const self = this;
    const mainEl = self._mainEl;

    mainEl.innerHTML = `
      <div class="p2p-center">
        <div class="p2p-card">
          <div class="p2p-card-title">Connect to someone</div>

          <div class="p2p-sec">
            <div class="p2p-lbl">Your invite code</div>
            <textarea class="p2p-blob" id="p2p-offer" style="height:68px" readonly placeholder="Generating…"></textarea>
            <div class="p2p-row">
              <button class="btn" id="p2p-copy" disabled>Copy</button>
              <span id="p2p-copy-ok" class="p2p-hint"></span>
            </div>
            <div class="p2p-hint" style="margin-top:6px">Send this to the person you want to connect with</div>
          </div>

          <div class="p2p-divider">then paste their response below</div>

          <div class="p2p-sec">
            <textarea class="p2p-blob" id="p2p-answer" style="height:68px" placeholder="Paste the code they send back…"></textarea>
            <div class="p2p-row">
              <button class="btn" id="p2p-connect">Connect →</button>
              <span id="p2p-err" class="p2p-hint" style="color:#e44"></span>
            </div>
          </div>

          <div style="border-top:1px solid var(--divider);padding-top:12px;text-align:center">
            <button class="btn" id="p2p-to-receiver" style="font-size:12px;padding:5px 14px">I got invited →</button>
          </div>
        </div>
      </div>
    `;

    const { peerId, pc, dc } = self._makePeerConnection();

    (async () => {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await gatherIce(pc);
      const blob = await encBlob(pc.localDescription, self._pub);
      if (!mainEl.querySelector('#p2p-offer')) return; // navigated away
      mainEl.querySelector('#p2p-offer').value = blob;
      const copyBtn = mainEl.querySelector('#p2p-copy');
      copyBtn.disabled = false;
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(blob);
        const ok = mainEl.querySelector('#p2p-copy-ok');
        ok.textContent = 'Copied!'; setTimeout(() => { ok.textContent = ''; }, 2000);
      });
    })();

    mainEl.querySelector('#p2p-connect').addEventListener('click', async () => {
      const btn = mainEl.querySelector('#p2p-connect');
      const s = mainEl.querySelector('#p2p-answer').value.trim();
      const parsed = await decBlob(s);
      const err = mainEl.querySelector('#p2p-err');
      if (!parsed || parsed.type !== 'answer' || !parsed.pub) { err.textContent = 'Invalid code.'; return; }
      err.textContent = '';
      btn.disabled = true;
      try {
        const peerPub = await importPub(parsed.pub);
        const key = await deriveSharedKey(self._kp.privateKey, peerPub);
        const peer = self._peers.get(peerId);
        peer.key = key;
        self._bindDC(peerId, dc);
        await pc.setRemoteDescription({ type: parsed.type, sdp: parsed.sdp });
      } catch(e) { btn.disabled = false; mainEl.querySelector('#p2p-err').textContent = e.message; }
    });

    mainEl.querySelector('#p2p-to-receiver').addEventListener('click', () => {
      pc.close(); self._peers.delete(peerId);
      self._mountReceiver();
    });
  },

  // -Handshake: receiver ---------------------------------------------------

  _mountReceiver() {
    const self = this;
    const mainEl = self._mainEl;

    mainEl.innerHTML = `
      <div class="p2p-center">
        <div class="p2p-card">
          <div class="p2p-card-title">Join a session</div>

          <div class="p2p-sec">
            <div class="p2p-lbl">Their invite code</div>
            <textarea class="p2p-blob" id="p2p-offer-in" style="height:68px" placeholder="Paste here…"></textarea>
            <div class="p2p-row">
              <button class="btn" id="p2p-gen">Generate response →</button>
              <span id="p2p-err" class="p2p-hint" style="color:#e44"></span>
            </div>
          </div>

          <div id="p2p-answer-sec" class="p2p-sec" style="display:none">
            <div class="p2p-divider">send this back to them</div>
            <textarea class="p2p-blob" id="p2p-answer-out" style="height:68px" readonly></textarea>
            <div class="p2p-row">
              <button class="btn" id="p2p-copy-ans">Copy</button>
              <span id="p2p-copy-ok" class="p2p-hint"></span>
              <span class="p2p-hint" style="margin-left:auto">Then wait for them to connect</span>
            </div>
          </div>

          <div style="border-top:1px solid var(--divider);padding-top:12px;text-align:center;margin-top:4px">
            <button class="btn" id="p2p-to-caller" style="font-size:12px;padding:5px 14px">← Create my own invite</button>
          </div>
        </div>
      </div>
    `;

    mainEl.querySelector('#p2p-to-caller').addEventListener('click', () => self._mountCaller());

    mainEl.querySelector('#p2p-gen').addEventListener('click', async () => {
      const s = mainEl.querySelector('#p2p-offer-in').value.trim();
      const parsed = await decBlob(s);
      const err = mainEl.querySelector('#p2p-err');
      if (!parsed || parsed.type !== 'offer' || !parsed.pub) { err.textContent = 'Invalid code.'; return; }
      err.textContent = '';
      mainEl.querySelector('#p2p-gen').disabled = true;

      const peerId = Math.random().toString(36).slice(2, 10);
      const pc = new RTCPeerConnection(ICE);
      const peerPub = await importPub(parsed.pub);
      const key = await deriveSharedKey(self._kp.privateKey, peerPub);

      self._peers.set(peerId, { pc, dc: null, key, renegoBusy: false, inFiles: new Map(), screenPending: null, name: '', _aud: null });

      pc.addEventListener('datachannel', e => { self._peers.get(peerId).dc = e.channel; self._bindDC(peerId, e.channel); });
      pc.addEventListener('track', e => self._onTrack(peerId, e));
      pc.addEventListener('connectionstatechange', () => {
        if (pc.connectionState === 'connected') self._onConnected(peerId);
        if (['failed','closed'].includes(pc.connectionState)) self._onDropped(peerId);
      });

      await pc.setRemoteDescription({ type: parsed.type, sdp: parsed.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await gatherIce(pc);

      const blob = await encBlob(pc.localDescription, self._pub);
      const sec = mainEl.querySelector('#p2p-answer-sec');
      if (!sec) return;
      sec.style.display = '';
      mainEl.querySelector('#p2p-answer-out').value = blob;
      mainEl.querySelector('#p2p-copy-ans').addEventListener('click', () => {
        navigator.clipboard.writeText(blob);
        const ok = mainEl.querySelector('#p2p-copy-ok');
        ok.textContent = 'Copied!'; setTimeout(() => { ok.textContent = ''; }, 2000);
      });
    });
  },

  // -Peer connection factory -----------------------------------------------

  _makePeerConnection() {
    const self = this;
    const peerId = Math.random().toString(36).slice(2, 10);
    const pc = new RTCPeerConnection(ICE);
    const dc = pc.createDataChannel('main', { ordered: true });

    self._peers.set(peerId, { pc, dc, key: null, renegoBusy: false, inFiles: new Map(), screenPending: null, name: '', _aud: null });

    pc.addEventListener('track', e => self._onTrack(peerId, e));
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'connected') self._onConnected(peerId);
      if (['failed','closed'].includes(pc.connectionState)) self._onDropped(peerId);
    });
    return { peerId, pc, dc };
  },

  _setupRenego(peerId, pc) {
    const self = this;
    pc.addEventListener('negotiationneeded', async () => {
      const peer = self._peers.get(peerId);
      if (!peer || peer.renegoBusy || pc.signalingState !== 'stable') return;
      peer.renegoBusy = true;
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await gatherIce(pc);
        await self._send(peerId, { t: 'renego-offer', sdp: await encBlob(pc.localDescription, self._pub) });
      } catch {} finally { peer.renegoBusy = false; }
    });
  },

  // -DataChannel -----------------------------------------------------------

  _bindDC(peerId, dc) {
    const self = this;
    dc.addEventListener('open', () => {
      const peer = self._peers.get(peerId);
      if (peer?.pc) self._setupRenego(peerId, peer.pc);
    });
    dc.addEventListener('message', async e => {
      const peer = self._peers.get(peerId);
      if (!peer?.key) return;
      let msg; try { msg = await open(peer.key, e.data); } catch { return; }
      self._onMsg(peerId, msg);
      if (msg.t === 'chat') for (const [id] of self._peers) if (id !== peerId) self._send(id, msg);
    });
    dc.addEventListener('close', () => self._onDropped(peerId));
  },

  async _send(peerId, msg) {
    const peer = this._peers.get(peerId);
    if (!peer?.key || !peer.dc || peer.dc.readyState !== 'open') return;
    peer.dc.send(await seal(peer.key, msg));
  },

  async _broadcast(msg, skip = null) {
    for (const [id] of this._peers) if (id !== skip) this._send(id, msg);
  },

  // -Messages --------------------------------------------------------------

  _onMsg(peerId, msg) {
    const self = this;
    const main = self._mainEl;
    const prev = self._previewEl;

    if (msg.t === 'name') {
      const peer = self._peers.get(peerId);
      if (peer) peer.name = msg.name;
      self._appendMsg('p2p-sys', `${esc(msg.name)} joined`);
      self._refreshPeerList();
      return;
    }

    if (msg.t === 'chat') {
      const peer = self._peers.get(peerId);
      self._appendMsg('p2p-msg', `<b class="p2p-who">${esc(peer?.name || 'Peer')}</b>${esc(msg.text)}<span class="p2p-mts">${esc(msg.ts)}</span>`);
      return;
    }

    if (msg.t === 'file-meta') {
      const peer = self._peers.get(peerId);
      if (!peer) return;
      peer.inFiles.set(msg.id, { name: msg.name, size: msg.size, chunks: [], got: 0 });
      self._addFRow(msg.id, msg.name, msg.size);
      return;
    }

    if (msg.t === 'file-chunk') {
      const f = self._peers.get(peerId)?.inFiles.get(msg.id);
      if (!f) return;
      const bytes = b64u8(msg.data);
      f.chunks.push(bytes); f.got += bytes.length;
      self._fProgress(msg.id, f.got, f.size);
      return;
    }

    if (msg.t === 'file-done') {
      const peer = self._peers.get(peerId);
      const f = peer?.inFiles.get(msg.id);
      if (!f) return;
      peer.inFiles.delete(msg.id);
      self._fDone(msg.id, f.name, new Blob(f.chunks.map(c => c.buffer)));
      return;
    }

    if (msg.t === 'renego-offer') {
      (async () => {
        const peer = self._peers.get(peerId);
        if (!peer) return;
        const desc = await decBlob(msg.sdp); if (!desc) return;
        if (peer.pc.signalingState !== 'stable') return;
        try {
          await peer.pc.setRemoteDescription(desc);
          const answer = await peer.pc.createAnswer();
          await peer.pc.setLocalDescription(answer);
          await gatherIce(peer.pc);
          self._send(peerId, { t: 'renego-answer', sdp: await encBlob(peer.pc.localDescription, self._pub) });
        } catch {}
      })();
      return;
    }

    if (msg.t === 'renego-answer') {
      (async () => {
        const peer = self._peers.get(peerId);
        if (peer?.pc.signalingState === 'have-local-offer') {
          const desc = await decBlob(msg.sdp);
          if (desc) peer.pc.setRemoteDescription(desc).catch(() => {});
        }
      })();
      return;
    }

    if (msg.t === 'screen-request') {
      const peer = self._peers.get(peerId); if (peer) peer.screenPending = true;
      prev?.querySelector('#p2p-screen-req') && (prev.querySelector('#p2p-screen-req').style.display = '');
      return;
    }

    if (msg.t === 'screen-accept') {
      if (self._screen) {
        const peer = self._peers.get(peerId);
        if (peer) self._screen.getTracks().forEach(t => peer.pc.addTrack(t, self._screen));
        prev?.querySelector('#p2p-screen-st') && (prev.querySelector('#p2p-screen-st').textContent = 'Sharing…');
      }
      return;
    }

    if (msg.t === 'screen-decline') {
      self._screen?.getTracks().forEach(t => t.stop()); self._screen = null;
      self._syncScreenBtn();
      prev?.querySelector('#p2p-screen-st') && (prev.querySelector('#p2p-screen-st').textContent = 'Peer declined.');
      return;
    }

    if (msg.t === 'screen-stop') {
      const vid     = prev?.querySelector('#p2p-remote-screen');
      const thumb   = main?.querySelector('#p2p-screen-thumb');
      const overlay = main?.querySelector('#p2p-screen-overlay');
      const ovVid   = main?.querySelector('#p2p-overlay-video');
      if (vid) vid.srcObject = null;
      if (thumb) thumb.style.display = 'none';
      if (overlay) overlay.style.display = 'none';
      if (ovVid) ovVid.srcObject = null;
      prev?.querySelector('#p2p-remote-wrap') && (prev.querySelector('#p2p-remote-wrap').style.display = 'none');
      return;
    }
  },

  _appendMsg(cls, html) {
    const box = this._mainEl?.querySelector('#p2p-msgs');
    if (!box) return;
    const el = document.createElement('div');
    el.className = cls; el.innerHTML = html;
    box.appendChild(el); box.scrollTop = box.scrollHeight;
  },

  // -Tracks ----------------------------------------------------------------

  _onTrack(peerId, e) {
    const self = this;
    const stream = e.streams[0]; if (!stream) return;
    const prev = self._previewEl;
    const main = self._mainEl;

    if (stream.getVideoTracks().length > 0) {
      // Remote screen share - show in preview panel (full) and main panel (thumb)
      const wrap = prev?.querySelector('#p2p-remote-wrap');
      const vid  = prev?.querySelector('#p2p-remote-screen');
      if (wrap && vid) { wrap.style.display = ''; vid.srcObject = stream; }

      const thumb = main?.querySelector('#p2p-screen-thumb');
      const tvid  = main?.querySelector('#p2p-thumb-video');
      if (thumb && tvid) { thumb.style.display = ''; tvid.srcObject = stream; }
    } else {
      const peer = self._peers.get(peerId);
      if (peer?._aud) peer._aud.srcObject = null;
      const a = new Audio();
      a.srcObject = stream; a.play().catch(() => {});
      if (peer) peer._aud = a;
      if (self._audMuted && peer?._aud) peer._aud.muted = true;
      // Attach analyser for volume visualiser
      const analyser = self._makeAnalyser(stream);
      if (analyser) {
        if (self._analysers) { self._analysers.get(peerId)?.ctx.close().catch?.(() => {}); self._analysers.set(peerId, analyser); }
        self._refreshPeerList();
      }
    }
  },

  // -Connected: mount ------------------------------------------------------

  _onConnected(peerId) {
    const self = this;
    const main = self._mainEl;

    if (main && !main.querySelector('#p2p-msgs')) self._mountConnected();

    self._showHeaderBadge();
    self._appendMsg('p2p-sys', '● Connected · E2EE active');

    const dot = main?.querySelector('.p2p-dot');
    if (dot) { dot.style.background = '#2a9d2a'; dot.classList.remove('p2p-pulse'); }
    self._refreshPeerList();

    if (!self._myName) {
      const dlg = main?.querySelector('#p2p-name-dlg');
      if (dlg) { dlg.style.display = ''; main.querySelector('#p2p-name-in')?.focus(); }
    } else {
      self._send(peerId, { t: 'name', name: self._myName });
    }
  },

  _mountConnected() {
    const self = this;
    const main = self._mainEl;
    const prev = self._previewEl;
    if (!main) return;

    main.innerHTML = `
      <div class="p2p-connected">

        <div id="p2p-name-dlg" class="p2p-namedlg" style="display:none;flex-shrink:0">
          <div style="font-size:13px;font-weight:600;margin-bottom:8px">What's your name?</div>
          <div style="display:flex;gap:6px">
            <input id="p2p-name-in" type="text" placeholder="Enter a name…" maxlength="32" autocomplete="off"
              style="flex:1;padding:6px 10px;background:var(--bg);border:1px solid var(--input-border);border-radius:var(--radius);color:var(--text);font-size:13px;font-family:inherit;outline:none">
            <button class="btn" id="p2p-name-set">Set</button>
            <button class="btn" id="p2p-name-skip" style="font-size:12px;padding:6px 10px">Skip</button>
          </div>
        </div>

        <div id="p2p-msgs" class="p2p-msgs"></div>

        <div id="p2p-sharing-bar" class="p2p-sharing-bar" style="display:none">
          <span style="width:7px;height:7px;border-radius:50%;background:#2a9d2a;display:inline-block"></span>
          Sharing your screen
          <button class="btn" id="p2p-stop-sharing" style="margin-left:auto;font-size:11px;padding:3px 9px">Stop</button>
        </div>

        <div id="p2p-screen-thumb" class="p2p-screen-thumb" style="display:none;flex-shrink:0;margin:0 10px 6px">
          <video id="p2p-thumb-video" autoplay playsinline muted style="max-height:130px;object-fit:contain;width:100%"></video>
          <div class="p2p-screen-thumb-label">Click to expand</div>
          <button id="p2p-thumb-close" title="Dismiss" style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,.6);border:none;color:#fff;width:20px;height:20px;border-radius:50%;cursor:pointer;font-size:13px;line-height:1;display:flex;align-items:center;justify-content:center;padding:0">×</button>
        </div>

        <div id="p2p-screen-overlay" class="p2p-screen-overlay">
          <div class="p2p-screen-overlay-bar">
            <span class="p2p-hint" style="color:#fff;flex:1">Peer's screen</span>
            <button class="btn" id="p2p-overlay-close" style="font-size:12px;padding:4px 10px;background:rgba(255,255,255,.1);color:#fff;border-color:rgba(255,255,255,.2)">Collapse ↙</button>
          </div>
          <video id="p2p-overlay-video" autoplay playsinline muted style="flex:1;width:100%;object-fit:contain;display:block;background:#000"></video>
        </div>

        <div style="padding:6px 10px 4px;flex-shrink:0">
          <div id="p2p-drop" class="p2p-drop">
            Drop files here or <label style="color:var(--text);cursor:pointer;text-decoration:underline">browse
              <input type="file" id="p2p-fpick" style="display:none" multiple>
            </label>
          </div>
          <div id="p2p-flist" style="margin-top:5px;display:flex;flex-direction:column;gap:3px"></div>
        </div>

        <div class="p2p-bottombar">
          <div class="p2p-userinfo">
            <div style="display:flex;align-items:center;gap:5px">
              <span class="p2p-dot p2p-pulse" style="background:#888"></span>
              <span class="p2p-username" id="p2p-myname-lbl">${esc(self._myName || 'You')}</span>
            </div>
            <div class="p2p-lvlbar" style="margin-top:3px"><div class="p2p-lvlfill" id="p2p-mylvl" style="width:0%"></div></div>
          </div>

          <div class="p2p-voicegrp">
            ${svgBtn('p2p-aud-btn', 'headphones.svg', 'Toggle audio output')}
            <button class="btn p2p-srcbtn" id="p2p-aud-src" title="Output device"><img class="icon" src="/assets/icons/down.svg" alt="▾"></button>
          </div>

          <div class="p2p-voicegrp" style="margin-left:2px">
            ${svgBtn('p2p-mic-btn', 'nomic.svg', 'Toggle microphone', 'class="btn p2p-ibtn off"')}
            <button class="btn p2p-srcbtn" id="p2p-mic-src" title="Input device"><img class="icon" src="/assets/icons/down.svg" alt="▾"></button>
          </div>

          <div class="p2p-voicegrp" style="margin-left:2px">
            ${svgBtn('p2p-screen-btn', 'screenshare.svg', 'Share screen')}
            <button class="btn p2p-srcbtn" id="p2p-screen-res" title="Stream resolution"><img class="icon" src="/assets/icons/down.svg" alt="▾"></button>
          </div>

          <button class="btn p2p-ibtn" id="p2p-settings-btn" title="Settings" style="margin-left:auto">
            <img class="icon p2p-bicon" src="/assets/icons/settings.svg" alt="Settings">
          </button>
          <button class="btn" id="p2p-disc" style="font-size:11px;padding:4px 9px;opacity:.7">Leave</button>
        </div>

        <div id="p2p-settings-panel" style="display:none;flex-shrink:0;border-top:1px solid var(--divider);padding:12px 10px;background:var(--surface);display:none;flex-direction:column;gap:10px">
          <div class="p2p-lbl">Settings</div>

          <div style="display:flex;align-items:center;gap:10px">
            <div style="flex:1">
              <div style="font-size:12px;font-weight:600;margin-bottom:2px">Test Microphone</div>
              <div class="p2p-hint" id="p2p-mictest-hint">Plays your mic back. Use headphones.</div>
            </div>
            <button class="btn" id="p2p-mictest-btn" style="font-size:12px;padding:5px 12px;flex-shrink:0">Test Mic</button>
          </div>

          <div style="display:flex;align-items:center;gap:10px">
            <div style="flex:1">
              <div style="font-size:12px;font-weight:600;margin-bottom:2px">Output Volume</div>
            </div>
            <input type="range" id="p2p-vol-slider" min="0" max="100" value="100" style="width:90px">
          </div>
        </div>

        <div class="p2p-msginput">
          <input id="p2p-cin" type="text" placeholder="Message…" autocomplete="off"
            style="flex:1;padding:6px 10px;background:var(--bg);border:1px solid var(--input-border);border-radius:var(--radius);color:var(--text);font-size:13px;font-family:inherit;outline:none">
          <button class="btn" id="p2p-csend">Send</button>
        </div>

      </div>
    `;

    if (prev) prev.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:12px;height:100%">

        <div>
          <div class="p2p-lbl" style="margin-bottom:8px">Peers</div>
          <div id="p2p-peer-list" style="display:flex;flex-direction:column;gap:4px"></div>
        </div>

        <div id="p2p-screen-req" class="p2p-reqbox" style="display:none">
          <div style="font-size:13px;font-weight:600;margin-bottom:4px">Screen share request</div>
          <div class="p2p-hint" style="margin-bottom:10px">Peer wants to share their screen.</div>
          <div style="display:flex;gap:8px">
            <button class="btn" id="p2p-accept-screen">Accept</button>
            <button class="btn" id="p2p-decline-screen">Decline</button>
          </div>
        </div>

        <div id="p2p-screen-st" class="p2p-hint" style="min-height:14px"></div>

        <div id="p2p-remote-wrap" style="display:none;flex:1;min-height:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <span class="p2p-hint" style="flex:1">Peer's screen</span>
            <button class="btn" id="p2p-stop-viewing" style="font-size:11px;padding:3px 9px">Stop Viewing</button>
          </div>
          <video id="p2p-remote-screen" autoplay playsinline muted
            style="width:100%;border-radius:var(--radius);background:#111;display:block;max-height:300px;object-fit:contain"></video>
        </div>

        <div style="border-top:1px solid var(--divider);padding-top:12px;margin-top:auto">
          <div class="p2p-lbl" style="margin-bottom:8px">Invite another</div>
          <button class="btn" id="p2p-invite-btn" style="font-size:12px;padding:5px 12px;width:100%">Generate invite code →</button>
          <div id="p2p-invite-area" style="display:none;margin-top:10px">
            <textarea class="p2p-blob" id="p2p-invite-blob" style="height:56px;margin-bottom:6px" readonly></textarea>
            <div class="p2p-row">
              <button class="btn" id="p2p-invite-copy">Copy</button>
              <span id="p2p-invite-ok" class="p2p-hint"></span>
            </div>
            <div class="p2p-row" style="margin-top:8px">
              <input id="p2p-invite-ans" type="text" placeholder="Paste their response…"
                style="flex:1;padding:5px 8px;background:var(--bg);border:1px solid var(--input-border);border-radius:var(--radius);color:var(--text);font-size:12px;font-family:inherit;outline:none">
              <button class="btn" id="p2p-invite-connect" style="font-size:12px;padding:5px 10px">Connect</button>
            </div>
            <div id="p2p-invite-err" class="p2p-hint" style="color:#e44;display:none;margin-top:4px"></div>
          </div>
        </div>

      </div>
    `;

    self._wireConnected();
  },

  _wireConnected() {
    const self = this;
    const main = self._mainEl;
    const prev = self._previewEl;
    if (!main) return;

    // Name dialog
    const nameDlg = main.querySelector('#p2p-name-dlg');
    const nameIn  = main.querySelector('#p2p-name-in');
    const myLbl   = main.querySelector('#p2p-myname-lbl');
    const applyName = (raw) => {
      const name = raw.trim().slice(0, 32);
      if (!name) { nameDlg.style.display = 'none'; return; }
      self._myName = name;
      if (myLbl) myLbl.textContent = name;
      nameDlg.style.display = 'none';
      self._broadcast({ t: 'name', name });
    };
    main.querySelector('#p2p-name-set').addEventListener('click', () => applyName(nameIn?.value || ''));
    main.querySelector('#p2p-name-skip').addEventListener('click', () => { nameDlg.style.display = 'none'; });
    nameIn?.addEventListener('keydown', e => { if (e.key === 'Enter') applyName(nameIn.value); });

    // Disconnect / Leave
    main.querySelector('#p2p-disc').addEventListener('click', () => {
      self._teardown(); self._peers = new Map(); self._myName = ''; self._screen = null; self._mic = null;
      self._removeHeaderBadge();
      genKeyPair().then(async kp => {
        self._kp = kp; self._pub = await exportPub(kp.publicKey);
        self._mountCaller(); injectGuide(main, self.guide);
      });
    });

    // Chat
    const cin  = main.querySelector('#p2p-cin');
    const msgs = main.querySelector('#p2p-msgs');
    const doSend = async () => {
      const text = cin.value.trim(); if (!text) return;
      const ts = hms(); const name = self._myName || 'You';
      await self._broadcast({ t: 'chat', text, ts, name: self._myName });
      const el = document.createElement('div');
      el.className = 'p2p-msg p2p-mine';
      el.innerHTML = `<b class="p2p-who">${esc(name)}</b>${esc(text)}<span class="p2p-mts">${ts}</span>`;
      msgs.appendChild(el); msgs.scrollTop = msgs.scrollHeight;
      cin.value = '';
    };
    main.querySelector('#p2p-csend').addEventListener('click', doSend);
    cin.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); } });

    // File drop
    const drop = main.querySelector('#p2p-drop');
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('on'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('on'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('on'); [...e.dataTransfer.files].forEach(f => self._sendFile(f)); });
    main.querySelector('#p2p-fpick').addEventListener('change', e => { [...e.target.files].forEach(f => self._sendFile(f)); e.target.value = ''; });

    // Screen thumb → expand overlay
    main.querySelector('#p2p-screen-thumb').addEventListener('click', e => {
      if (e.target.id === 'p2p-thumb-close') return; // handled below
      const overlay = main.querySelector('#p2p-screen-overlay');
      const ovVid   = main.querySelector('#p2p-overlay-video');
      const thVid   = main.querySelector('#p2p-thumb-video');
      if (overlay && ovVid && thVid?.srcObject) {
        ovVid.srcObject = thVid.srcObject;
        overlay.style.display = 'flex';
      }
    });
    main.querySelector('#p2p-thumb-close').addEventListener('click', e => {
      e.stopPropagation();
      main.querySelector('#p2p-screen-thumb').style.display = 'none';
    });
    main.querySelector('#p2p-overlay-close').addEventListener('click', () => {
      main.querySelector('#p2p-screen-overlay').style.display = 'none';
    });
    main.querySelector('#p2p-stop-sharing').addEventListener('click', () => self._stopScreen());

    // Settings toggle
    let settingsOpen = false;
    const settingsPanel = main.querySelector('#p2p-settings-panel');
    main.querySelector('#p2p-settings-btn').addEventListener('click', () => {
      settingsOpen = !settingsOpen;
      settingsPanel.style.display = settingsOpen ? 'flex' : 'none';
    });

    // Mic test (loopback)
    let micTestAudio = null;
    main.querySelector('#p2p-mictest-btn').addEventListener('click', async () => {
      const btn  = main.querySelector('#p2p-mictest-btn');
      const hint = main.querySelector('#p2p-mictest-hint');
      if (micTestAudio) {
        micTestAudio.srcObject = null; micTestAudio = null;
        btn.textContent = 'Test Mic'; hint.textContent = 'Plays your mic back. Use headphones.';
        return;
      }
      try {
        const stream = self._mic || await navigator.mediaDevices.getUserMedia({ audio: true });
        micTestAudio = new Audio();
        micTestAudio.srcObject = stream;
        micTestAudio.play().catch(() => {});
        btn.textContent = 'Stop Test';
        hint.textContent = 'Testing - you should hear yourself.';
      } catch {
        hint.textContent = 'Mic access denied.';
      }
    });

    // Output volume
    main.querySelector('#p2p-vol-slider').addEventListener('input', e => {
      const vol = e.target.value / 100;
      for (const p of self._peers.values()) if (p._aud) p._aud.volume = vol;
    });

    // Stop viewing peer's screen
    prev?.querySelector('#p2p-stop-viewing')?.addEventListener('click', () => {
      const wrap  = prev.querySelector('#p2p-remote-wrap');
      const vid   = prev.querySelector('#p2p-remote-screen');
      const thumb = main.querySelector('#p2p-screen-thumb');
      const overlay = main.querySelector('#p2p-screen-overlay');
      if (wrap) wrap.style.display = 'none';
      if (vid) vid.srcObject = null;
      if (thumb) thumb.style.display = 'none';
      if (overlay) overlay.style.display = 'none';
    });

    // Headphones (mute/unmute all remote audio)
    const audBtn = main.querySelector('#p2p-aud-btn');
    audBtn.addEventListener('click', () => {
      self._audMuted = !self._audMuted;
      for (const p of self._peers.values()) if (p._aud) p._aud.muted = self._audMuted;
      audBtn.classList.toggle('off', self._audMuted);
      audBtn.querySelector('img').src = self._audMuted ? '/assets/icons/noheadphones.svg' : '/assets/icons/headphones.svg';
    });

    // Headphones source picker
    main.querySelector('#p2p-aud-src').addEventListener('click', async () => {
      const devices = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter(d => d.kind === 'audiooutput');
      self._showDevicePicker(main.querySelector('#p2p-aud-src'), devices, async (id) => {
        for (const p of self._peers.values()) {
          if (p._aud && p._aud.setSinkId) await p._aud.setSinkId(id).catch(() => {});
        }
      });
    });

    // Mic button
    const micBtn = main.querySelector('#p2p-mic-btn');
    micBtn.addEventListener('click', async () => {
      if (!self._mic) {
        try {
          self._mic = await navigator.mediaDevices.getUserMedia({ audio: true });
          for (const [, p] of self._peers) self._mic.getTracks().forEach(t => p.pc.addTrack(t, self._mic));
          self._micMuted = false;
          micBtn.classList.remove('off');
          micBtn.querySelector('img').src = '/assets/icons/mic.svg';
          self._myAnalyser = self._makeAnalyser(self._mic);
        } catch {
          prev?.querySelector('#p2p-screen-st') && (prev.querySelector('#p2p-screen-st').textContent = 'Mic access denied.');
        }
        return;
      }
      self._micMuted = !self._micMuted;
      self._mic.getAudioTracks().forEach(t => { t.enabled = !self._micMuted; });
      micBtn.classList.toggle('off', self._micMuted);
      micBtn.querySelector('img').src = self._micMuted ? '/assets/icons/nomic.svg' : '/assets/icons/mic.svg';
    });

    // Mic source picker
    main.querySelector('#p2p-mic-src').addEventListener('click', async () => {
      const devices = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter(d => d.kind === 'audioinput');
      self._showDevicePicker(main.querySelector('#p2p-mic-src'), devices, async (id) => {
        if (!self._mic) return;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: id } } }).catch(() => null);
        if (!stream) return;
        const oldTracks = self._mic.getAudioTracks();
        const newTrack  = stream.getAudioTracks()[0];
        for (const [, p] of self._peers) {
          const sender = p.pc.getSenders().find(s => s.track && oldTracks.includes(s.track));
          if (sender) await sender.replaceTrack(newTrack).catch(() => {});
        }
        oldTracks.forEach(t => t.stop());
        self._mic = stream;
      });
    });

    // Stream settings picker
    main.querySelector('#p2p-screen-res').addEventListener('click', (e) => {
      self._showStreamSettings(e.currentTarget);
    });

    // Start visualiser loop
    self._startVizLoop();

    // Screen share
    const screenBtn = main.querySelector('#p2p-screen-btn');
    screenBtn.addEventListener('click', async () => {
      if (self._screen) { self._stopScreen(); return; }
      const scaledH = Math.round(1080 * self._streamRes);
      const videoConstraints = self._streamRes < 1.0
        ? { height: { ideal: scaledH }, frameRate: { ideal: self._streamFps } }
        : { frameRate: { ideal: self._streamFps } };
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: videoConstraints, audio: false });
        self._screen = stream;
        stream.getVideoTracks()[0].addEventListener('ended', () => self._stopScreen());
        self._syncScreenBtn();
        prev?.querySelector('#p2p-screen-st') && (prev.querySelector('#p2p-screen-st').textContent = 'Waiting for peer to accept…');
        await self._broadcast({ t: 'screen-request' });
      } catch(e) {
        prev?.querySelector('#p2p-screen-st') && (prev.querySelector('#p2p-screen-st').textContent = e.name === 'NotAllowedError' ? 'Cancelled.' : e.message);
      }
    });

    // Accept/Decline screen share
    prev?.querySelector('#p2p-accept-screen')?.addEventListener('click', () => {
      prev.querySelector('#p2p-screen-req').style.display = 'none';
      for (const [id, peer] of self._peers) {
        if (peer.screenPending) { peer.screenPending = false; self._send(id, { t: 'screen-accept' }); }
      }
    });
    prev?.querySelector('#p2p-decline-screen')?.addEventListener('click', () => {
      prev.querySelector('#p2p-screen-req').style.display = 'none';
      for (const [id, peer] of self._peers) {
        if (peer.screenPending) { peer.screenPending = false; self._send(id, { t: 'screen-decline' }); }
      }
    });

    // -Refs -
    // Invite another 
    prev?.querySelector('#p2p-invite-btn')?.addEventListener('click', async () => {
      const area = prev.querySelector('#p2p-invite-area');
      prev.querySelector('#p2p-invite-btn').style.display = 'none';
      area.style.display = '';

      const { peerId, pc, dc } = self._makePeerConnection();
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await gatherIce(pc);
      const blob = await encBlob(pc.localDescription, self._pub);

      prev.querySelector('#p2p-invite-blob').value = blob;
      prev.querySelector('#p2p-invite-copy').addEventListener('click', () => {
        navigator.clipboard.writeText(blob);
        const ok = prev.querySelector('#p2p-invite-ok');
        ok.textContent = 'Copied!'; setTimeout(() => { ok.textContent = ''; }, 2000);
      });

      prev.querySelector('#p2p-invite-connect').addEventListener('click', async () => {
        const s = prev.querySelector('#p2p-invite-ans').value.trim();
        const parsed = await decBlob(s);
        const err = prev.querySelector('#p2p-invite-err');
        if (!parsed || parsed.type !== 'answer' || !parsed.pub) { err.textContent = 'Invalid code.'; err.style.display = ''; return; }
        err.style.display = 'none';
        try {
          const peerPub = await importPub(parsed.pub);
          const key = await deriveSharedKey(self._kp.privateKey, peerPub);
          const peer = self._peers.get(peerId);
          peer.key = key;
          self._bindDC(peerId, dc);
          await pc.setRemoteDescription({ type: parsed.type, sdp: parsed.sdp });
          area.style.display = 'none';
          prev.querySelector('#p2p-invite-btn').style.display = '';
        } catch(e) { const err2 = prev.querySelector('#p2p-invite-err'); err2.textContent = e.message; err2.style.display = ''; }
      });
    });
  },

  _syncScreenBtn() {
    const main = this._mainEl;
    const btn  = main?.querySelector('#p2p-screen-btn');
    if (!btn) return;
    const sharing = !!this._screen;
    btn.classList.toggle('active', sharing);
    btn.querySelector('img').src = sharing ? '/assets/icons/noscreenshare.svg' : '/assets/icons/screenshare.svg';
    const bar = main?.querySelector('#p2p-sharing-bar');
    if (bar) bar.style.display = sharing ? '' : 'none';
  },

  _stopScreen() {
    this._screen?.getTracks().forEach(t => t.stop()); this._screen = null;
    this._broadcast({ t: 'screen-stop' });
    this._syncScreenBtn();
    const prev = this._previewEl;
    prev?.querySelector('#p2p-screen-st') && (prev.querySelector('#p2p-screen-st').textContent = '');
  },

  _refreshPeerList() {
    const list = this._previewEl?.querySelector('#p2p-peer-list');
    if (!list) return;
    list.innerHTML = '';
    for (const [id, peer] of this._peers) {
      if (peer.pc?.connectionState !== 'connected') continue;
      const row = document.createElement('div');
      row.className = 'p2p-peer-row';
      row.innerHTML = `
        <span class="p2p-dot" id="p2pvd-${id}" style="background:#2a9d2a;transition:box-shadow .1s"></span>
        <span style="flex:1">${esc(peer.name || 'Peer')}</span>
        <div class="p2p-lvlbar"><div class="p2p-lvlfill" id="p2pvl-${id}" style="width:0%"></div></div>
      `;
      list.appendChild(row);
    }
  },

  _onDropped(peerId) {
    const self = this;
    const main = self._mainEl;
    const peer = self._peers.get(peerId);
    if (peer?._aud) peer._aud.srcObject = null;
    const analyser = self._analysers?.get(peerId);
    if (analyser) { try { analyser.ctx.close(); } catch {} self._analysers.delete(peerId); }
    self._peers.delete(peerId);
    self._appendMsg('p2p-sys', '○ Peer disconnected.');
    self._refreshPeerList();

    if (self._peers.size === 0) {
      const dot = main?.querySelector('.p2p-dot');
      if (dot) { dot.style.background = '#888'; dot.classList.add('p2p-pulse'); }
    }
  },

  // -Stream settings picker ------------------------------------------------

  _showStreamSettings(anchor) {
    const self = this;
    document.getElementById('p2p-streampick')?.remove();
    const rect = anchor.getBoundingClientRect();
    const panel = document.createElement('div');
    panel.id = 'p2p-streampick';
    panel.style.cssText = `position:fixed;z-index:9999;bottom:${window.innerHeight - rect.top + 6}px;left:${Math.max(4, rect.right - 210)}px;width:210px;background:var(--surface);border:1px solid var(--divider);border-radius:var(--radius);box-shadow:0 -4px 16px rgba(0,0,0,.2);font-size:12px;padding:10px 12px;box-sizing:border-box`;

    const pct = Math.round(self._streamRes * 100);
    const px  = Math.round(1080 * self._streamRes);

    panel.innerHTML = `
      <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:8px">Stream Quality</div>
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
          <span style="font-weight:600">Resolution</span>
          <span id="p2p-res-lbl" style="color:var(--text-muted)">${pct}% (~${px}p)</span>
        </div>
        <input type="range" id="p2p-res-sl" min="25" max="100" step="5" value="${pct}"
          style="width:100%;accent-color:var(--text);cursor:pointer">
        <div style="display:flex;justify-content:space-between;color:var(--text-muted);font-size:10px;margin-top:2px"><span>0.25×</span><span>1×</span></div>
      </div>
      <div>
        <div style="font-weight:600;margin-bottom:6px">FPS</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap" id="p2p-fps-btns">
          ${[5,10,15,24,30,60].map(f => {
            const active = f === self._streamFps;
            return `<button data-fps="${f}" style="padding:3px 8px;font-size:11px;border-radius:3px;border:1px solid var(--divider);background:${active ? 'var(--text)' : 'var(--bg)'};color:${active ? 'var(--bg)' : 'var(--text)'};cursor:pointer;transition:background .1s">${f}</button>`;
          }).join('')}
        </div>
      </div>
    `;

    document.body.appendChild(panel);

    panel.querySelector('#p2p-res-sl').addEventListener('input', e => {
      self._streamRes = e.target.value / 100;
      const p = Math.round(1080 * self._streamRes);
      panel.querySelector('#p2p-res-lbl').textContent = `${e.target.value}% (~${p}p)`;
    });

    panel.querySelector('#p2p-fps-btns').addEventListener('click', e => {
      const btn = e.target.closest('[data-fps]');
      if (!btn) return;
      self._streamFps = parseInt(btn.dataset.fps);
      panel.querySelectorAll('[data-fps]').forEach(b => {
        const on = parseInt(b.dataset.fps) === self._streamFps;
        b.style.background = on ? 'var(--text)' : 'var(--bg)';
        b.style.color = on ? 'var(--bg)' : 'var(--text)';
      });
    });

    const close = e => {
      if (!panel.contains(e.target) && e.target !== anchor) {
        panel.remove();
        document.removeEventListener('click', close, true);
      }
    };
    setTimeout(() => document.addEventListener('click', close, true), 0);
  },

  // -Device picker ---------------------------------------------------------

  _showDevicePicker(anchor, devices, onSelect) {
    document.getElementById('p2p-devpick')?.remove();
    if (!devices.length) return;
    const rect = anchor.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.id = 'p2p-devpick';
    menu.style.cssText = `position:fixed;z-index:9999;bottom:${window.innerHeight - rect.top + 4}px;left:${rect.left}px;min-width:180px;max-height:220px;overflow-y:auto;background:var(--surface);border:1px solid var(--divider);border-radius:var(--radius);box-shadow:0 -4px 16px rgba(0,0,0,.2);font-size:12px`;
    for (const d of devices) {
      const item = document.createElement('div');
      item.textContent = d.label || d.deviceId.slice(0, 12);
      item.style.cssText = 'padding:8px 12px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
      item.addEventListener('mouseenter', () => { item.style.background = 'var(--divider)'; });
      item.addEventListener('mouseleave', () => { item.style.background = ''; });
      item.addEventListener('click', () => { menu.remove(); onSelect(d.deviceId); });
      menu.appendChild(item);
    }
    document.body.appendChild(menu);
    const close = e => { if (!menu.contains(e.target) && e.target !== anchor) { menu.remove(); document.removeEventListener('click', close, true); } };
    setTimeout(() => document.addEventListener('click', close, true), 0);
  },

  // -File transfer ---------------------------------------------------------

  _addFRow(id, name, size) {
    const list = this._mainEl?.querySelector('#p2p-flist'); if (!list) return;
    const row = document.createElement('div'); row.className = 'p2p-frow'; row.id = `pfr-${id}`;
    row.innerHTML = `<span class="p2p-fname" title="${esc(name)}">${esc(name)}</span><span style="color:var(--text-muted);flex-shrink:0">${fmt(size)}</span><div class="p2p-fbar"><div class="p2p-ffill" style="width:0%"></div></div>`;
    list.appendChild(row);
  },

  _fProgress(id, got, total) {
    const fill = this._mainEl?.querySelector(`#pfr-${id} .p2p-ffill`);
    if (fill) fill.style.width = `${Math.round(got / total * 100)}%`;
  },

  _fDone(id, name, blob) {
    const row = this._mainEl?.querySelector(`#pfr-${id}`); if (!row) return;
    row.querySelector('.p2p-fbar')?.remove();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.textContent = 'Save';
    a.style.cssText = 'color:var(--text);font-size:12px;text-decoration:underline;cursor:pointer;flex-shrink:0';
    a.addEventListener('click', () => setTimeout(() => URL.revokeObjectURL(url), 10000));
    row.appendChild(a);
  },

  async _sendFile(file) {
    const self = this; if (!self._peers.size) return;
    const id = Math.random().toString(36).slice(2, 10);
    self._addFRow(id, file.name, file.size);
    await self._broadcast({ t: 'file-meta', id, name: file.name, size: file.size });
    const bytes = new Uint8Array(await file.arrayBuffer());
    let offset = 0, seq = 0;
    while (offset < bytes.length) {
      for (const [, p] of self._peers)
        while (p.dc?.bufferedAmount > 2 * 1024 * 1024) await new Promise(r => setTimeout(r, 30));
      const chunk = bytes.subarray(offset, offset + CHUNK);
      await self._broadcast({ t: 'file-chunk', id, seq: seq++, data: u8b64(chunk) });
      offset += CHUNK;
      self._fProgress(id, Math.min(offset, file.size), file.size);
    }
    await self._broadcast({ t: 'file-done', id });
    self._fProgress(id, file.size, file.size);
  },
};
