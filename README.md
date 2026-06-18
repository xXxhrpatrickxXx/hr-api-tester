# Hello Retail API Tester

Tool to fire requests at the Hello Retail **Recommendations**, **Search**, and **Pages** APIs and render the returned products as visual tiles.

**Hosted:** https://xxxhrpatrickxxx.github.io/hr-api-tester/ — always available, nothing to install. Every push to `main` auto-deploys via GitHub Actions.

## How it works

- **client/** — Vite + React UI. Pick an API preset (or Custom), choose a method, edit the JSON body, hit **Send**. Results show as product tiles plus raw JSON / response headers.
- The browser calls `core.helloretail.com` **directly** (the HR serve endpoints allow cross-origin requests), so the app is fully static and needs no server. Base URLs are baked into the client; the API key and `websiteUuid` are entered per request.
- **server/** — an optional Express server (`:8787`) for running the whole thing locally as one process. It serves the built client and includes a `/api/proxy` forwarder, but the deployed site does not use it.

## Run locally

```sh
npm install
npm run dev      # Vite dev server with hot reload
```

Or run the built app from the single Node server (or use `start-hr-api-tester.cmd`):

```sh
npm run serve    # build, then serve at http://localhost:8787
```

## Credentials

The API key and `websiteUuid` vary per request, so they are **not** stored anywhere — enter them directly in the request (headers / JSON body) in the UI. Nothing sensitive is built into the deployed site.

## Features

- **Per-solution sessions & history** — each API keeps its own request form, page key, and a history of past requests/responses (persisted in `localStorage`). Lock entries to protect them from "clear all".
- **Real-time filtering** — filter products by any field, or a specific field.
- **Recommendations step grouping** — products are grouped by their `countAfterSource` waterfall step, each boxed with a colored header.
- **Tile mapping** — auto-detects the product array and maps the standard fields (`title`, `imgUrl`, `productNumber`, `price`, `oldPrice`, `url`); override under **Tile mapping** for non-standard responses.
