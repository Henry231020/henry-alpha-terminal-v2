'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createJupiterPriceClient } = require('../lib/jupiter-price');

const MINT_A = 'So11111111111111111111111111111111111111112';
const MINT_B = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

test('fetches Jupiter V3 prices in one batch and caches them', async () => {
  let calls = 0;
  let requestedUrl = '';
  const client = createJupiterPriceClient({
    fetchImpl: async url => {
      calls++;
      requestedUrl = url;
      return { ok: true, json: async () => ({
        [MINT_A]: { usdPrice: 150, blockId: 123, decimals: 9, priceChange24h: 2.5 },
        [MINT_B]: { usdPrice: 1, blockId: 124, decimals: 6, priceChange24h: 0.1 }
      }) };
    }
  });
  const first = await client.getPrices([MINT_A, MINT_B, MINT_A]);
  assert.equal(calls, 1);
  assert.ok(requestedUrl.includes('price%2Fv3') || requestedUrl.includes('/price/v3'));
  assert.equal(first[MINT_A].usdPrice, 150);
  assert.equal(first[MINT_B].usdPrice, 1);
  const second = await client.getPrices([MINT_A, MINT_B]);
  assert.equal(calls, 1);
  assert.equal(second[MINT_A].cached, true);
});

test('returns unavailable when Jupiter has no qualifying price', async () => {
  const client = createJupiterPriceClient({
    fetchImpl: async () => ({ ok: true, json: async () => ({}) })
  });
  const result = await client.getPrice(MINT_A);
  assert.equal(result.status, 'unavailable');
});

test('fails closed on HTTP errors and rejects invalid mint addresses', async () => {
  let calls = 0;
  const client = createJupiterPriceClient({
    fetchImpl: async () => { calls++; return { ok: false, status: 429 }; }
  });
  assert.equal((await client.getPrice(MINT_A)).status, 'unavailable');
  assert.equal((await client.getPrice('not-a-mint')).reason, 'Invalid mint address');
  assert.equal(calls, 1);
});
