import { useEffect, useRef, useState } from 'react'
import { writeClipboard } from '../lib/dom.js'

// `text` is a function so a large response is only serialized on click, not on
// every render. `icon` adds a clipboard (✓ once copied) before the label.
export function CopyButton({ text, className = 'chip', label = 'copy', title = 'Copy to clipboard', icon }) {
  const [state, setState] = useState('idle') // idle | ok | err
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  async function copy() {
    try {
      await writeClipboard(typeof text === 'function' ? text() : String(text ?? ''))
      setState('ok')
    } catch {
      setState('err')
    }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 1400)
  }
  return (
    <button className={className} onClick={copy} title={title} data-state={state}>
      {icon && (
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          {state === 'ok' ? (
            <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <g fill="none" stroke="currentColor" strokeWidth="1.4">
              <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
              <path d="M10.5 5.5V3.5A1.5 1.5 0 0 0 9 2H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5h2" />
            </g>
          )}
        </svg>
      )}
      {state === 'ok' ? 'copied' : state === 'err' ? 'failed' : label}
    </button>
  )
}
