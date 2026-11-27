import { useRef, useState } from 'react'
import { performRequest, REQUEST_TIMEOUT_MS } from '../lib/send.js'

// Requests in flight, per solution, so each can be cancelled (or time out) and
// a request running in one solution doesn't lock the others.
export function useRequests() {
  const controllers = useRef({})
  const [inFlight, setInFlight] = useState({})

  // Sends `snapshot` for solution `key`; resolves to its history entry.
  async function run(key, snapshot, headers) {
    const controller = new AbortController()
    controllers.current[key] = controller
    setInFlight((m) => ({ ...m, [key]: true }))
    const timeout = setTimeout(() => controller.abort('timeout'), REQUEST_TIMEOUT_MS)
    try {
      return await performRequest(snapshot, headers, { signal: controller.signal })
    } finally {
      clearTimeout(timeout)
      delete controllers.current[key]
      setInFlight((m) => ({ ...m, [key]: false }))
    }
  }

  const cancel = (key) => controllers.current[key]?.abort()

  return { inFlight, run, cancel }
}
