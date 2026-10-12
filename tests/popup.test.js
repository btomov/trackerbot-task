import test from 'node:test';
import assert from 'node:assert/strict';
import { startAccountCheck, watchResults } from '../src/accountCheck.js';

const settle = () => new Promise(resolve => setImmediate(resolve));

test('the popup mirror keeps a logout that arrives during its storage read', async () => {
  let changed, finishRead;
  globalThis.chrome = { storage: {
    local: { get: () => new Promise(resolve => { finishRead = resolve; }) },
    onChanged: { addListener: fn => { changed = fn; }, removeListener: () => {} },
  } };
  const results = {};
  const cache = watchResults(update => Object.assign(results, update));
  const reading = cache.read();
  changed({ 'account:UK': { newValue: { status: 'session-changed', email: null, checkedAt: null } } }, 'local');
  finishRead({
    'account:US': { status: 'signed-in', email: 'us@example.com', checkedAt: 1 },
    'account:UK': { status: 'signed-in', email: 'old@example.com', checkedAt: 1 },
  });
  await reading;
  assert.equal(results.US.email, 'us@example.com');
  assert.equal(results.UK.status, 'session-changed', 'older read data does not restore the email');
  assert.equal(results.DE, null);
  cache.stop();
});

test('switching to a fresh cached result neither checks nor shows checking', () => {
  let messages = 0;
  globalThis.chrome = { runtime: { sendMessage: async () => { messages++; } } };
  const checking = [];
  startAccountCheck('US', false, { checkedAt: Date.now() }, {
    read: async () => {}, onChecking: value => checking.push(value), onError: () => {},
  });
  assert.deepEqual(checking, [false]);
  assert.equal(messages, 0);
});

test('a missing result shows checking until the worker replies, then rereads storage', async () => {
  let reply;
  globalThis.chrome = { runtime: { sendMessage: () => new Promise(resolve => { reply = resolve; }) } };
  const checking = [];
  let reads = 0;
  startAccountCheck('US', false, null, {
    read: async () => { reads++; }, onChecking: value => checking.push(value), onError: () => {},
  });
  assert.deepEqual(checking, [true], 'checking is set synchronously, before the first paint');
  reply({ state: { status: 'signed-in' } });
  await settle();
  assert.deepEqual(checking, [true, false]);
  assert.equal(reads, 1);
});
