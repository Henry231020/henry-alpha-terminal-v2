'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { valueTradeInUsd, MAX_TRADE_QUOTE_AGE_MS } = require('../lib/trade-valuation');

test('values a trade using a fresh SOL/USD quote and records its provenance', () => {
  const result = valueTradeInUsd({ solAmount: 2, timestamp: 100000 }, { price: 150, checkedAt: 110000 });
  assert.equal(result.usdValue, 300);
  assert.equal(result.solUsdPrice, 150);
  assert.equal(result.solUsdQuoteAgeMs, 10000);
  assert.equal(result.usdValueApproximate, false);
});

test('marks a quote approximate when its timestamp differs by more than 30 seconds', () => {
  const result = valueTradeInUsd({ solAmount: 1, timestamp: 100000 }, { price: 150, checkedAt: 140001 });
  assert.equal(result.usdValueApproximate, true);
});

test('rejects SOL/USD quotes more than 60 seconds from the trade time', () => {
  assert.equal(valueTradeInUsd({ solAmount: 1, timestamp: 100000 }, { price: 150, checkedAt: 100000 + MAX_TRADE_QUOTE_AGE_MS + 1 }), null);
  assert.equal(valueTradeInUsd({ solAmount: 1, timestamp: 100000 }, { price: 150, checkedAt: 100000 - MAX_TRADE_QUOTE_AGE_MS - 1 }), null);
});

test('rejects invalid trade sizes, timestamps and SOL/USD quotes', () => {
  assert.equal(valueTradeInUsd({ solAmount: 0, timestamp: 100000 }, { price: 150, checkedAt: 100000 }), null);
  assert.equal(valueTradeInUsd({ solAmount: 1, timestamp: NaN }, { price: 150, checkedAt: 100000 }), null);
  assert.equal(valueTradeInUsd({ solAmount: 1, timestamp: 100000 }, { price: 0, checkedAt: 100000 }), null);
  assert.equal(valueTradeInUsd({ solAmount: 1, timestamp: 100000 }, { price: 150, checkedAt: NaN }), null);
});
