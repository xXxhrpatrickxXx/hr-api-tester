// Small localStorage wrappers for UI preferences (layout, theme, log tag).
// localStorage can be missing or throw on access (private windows, blocked
// site data), so every call is guarded: a failed read gives null and a failed
// write is dropped. The app then just runs with its defaults.

export function readStored(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

// `value` null / undefined removes the key.
export function writeStored(key, value) {
  try {
    if (value == null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* storage unavailable or full: keep running without it */
  }
}

// A stored number within [min, max], else `fallback`.
export function storedNumber(raw, min, max, fallback) {
  if (raw == null || raw === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback
}
