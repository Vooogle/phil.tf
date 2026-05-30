# PTK Design Language

## Palette

Warm gray, light mode only.

| Token | Value | Use |
|-------|-------|-----|
| `--bg` | `#f7f5f2` | Page background |
| `--surface` | `#f0ede9` | Panel / card surfaces |
| `--surface-hover` | `#e8e4de` | Hover state |
| `--surface-active` | `#dedad3` | Pressed / selected |
| `--sidebar-bg` | `#edeae6` | Left sidebar |
| `--header-bg` | `#e9e5e0` | Top header |
| `--divider` | `#ddd8d2` | Separators |
| `--text` | `#1c1a17` | Primary text |
| `--text-muted` | `#6e6860` | Secondary / labels |
| `--text-faint` | `#9e9890` | Placeholder, hints |
| `--accent` | `#7a6a5a` | Active indicator, icon fill |
| `--accent-hover` | `#5e5145` | Accent on hover |
| `--input-border` | `#c8c3bc` | Text input border |
| `--input-focus` | `#8a7e72` | Text input focus ring |

## Typography

- UI: `system-ui, -apple-system, sans-serif`
- Mono: `ui-monospace, 'Cascadia Code', 'Fira Code', monospace`
- Base size: 14px
- Line height: 1.5

## Interaction Rules

1. **Clickable elements** (buttons, nav items, cards, links):
   No border. No outline. Hover → `--surface-hover` bg. Active → `--surface-active` bg.

2. **Text inputs** (`input`, `textarea`, `select`):
   `1px solid var(--input-border)`. Focus → `2px solid var(--input-focus)` inset.

3. **Selected / active state:**
   `--surface-active` bg + 2px `--accent` left border indicator.

4. **Disabled:**
   `opacity: 0.45`. No hover effect.

5. **Transitions:** 80ms ease for bg/color changes.

## Layout

```
┌─────────────────────────────────────────────────────┐
│ header (48px)                                        │
├──────────────┬──────────────────────┬───────────────┤
│ sidebar      │ tool view            │ preview panel │
│ (240px)      │ (flex: 1)            │ (280px)       │
│              │                      │               │
└──────────────┴──────────────────────┴───────────────┘
```

## Adding Tools

Create `tools/<name>.js`, add to `tools/registry.js`.

```js
export default {
  id: 'my-tool',          // URL: /tool/my-tool
  name: 'My Tool',
  category: 'Category',
  description: 'One line.',
  render(mainEl, previewEl) { /* build DOM */ },
  destroy() { /* remove listeners, timers */ }
}
```
