'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS, readConfig, evaluateBuy, evaluateExit } = require('../lib/auto-risk');

test('live trading is disabled unless both mode and explicit flag are set', () => {
  assert.equal(readConfig({}).enabled, false);
  assert.equal(readConfig({ TRADING_MODE: 'live' }).enabled, false);
  assert.equal(readConfig({ TRADING_MODE: 'live', AUTO_TRADING_ENABLED: 'true' }).enabled, true);
  assert.equal(readConfig({ TRADING_MODE: 'paper', AUTO_TRADING_ENABLED: 'true' }).enabled, false);
});

test('unknown wallet risk and incomplete holder data block automatic buys', () => {
  const now = Date.now();
  const token = { mint: 'mint', priceUsd: 1, liquidityUsd: 20000, updatedAt: new Date(now).toISOString() };
  const analysis = { signal: 'BUY PRESSURE CONFIRMED (ALERT ONLY)', gates: { walletRisk: 'unknown' } };
  const result = evaluateBuy({ token, analysis, risk: { status: 'observed', top10ConcentrationPct: 10 }, now, config: DEFAULTS });
  assert.equal(result.allowed, false);
  assert.ok(result.reasons.some(x => x.includes('not independently verified low')));
});

test('buy is blocked for stale prices and excessive concentration', () => {
  const now = Date.now();
  const token = { mint: 'mint', priceUsd: 1, liquidityUsd: 20000, updatedAt: new Date(now - 60000).toISOString() };
  const analysis = { signal: 'BUY PRESSURE CONFIRMED (ALERT ONLY)', gates: { walletRisk: 'low' } };
  const result = evaluateBuy({ token, analysis, risk: { status: 'observed', top10ConcentrationPct: 60 }, now, config: DEFAULTS });
  assert.equal(result.allowed, false);
  assert.ok(result.reasons.length >= 2);
});

test('stop-loss and take-profit thresholds produce exits', () => {
  assert.equal(evaluateExit({ entryPriceUsd: 1, currentPriceUsd: 0.79 }).reason, 'STOP_LOSS');
  assert.equal(evaluateExit({ entryPriceUsd: 1, currentPriceUsd: 1.5 }).reason, 'TAKE_PROFIT');
  assert.equal(evaluateExit({ entryPriceUsd: 1, currentPriceUsd: 1.1 }).reason, 'HOLD');
});
