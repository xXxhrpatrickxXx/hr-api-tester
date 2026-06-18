import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '.env') })

const PORT = process.env.PORT || 8787
const app = express()
app.use(cors())
app.use(express.json({ limit: '2mb' }))

// Replace ${VAR} tokens with values from the server environment. Used on the
// URL, headers, and body so credentials live only in server/.env.
function substituteEnv(input) {
  if (typeof input === 'string') {
    return input.replace(/\$\{([A-Z0-9_]+)\}/g, (match, name) =>
      process.env[name] != null ? process.env[name] : match,
    )
  }
  if (Array.isArray(input)) return input.map(substituteEnv)
  if (input && typeof input === 'object') {
    return Object.fromEntries(
      Object.entries(input).map(([k, v]) => [k, substituteEnv(v)]),
    )
  }
  return input
}

// Expose non-secret config to the client (e.g. base URLs for presets).
app.get('/api/config', (_req, res) => {
  res.json({
    bases: {
      recommendations: process.env.HR_RECOMMENDATIONS_BASE || '',
      search: process.env.HR_SEARCH_BASE || '',
      pages: process.env.HR_PAGES_BASE || '',
    },
    // List which ${VARS} are populated so the UI can hint without leaking values.
    definedEnv: Object.keys(process.env).filter((k) => k.startsWith('HR_')),
  })
})

// Generic forwarder. The client sends { method, url, headers, body }.
app.post('/api/proxy', async (req, res) => {
  const started = Date.now()
  try {
    let { method = 'GET', url, headers = {}, body } = req.body || {}
    if (!url) return res.status(400).json({ error: 'Missing "url"' })

    url = substituteEnv(url)
    headers = substituteEnv(headers)

    const init = { method, headers: { ...headers } }
    if (method !== 'GET' && method !== 'HEAD' && body != null && body !== '') {
      // Body arrives as a raw string from the UI's JSON editor.
      init.body = substituteEnv(typeof body === 'string' ? body : JSON.stringify(body))
      if (!Object.keys(init.headers).some((h) => h.toLowerCase() === 'content-type')) {
        init.headers['Content-Type'] = 'application/json'
      }
    }

    const upstream = await fetch(url, init)
    const text = await upstream.text()
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }

    res.json({
      ok: upstream.ok,
      status: upstream.status,
      statusText: upstream.statusText,
      durationMs: Date.now() - started,
      requestUrl: url,
      headers: Object.fromEntries(upstream.headers.entries()),
      json: parsed,
      text: parsed == null ? text : undefined,
    })
  } catch (err) {
    res.status(502).json({
      error: String(err?.message || err),
      durationMs: Date.now() - started,
    })
  }
})

// Serve the built client (npm run build) from this same server, so the whole
// app runs as one process on one port — open http://localhost:8787. In dev you
// still use the Vite server (:5173), which proxies /api here.
const distDir = join(__dirname, '..', 'dist')
if (existsSync(join(distDir, 'index.html'))) {
  app.use(express.static(distDir))
  // SPA fallback for any non-API GET route.
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(distDir, 'index.html')))
}

app.listen(PORT, () => {
  console.log(`[hr-api-tester] listening on http://localhost:${PORT}`)
  if (!existsSync(join(distDir, 'index.html'))) {
    console.log('[hr-api-tester] no built client found — run "npm run build" to serve the UI here.')
  }
})
