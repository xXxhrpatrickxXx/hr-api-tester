import { useEffect } from 'react'
import { storedNumber } from '../lib/storage.js'
import { useStoredState } from './useStoredState.js'

const LEFT_WIDTH_KEY = 'hr-api-tester:leftWidth'
// .panel's horizontal padding (14px each side), so panelWidth = editorWidth +
// PANEL_PAD keeps the editor un-clipped.
const PANEL_PAD = 28
const MIN_LEFT = 280
const maxLeft = () => Math.min(1400, window.innerWidth - 320)
const clampLeft = (w) => Math.min(Math.max(w, MIN_LEFT), maxLeft())

// Width of the request (config) column, set by dragging or keying the gutter
// and persisted (a layout preference, not per-request data). Returns the width
// and the props for the gutter element.
//
// Dragging `editorRef`'s resize corner sideways widens the column instead of
// the editor itself: the column grows to fit, then the editor snaps back to
// filling it. Off while `disabled` (the mobile layout has no columns).
export function useColumnResize(editorRef, disabled) {
  const [width, setWidth] = useStoredState(LEFT_WIDTH_KEY, (raw) => storedNumber(raw, MIN_LEFT, 1400, 420))

  useEffect(() => {
    const el = editorRef.current
    if (disabled || !el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (!el.style.width) return // already filling the column
      const max = maxLeft()
      const needed = Math.min(el.offsetWidth + PANEL_PAD, max)
      setWidth((w) => (needed > w ? needed : w))
      if (el.offsetWidth + PANEL_PAD >= max) {
        // At the cap, stop the editor overflowing: the resize handle writes the
        // inline width directly, so clear it and let the column bound it.
        el.style.width = ''
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [editorRef, disabled, setWidth])

  // Pointer events, so dragging works with mouse, touch and pen alike.
  function onPointerDown(e) {
    if (e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    const onMove = (ev) => setWidth(clampLeft(startW + ev.clientX - startX))
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  // Keyboard: ←/→ move the gutter (Shift for bigger steps), Home/End jump to
  // the narrowest / widest column.
  function onKeyDown(e) {
    const step = e.shiftKey ? 80 : 20
    const next = {
      ArrowLeft: width - step,
      ArrowRight: width + step,
      Home: MIN_LEFT,
      End: maxLeft(),
    }[e.key]
    if (next == null) return
    e.preventDefault()
    setWidth(clampLeft(next))
  }

  const gutterProps = {
    role: 'separator',
    'aria-orientation': 'vertical',
    'aria-label': 'Resize request panel',
    'aria-valuenow': Math.round(width),
    'aria-valuemin': MIN_LEFT,
    'aria-valuemax': Math.round(maxLeft()),
    tabIndex: disabled ? -1 : 0,
    onPointerDown,
    onKeyDown,
    title: 'Drag (or focus and use ←/→) to resize',
  }
  return { width, gutterProps }
}
