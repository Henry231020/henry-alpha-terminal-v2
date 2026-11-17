'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPaperTrader } = require('../lib/paper-trader');

const config = {
  enabled: true,
  startingBalanceUsd: 1000,
  positionSizeUsd: 50,
  stopLossPct: 20,
  takeProfitPct: 50,
  trailingStopPct: 15,
  dailyLossLimitUsd: 100,
  maxOpenPositions: 2
};
const passingAnalysis = {
  signal: 'BUY PRESSURE CONFIRMED (ALERT ONLY)',
  gates: {
    enoughTrades: true, buyPressure: true, accelerating: true, priceConfirmed: true,
    liquidityOk: true, concentrationOk: true, creatorConcentrationOk: true,
    mintAuthorityOk: true, freezeAuthorityOk: true, mintInitializedOk: true,
    tokenProgramOk: true, walletRisk: 'low'
  }
};

test('paper trader is disabled unless explicitly enabled and fully configured', () => {
  const disabled = createPaperTrader({});
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.summary().mode, 'paper-only');
  assert.equal(disabled.onMarketUpdate({ mint: 'mint', priceUsd: 1, analysis: passingAnalysis }).length, 0);
  assert.equal(createPaperTrader({ ...config, stopLossPct: 0 }).enabled, false);
});

test('opens and closes simulated positions at take-profit without sending transactions', () => {
  const trader = createPaperTrader(config);
  const entry = trader.onMarketUpdate({ mint: 'mint-a', priceUsd: 1, analysis: passingAnalysis, now: Date.parse('2026-11-17T00:00:00Z') });
  assert.equal(entry[0].type, 'PAPER_BUY');
  assert.equal(trader.summary().cashUsd, 950);
  const exit = trader.onMarketUpdate({ mint: 'mint-a', priceUsd: 1.5, analysis: {}, now: Date.parse('2026-11-17T00:01:00Z') });
  assert.equal(exit[0].type, 'PAPER_SELL');
  assert.equal(exit[0].reason, 'take-profit');
  assert.equal(exit[0].pnlUsd, 25);
  assert.equal(trader.summary().equityUsd, 1025);
  assert.equal(trader.summary().automaticTrading, false);
});

test('stop-loss and trailing-stop exits close simulated positions', () => {
  const stopTrader = createPaperTrader(config);
  stopTrader.onMarketUpdate({ mint: 'mint-stop', priceUsd: 1, analysis: passingAnalysis, now: 100000 });
  const stop = stopTrader.onMarketUpdate({ mint: 'mint-stop', priceUsd: 0.8, analysis: {}, now: 110000 });
  assert.equal(stop[0].reason, 'stop-loss');

  const trailTrader = createPaperTrader({ ...config, takeProfitPct: 500 });
  trailTrader.onMarketUpdate({ mint: 'mint-trail', priceUsd: 1, analysis: passingAnalysis, now: 100000 });
  trailTrader.onMarketUpdate({ mint: 'mint-trail', priceUsd: 2, analysis: {}, now: 110000 });
  const trail = trailTrader.onMarketUpdate({ mint: 'mint-trail', priceUsd: 1.6, analysis: {}, now: 120000 });
  assert.equal(trail[0].reason, 'trailing-stop');
});

test('daily loss limit and maximum open positions block new entries', () => {
  const trader = createPaperTrader({ ...config, positionSizeUsd: 50, stopLossPct: 20, dailyLossLimitUsd: 9, maxOpenPositions: 1 });
  trader.onMarketUpdate({ mint: 'mint-a', priceUsd: 1, analysis: passingAnalysis, now: Date.parse('2026-11-17T00:00:00Z') });
  trader.onMarketUpdate({ mint: 'mint-a', priceUsd: 0.8, analysis: {}, now: Date.parse('2026-11-17T00:01:00Z') });
  const blocked = trader.onMarketUpdate({ mint: 'mint-b', priceUsd: 1, analysis: passingAnalysis, now: Date.parse('2026-11-17T00:02:00Z') });
  assert.equal(blocked.length, 0);
});
