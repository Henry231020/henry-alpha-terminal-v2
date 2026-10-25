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
