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

test('fails closed when holder account page is incomplete', async () => {
  const client = createHeliusRiskClient({
    apiKey: 'test',
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.method, 'getTokenAccounts');
      assert.ok(body.params.page === 1 || body.params.page === 2);
      return { ok: true, json: async () => ({ result: { token_accounts: body.params.page === 1 ? [{ owner: 'wallet-a', amount: '90' }, { owner: 'wallet-b', amount: '5' }, { owner: 'wallet-c', amount: '5' }] : [] } }) };
    }
  });
  const result = await client.getHolderRisk('So11111111111111111111111111111111111111112');
  assert.equal(result.status, 'observed');
  assert.equal(result.holderCount, 3);
  assert.equal(result.top10ConcentrationPct, 100);
  assert.match(result.reason, /All holder-account pages retrieved/);
});

test('HTTP errors fail closed as unknown', async () => {
  const client = createHeliusRiskClient({ apiKey: 'test', fetchImpl: async () => ({ ok: false, status: 429 }) });
  const result = await client.getHolderRisk('So11111111111111111111111111111111111111112');
  assert.equal(result.status, 'unknown');
  assert.equal(result.top10ConcentrationPct, null);
});

test('paginates holder accounts and aggregates multiple accounts by owner', async () => {
  const requestedPages = [];
  const client = createHeliusRiskClient({
    apiKey: 'test',
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      requestedPages.push(body.params.page);
      const rows = body.params.page === 1
        ? [{ owner: 'wallet-a', amount: '60' }, { owner: 'wallet-a', amount: '10' }]
        : body.params.page === 2
          ? [{ owner: 'wallet-b', amount: '30' }]
          : [];
      return { ok: true, json: async () => ({ result: { token_accounts: rows } }) };
    }
  });
  const result = await client.getHolderRisk('So11111111111111111111111111111111111111112');
  assert.deepEqual(requestedPages, [1, 2, 3]);
  assert.equal(result.status, 'observed');
  assert.equal(result.holderCount, 2);
  assert.equal(result.accountCount, 3);
  assert.equal(result.top10ConcentrationPct, 100);
});

test('holder scan remains unknown when pagination limit is reached', async () => {
  let calls = 0;
  const client = createHeliusRiskClient({
    apiKey: 'test',
    fetchImpl: async (_url, options) => {
      calls++;
      assert.equal(JSON.parse(options.body).params.page, calls);
      return { ok: true, json: async () => ({ result: { token_accounts: Array.from({ length: 1000 }, (_, i) => ({ owner: 'wallet-' + i, amount: '1' })) } }) };
    }
  });
  const result = await client.getHolderRisk('So11111111111111111111111111111111111111112');
  assert.equal(calls, 20);
  assert.equal(result.status, 'unknown');
  assert.equal(result.top10ConcentrationPct, null);
  assert.match(result.reason, /page limit/);
});
