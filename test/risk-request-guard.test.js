'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { RiskRequestGuard } = require('../lib/risk-request-guard');

const mintA = 'So11111111111111111111111111111111111111112';
const mintB = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

test('rejects malformed mint addresses before provider calls', () => {
  const guard = new RiskRequestGuard();
  assert.equal(guard.begin('not-a-mint').status, 400);
});

test('prevents duplicate concurrent risk requests for the same mint', () => {
  const guard = new RiskRequestGuard();
  const first = guard.begin(mintA);
  assert.equal(first.ok, true);
  assert.equal(guard.begin(mintA).status, 429);
  first.release();
});

test('limits concurrent risk requests across tokens', () => {
  const guard = new RiskRequestGuard({ maxConcurrent: 1 });
  const first = guard.begin(mintA);
  assert.equal(guard.begin(mintB).status, 429);
  first.release();
  assert.equal(guard.begin(mintB).ok, true);
});

test('applies per-mint cooldown and permits a retry after expiry', () => {
  let now = 1000;
  const guard = new RiskRequestGuard({ cooldownMs: 30000, clock: () => now });
  const first = guard.begin(mintA);
  first.release();
  const blocked = guard.begin(mintA);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.retryAfterMs, 30000);
  now += 30000;
  assert.equal(guard.begin(mintA).ok, true);
});
