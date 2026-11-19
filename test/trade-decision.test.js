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

test('confirmed buy setup includes reference entry, stop and 0.5x/1x profit targets', () => {
  const prices = [1];
  const increments = [0.001, 0.001, -0.0005, -0.0005];
  for (let i = 0; i < 59; i++) prices.push(prices[prices.length - 1] + increments[i % increments.length]);
  const snapshots = prices.map((priceUsd, i) => ({ timestamp: now - (59 - i) * 30000, priceUsd }));
  const trades = [
    ...Array.from({ length: 4 }, (_, i) => ({ side: 'buy', usdValue: 100, timestamp: now - 240000 + i * 1000 })),
    ...Array.from({ length: 10 }, (_, i) => ({ side: 'buy', usdValue: 150, timestamp: now - 50000 + i * 100 }))
  ];
  const result = analysePressure({ trades, snapshots, now, liquidityUsd: 20000, holderConcentrationPct: 20, walletRisk: 'low' });
  assert.equal(result.tradeDecision.action, 'BUY SETUP');
  assert.ok(result.tradePlan.referenceEntryPrice > 0);
  assert.ok(result.tradePlan.stopLossPrice < result.tradePlan.referenceEntryPrice);
  assert.ok(result.tradePlan.takeProfit1Price > result.tradePlan.referenceEntryPrice);
  assert.ok(result.tradePlan.takeProfit2Price > result.tradePlan.takeProfit1Price);
});

test('surfaces a technical watchlist candidate but never a BUY when wallet risk is unknown', () => {
  const prices = [1];
  const increments = [0.001, 0.001, -0.0005, -0.0005];
  for (let i = 0; i < 59; i++) prices.push(prices[prices.length - 1] + increments[i % increments.length]);
  const snapshots = prices.map((priceUsd, i) => ({ timestamp: now - (59 - i) * 30000, priceUsd }));
  const trades = [
    ...Array.from({ length: 4 }, (_, i) => ({ side: 'buy', usdValue: 100, timestamp: now - 240000 + i * 1000 })),
    ...Array.from({ length: 10 }, (_, i) => ({ side: 'buy', usdValue: 150, timestamp: now - 50000 + i * 100 }))
  ];
  const result = analysePressure({ trades, snapshots, now, liquidityUsd: 20000, holderConcentrationPct: 20, walletRisk: 'unknown' });
  assert.equal(result.tradeDecision.action, 'WATCHLIST — RISK UNVERIFIED');
  assert.equal(result.tradeDecision.automaticTrading, false);
  assert.match(result.tradeDecision.reasons.join(' '), /do not treat this as a BUY signal/);
});

test('RSI uses Wilder smoothing across the complete observation series', () => {
  const alternating = Array.from({ length: 15 }, (_, i) => i % 2 === 0 ? 1 : 2);
  alternating.push(2);
  const value = calculateRsi(alternating, 14);
  assert.ok(Math.abs(value - 53.5714285714) < 0.0001);
});
test('RSI handles flat prices and rejects invalid periods or values', () => {
  assert.equal(calculateRsi(Array(20).fill(1), 14), 50);
  assert.equal(calculateRsi(Array(20).fill(1), 0), null);
  assert.equal(calculateRsi([1, 2, NaN, 4], 2), null);
});

test('urgent accelerating sell pressure warns to exit before EMA history is ready', () => {
  const trades = [
    ...Array.from({ length: 4 }, (_, i) => ({ side: 'buy', usdValue: 100, timestamp: now - 240000 + i * 1000 })),
    ...Array.from({ length: 10 }, (_, i) => ({ side: 'sell', usdValue: 200, timestamp: now - 50000 + i * 100 }))
  ];
  const result = analysePressure({ trades, now, snapshots: [] });
  assert.equal(result.indicators.ready, false);
  assert.equal(result.tradeDecision.action, 'SELL / EXIT WARNING');
  assert.match(result.tradeDecision.reasons.join(' '), /Accelerating sell pressure/);
});
