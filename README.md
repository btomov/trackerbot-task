# Amazon Account Detector

Chrome MV3 extension with a React popup. Checks Amazon US, UK, DE, IT and FR using
cookies from the Chrome profile where it is installed. No Amazon tab needs to be
open. Everything stays local; the extension never navigates or scripts your tabs.

## Build and load

Requires Node 22.12+ or 20.19+.

```sh
npm ci
npm run build
```

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**,
and select **dist**. Open the extension, select a marketplace and click **Check again**.
After rebuilding, click **Reload** on the extension card.

`npm run dev` previews the popup without account checks. `npm test` runs the
regression tests with Node's built-in test runner.

## Code and decisions

| File | Purpose |
|---|---|
| `src/App.jsx` | Popup layout and status display |
| `src/useAccountCheck.js` | Selection, cache updates and refresh lifecycle |
| `src/accountCheck.js` | Cache subscription and background check workflow |
| `public/errors.js` | Safe, specific failure messages |
| `src/popup.css` | Popup styling |
| `public/background.js` | Fetching, cache writes and cookie invalidation |
| `public/parser.js` | Email extraction and session classification |
| `public/offscreen.js` / `.html` | Hidden DOMParser document |
| `public/marketplaces.js` | Domains, sign-in URL parameters and 60-second TTL |
| `public/manifest.json` | Chrome entry points and permissions |
| `vite.config.js` | Bundle React and copy extension files into `dist` |

React handles the popup. Vite compiles JSX and bundles React locally. The worker
and parser are plain JavaScript; no other libraries or extension framework are
needed. Read `src` and `public` for authored code; the build is also unminified.

Each check fetches the marketplace's reference sign-in URL with
`credentials: 'include'` and extracts one distinct email from its sign-in form.
A complete email means **Logged in**; an empty email-entry form means **Not logged
in**. Dedicated email fields take priority; masked/ambiguous addresses are
rejected. CAPTCHA, reauthentication without identity, unexpected HTML and network
failures all show **Couldn’t check**.

HTML is parsed offscreen because MV3 service workers have no DOMParser. Amazon
scripts are never executed and remote HTML is never inserted into the popup.
Requests only use GET; they never submit forms or select/switch accounts. Amazon
may still update cookies in its responses.

`chrome.storage.local` caches `{ status, email, checkedAt }` per marketplace.
Opening the popup or changing marketplace reuses a result checked within the last
60 seconds, with no Amazon request. Missing, expired or invalidated results refresh
automatically. **Check again** always bypasses the cache. While the popup is open,
the selected marketplace refreshes when its result expires. After 60 seconds the
email is hidden until refreshed. The popup loads every marketplace's cached result
when it opens and keeps them current, so switching marketplaces renders at once.
Authentication cookie changes invalidate the cache. Routine expiry updates and
`session-token` rotation during our active checks are ignored. Token changes
outside a check and actual removals invalidate the cache. Creating an anonymous
`session-id` does not interrupt an inactive-marketplace check.
Request deduplication and ordered writes prevent a pending check from restoring
an email after logout. Server-side expiry without a cookie event is detected on
the next check. A Chrome alarm also checks the saved marketplace (US by default)
every minute while the popup is closed. Chrome may delay alarms, including while
the device sleeps; expired emails remain hidden until a fresh result arrives.
Alarm and popup requests share any check already in flight.

Permissions: `storage` for the cache, `offscreen` for DOM parsing, `cookies` for
logout detection, `alarms` for automatic background refresh, and the five Amazon
hosts for background requests. No OAuth,
server, sync, tab permissions or content scripts.

Failures show specific messages (network, timeout, HTTP, parser or storage). The
service-worker console logs only the marketplace, stage and error category, never
cookies, account emails or HTML.
