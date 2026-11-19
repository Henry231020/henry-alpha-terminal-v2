'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TradeLearningEngine } = require('../lib/trade-learning');

function buyAnalysis() {
  return {
    tradeDecision: { action: 'BUY SETUP', reasons: ['Bullish EMA alignment and confirmed pressure.'] },
    indicators: { ready: true, priceFresh: true, ema9: 2, ema20: 1.8, ema50: 1.5, rsi14: 62, observations: 60 },
    metrics: { buyUsd: 3000, sellUsd: 500, buyCount: 20, sellCount: 4, imbalancePct: 71.4, acceleration: 2.2, liquidityUsd: 20000, holderConcentrationPct: 20 },
    gates: { enoughTrades: true, buyPressure: true, sellPressure: false, accelerating: true, priceConfirmed: true, liquidityOk: true, concentrationOk: true, walletRisk: 'low' }
  };
}

test('opens a paper trade and captures entry reasoning and indicators', () => {
  let now = 100000;
  const engine = new TradeLearningEngine({ clock: () => now });
  const result = engine.observe({ mint: 'mint-a', analysis: buyAnalysis(), priceUsd: 1, timestamp: now });
  assert.equal(result.trade.status, 'paper entry opened');
  assert.equal(result.trade.entryConditions.rsi14, 62);
  assert.equal(result.trade.entryReasons.length, 1);
  assert.equal(engine.summary().openPaperPositions, 1);
  assert.equal(engine.summary().closedTrades, 0);
});

test('closes a profitable paper trade and explains the exit', () => {
  let now = 100000;
  const engine = new TradeLearningEngine({ clock: () => now });
  engine.observe({ mint: 'mint-a', analysis: buyAnalysis(), priceUsd: 1, timestamp: now });
  now += 1000;
  const result = engine.observe({ mint: 'mint-a', analysis: { tradeDecision: { action: 'WAIT', reasons: [] } }, priceUsd: 1.5, timestamp: now });
  assert.equal(result.trade.outcome, 'WIN');
  assert.equal(result.trade.pnlPct, 50);
  assert.match(result.trade.exitReason, /take-profit/);
  assert.equal(engine.summary().winRatePct, 100);
});

test('does not paper-enter when required data-quality gates are unknown', () => {
  let now = 100000;
  const engine = new TradeLearningEngine({ clock: () => now });
  const analysis = buyAnalysis();
  analysis.gates.walletRisk = 'unknown';
  const result = engine.observe({ mint: 'mint-a', analysis, priceUsd: 1, timestamp: now });
  assert.equal(result.trade, null);
  assert.match(result.status, /data-quality gate/);
});

test('rejects duplicate or out-of-order market observations', () => {
  let now = 100000;
  const engine = new TradeLearningEngine({ clock: () => now });
  engine.observe({ mint: 'mint-a', analysis: buyAnalysis(), priceUsd: 1, timestamp: now });
  assert.equal(engine.observe({ mint: 'mint-a', analysis: buyAnalysis(), priceUsd: 1, timestamp: now }).accepted, false);
});

test('reports descriptive RSI-band outcomes without changing strategy rules', () => {
  let now = 100000;
  const engine = new TradeLearningEngine({ clock: () => now });
  engine.observe({ mint: 'mint-a', analysis: buyAnalysis(), priceUsd: 1, timestamp: now });
  now += 1000;
  engine.observe({ mint: 'mint-a', analysis: { tradeDecision: { action: 'SELL / EXIT WARNING', reasons: ['Bearish trend.'] }, indicators: { rsi14: 45 } }, priceUsd: 1.1, timestamp: now });
  const summary = engine.summary();
  assert.equal(summary.closedTrades, 1);
  assert.equal(summary.conditionStats['entry RSI 60-69'].trades, 1);
  assert.match(summary.learningNote, /fewer than 20/);
});

test('restoring a closed paper trade clears its earlier persisted open entry',()=>{
 const engine=new TradeLearningEngine();
 const entry={mint:'mint-restore',entryAt:1000,entryPrice:1,status:'paper entry opened',entryConditions:{rsi14:60}};
 const closed={...entry,exitAt:2000,exitPrice:1.5,pnlPct:50,outcome:'WIN',status:'closed paper trade'};
 assert.equal(engine.restoreTrade(entry),true);
 assert.equal(engine.summary().openPaperPositions,1);
 assert.equal(engine.restoreTrade(closed),true);
 assert.equal(engine.summary().openPaperPositions,0);
 assert.equal(engine.summary().closedTrades,1);
});

test('summary tolerates legacy closed records without entry condition details',()=>{
 const engine=new TradeLearningEngine();
 assert.equal(engine.restoreTrade({mint:'legacy-mint',entryAt:1000,entryPrice:1,exitAt:2000,exitPrice:1.1,pnlPct:10,outcome:'WIN',status:'closed paper trade'}),true);
 assert.equal(engine.summary().closedTrades,1);
 assert.equal(engine.summary().conditionStats['entry RSI unknown'].trades,1);
});
