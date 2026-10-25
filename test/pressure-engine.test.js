const test = require('node:test');
const assert = require('node:assert/strict');
const { analysePressure } = require('../lib/pressure-engine');
const now = 1_800_000_000_000;
test('does not raise buy alert when risk data is missing', () => {
  const trades = Array.from({length:10}, (_,i) => ({side:'buy',usdValue:250,timestamp:now-50000+i*100}));
  const snapshots = [{timestamp:now-50000,priceUsd:1},{timestamp:now,priceUsd:1.1}];
  const result = analysePressure({trades,snapshots,now});
  assert.notEqual(result.signal,'BUY PRESSURE CONFIRMED (ALERT ONLY)');
  assert.equal(result.automaticTrading,false);
});
test('flags urgent dump pressure without requiring price confirmation', () => {
  const trades = Array.from({length:10}, (_,i) => ({side:'sell',usdValue:300,timestamp:now-50000+i*100}));
  const result = analysePressure({trades,now});
  assert.equal(result.signal,'URGENT DUMP PRESSURE');
  assert.equal(result.automaticTrading,false);
});
test('returns WAIT when no real trade data is supplied', () => {
  const result = analysePressure({now});
  assert.equal(result.signal,'WAIT');
  assert.equal(result.metrics.imbalancePct,null);
});
