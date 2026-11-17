'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeWalletActivity } = require('../lib/wallet-activity');

test('identifies earliest observed buyers within the launch window', () => {
  const launchAt = '2026-11-17T00:00:00.000Z';
  const start = Date.parse(launchAt);
  const result = summarizeWalletActivity([
    { wallet: 'walletB', side: 'buy', timestamp: start + 120000, usdValue: 20 },
    { wallet: 'walletA', side: 'buy', timestamp: start + 30000, usdValue: 50 },
    { wallet: 'walletA', side: 'sell', timestamp: start + 180000, usdValue: 10 },
    { wallet: 'walletC', side: 'buy', timestamp: start + 900000, usdValue: 100 }
  ], { launchAt, windowMs: 600000 });
  assert.equal(result.earlyBuyerCount, 2);
  assert.equal(result.earlyBuyers[0].wallet, 'walletA');
  assert.equal(result.earlyBuyers[0].netBuyUsd, 40);
  assert.equal(result.earlyBuyers[1].wallet, 'walletB');
});

test('does not label wallets early when launch time is unavailable', () => {
  const result = summarizeWalletActivity([{ wallet: 'walletA', side: 'buy', timestamp: 1000, usdValue: 10 }]);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.earlyBuyerCount, undefined);
});

test('filters malformed wallet and trade observations', () => {
  const result = summarizeWalletActivity([
    { wallet: '', side: 'buy', timestamp: 1000, usdValue: 10 },
    { wallet: 'walletA', side: 'hold', timestamp: 1000, usdValue: 10 },
    { wallet: 'walletB', side: 'buy', timestamp: 1000, usdValue: -1 }
  ], { launchAt: '1970-01-01T00:00:00.000Z' });
  assert.equal(result.walletsObserved, 0);
  assert.equal(result.earlyBuyerCount, 0);
});
