export const MARKETPLACES = {
  US: { label: 'United States', domain: 'amazon.com', handle: 'usflex' },
  UK: { label: 'United Kingdom', domain: 'amazon.co.uk', handle: 'gbflex' },
  DE: { label: 'Germany', domain: 'amazon.de', handle: 'deflex' },
  IT: { label: 'Italy', domain: 'amazon.it', handle: 'itflex' },
  FR: { label: 'France', domain: 'amazon.fr', handle: 'frflex' },
};
export const TTL_MS = 60_000;
export const cacheKey = (code) => `account:${code}`;
export const isFresh = (state, now = Date.now()) => Boolean(
  state?.checkedAt && now >= state.checkedAt && now - state.checkedAt < TTL_MS,
);
const originFor =(code) => `https://www.${MARKETPLACES[code].domain}`;

export function switchUrl(code) {
  const url = new URL('/ap/signin', originFor(code));
  url.search = new URLSearchParams({
    'openid.pape.max_auth_age': '0',
    'openid.return_to': `${originFor(code)}/?&ref_=nav_youraccount_switchacct`,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.assoc_handle': MARKETPLACES[code].handle,
    'openid.mode': 'checkid_setup',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    ignoreAuthState: '1',
    _encoding: 'UTF8',
  });
  return url.href;
}

// Track session/authentication values. session-id-time only records a refreshed
// timestamp and does not establish which account is authenticated.
export const isSessionCookie = (name) => /^(?:session-id|session-token|at-.+|sess-at-.+|x-.+)$/.test(name);
