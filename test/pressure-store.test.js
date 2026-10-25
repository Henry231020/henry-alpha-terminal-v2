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
  assert.match(store.getStats().persistence,/PostgreSQL recovery/);
});

test('restores validated persisted trades and snapshots', () => {
  const now = 1000000;
  const store = new PressureStore({ clock: () => now });
  assert.equal(store.restoreObservation('mint', 'trade', now, { side: 'buy', timestamp: now, usdValue: 25 }), true);
  assert.equal(store.restoreObservation('mint', 'snapshot', now, { timestamp: now, priceUsd: 2 }), true);
  assert.equal(store.restoreObservation('mint', 'trade', now, { side: 'invalid', timestamp: now, usdValue: 25 }), false);
  assert.equal(store.getStats().tradeCount, 1);
  assert.equal(store.getStats().snapshotCount, 1);
});

test('empty or invalid risk updates reset measurements to unknown', () => {
  const store = new PressureStore();
  store.setRisk('mint', { liquidityUsd: 20000, holderConcentrationPct: 10, walletRisk: 'low' });
  store.setRisk('mint', { liquidityUsd: '', holderConcentrationPct: -1, walletRisk: 'unknown' });
  const result = store.analyse('mint');
  assert.match(result.reasons.join(' '), /Liquidity missing/);
  assert.match(result.reasons.join(' '), /Holder concentration missing/);
  assert.notEqual(result.signal, 'BUY PRESSURE CONFIRMED (ALERT ONLY)');
});

test('liquidity refresh preserves independently verified holder risk', () => {
  const store = new PressureStore();
  store.setRisk('mint', { liquidityUsd: 20000, holderConcentrationPct: 12, walletRisk: 'low' });
  store.updateLiquidity('mint', 25000);
  const state = store.ensure('mint');
  assert.equal(state.risk.liquidityUsd, 25000);
  assert.equal(state.risk.holderConcentrationPct, 12);
  assert.equal(state.risk.walletRisk, 'low');
  store.updateLiquidity('mint', null);
  assert.equal(state.risk.liquidityUsd, null);
  assert.equal(state.risk.holderConcentrationPct, 12);
  assert.equal(state.risk.walletRisk, 'low');
});

test('holder-only risk updates preserve liquidity and fail closed on malformed concentration', () => {
  const store = new PressureStore();
  store.setRisk('mint', { liquidityUsd: 12000, holderConcentrationPct: null, walletRisk: 'unknown' });
  store.updateHolderRisk('mint', { holderConcentrationPct: 18, walletRisk: 'unknown' });
  let risk = store.ensure('mint').risk;
  assert.equal(risk.liquidityUsd, 12000);
  assert.equal(risk.holderConcentrationPct, 18);
  assert.equal(risk.walletRisk, 'unknown');

  store.updateHolderRisk('mint', { holderConcentrationPct: 'not-a-number', walletRisk: 'trusted' });
  risk = store.ensure('mint').risk;
  assert.equal(risk.liquidityUsd, 12000);
  assert.equal(risk.holderConcentrationPct, null);
  assert.equal(risk.walletRisk, 'unknown');
});
