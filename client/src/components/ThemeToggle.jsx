import { useEffect, useState } from 'react'

// Theme choice: 'auto' follows the OS (dark when it states no preference),
// 'light' / 'dark' pin it. index.html applies it before first paint; this keeps
// <html data-theme> in sync afterwards, including OS changes while on auto.
const THEME_KEY = 'hr-api-tester:theme'
const THEME_NEXT = { auto: 'light', light: 'dark', dark: 'auto' }
const THEME_LABEL = { auto: '◐ Auto', light: '☀ Light', dark: '☾ Dark' }

export function ThemeToggle() {
  const [mode, setMode] = useState(() => {
    try {
      const t = localStorage.getItem(THEME_KEY)
      return t === 'light' || t === 'dark' ? t : 'auto'
    } catch {
      return 'auto'
    }
  })
  useEffect(() => {
    try {
      if (mode === 'auto') localStorage.removeItem(THEME_KEY)
      else localStorage.setItem(THEME_KEY, mode)
    } catch {}
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const apply = () => {
      const theme = mode === 'auto' ? (mq.matches ? 'light' : 'dark') : mode
      document.documentElement.dataset.theme = theme
    }
    apply()
    if (mode !== 'auto') return
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [mode])
  return (
    <button
      className="chip sm theme"
      onClick={() => setMode(THEME_NEXT[mode])}
      title={`Theme: ${mode}${mode === 'auto' ? ' (follows system)' : ''}. Click to switch.`}
    >
      {THEME_LABEL[mode]}
    </button>
  )
}
