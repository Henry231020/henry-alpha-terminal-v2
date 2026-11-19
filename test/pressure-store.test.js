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

test('cached provider quotes cannot inflate price-history observations', () => {
  const now = 1000000;
  const store = new PressureStore({ clock: () => now });
  assert.equal(store.recordSnapshot('mint', { timestamp: now - 1000, priceUsd: 1 }), true);
  assert.equal(store.recordSnapshot('mint', { timestamp: now - 1000, priceUsd: 1 }), false);
  assert.equal(store.recordSnapshot('mint', { timestamp: now, priceUsd: 1.1 }), true);
  assert.equal(store.getStats().snapshotCount, 2);
});

test('holder and RugCheck risk gates expire after five minutes',()=>{
 let now=2000000;const store=new PressureStore({clock:()=>now});
 store.updateLiquidity('mint',20000);
 store.updateHolderRisk('mint',{holderConcentrationPct:20,walletRisk:'low'});
 let analysis=store.analyse('mint');
 assert.equal(analysis.gates.walletRisk,'low');
 assert.equal(analysis.gates.concentrationOk,true);
 now+=5*60*1000+1;
 analysis=store.analyse('mint');
 assert.equal(analysis.gates.walletRisk,'unknown');
 assert.equal(analysis.gates.concentrationOk,false);
});
test('restored risk uses its persisted observation time rather than becoming fresh',()=>{
 let now=3000000;const store=new PressureStore({clock:()=>now});
 assert.equal(store.restoreObservation('mint','risk',now-6*60*1000,{holderConcentrationPct:10,walletRisk:'low'}),true);
 const analysis=store.analyse('mint');
 assert.equal(analysis.gates.walletRisk,'unknown');
 assert.equal(analysis.gates.concentrationOk,false);
});

test('pressure store bounds retained token state during long-running token churn', () => {
  const { MAX_TRACKED_MINTS } = require('../lib/pressure-store');
  const store = new PressureStore();
  for (let i = 0; i < MAX_TRACKED_MINTS + 1; i++) store.updateLiquidity('mint-' + i, 10000);
  assert.equal(store.byMint.size, MAX_TRACKED_MINTS);
  assert.equal(store.byMint.has('mint-0'), false);
  assert.equal(store.byMint.has('mint-' + MAX_TRACKED_MINTS), true);
});


test('liquidity evidence expires independently after two minutes',()=>{
  let now=4000000;
  const store=new PressureStore({clock:()=>now});
  store.updateLiquidity('mint',25000,now);
  store.updateHolderRisk('mint',{holderConcentrationPct:12,walletRisk:'low',checkedAt:now});
  let analysis=store.analyse('mint');
  assert.equal(analysis.gates.liquidityOk,true);
  now+=2*60*1000+1;
  analysis=store.analyse('mint');
  assert.equal(analysis.gates.liquidityOk,false);
  assert.match(analysis.reasons.join(' '),/Liquidity missing/);
  assert.equal(analysis.gates.walletRisk,'low');
});
test('old or future-dated liquidity observations cannot pass the freshness gate',()=>{
  let now=5000000;
  const store=new PressureStore({clock:()=>now});
  store.updateLiquidity('mint',30000,now-2*60*1000-1);
  store.updateHolderRisk('mint',{holderConcentrationPct:10,walletRisk:'low',checkedAt:now});
  assert.equal(store.analyse('mint').gates.liquidityOk,false);
  store.updateLiquidity('mint',30000,now+6000);
  assert.equal(store.analyse('mint').gates.liquidityOk,false);
});


test('pressure store refreshes active mints before LRU eviction',()=>{
  const { MAX_TRACKED_MINTS } = require('../lib/pressure-store');
  const store = new PressureStore();
  for (let i = 0; i < MAX_TRACKED_MINTS; i++) store.updateLiquidity('mint-' + i, 10000);
  store.updateLiquidity('mint-0', 12000);
  store.updateLiquidity('mint-new', 15000);
  assert.equal(store.byMint.has('mint-0'), true);
  assert.equal(store.byMint.has('mint-1'), false);
  assert.equal(store.byMint.has('mint-new'), true);
  assert.equal(store.byMint.size, MAX_TRACKED_MINTS);
});
