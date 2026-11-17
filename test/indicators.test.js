'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMinuteCandles, calculateEma, calculateRsi, calculateIndicators } = require('../lib/indicators');

test('minute candles aggregate observed prices without filling missing minutes', () => {
  const samples = [
    { timestamp: 60000, priceUsd: 2 },
    { timestamp: 61000, priceUsd: 3 },
    { timestamp: 180000, priceUsd: 4 }
  ];
  const candles = buildMinuteCandles(samples);
  assert.equal(candles.length, 2);
  assert.deepEqual(candles[0], { timestamp: 60000, open: 2, high: 3, low: 2, close: 3, samples: 2 });
  assert.equal(candles[1].timestamp, 180000);
});

test('EMA returns null until the requested number of valid values exists', () => {
  assert.equal(calculateEma([1, 2, 3], 9), null);
  assert.ok(calculateEma(Array.from({ length: 9 }, (_, i) => i + 1), 9) > 0);
});

test('RSI handles rising, falling and flat series', () => {
  assert.equal(calculateRsi(Array.from({ length: 16 }, (_, i) => i + 1), 14), 100);
  assert.equal(calculateRsi(Array.from({ length: 16 }, (_, i) => 16 - i), 14), 0);
  assert.equal(calculateRsi(Array(16).fill(5), 14), 50);
});

test('indicator response reports readiness and does not fabricate missing candles', () => {
  const samples = Array.from({ length: 20 }, (_, i) => ({ timestamp: i * 60000, priceUsd: 1 + i / 100 }));
  const result = calculateIndicators(samples);
  assert.equal(result.candleCount, 20);
  assert.equal(result.ema9Ready, true);
  assert.equal(result.ema20Ready, true);
  assert.equal(result.ema50Ready, false);
  assert.equal(result.ema50, null);
  assert.equal(result.rsi14Ready, true);
});
