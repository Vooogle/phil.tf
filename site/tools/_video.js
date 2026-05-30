// Shared utilities for video tools

export function isVideo(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return file.type.startsWith('video/') || ['mp4','webm','mov','avi','mkv','m4v','ogv'].includes(ext);
}

// Build the video filter chain (handles even-dimension enforcement + gif special case)
export function buildVf(s = {}, toExt = '') {
  if (toExt === 'gif') {
    const w = s.res || '480', fps = s.fps || '10';
    return `fps=${fps},scale=${w}:-1:flags=lanczos`;
  }
  const parts = [];
  if (s.fps) parts.push(`fps=${s.fps}`);
  parts.push(s.res ? `scale=-2:${s.res}` : 'scale=trunc(iw/2)*2:trunc(ih/2)*2');
  return parts.join(',');
}

// Video codec args for a given output format + settings
export function vcodecArgs(toExt, s = {}) {
  const q = s.quality || 'medium';
  if (toExt === 'webm') {
    const crf = { high:'20', medium:'33', low:'40', tiny:'55' }[q];
    return ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-crf', crf, '-b:v', '0'];
  }
  if (toExt === 'gif') return ['-loop', '0'];
  const crf = { high:'18', medium:'23', low:'28', tiny:'35' }[q];
  return ['-c:v', 'libx264', '-preset', s.preset || 'ultrafast', '-pix_fmt', 'yuv420p', '-crf', crf];
}

// Audio args — returns [] if auto, ['-an'] if disabled/gif, ['-b:a', X] if bitrate set
export function buildAudioArgs(toExt, s = {}, skipAudio = false) {
  if (toExt === 'gif' || skipAudio || s.abr === '0') return ['-an'];
  const out = [];
  if (s.abr)  out.push('-b:a', s.abr);
  if (s.ch)   out.push('-ac', s.ch);
  return out;
}

// Settings HTML — idPrefix avoids ID collisions across tool instances
export function videoSettingsHTML(idPrefix) {
  return `
    <div class="cv-settings">
      <div class="cv-setting-row">
        <span class="cv-setting-lbl">Quality</span>
        <select class="cv-select" id="${idPrefix}-q">
          <option value="high">High</option>
          <option value="medium" selected>Medium</option>
          <option value="low">Low</option>
          <option value="tiny">Tiny</option>
        </select>
      </div>
      <div class="cv-setting-row">
        <span class="cv-setting-lbl">Resolution</span>
        <select class="cv-select" id="${idPrefix}-res">
          <option value="">Original</option>
          <option value="2160">4K (2160p)</option>
          <option value="1080">1080p</option>
          <option value="720">720p</option>
          <option value="480">480p</option>
          <option value="360">360p</option>
          <option value="240">240p</option>
        </select>
      </div>
      <div class="cv-setting-row">
        <span class="cv-setting-lbl">Frame rate</span>
        <select class="cv-select" id="${idPrefix}-fps">
          <option value="">Original</option>
          <option value="60">60 fps</option>
          <option value="30">30 fps</option>
          <option value="24">24 fps</option>
          <option value="15">15 fps</option>
          <option value="10">10 fps</option>
        </select>
      </div>
      <div class="cv-setting-row">
        <span class="cv-setting-lbl">Audio bitrate</span>
        <select class="cv-select" id="${idPrefix}-abr">
          <option value="">Auto</option>
          <option value="320k">320 kbps</option>
          <option value="192k">192 kbps</option>
          <option value="128k">128 kbps</option>
          <option value="96k">96 kbps</option>
          <option value="0">Remove audio</option>
        </select>
      </div>
      <div class="cv-setting-row">
        <span class="cv-setting-lbl">Channels</span>
        <select class="cv-select" id="${idPrefix}-ch">
          <option value="">Original</option>
          <option value="2">Stereo</option>
          <option value="1">Mono</option>
        </select>
      </div>
    </div>
  `;
}

// Read video settings from a container element
export function readVideoSettings(container, idPrefix) {
  const g = id => container.querySelector(`#${id}`)?.value ?? '';
  return {
    quality: g(`${idPrefix}-q`) || 'medium',
    res:     g(`${idPrefix}-res`),
    fps:     g(`${idPrefix}-fps`),
    abr:     g(`${idPrefix}-abr`),
    ch:      g(`${idPrefix}-ch`),
  };
}
