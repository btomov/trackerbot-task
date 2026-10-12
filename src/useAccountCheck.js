import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MARKETPLACES, isFresh } from '../public/marketplaces.js';
import { messageFor } from '../public/errors.js';
import { startAccountCheck, watchResults } from './accountCheck.js';

export function useAccountCheck() {
  const [code, setCode] = useState(null);
  const [results, setResults] = useState(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [refreshId, setRefreshId] = useState(0);
  const userSelected = useRef(false);
  const lastRefreshId = useRef(0);
  const watcher = useRef(null);
  const available = Boolean(globalThis.chrome?.runtime?.id && chrome.storage?.local);
  const loaded = results !== null;
  const fresh = isFresh(results?.[code], now);

  // Load the saved marketplace and every cached result together, then keep the results
  // current so neither opening the popup nor switching marketplaces waits on storage.
  useEffect(() => {
    if (!available) {
      setResults({});
      setCode('US');
      return;
    }
    let stopped = false;
    const cache = watchResults(update => {
      setResults(current => ({ ...current, ...update }));
      setNow(Date.now());
    });
    watcher.current = cache;
    const restore = async () => {
      let saved;
      try {
        const [preference] = await Promise.all([chrome.storage.local.get('marketplace'), cache.read()]);
        saved = preference.marketplace;
      } catch {
        setResults(current => current ?? {});
        setError(messageFor('storage-read'));
      }
      if (!stopped && !userSelected.current) setCode(Object.hasOwn(MARKETPLACES, saved) ? saved : 'US');
    };
    void restore();
    return () => {
      stopped = true;
      cache.stop();
    };
  }, [available]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // A layout effect settles "Checking…" before paint, so switching never flashes the idle
  // state. Freshness changes also recheck an expired or invalidated result;
  // the one-second clock must not restart a pending request on every tick.
  useLayoutEffect(() => {
    if (!code || !loaded || !available) return;
    const force = refreshId !== lastRefreshId.current;
    lastRefreshId.current = refreshId;
    return startAccountCheck(code, force, results[code], {
      read: watcher.current.read,
      onChecking: setChecking,
      onError: setError,
    });
  }, [code, refreshId, loaded, available, fresh]);

  function selectMarketplace(next) {
    if (!Object.hasOwn(MARKETPLACES, next)) return;
    userSelected.current = true;
    setCode(next);
    if (!available) return;
    void chrome.storage.local.set({ marketplace: next })
      .catch(() => setError(messageFor('preference-write')));
  }

  return {
    code, selectMarketplace, checking, error, now, available,
    loading: !code || !loaded,
    state: results?.[code] ?? null,
    refresh: () => setRefreshId(value => value + 1),
  };
}
