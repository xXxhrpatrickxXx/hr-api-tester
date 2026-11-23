// Shift+Alt+F, as in VS Code. Matched on the physical key so it also works on
// macOS, where Option+F types a character instead of "f".
export function isFormatShortcut(e) {
  return e.shiftKey && e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyF'
}

// Replace a textarea's whole text as if typed, so Ctrl+Z undoes the format and
// React's onChange fires as usual. Returns false where execCommand is
// unsupported; the caller then sets the state directly (no undo step).
export function replaceEditorText(el, text) {
  if (!el || el.value === text) return Boolean(el)
  const { scrollTop } = el
  el.focus()
  el.select()
  const ok = document.execCommand('insertText', false, text)
  if (ok) {
    el.setSelectionRange(0, 0)
    el.scrollTop = Math.min(scrollTop, el.scrollHeight)
  }
  return ok
}

// Clipboard write. navigator.clipboard needs a secure context (https or
// localhost, both of which we have), but fall back to the old selection trick
// rather than failing outright.
export function writeClipboard(value) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value)
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea')
    ta.value = value
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-1000px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    ok ? resolve() : reject(new Error('copy rejected'))
  })
}
