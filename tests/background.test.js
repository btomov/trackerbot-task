import test from 'node:test';
import assert from 'node:assert/strict';

// Exercise the worker through its real message/cookie handlers. Amazon and Chrome
// are mocked; these tests verify lifecycle behavior, not real account extraction.
test('background checks deduplicate, clear failed results, and reject logout races', async () => {
  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;
  const data = {};
  const cookies = [{ name: 'at-main', domain: '.amazon.com', path: '/', value: 'session-one' }];
  let requestHandler, cookieHandler, alarmHandler;
  let mode = 'success';
  let fetchCount = 0;
  globalThis.chrome = {
    runtime: {
      id: 'test-extension', getURL: path => `chrome-extension://test-extension/${path}`,
      getContexts: async () => [{ contextType: 'OFFSCREEN_DOCUMENT' }],
      onMessage: { addListener: fn => { requestHandler = fn; } },
      sendMessage: async ({ html }) => ({ facts: JSON.parse(html) }),
    },
    offscreen: { createDocument: async () => {} },
    alarms: {
      get: async () => ({ name: 'account-refresh' }),
      create: async () => assert.fail('existing alarm should be reused'),
      onAlarm: { addListener: fn => { alarmHandler = fn; } },
    },
    cookies: { onChanged: { addListener: fn => { cookieHandler = fn; } } },
    storage: { local: {
      get: async () => ({ marketplace: data.marketplace }),
      set: async value => Object.assign(data, value),
    } },
  };
  globalThis.fetch = async (url, options) => {
    fetchCount++;
    assert.ok(url.includes('/ap/signin'));
    assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'include');
    assert.equal(options.cache, 'no-store');
    // Cookie events from the response arrive while the check is in flight.
    await new Promise(resolve => setImmediate(resolve));
    if (mode === 'rotate-session-token') {
      const token = cookies.find(cookie => cookie.name === 'session-token');
      cookieHandler({ cookie: token, removed: true, cause: 'overwrite' });
      token.value += '-rotated';
      cookieHandler({ cookie: token, removed: false, cause: 'explicit' });
    }
    if (mode === 'refresh') {
      const old = cookies[0];
      cookieHandler({ cookie: old, removed: true, cause: 'overwrite' });
      cookies[0] = { ...old, expirationDate: (old.expirationDate ?? 1000) + 1000 };
      cookieHandler({ cookie: cookies[0], removed: false, cause: 'explicit' });
      cookieHandler({ cookie: { ...old, name: 'session-id-time', value: String(Date.now()) }, removed: false, cause: 'explicit' });
    }
    if (mode === 'offline') throw new Error('offline');
    if (mode === 'http-error') {
      return { ok: false, status: 503, url, headers: new Headers(), text: async () => 'Service Unavailable' };
    }
    if (mode === 'logout') {
      mode = 'success';
      cookies[0] = { ...cookies[0], value: 'session-two' };
      cookieHandler({ cookie: cookies[0], removed: true });
    }
    const facts = { kind: 'account', email: 'active@example.com' };
    return { ok: true, status: 200, url, headers: new Headers(), text: async () => JSON.stringify(facts) };
  };
  try {
    await import('../public/background.js');
    const check = code => new Promise(resolve => {
      const keepOpen = requestHandler({ target: 'background', type: 'check', code }, { id: 'test-extension' }, resolve);
      assert.equal(keepOpen, true);
    });
    const [one, two] = await Promise.all([check('US'), check('US')]);
    assert.equal(fetchCount, 1, 'two popup requests share one check');
    assert.deepEqual(one, two);
    assert.equal(data['account:US'].email, 'active@example.com');

    mode = 'refresh';
    const refreshed = await check('US');
    assert.equal(refreshed.state.status, 'signed-in', 'expiry refresh is not a session change');
    assert.equal(data['account:US'].email, 'active@example.com');

    cookies.push({ name: 'session-token', domain: '.amazon.com', path: '/', value: 'rotating-token' });
    mode = 'rotate-session-token';
    const rotated = await check('US');
    assert.equal(rotated.state.status, 'signed-in', 'observed session-token rotation does not discard the check');
    cookieHandler({ cookie: cookies.pop(), removed: true, cause: 'expired' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(data['account:US'].email, null, 'actual session-token expiry still invalidates');

    // A replacement containing a DIFFERENT token still clears the cached email.
    cookieHandler({ cookie: cookies[0], removed: true, cause: 'overwrite' });
    cookies[0] = { ...cookies[0], value: 'different-account-token' };
    cookieHandler({ cookie: cookies[0], removed: false, cause: 'explicit' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(data['account:US'].email, null);
    assert.equal(data['account:US'].checkedAt, null);

    mode = 'offline';
    await check('US');
    assert.equal(data['account:US'].status, 'error');
    assert.equal(data['account:US'].email, null, 'failure replaces the previous email');

    // The body is not JSON, so reaching the parser would report parser-unavailable instead.
    mode = 'http-error';
    await check('US');
    assert.equal(data['account:US'].error.code, 'http', 'non-OK responses fail before parsing');
    assert.match(data['account:US'].error.message, /HTTP 503/);

    mode = 'logout';
    const race = await check('US');
    assert.equal(race.state.status, 'session-changed');
    assert.equal(race.state.email, null);
    assert.equal(data['account:US'].email, null);
    assert.equal(data['account:US'].checkedAt, null, 'old fetch cannot overwrite cookie invalidation');

    let invalid;
    requestHandler({ target: 'background', type: 'check', code: '__proto__' }, { id: 'test-extension' }, r => { invalid = r; });
    assert.equal(invalid.error.code, 'bad-request');

    const beforeAlarm = fetchCount;
    await alarmHandler({ name: 'unrelated' });
    assert.equal(fetchCount, beforeAlarm, 'unrelated alarms do not check Amazon');

    data.marketplace = 'DE';
    await alarmHandler({ name: 'account-refresh' });
    assert.equal(data['account:DE'].email, 'active@example.com', 'closed-popup refresh uses the saved marketplace');
    assert.equal(fetchCount, beforeAlarm + 1);

    data.marketplace = '__proto__';
    await alarmHandler({ name: 'account-refresh' });
    assert.equal(data['account:US'].status, 'signed-in', 'invalid preferences safely default to US');

    data.marketplace = 'US';
    const beforeShared = fetchCount;
    await Promise.all([alarmHandler({ name: 'account-refresh' }), check('US')]);
    assert.equal(fetchCount, beforeShared + 1, 'alarm and popup share a pending check');

    mode = 'logout';
    await alarmHandler({ name: 'account-refresh' });
    assert.equal(data['account:US'].status, 'session-changed', 'alarm refresh cannot restore an email after logout');
    assert.equal(data['account:US'].email, null);
    assert.equal(data['account:US'].checkedAt, null);

    mode = 'offline';
    await alarmHandler({ name: 'account-refresh' });
    assert.equal(data['account:US'].status, 'error');
    mode = 'success';
    await alarmHandler({ name: 'account-refresh' });
    assert.equal(data['account:US'].status, 'signed-in', 'next alarm retries a failed refresh');
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
  }
});

test('worker startup recreates a missing refresh alarm without resetting an existing one', async () => {
  const originalChrome = globalThis.chrome;
  let alarm;
  let creations = 0;
  globalThis.chrome = {
    runtime: { onMessage: { addListener: () => {} } },
    cookies: { onChanged: { addListener: () => {} } },
    alarms: {
      get: async name => {
        assert.equal(name, 'account-refresh');
        return alarm;
      },
      create: async (name, options) => {
        creations++;
        assert.equal(name, 'account-refresh');
        assert.equal(options.periodInMinutes, 1);
        alarm = { name, ...options };
      },
      onAlarm: { addListener: () => {} },
    },
  };
  try {
    await import('../public/background.js?startup-one');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(creations, 1, 'missing alarm is created on startup');
    await import('../public/background.js?startup-two');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(creations, 1, 'worker restart preserves the existing schedule');
    alarm = undefined;
    await import('../public/background.js?startup-three');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(creations, 2, 'alarm lost across browser restart is recreated');
  } finally {
    globalThis.chrome = originalChrome;
  }
});
