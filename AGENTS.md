# AGENTS.md

Guidance for AI coding agents working in this repository. Human-facing docs are in
[README.md](README.md).

## Project

Chrome Manifest V3 extension that detects which Amazon account is logged in on a
chosen marketplace (US, UK, DE, IT, FR) without touching the user's tabs. A React
popup shows the cached result; a service worker fetches the marketplace's sign-in
page with the profile's cookies and an offscreen document parses the HTML.

## Setup and commands

Requires Node 22.12+ or 20.19+ (Vite 7).

```sh
npm ci           # install
npm test         # node:test regression suite (tests/*.test.js)
npm run build    # build the unpacked extension into dist/
npm run dev      # popup preview in a browser tab; no Chrome APIs, so no checks
```

Run `npm test` and `npm run build` before finishing any change. To try it in Chrome:
`chrome://extensions` → Developer mode → **Load unpacked** → `dist/`; click
**Reload** on the extension card after each rebuild.

## Layout

| Path | Role |
|---|---|
| `public/` | Extension files Chrome loads as-is: `manifest.json`, `background.js` (service worker), `offscreen.*`, `parser.js`, and modules shared with the popup (`marketplaces.js`, `errors.js`) |
| `src/` | React popup, bundled by Vite: `App.jsx` (view), `useAccountCheck.js` (state and lifecycle), `accountCheck.js` (cache mirror and check requests) |
| `tests/` | `background.test.js` (worker lifecycle), `core.test.js` (URLs, TTL, result mapping), `popup.test.js` (popup cache logic) |
| `dist/` | Build output; gitignored. Never edit it by hand |

## Rules that are easy to break

- **`public/` is not bundled.** It is copied verbatim into `dist/` by the plugin in
  `vite.config.js` (Vite's `publicDir` is off so `src/` can import shared modules
  from `../public/`). Code there must be plain browser ESM: relative imports with
  `.js` extensions, no npm packages, no JSX.
- **The build is intentionally unminified** so reviewers can read `dist/`.
- **DOM parsing only happens offscreen.** MV3 service workers have no `DOMParser`;
  `inspectHtml` runs in the offscreen document. `resolveAccount` stays pure so it
  can be tested in Node.
- **No disruption, no side effects on Amazon.** Requests are `GET` with
  `credentials: 'include'`. Never open, navigate or script tabs, add content
  scripts, submit forms, switch accounts, run Amazon's scripts or insert remote
  HTML into the popup.
- **Privacy.** Never log or display cookies, HTML or account emails outside the
  popup result. Console output is limited to marketplace, stage and error code.
  User-facing errors come from the fixed `MESSAGES` in `public/errors.js`; add a
  code there instead of writing inline error strings.
- **Cache contract.** `chrome.storage.local` key `account:<CODE>` holds
  `{ status, email, checkedAt, error? }`, where `status` is `signed-in`,
  `signed-out`, `error` or `session-changed`. The TTL is 60 s (`TTL_MS` in
  `public/marketplaces.js`). The popup decides freshness; the worker always asks
  Amazon and shares a check already in flight.
- **Logout races.** Cookie changes bump a per-marketplace revision and write
  `session-changed` with `checkedAt: null`; writes are serialized so an older check
  can never restore an email. Keep `tests/background.test.js` passing and add a
  test for any new path through `check()` or the cookie listener.
- **No flicker.** The popup mirrors every marketplace's cached result
  (`watchResults`) and decides "Checking…" in a layout effect. Don't reintroduce
  an empty or loading state when switching marketplaces.
- **Permissions are minimal**: `storage`, `offscreen`, `cookies`, `alarms` and the five
  Amazon hosts. Don't add any without a clear need, and update the README's
  permissions paragraph if you do.

## Common changes

- **Add a marketplace:** add an entry (label, domain, `openid.assoc_handle`) to
  `MARKETPLACES` in `public/marketplaces.js`, add its host to `host_permissions` in
  `public/manifest.json`, and update the README. URL tests iterate `MARKETPLACES`
  automatically.
- **Release:** keep `version` in `package.json` and `public/manifest.json` in sync.

## Testing notes

- Tests use Node's built-in runner and mock Chrome via `globalThis.chrome`.
- Node has no DOM, so `inspectHtml` (`public/parser.js`) has no unit tests.
  Check parser changes manually in Chrome against a real sign-in page.

## Style

- Plain JavaScript ES modules, no TypeScript, no linter config. Follow the
  existing code: 2-space indent, single quotes, semicolons, small modules.
- Comments explain *why*, briefly, and only where the reason isn't obvious.
- Dependencies are only `react`, `react-dom` and `vite`. Don't add more without
  a strong reason.
- Syncing with a server is out of scope.
