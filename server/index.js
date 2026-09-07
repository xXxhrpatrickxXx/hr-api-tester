// Optional local host for the built client. The app is fully static: the
// browser calls core.helloretail.com directly (CORS is open on the serve
// endpoints), so there is no proxy and no credentials here. The deployed
// GitHub Pages site doesn't use this file at all.
import express from 'express'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 8787
const distDir = join(__dirname, '..', 'dist')
const hasBuild = existsSync(join(distDir, 'index.html'))

const app = express()

if (hasBuild) {
  app.use(express.static(distDir))
  // Single-page app: any other GET returns the shell.
  app.get('*', (_req, res) => res.sendFile(join(distDir, 'index.html')))
}

app.listen(PORT, () => {
  console.log(`[hr-api-tester] listening on http://localhost:${PORT}`)
  if (!hasBuild) {
    console.log('[hr-api-tester] no built client found — run "npm run build" first.')
  }
})
