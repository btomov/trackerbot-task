import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKETPLACES, switchUrl, isFresh, TTL_MS, isSessionCookie } from '../public/marketplaces.js';
import { resolveAccount } from '../public/parser.js';

for (const code of Object.keys(MARKETPLACES)) {
  test(`${code}: switch URL stays on its marketplace and has the required parameters`, () => {
    const url = new URL(switchUrl(code));
    assert.equal(url.hostname, `www.${MARKETPLACES[code].domain}`);
    assert.equal(url.pathname, '/ap/signin');
    assert.equal(url.searchParams.get('openid.assoc_handle'), MARKETPLACES[code].handle);
    assert.equal(url.searchParams.get('openid.pape.max_auth_age'), '0');
    assert.equal(url.searchParams.get('ignoreAuthState'), '1');
    assert.equal(url.searchParams.get('openid.return_to'), `https://www.${MARKETPLACES[code].domain}/?&ref_=nav_youraccount_switchacct`);
    assert.equal(url.searchParams.has('switch_account'), false);
  });
}
test('TTL expires at the boundary and a cleared timestamp is stale', () => {
  const now = 1_000_000;
  assert.equal(isFresh({ checkedAt: now - TTL_MS + 1 }, now), true);
  assert.equal(isFresh({ checkedAt: now - TTL_MS }, now), false);
  assert.equal(isFresh({ checkedAt: null }, now), false);
  assert.equal(isFresh({ checkedAt: now + 1 }, now), false);
});
test('a sign-in form email identifies the logged-in account', () => {
  assert.deepEqual(resolveAccount({ kind: 'account', email: 'active@example.com' }),
    { status: 'signed-in', email: 'active@example.com' });
});
test('an empty email-entry form means logged out', () => {
  assert.deepEqual(resolveAccount({ kind: 'signin', email: null }),
    { status: 'signed-out', email: null });
});
test('blocked or unrecognized pages are not interpreted as logged out', () => {
  assert.deepEqual(resolveAccount({ kind: 'unavailable', email: null }),
    { status: 'error', email: null });
});
test('session cookie filter covers authentication but ignores preferences', () => {
  for (const name of ['at-main', 'sess-at-acbde', 'x-main', 'session-id', 'session-token']) assert.ok(isSessionCookie(name));
  for (const name of ['i18n-prefs', 'lc-main', 'sp-cdn', 'ubid-main', 'session-id-time']) assert.equal(isSessionCookie(name), false);
});
