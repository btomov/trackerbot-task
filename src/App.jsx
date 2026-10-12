import { MARKETPLACES, isFresh } from '../public/marketplaces.js';
import { messageFor } from '../public/errors.js';
import { useAccountCheck } from './useAccountCheck.js';

const STATUS = {
  'signed-in': ['Logged in', ''],
  'signed-out': ['Not logged in', ''],
  error: ['Couldn’t check', messageFor('check-failed')],
  'session-changed': ['Check needed', ''],
};

function ageLabel(checkedAt, now) {
  const seconds = Math.max(0, Math.floor((now - checkedAt) / 1000));
  if (seconds < 10) return 'Checked just now';
  if (seconds < 60) return `Checked ${seconds}s ago`;
  if (seconds < 3600) return `Checked ${Math.floor(seconds / 60)}m ago`;
  return `Checked ${Math.floor(seconds / 3600)}h ago`;
}

export function App() {
  const { code, selectMarketplace, state, loading, checking, error, now, available, refresh } = useAccountCheck();
  const fresh = isFresh(state, now);
  const stale = Boolean(state && !fresh);
  const staleIdentity = stale && Boolean(state.email);
  const [title, description] = state
    ? STATUS[state.status] ?? STATUS.error
    : ['No result yet', 'Check the selected marketplace for an active account.'];
  const initialCheck = checking && !state?.checkedAt;
  const detail = staleIdentity ? 'Check again for the latest account.' : state?.error?.message ?? description;

  return (
    <main>
      <header>
        <span className="brand-mark" aria-hidden="true">a<span>↗</span></span>
        <div><p className="eyebrow">ACCOUNT CHECK</p><h1>Amazon Account Detector</h1></div>
      </header>
      <label htmlFor="marketplace">Marketplace</label>
      <select id="marketplace" value={code ?? 'US'} onChange={event => selectMarketplace(event.target.value)}>
        {Object.entries(MARKETPLACES).map(([key, marketplace]) => (
          <option key={key} value={key}>{marketplace.label} · {marketplace.domain}</option>
        ))}
      </select>
      <section className="result" aria-live="polite" aria-atomic="true">
        {!loading && <>
          {checking && state?.checkedAt && <p className="result-label">Checking…</p>}
          <h2>{initialCheck ? 'Checking…' : staleIdentity ? 'Result expired' : title}</h2>
          {fresh && state?.email && !error && <p className="email">{state.email}</p>}
          {!initialCheck && detail && <p className="description">{detail}</p>}
          {state?.checkedAt && <p className="freshness">{ageLabel(state.checkedAt, now)}{stale ? ' · expired' : ''}</p>}
        </>}
      </section>
      {!available && <p className="notice" role="status">Browser preview only. Load the dist folder in Chrome to check your account.</p>}
      {error && <p className="notice" role="alert">{error}</p>}
      <button disabled={checking || loading || !available} onClick={refresh}>
        {checking ? 'Checking marketplace…' : 'Check again'}<span aria-hidden="true">↻</span>
      </button>
    </main>
  );
}
