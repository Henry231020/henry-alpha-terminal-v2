'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AlertThrottle } = require('../lib/alert-throttle');

test('throttles repeated alerts for the same mint and signal', () => {
  const throttle = new AlertThrottle({ cooldownMs: 30000 });
  assert.equal(throttle.shouldAllow('mint:BUY SETUP', 100000), true);
  assert.equal(throttle.shouldAllow('mint:BUY SETUP', 120000), false);
  assert.equal(throttle.shouldAllow('mint:BUY SETUP', 131000), true);
});

test('a BUY alert does not suppress a SELL warning for the same mint', () => {
  const throttle = new AlertThrottle();
  assert.equal(throttle.shouldAllow('mint:BUY SETUP', 100000), true);
  assert.equal(throttle.shouldAllow('mint:SELL / EXIT WARNING', 100001), true);
});

test('rejects out-of-order timestamps and invalid keys', () => {
  const throttle = new AlertThrottle();
  assert.equal(throttle.shouldAllow('mint:SELL', 100000), true);
  assert.equal(throttle.shouldAllow('mint:SELL', 99000), false);
  assert.equal(throttle.shouldAllow('', 101000), false);
  assert.equal(throttle.shouldAllow('mint:SELL', NaN), false);
});

test('bounds retained alert keys', () => {
  const throttle = new AlertThrottle({ maxEntries: 2, retentionMs: 1000000 });
  throttle.shouldAllow('a', 1000);
  throttle.shouldAllow('b', 1000);
  throttle.shouldAllow('c', 1000);
  assert.equal(throttle.lastByKey.size, 2);
  assert.equal(throttle.lastByKey.has('a'), false);
});
