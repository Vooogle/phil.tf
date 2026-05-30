let _ffmod = null;

export async function loadFFmpeg(onStatus) {
  if (_ffmod) return _ffmod;
  const mt = self.crossOriginIsolated === true;
  onStatus(`Loading FFmpeg (~${mt ? '32' : '30'} MB, cached after first load)…`);
  const { FFmpeg }               = await import('https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js');
  const { fetchFile, toBlobURL } = await import('https://unpkg.com/@ffmpeg/util@0.12.1/dist/esm/index.js');
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
  try { await ff.load(loadOpts); } finally { window.Worker = _W; }
  _ffmod = { ff, fetchFile };
  return _ffmod;
}

export function parseFFmpegProgress(msg) {
  if (!msg.includes('frame=') && !msg.includes('size=')) return null;
  const get = k => { const m = msg.match(new RegExp(k + '\\s*=\\s*([\\S]+)')); return m ? m[1] : null; };
  const parts = [];
  const frame = get('frame'); if (frame) parts.push(`frame ${frame}`);
  const fps   = get('fps');   if (fps && fps !== '0') parts.push(`${fps} fps`);
  const size  = get('size');  if (size) parts.push(size);
  const time  = get('time');  if (time && time !== 'N/A') parts.push(time);
  const speed = get('speed'); if (speed && speed !== '0x') parts.push(speed);
  return parts.length ? parts.join('  ·  ') : null;
}

export async function ffExec(ff, args, onStatus, onProgress) {
  const logs = [];
  const logH = ({ message }) => {
    logs.push(message);
    if (onStatus) { const p = parseFFmpegProgress(message); if (p) onStatus(p); }
  };
  const progH = onProgress ? ({ progress }) => onProgress(Math.max(0, Math.min(1, progress))) : null;
  ff.on('log', logH);
  if (progH) ff.on('progress', progH);
  let ret;
  try {
    ret = await ff.exec(args);
  } catch (e) {
    // Emscripten can throw strings or non-Error values on abort
    const isBanner = s => /^\s*(lib(av|sw|post)|  built |  config|Copyright|ffmpeg version \d)/.test(s);
    const tail = logs.filter(s => s && !isBanner(s)).slice(-6).join(' | ');
    throw new Error(`FFmpeg crashed: ${e?.message ?? String(e)}${tail ? ' | ' + tail : ''}`);
  } finally {
    ff.off('log', logH);
    if (progH) ff.off('progress', progH);
  }
  if (ret !== 0) {
    // Filter out the version banner (libav*, "built with", copyright lines) to surface real errors
    const isBanner = s => /^\s*(lib(av|sw|post)|  built |  config|Copyright|ffmpeg version \d)/.test(s);
    const clean = logs.filter(s => s && !isBanner(s));
    const errLines = clean.filter(s => /error|fail|invalid|cannot|not found|Conversion|Abort|unsupport/i.test(s));
    const display = (errLines.length ? errLines : clean).slice(-8);
    throw new Error(`FFmpeg failed (code ${ret}): ${display.join(' | ')}`);
  }
  return logs;
}

export function resetFFmpeg() { _ffmod = null; }

// Returns { duration, audioCodec } — audioCodec may be null if no audio stream
export async function probeInfo(ff, inName) {
  const logs = [];
  const logH = ({ message }) => logs.push(message);
  ff.on('log', logH);
  await ff.exec(['-i', inName]);
  ff.off('log', logH);
  const joined = logs.join('\n');
  const dm = joined.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  if (!dm) throw new Error('Could not determine video duration');
  const duration = parseInt(dm[1]) * 3600 + parseInt(dm[2]) * 60 + parseFloat(dm[3]);
  const am = joined.match(/Audio:\s*(\w+)/);
  const audioCodec = am ? am[1].toLowerCase() : null;
  return { duration, audioCodec };
}

// Codecs known to crash ffmpeg.wasm when decoded (e.g. opus-in-MP4)
export const CRASHY_AUDIO = new Set(['opus', 'vorbis']);

export async function probeDuration(ff, inName) {
  return (await probeInfo(ff, inName)).duration;
}
