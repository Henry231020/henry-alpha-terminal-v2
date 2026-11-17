'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRateLimiter } = require('../lib/rate-limit');

test('rate limiter permits configured calls then blocks until window expires', () => {
  let now = 1000;
  const allow = createRateLimiter({ limit: 2, windowMs: 10000, clock: () => now });
  assert.equal(allow().allowed, true);
  assert.equal(allow().remaining, 0);
  const blocked = allow();
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 10);
  now += 10000;
  assert.equal(allow().allowed, true);
});

test('rate limiter resets safely if clock moves backwards', () => {
  let now = 5000;
  const allow = createRateLimiter({ limit: 1, windowMs: 10000, clock: () => now });
  assert.equal(allow().allowed, true);
  assert.equal(allow().allowed, false);
  now = 4000;
  assert.equal(allow().allowed, true);
});
