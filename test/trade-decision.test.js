const test = require('node:test');
const assert = require('node:assert/strict');
const { ema, calculateRsi, analysePressure } = require('../lib/pressure-engine');

const now = 1800000000000;

test('EMA requires enough observations and returns a finite value', () => {
  assert.equal(ema([1, 2, 3], 9), null);
  assert.ok(Number.isFinite(ema(Array.from({ length: 50 }, (_, i) => 1 + i * 0.01), 9)));
});

test('RSI returns null until 15 prices and stays within 0-100', () => {
  assert.equal(calculateRsi(Array.from({ length: 14 }, (_, i) => 1 + i * 0.01)), null);
  const value = calculateRsi(Array.from({ length: 30 }, (_, i) => 1 + i * 0.01));
  assert.ok(value >= 0 && value <= 100);
});

test('trade decision waits until EMA 9/20/50 and RSI history are ready', () => {
  const result = analysePressure({
    now,
    snapshots: [{ timestamp: now - 30000, priceUsd: 1 }, { timestamp: now, priceUsd: 1.01 }]
  });
  assert.equal(result.tradeDecision.action, 'WAIT');
  assert.equal(result.indicators.ready, false);
  assert.equal(result.automaticTrading, false);
});

test('bearish EMA alignment produces a sell/exit warning', () => {
  const snapshots = Array.from({ length: 60 }, (_, i) => ({
    timestamp: now - (59 - i) * 30000,
    priceUsd: 2 - i * 0.01
  }));
  const result = analysePressure({ now, snapshots, liquidityUsd: 20000, holderConcentrationPct: 20, walletRisk: 'low' });
  assert.equal(result.indicators.ready, true);
  assert.equal(result.tradeDecision.action, 'SELL / EXIT WARNING');
  assert.equal(result.automaticTrading, false);
});
