import { MARKETPLACES, TTL_MS, cacheKey, switchUrl, isSessionCookie } from './marketplaces.js';
import { resolveAccount } from './parser.js';
import { fail, errorInfo } from './errors.js';

// Share one active check per marketplace across popup requests.
const inFlight = new Map();
// Increment on invalidation so older checks cannot restore the cached email.
const revisions = new Map(Object.keys(MARKETPLACES).map(code => [code, 0]));
// Keep cache writes in order, including logout invalidation.
const writes = new Map();
// Pair Chrome's cookie removal/insertion events to recognize expiry-only updates.
const overwrittenCookies = new Map();
const cookieKey = (cookie) => JSON.stringify([
  cookie.storeId, cookie.domain, cookie.path, cookie.name, cookie.partitionKey ?? null,
]);
let creatingOffscreen;
const REFRESH_ALARM = 'account-refresh';

// Alarms wake the worker even when the popup is closed. Restore a missing alarm
// on worker startup because Chrome may clear alarms across browser restarts.
async function ensureRefreshAlarm() {
  if (!await chrome.alarms.get(REFRESH_ALARM)) {
    await chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: TTL_MS / 60_000 });
  }
}

void ensureRefreshAlarm().catch(() => {
  console.error('[Amazon Account Detector]', { stage: 'refresh-schedule', code: 'alarm' });
});

chrome.alarms.onAlarm.addListener(async ({ name }) => {
  if (name !== REFRESH_ALARM) return;
  let code;
  try {
    const { marketplace } = await chrome.storage.local.get('marketplace');
    code = Object.hasOwn(MARKETPLACES, marketplace) ? marketplace : 'US';
    await check(code);
  } catch (error) {
    console.error('[Amazon Account Detector]', {
      marketplace: code, stage: 'background-refresh', code: errorInfo(error, 'storage-read').code,
    });
  }
});

// One shared offscreen document, even if two marketplaces are checked together.
async function ensureParser() {
  if (creatingOffscreen) return creatingOffscreen;
  creatingOffscreen = (async () => {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL('offscreen.html')],
    });
    if (!contexts.length) await chrome.offscreen.createDocument({
      url: 'offscreen.html', reasons: ['DOM_PARSER'],
      justification: 'Parse Amazon response HTML without accessing browser tabs.',
    });
  })();
  try { await creatingOffscreen; } finally { creatingOffscreen = null; }
}

async function fetchFacts(url) {
  let response, html;
  try {
    response = await fetch(url, {
      method: 'GET', credentials: 'include', cache: 'no-store',
      redirect: 'follow', signal: AbortSignal.timeout(12_000),
    });
    html = await response.text();
  } catch (error) {
    fail(['TimeoutError', 'AbortError'].includes(error.name) ? 'timeout' : 'network');
  }
  if (new URL(response.url).origin !== new URL(url).origin) fail('unexpected-origin');
  if (response.headers.get('x-amzn-waf-action')) return { kind: 'unavailable' };
  if (!response.ok) fail('http', response.status);
  if (html.length > 3_000_000) fail('response-too-large');
  let parsed;
  try {
    await ensureParser();
    parsed = await chrome.runtime.sendMessage({ target: 'offscreen', html });
  } catch {
    fail('parser-unavailable');
  }
  if (parsed?.error) fail('parse-failed');
  if (!parsed?.facts) fail('parser-unavailable');
  return parsed.facts;
}

// Serialize storage writes so a logout cannot be overwritten by an older fetch.
function writeState(code, state, revision) {
  const previous = writes.get(code) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    if (revision !== revisions.get(code)) return;
    await chrome.storage.local.set({ [cacheKey(code)]: state });
  });
  writes.set(code, next);
  return next;
}

// The popup decides whether its cached result is fresh enough; this always asks Amazon.
function check(code) {
  if (inFlight.has(code)) return inFlight.get(code);
  const revision = revisions.get(code);
  const task = (async () => {
    let state;
    try {
      state = resolveAccount(await fetchFacts(switchUrl(code)));
    } catch (error) {
      const details = errorInfo(error);
      console.warn('[Amazon Account Detector]', { marketplace: code, stage: 'signin', code: details.code });
      state = { status: 'error', email: null, error: details };
    }
    state.checkedAt = Date.now();
    try { await writeState(code, state, revision); } catch { fail('storage-write'); }
    if (revision !== revisions.get(code)) state = { status: 'session-changed', email: null, checkedAt: Date.now() };
    return state;
  })().finally(() => inFlight.delete(code));
  inFlight.set(code, task);
  return task;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message.target !== 'background') return;
  if (message.type !== 'check' || !Object.hasOwn(MARKETPLACES, message.code)) {
    respond({ error: errorInfo(null, 'bad-request') });
    return;
  }
  check(message.code).then(state => respond({ state }), error => respond({ error: errorInfo(error) }));
  return true; // Keep the response channel open while the service worker fetches.
});

chrome.cookies.onChanged.addListener(({ cookie, removed, cause }) => {
  if (!isSessionCookie(cookie.name)) return;
  const domain = cookie.domain.replace(/^\./, '');
  const code = Object.keys(MARKETPLACES).find(code =>
    domain === MARKETPLACES[code].domain || domain.endsWith(`.${MARKETPLACES[code].domain}`));
  if (!code) return;
  const key = cookieKey(cookie);
  // Chrome emits removal (overwrite) then insertion (explicit) even when only
  // expiry changes. Compare the pair's VALUES instead of treating it as logout.
  // Ignore nonempty session-token rotation only during our own active check.
  // Outside a check, a replacement may mean logout or account switching.
  if (cookie.name === 'session-token' && inFlight.has(code) && cookie.value && (!removed || cause === 'overwrite')) {
    return;
  }
  if (removed && cause === 'overwrite') {
    overwrittenCookies.set(key, cookie.value);
    return;
  }
  const previousValue = overwrittenCookies.get(key);
  const wasOverwrite = overwrittenCookies.has(key);
  overwrittenCookies.delete(key);
  // First visiting an inactive marketplace creates anonymous session cookies.
  // Creating session-id is not a login/logout and must not cancel the check.
  if (cookie.name === 'session-id' && !removed && !wasOverwrite) return;
  if (!removed && wasOverwrite && previousValue === cookie.value) return;
  const revision = revisions.get(code) + 1;
  revisions.set(code, revision);
  void writeState(code, { status: 'session-changed', email: null, checkedAt: null }, revision).catch(() => {
    console.error('[Amazon Account Detector]', { marketplace: code, stage: 'cache-invalidation', code: 'storage-write' });
  });
});
