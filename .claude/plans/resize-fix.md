# Fix: Chat Widget Resize — Instant, Lag-Free

## Root Causes of Lag
1. **`transition: all 0.25s`** on `.claude-float` — applies to width/height during resize, creating 250ms delay on every mouse movement
2. **Native CSS `resize: both`** — poor control, tiny grab target, no visual affordance
3. **`direction: rtl` hack** — fragile workaround for bottom-right anchoring

## Solution: Custom Resize with Direct DOM Manipulation

Replace native CSS resize with custom drag handles that manipulate the DOM directly (no React state during drag). This gives instant visual feedback.

### Changes

#### 1. `src/ui/App.jsx` — `ClaudeFloatingPanel`

Add three invisible resize handles as sibling divs inside the float container (only when `viewMode === 'expanded'`):
- **Left edge** — full-height strip, 6px wide, `cursor: ew-resize`
- **Top edge** — full-width strip, 6px tall, `cursor: ns-resize`
- **Top-left corner** — 12x12px square, `cursor: nwse-resize`

Add a `useEffect` that attaches `mousedown` handlers to these elements. On mousedown:
1. Record initial mouse position, element width/height
2. Add a class `claude-float--resizing` to disable transitions
3. Attach `mousemove` and `mouseup` to `window`
4. On `mousemove`: compute delta, apply new width/height directly via `el.style.width` / `el.style.height` (no React state, no re-render)
5. On `mouseup`: remove listeners, remove `--resizing` class

Key performance details:
- All DOM writes happen in the `mousemove` handler directly — no `requestAnimationFrame` wrapper needed since we're only setting two style properties
- `will-change: width, height` during resize for compositor optimization
- Clamp to min-width (360px) and min-height (300px) from CSS
- Since panel is anchored bottom-right, left-edge drag changes width, top-edge drag changes height (no position recalculation needed — CSS `right`/`bottom` stay fixed)

#### 2. `src/ui/styles/index.css` — CSS changes

**Remove from `.claude-float--expanded`:**
- `resize: both`
- `direction: rtl`

**Remove:**
- `.claude-float--expanded > * { direction: ltr; }`

**Change `.claude-float` transition** to exclude width/height:
```css
transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1),
            box-shadow 0.25s cubic-bezier(0.4, 0, 0.2, 1);
```

**Add `--resizing` class:**
```css
.claude-float--resizing {
  transition: none !important;
  user-select: none;
  will-change: width, height;
}
```

**Add resize handle styles:**
```css
.claude-resize-left { position: absolute; left: -3px; top: 0; width: 6px; height: 100%; cursor: ew-resize; z-index: 10; }
.claude-resize-top { position: absolute; top: -3px; left: 0; height: 6px; width: 100%; cursor: ns-resize; z-index: 10; }
.claude-resize-corner { position: absolute; top: -3px; left: -3px; width: 14px; height: 14px; cursor: nw-resize; z-index: 11; }
```

No visible styling on the handles — they're invisible hit targets. The cursor change is the affordance.

### What This Achieves
- **Zero lag** — direct DOM style writes, no React re-renders during drag
- **No transition interference** — transitions disabled during resize
- **Large grab targets** — 6px edges vs 16px native handle
- **Three resize directions** — left, top, and corner (diagonal)
- **Clean anchoring** — bottom-right stays fixed, no position math needed
