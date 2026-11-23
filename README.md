# Hello Retail API Tester

Tool to fire requests at the Hello Retail **Recommendations**, **Search**, and **Pages** APIs and render the returned products as visual tiles.

**Hosted:** https://xxxhrpatrickxxx.github.io/hr-api-tester/ — always available, nothing to install. Every push to `main` auto-deploys via GitHub Actions.

## How it works

- **client/** — Vite + React UI. Pick an API preset (or Custom), choose a method, edit the JSON body, hit **Send**. Results show as product tiles plus raw JSON / response headers.
  - `src/App.jsx` holds the app state and layout; `src/components/` the UI pieces (tiles, history panel, page info, theme / Matrix toggles, …).
  - `src/lib/` is the plain logic, with no React: presets and endpoint URLs, reading products out of each API's response shape, legacy query strings, paging and log-tag rewriting, history search / export / import, and the IndexedDB store. Its `*.test.js` files are the tests.
- The browser calls `core.helloretail.com` **directly** (the HR serve endpoints allow cross-origin requests), so the app is fully static and needs no server. Base URLs are baked into the client; the API key and `websiteUuid` are entered per request.
- **server/** — an optional Express server (`:8787`) that just serves the built client, for running it locally. It holds no credentials and no proxy; the deployed site doesn't use it at all.

## Run locally

```sh
npm install
npm run dev      # Vite dev server with hot reload
```

Or run the built app from the single Node server (or use `start-hr-api-tester.cmd`):

```sh
npm run serve    # build, then serve at http://localhost:8787
```

Run the tests (Vitest, no browser needed):

```sh
npm test
```

## Credentials

The API key and `websiteUuid` vary per request, so they are **not** stored anywhere — enter them directly in the request (headers / JSON body) in the UI. Nothing sensitive is built into the deployed site, and there is no `.env` to configure: the endpoint URLs are constants in the client.

## Features

- **Per-solution sessions & history** — each API keeps its own request form, page key, and a history of up to 100 past requests/responses (persisted in IndexedDB). Lock entries to protect them from "clear all", add a note to label them, search the list, and step through it with ↑/↓.
- **Export / import history** — saved history belongs to the site address (the hosted app, `:5173` and `:8787` each have their own), so export it as JSON to back it up or move it between them. Importing merges, skipping entries already there.
- **Paging** — Search, Pages and Search (legacy) results get prev / next buttons that move the request's offset (`products.start` / `product_start`) and resend it.
- **API log tag** — an optional tag added as `?apiLogTag=…` to every request to `core.helloretail.com`, so your test calls are easy to find in the API log ("only tagged"). API logging has to be on for the website.
- **AI synonym matches** — Search products that only matched through AI synonym expansion (`suggestedResult`) get an *AI match* tag; the status bar counts them, and says so when every result is one (`suggestedProductStatus: ONLY_SUGGESTED`).
- **Ctrl+Enter** sends the request from anywhere.
- **Matrix mode** — the *Matrix* button in the top bar switches to a green-on-black look with digital rain behind the panels. Remembered across reloads.
- **Extra tile fields** — under **Tile mapping**, list extra product fields (dot paths work) to show on every tile, e.g. `inStock, brand`.
- **Real-time filtering** — filter products by any field, or a specific field.
- **Recommendations step grouping** — products are grouped by their `countAfterSource` waterfall step, each boxed with a colored header.
- **Tile mapping** — auto-detects the product array and maps the standard fields (`title`, `imgUrl`, `productNumber`, `price`, `oldPrice`, `url`); override under **Tile mapping** for non-standard responses.
- **Legacy parameters** — for Recoms (legacy) / Search (legacy), paste the Parameters JSON from the API log (or its query-string Body, or a full URL); the request URL is rebuilt from it as you type, and editing the URL writes back to the parameters.
- **Readable errors** — a failed request shows its error (status, code, message and the full error response) in place of the products. Legacy endpoints answer HTTP 200 with `{"error": ...}`, so those are caught from the body too.
