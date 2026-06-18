# Hello Retail API Tester

Local tool to fire requests at the Hello Retail **Recommendations**, **Search**, and **Pages** APIs and render the returned products as visual tiles.

## How it works

- **client/** — Vite + React UI. Pick an API preset (or Custom), choose a method, edit the JSON body, hit **Send**. Results show as product tiles plus raw JSON / response headers.
- **server/** — small Express proxy on `:8787`. It forwards your request to Hello Retail (avoiding browser CORS) and substitutes `${VAR}` tokens in the URL/headers/body with values from `server/.env`, so API keys never live in the browser.

## Setup

```sh
npm install
cp server/.env.example server/.env   # then fill in your keys / base URLs
npm run dev
```

Open http://localhost:5173.

## Credentials

The API key and `websiteUuid` vary per request, so they are **not** stored in `.env` — enter them directly in the request (headers / JSON body) in the UI.

`server/.env` holds only the per-API base URLs (`HR_RECOMMENDATIONS_BASE`, `HR_SEARCH_BASE`, `HR_PAGES_BASE`), which auto-populate the presets. You can still reference any `.env` value in a request as `${VAR_NAME}` — the proxy swaps it in server-side.

## Tile mapping

The UI auto-detects the largest array of objects in the response and maps common field names (title/image/price/url). If your response uses different keys, open **Tile mapping** to set the array path and field names — it suggests detected array paths as clickable chips.
