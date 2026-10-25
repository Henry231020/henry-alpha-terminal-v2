const test = require('node:test');
const assert = require('node:assert/strict');
const { analysePressure } = require('../lib/pressure-engine');
const now = 1800000000000;
test('missing risk data cannot trigger buy alert', () => {
  const trades = Array.from({length: 10}, (_, i) => ({ side: 'buy', usdValue: 250, timestamp: now - 50000 + i * 100 }));
  const result = analysePressure({ trades, snapshots: [{timestamp:now-30000,priceUsd:1},{timestamp:now,priceUsd:1.1}], now });
  assert.notEqual(result.signal, 'BUY PRESSURE CONFIRMED (ALERT ONLY)');
  assert.equal(result.automaticTrading, false);
});
test('accelerating sell pressure flags urgent dump without price confirmation', () => {
  const prior = Array.from({length:4}, (_, i) => ({side:'sell',usdValue:200,timestamp:now-240000+i*1000}));
  const recent = Array.from({length:10}, (_, i) => ({side:'sell',usdValue:300,timestamp:now-50000+i*100}));
  const result = analysePressure({trades:[...prior,...recent],now});
  assert.equal(result.signal, 'URGENT DUMP PRESSURE');
});
test('no trades returns WAIT and never enables trading', () => {
  const result = analysePressure({now});
  assert.equal(result.signal, 'WAIT');
  assert.equal(result.automaticTrading, false);
});
test('stale and future trades are excluded', () => {
  const result = analysePressure({trades:[{side:'buy',usdValue:5000,timestamp:now-400000},{side:'buy',usdValue:5000,timestamp:now+1000}],now});
  assert.equal(result.metrics.buyCount, 0);
});

test('buy alert remains blocked when any critical risk gate is unknown', () => {
  const trades = [
    ...Array.from({length: 4}, (_, i) => ({ side: 'buy', usdValue: 100, timestamp: now - 240000 + i * 1000 })),
    ...Array.from({length: 10}, (_, i) => ({ side: 'buy', usdValue: 150, timestamp: now - 50000 + i * 100 }))
  ];
  const snapshots = [{ timestamp: now - 30000, priceUsd: 1 }, { timestamp: now, priceUsd: 1.1 }];
  const base = { trades, snapshots, now, liquidityUsd: 20000, holderConcentrationPct: 20, walletRisk: 'low' };
  assert.equal(analysePressure(base).signal, 'BUY PRESSURE CONFIRMED (ALERT ONLY)');
  assert.notEqual(analysePressure({ ...base, liquidityUsd: null }).signal, 'BUY PRESSURE CONFIRMED (ALERT ONLY)');
  assert.notEqual(analysePressure({ ...base, holderConcentrationPct: null }).signal, 'BUY PRESSURE CONFIRMED (ALERT ONLY)');
  assert.notEqual(analysePressure({ ...base, walletRisk: 'unknown' }).signal, 'BUY PRESSURE CONFIRMED (ALERT ONLY)');
});

test('near-simultaneous price snapshots do not count as confirmation', () => {
  const trades = [
    ...Array.from({length: 4}, (_, i) => ({ side: 'buy', usdValue: 100, timestamp: now - 240000 + i * 1000 })),
    ...Array.from({length: 10}, (_, i) => ({ side: 'buy', usdValue: 150, timestamp: now - 50000 + i * 100 }))
  ];
  const snapshots = [{ timestamp: now - 1000, priceUsd: 1 }, { timestamp: now, priceUsd: 1.1 }];
  const result = analysePressure({
    trades, snapshots, now, liquidityUsd: 20000,
    holderConcentrationPct: 20, walletRisk: 'low'
  });
  assert.notEqual(result.signal, 'BUY PRESSURE CONFIRMED (ALERT ONLY)');
  assert.ok(result.reasons.some(reason => reason.includes('price confirmation')));
});
