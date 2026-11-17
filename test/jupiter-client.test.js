'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createJupiterClient } = require('../lib/jupiter-client');

test('Jupiter order validates fields and returns order response', async () => {
  let called = '';
  const client = createJupiterClient({
    apiKey: 'test-key',
    fetchImpl: async (url, init) => {
      called = String(url);
      assert.equal(init.headers['x-api-key'], 'test-key');
      return { ok: true, json: async () => ({ transaction: 'unsigned', requestId: 'req-1', outAmount: '123' }) };
    }
  });
  const order = await client.getOrder({ inputMint: 'So111', outputMint: 'TokenMint', amount: '1000', taker: 'Wallet' });
  assert.equal(order.requestId, 'req-1');
  assert.match(called, /\/order\?/);
});

test('Jupiter swap requires a signer and executes the signed order', async () => {
  const calls = [];
  const client = createJupiterClient({
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('/order?')) return { ok: true, json: async () => ({ transaction: 'unsigned', requestId: 'req-2' }) };
      return { ok: true, json: async () => ({ status: 'Success', signature: 'sig-1' }) };
    }
  });
  await assert.rejects(() => client.swap({ inputMint: 'A', outputMint: 'B', amount: '1', taker: 'W' }), /signTransaction/);
  const result = await client.swap({
    inputMint: 'A', outputMint: 'B', amount: '1', taker: 'W',
    signTransaction: async tx => tx + '-signed'
  });
  assert.equal(result.result.signature, 'sig-1');
  assert.equal(calls.length, 2);
  assert.match(calls[1].init.body, /req-2/);
});

test('Jupiter HTTP errors fail closed', async () => {
  const client = createJupiterClient({ fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: 'rate limited' }) }) });
  await assert.rejects(() => client.getOrder({ inputMint: 'A', outputMint: 'B', amount: '1', taker: 'W' }), /HTTP 429/);
});
