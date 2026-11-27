# Hello Retail API Tester

Tool to fire requests at the Hello Retail **Recommendations**, **Search**, and **Pages** APIs and render the returned products as visual tiles.

**Hosted:** https://xxxhrpatrickxxx.github.io/hr-api-tester/ — always available, nothing to install. Every push to `main` is linted, tested and auto-deployed via GitHub Actions; pull requests get the same lint / test / build check first.

## How it works

- **client/** — Vite + React UI. Pick an API preset (or Custom), choose a method, edit the JSON body, hit **Send**. Results show as product tiles plus raw JSON / response headers.
  - `src/App.jsx` holds the app state and the request panel; `src/components/` the UI pieces (results panel, tiles, JSON tree, history panel, tile mapping, theme / Matrix toggles, …).
  - `src/lib/` is the plain logic, with no React: presets and endpoint URLs, reading products out of each API's response shape, legacy query strings, sending a request, paging and log-tag rewriting, JSON tree search, history search / export / import, guarded localStorage access, and the IndexedDB store. Its `*.test.js` files are the tests.
  - `src/hooks/` holds React hooks: requests in flight per solution, reading a response, the resizable column, media queries, and `useStoredState` (state kept in localStorage).
- The browser calls `core.helloretail.com` **directly** (the HR serve endpoints allow cross-origin requests), so the app is fully static and needs no server. Base URLs are baked into the client; the API key and `websiteUuid` are entered per request.

## Run locally

Needs Node.js 22.12 or newer.

```sh
npm install
npm run dev      # Vite dev server with hot reload, at http://localhost:5173
```

Or build it and serve the built app (or use `start-hr-api-tester.cmd`):

```sh
npm run serve    # build, then serve at http://localhost:8787
```

Lint and test (Vitest, no browser needed) — CI runs both:

```sh
npm run lint
npm test
```

## Credentials

The API key and `websiteUuid` vary per request, so they are **not** built into the app — enter them directly in the request (headers / JSON body) in the UI. Nothing sensitive is in the deployed site, and there is no `.env` to configure: the endpoint URLs are constants in the client.

They **are** kept in your browser, though: every sent request goes into the history with its full headers and body, saved in IndexedDB for that site address until you delete it (the history's *×* / *clear all*, or clearing site data). Use a private window if that's not wanted.

**Export history** redacts the values of credential-looking request headers (`Authorization`, anything with `key`, `token`, `secret`, `auth`, `cookie`, `session` or `passw` in its name) so an export can be shared. Request bodies are exported as they are, so a key put in the body (e.g. legacy Search's `key`) stays in the file.

## Features

- **Per-solution sessions & history** — each API keeps its own request form, page key, and a history of up to 100 past requests/responses (persisted in IndexedDB). Lock entries to protect them from "clear all", add a note to label them (✎ edits it in place: Enter saves, Esc cancels), search the list, and step through it with ↑/↓.
- **Export / import history** — saved history belongs to the site address (the hosted app, `:5173` and `:8787` each have their own), so export it as JSON to back it up or move it between them. Credential headers are redacted in the file (see [Credentials](#credentials)). Importing merges, skipping entries already there.
- **Paging** — Search, Pages and Search (legacy) results get prev / next buttons that move the request's offset (`products.start` / `product_start`) and resend it.
- **API log tag** — an optional tag added as `?apiLogTag=…` to every request to `core.helloretail.com`, so your test calls are easy to find in the API log ("only tagged"). API logging has to be on for the website.
- **AI synonym matches** — Search products that only matched through AI synonym expansion (`suggestedResult`) get an *AI match* tag; the status bar counts them, and says so when every result is one (`suggestedProductStatus: ONLY_SUGGESTED`).
- **JSON tree** — the *json* and *headers* views are collapsible trees, opened at the products array (`products.results`, `products.result`, or each box's `products`) so the products show straight away. Search keys and values (matches highlighted, "matches only" hides the rest), expand / collapse all — for the whole response, or per node from the row's *expand all* / *collapse all* (or Alt+click its arrow) — and copy any node's path (in the `products.results[0].title` form *Tile mapping* reads). Large arrays render 100 items at a time. *raw* shows the formatted text.
- **Ctrl+Enter** sends the request from anywhere.
- **Matrix mode** — the *Matrix* button in the top bar switches to a green-on-black look with digital rain behind the panels. Remembered across reloads.
- **Extra tile fields** — under **Tile mapping**, list extra product fields (dot paths work) to show on every tile, e.g. `inStock, brand`.
- **Real-time filtering** — filter products by any field, or a specific field.
- **Recommendations step grouping** — products are grouped by their `countAfterSource` waterfall step, each boxed with a colored header.
- **Tile mapping** — auto-detects the product array and maps the standard fields (`title`, `imgUrl`, `productNumber`, `price`, `oldPrice`, `url`); override under **Tile mapping** for non-standard responses.
- **Legacy parameters** — for Recoms (legacy) / Search (legacy), paste the Parameters JSON from the API log (or its query-string Body, or a full URL); the request URL is rebuilt from it as you type, and editing the URL writes back to the parameters.
- **Readable errors** — a failed request shows its error (status, code, message and the full error response) in place of the products. Legacy endpoints answer HTTP 200 with `{"error": ...}`, so those are caught from the body too.
