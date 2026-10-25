const test = require('node:test');
const assert = require('node:assert/strict');
const { PressureStore } = require('../lib/pressure-store');
test('pressure store rejects incomplete or invalid trade observations', () => {
  let now = 1000000; const store = new PressureStore({clock:()=>now});
  assert.equal(store.recordTrade('mint',{side:'buy',timestamp:now,usdValue:100}),true);
  assert.equal(store.recordTrade('mint',{side:'hold',timestamp:now,usdValue:100}),false);
  assert.equal(store.recordTrade('mint',{side:'sell',timestamp:now,usdValue:NaN}),false);
  assert.equal(store.getStats().tradeCount,1);
});
test('pressure analysis waits when verified risk data is absent', () => {
  let now = 1000000; const store = new PressureStore({clock:()=>now});
  store.recordTrade('mint',{side:'buy',timestamp:now,usdValue:5000});
  const result = store.analyse('mint');
  assert.notEqual(result.signal,'BUY');
  assert.equal(result.automaticTrading,false);
});
test('store reports its non-persistent nature accurately', () => {
  const store = new PressureStore();
  assert.match(store.getStats().persistence,/memory-only/);
});
