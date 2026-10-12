import { MARKETPLACES, cacheKey, isFresh } from '../public/marketplaces.js';
import { errorInfo, fail } from '../public/errors.js';

const CODES = Object.keys(MARKETPLACES);

async function requestCheck(code) {
  let response;
  try {
    response = await chrome.runtime.sendMessage({ target: 'background', type: 'check', code });
  } catch {
    fail('messaging');
  }
  if (response?.error) throw response.error;
  if (!response?.state) fail('messaging');
}

// Mirror every marketplace's cached result while the popup is open, so switching
// marketplaces renders immediately instead of waiting for a storage read.
export function watchResults(onResults) {
  let stopped = false;
  const versions = Object.fromEntries(CODES.map(code => [code, 0]));

  async function read() {
    const started = { ...versions };
    let cache;
    try { cache = await chrome.storage.local.get(CODES.map(cacheKey)); }
    catch { fail('storage-read'); }
    // A logout event received during the read takes priority over its old data.
    const unchanged = CODES.filter(code => versions[code] === started[code]);
    if (!stopped) onResults(Object.fromEntries(unchanged.map(code => [code, cache[cacheKey(code)] ?? null])));
  }

  function onChanged(changes, area) {
    if (stopped || area !== 'local') return;
    const changed = CODES.filter(code => changes[cacheKey(code)]);
    if (!changed.length) return;
    changed.forEach(code => versions[code]++);
    onResults(Object.fromEntries(changed.map(code => [code, changes[cacheKey(code)].newValue ?? null])));
  }

  chrome.storage.onChanged.addListener(onChanged);
  return {
    read,
    stop() {
      stopped = true;
      chrome.storage.onChanged.removeListener(onChanged);
    },
  };
}

// Ask the worker to check a marketplace whose cached result is missing or expired, or on demand.
export function startAccountCheck(code, force, cached, { read, onChecking, onError }) {
  let cancelled = false;
  const needed = force || !isFresh(cached);

  async function check() {
    try {
      await requestCheck(code);
      if (!cancelled) await read(); // Storage includes any logout after the reply.
    } catch (error) {
      if (!cancelled) onError(errorInfo(error).message);
    } finally {
      if (!cancelled) onChecking(false);
    }
  }

  onChecking(needed);
  onError('');
  if (needed) void check();

  return () => { cancelled = true; };
}
