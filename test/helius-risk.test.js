'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHeliusRiskClient } = require('../lib/helius-risk');

test('missing Helius key returns unknown risk without network access', async () => {
  let called = false;
  const client = createHeliusRiskClient({ apiKey: '', fetchImpl: async () => { called = true; } });
  const result = await client.getHolderRisk('So11111111111111111111111111111111111111112');
  assert.equal(result.status, 'unknown');
  assert.equal(result.top10ConcentrationPct, null);
  assert.equal(called, false);
});

test('invalid mint returns unknown risk', async () => {
  const client = createHeliusRiskClient({ apiKey: 'test', fetchImpl: async () => { throw new Error('must not call'); } });
  const result = await client.getHolderRisk('not-a-mint');
  assert.equal(result.status, 'unknown');
  assert.equal(result.holderCount, null);
});

test('computes account concentration and warns it is not beneficial-owner proof', async () => {
  const client = createHeliusRiskClient({
    apiKey: 'test',
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.method, 'getTokenAccounts');
      return { ok: true, json: async () => ({ result: { token_accounts: [{ amount: '90' }, { amount: '5' }, { amount: '5' }] } }) };
    }
  });
  const result = await client.getHolderRisk('So11111111111111111111111111111111111111112');
  assert.equal(result.status, 'observed');
  assert.equal(result.holderCount, 3);
  assert.equal(result.top10ConcentrationPct, 100);
  assert.match(result.reason, /not verified beneficial owner/);
});

test('HTTP errors fail closed as unknown', async () => {
  const client = createHeliusRiskClient({ apiKey: 'test', fetchImpl: async () => ({ ok: false, status: 429 }) });
  const result = await client.getHolderRisk('So11111111111111111111111111111111111111112');
  assert.equal(result.status, 'unknown');
  assert.equal(result.top10ConcentrationPct, null);
});
