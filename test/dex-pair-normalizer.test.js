'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { selectPairForMint, normalisePairForMint } = require('../lib/dex-pair-normalizer');

const mint = 'So11111111111111111111111111111111111111112';
const base = {
  baseToken: { address: mint, name: 'Target', symbol: 'TGT' },
  quoteToken: { address: 'USDC', name: 'USD Coin', symbol: 'USDC' },
  priceUsd: '2',
  priceNative: '2',
  liquidity: { usd: 50000 },
  volume: { h24: 1000 },
  txns: { h24: { buys: 10, sells: 5 } },
  priceChange: { h24: 10 },
  pairAddress: 'pool-base'
};

test('selects the highest-liquidity pair that actually contains the requested mint', () => {
  const unrelated = { ...base, baseToken: { address: 'other' }, liquidity: { usd: 999999 } };
  const smaller = { ...base, pairAddress: 'pool-smaller', liquidity: { usd: 10000 } };
  assert.equal(selectPairForMint([unrelated, smaller, base], mint).pairAddress, 'pool-base');
});

test('skips a higher-liquidity pair with an unusable quote-side price', () => {
  const unusable = {
    ...base,
    baseToken: { address: 'other' },
    quoteToken: { address: mint },
    priceNative: '0',
    liquidity: { usd: 100000 }
  };
  const usable = {
    ...base,
    baseToken: { address: 'other' },
    quoteToken: { address: mint },
    priceNative: '2',
    liquidity: { usd: 50000 }
  };
  assert.equal(selectPairForMint([unusable, usable], mint), usable);
});

test('uses the requested base-token price and market cap', () => {
  const market = normalisePairForMint(base, mint);
  assert.equal(market.priceUsd, 2);
  assert.equal(market.marketCapUsd, null);
  assert.equal(market.priceOrientation, 'base-token');
  assert.equal(market.baseSymbol, 'TGT');
});

test('inverts the quote-token USD price when the requested mint is the quote side', () => {
  const pair = {
    ...base,
    baseToken: { address: 'other', name: 'Other', symbol: 'OTH' },
    quoteToken: { address: mint, name: 'Target', symbol: 'TGT' },
    priceUsd: '4',
    priceNative: '2',
    priceChange: { h24: 100 }
  };
  const market = normalisePairForMint(pair, mint);
  assert.equal(market.priceUsd, 2);
  assert.equal(market.marketCapUsd, null);
  assert.equal(market.priceChange24h, -50);
  assert.equal(market.priceOrientation, 'quote-token-inverted');
  assert.equal(market.buys24h, 5);
  assert.equal(market.sells24h, 10);
  assert.equal(market.baseSymbol, 'TGT');
});

test('keeps explicitly missing transaction and price-change metrics unknown', () => {
  const market = normalisePairForMint({
    ...base,
    txns: { h24: { buys: null, sells: undefined } },
    priceChange: { h24: null }
  }, mint);
  assert.equal(market.buys24h, null);
  assert.equal(market.sells24h, null);
  assert.equal(market.priceChange24h, null);
});

test('rejects unrelated pairs and quote-side pairs without a usable conversion ratio', () => {
  assert.equal(normalisePairForMint({ ...base, baseToken: { address: 'other' } }, mint), null);
  const pair = { ...base, baseToken: { address: 'other' }, quoteToken: { address: mint }, priceNative: '0' };
  assert.equal(normalisePairForMint(pair, mint).priceUsd, null);
});
