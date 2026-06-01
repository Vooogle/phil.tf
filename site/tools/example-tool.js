// ============================================================================
// Example Tool — copy this file to build a new tool
// ============================================================================
//
// Required fields: id, name, category, description, render, destroy
// Optional fields: previewLabel (shows right panel with that label),
//                  guide (markdown shown via injectGuide)
//
// render(mainEl, previewEl):
//   mainEl   — always present, put your main UI here
//   previewEl — only present if you set previewLabel, otherwise null
//
// destroy():
//   called when user navigates away — clean up timers, streams, listeners
//
// ============================================================================

import { injectGuide } from './guide.js';

export default {
  id: 'example-tool',
  name: 'Example Tool',
  category: 'Misc',
  description: 'Template for building new tools.',

  // Remove this line if the tool has no right panel
  previewLabel: 'Info',

  guide: `## Example Tool
This is the guide shown in the help drawer.

## Usage
Explain what the tool does here.
`,

  // Internal state — reset in render()
  _interval: null,
  _count: 0,

  render(mainEl, previewEl) {
    // Reset state
    this._interval = null;
    this._count = 0;

    // Main panel
    mainEl.innerHTML = `
      <div style="padding:20px;max-width:480px">
        <h2 style="font-size:16px;font-weight:700;margin:0 0 12px">Example Tool</h2>
        <p style="font-size:13px;color:var(--text-muted);margin:0 0 16px">
          Replace this with your tool UI.
        </p>
        <button class="btn" id="ex-btn">Click me</button>
        <div id="ex-out" style="margin-top:12px;font-size:13px;color:var(--text-muted)"></div>
      </div>
    `;

    mainEl.querySelector('#ex-btn').addEventListener('click', () => {
      this._count++;
      mainEl.querySelector('#ex-out').textContent = `Clicked ${this._count} time(s)`;
      if (previewEl) previewEl.querySelector('#ex-preview-count').textContent = this._count;
    });

    // Right panel — only rendered if previewLabel is set (previewEl != null)
    if (previewEl) {
      previewEl.innerHTML = `
        <div style="padding:12px;font-size:13px">
          <div class="p2p-lbl" style="margin-bottom:8px">Stats</div>
          <div>Clicks: <b id="ex-preview-count">0</b></div>
        </div>
      `;
    }

    // Show guide help button
    injectGuide(mainEl, this.guide);
  },

  destroy() {
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
  },
};
