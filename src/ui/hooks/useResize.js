// useResize — pointer-event-driven resize for bottom-right-anchored floating panel
import { useEffect, useRef, useCallback } from 'react';

/**
 * Returns the appropriate CSS cursor for a given resize edge.
 * @param {'left'|'top'|'top-left'} edge
 * @returns {string}
 */
function getCursor(edge) {
  switch (edge) {
    case 'left':     return 'ew-resize';
    case 'top':      return 'ns-resize';
    case 'top-left': return 'nwse-resize';
    default:         return 'default';
  }
}

/**
 * Custom resize hook using pointer events and requestAnimationFrame.
 *
 * Replaces native CSS `resize: both` with a custom drag system for a
 * bottom-right-anchored floating panel (position: fixed; bottom: 20px; right: 20px).
 * Resize handles sit on the left edge, top edge, and top-left corner.
 *
 * The hook listens for `pointerdown` on elements with a `data-resize-edge`
 * attribute inside the panel, then tracks `pointermove` / `pointerup` on
 * `document` to drive the resize. All dimension changes go directly to
 * `element.style` inside a rAF callback — no React state is involved.
 *
 * @param {React.RefObject<HTMLElement>} panelRef  — ref to the .claude-float container
 * @param {'minimized'|'collapsed'|'expanded'|'maximized'} viewMode
 * @param {{ minWidth?: number, minHeight?: number, maxHeight?: number }} [options]
 */
export function useResize(panelRef, viewMode, options = {}) {
  const {
    minWidth  = 360,
    minHeight = 300,
    maxHeight = 800,
  } = options;

  // Mutable drag state — never triggers re-renders
  const dragState = useRef(null);

  // Track the rAF id so we can cancel it on cleanup
  const rafId = useRef(null);

  // Store the cleanup function for document-level listeners so we can
  // call it from both pointerup and the effect teardown.
  const cleanupDrag = useCallback(() => {
    dragState.current = null;

    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }

    // Reset body overrides
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    // Only active in expanded mode
    if (viewMode !== 'expanded') {
      // If we were mid-drag when the mode changed, abort cleanly
      cleanupDrag();
      return;
    }

    const panel = panelRef.current;
    if (!panel) return;

    // --- Pointer handlers ---------------------------------------------------

    function onPointerDown(e) {
      const edge = e.target.dataset.resizeEdge;
      if (!edge) return; // click was not on a resize handle

      // Capture the pointer so we keep receiving events even if the
      // cursor leaves the browser window.
      e.target.setPointerCapture(e.pointerId);

      const rect = panel.getBoundingClientRect();

      dragState.current = {
        edge,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startWidth:  rect.width,
        startHeight: rect.height,
      };

      // Override body cursor so the resize cursor stays consistent
      // even when the pointer briefly leaves the handle element.
      document.body.style.cursor = getCursor(edge);
      document.body.style.userSelect = 'none';

      // Prevent text selection and default drag behaviour
      e.preventDefault();
    }

    function onPointerMove(e) {
      const state = dragState.current;
      if (!state) return;

      // Batch the style mutation inside rAF for smooth 60fps updates
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
      }

      rafId.current = requestAnimationFrame(() => {
        rafId.current = null;
        if (!dragState.current) return; // drag may have ended between scheduling and execution

        const { edge, startX, startY, startWidth, startHeight } = dragState.current;

        if (edge === 'left' || edge === 'top-left') {
          // Dragging left increases width (panel anchored at right edge)
          const newWidth = Math.max(minWidth, startWidth - (e.clientX - startX));
          panel.style.width = newWidth + 'px';
        }

        if (edge === 'top' || edge === 'top-left') {
          // Dragging up increases height (panel anchored at bottom edge)
          const rawHeight = startHeight - (e.clientY - startY);
          const newHeight = Math.min(maxHeight, Math.max(minHeight, rawHeight));
          panel.style.height = newHeight + 'px';
        }
      });
    }

    function onPointerUp(e) {
      if (!dragState.current) return;
      cleanupDrag();
    }

    // --- Attach listeners ----------------------------------------------------

    // pointerdown is delegated on the panel (handles have data-resize-edge)
    panel.addEventListener('pointerdown', onPointerDown);

    // pointermove and pointerup go on document so we track outside the panel
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);

    // --- Teardown ------------------------------------------------------------
    return () => {
      panel.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      cleanupDrag();
    };
  }, [viewMode, panelRef, minWidth, minHeight, maxHeight, cleanupDrag]);
}
