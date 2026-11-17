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
      if (body.method === 'getAccountInfo') return { ok: true, json: async () => ({ result: { value: null } }) };
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
      if (body.method === 'getAccountInfo') return { ok: true, json: async () => ({ result: { value: null } }) };
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
      const body = JSON.parse(options.body);
      if (body.method === 'getAccountInfo') return { ok: true, json: async () => ({ result: { value: null } }) };
      calls++;
      assert.equal(body.params.page, calls);
      return { ok: true, json: async () => ({ result: { token_accounts: Array.from({ length: 1000 }, (_, i) => ({ owner: 'wallet-' + i, amount: '1' })) } }) };
    }
  });
  const result = await client.getHolderRisk('So11111111111111111111111111111111111111112');
  assert.equal(calls, 20);
  assert.equal(result.status, 'unknown');
  assert.equal(result.top10ConcentrationPct, null);
  assert.match(result.reason, /page limit/);
});


test('combines holder concentration, creator share and mint authority state', async () => {
  const mint = 'So11111111111111111111111111111111111111112';
  const creator = 'CreatorWallet11111111111111111111111111111';
  let calls = 0;
  const mintBytes = Buffer.alloc(82);
  mintBytes.writeUInt32LE(0, 0);
  mintBytes[45] = 1;
  mintBytes.writeUInt32LE(1, 46);
  const client = createHeliusRiskClient({
    apiKey: 'test-key',
    fetchImpl: async (_url, init) => {
      calls++;
      const body = JSON.parse(init.body);
      if (body.method === 'getTokenAccounts') {
        return { ok: true, json: async () => ({ result: { token_accounts: body.params.page === 1 ? [
          { owner: creator, amount: '600' },
          { owner: 'OtherWallet111111111111111111111111111111', amount: '400' }
        ] : [] } }) };
      }
      if (body.method === 'getAccountInfo') {
        return { ok: true, json: async () => ({ result: { value: { owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', data: [mintBytes.toString('base64'), 'base64'] } } }) };
      }
      throw new Error('Unexpected RPC method');
    }
  });
  const result = await client.getHolderRisk(mint, { creatorWallet: creator });
  assert.equal(result.status, 'observed');
  assert.equal(result.top10ConcentrationPct, 100);
  assert.equal(result.creatorConcentrationPct, 60);
  assert.equal(result.mintAuthority.mintAuthorityRevoked, true);
  assert.equal(result.mintAuthority.freezeAuthorityRevoked, false);
  const firstCallCount = calls;
  const cached = await client.getHolderRisk(mint, { creatorWallet: creator });
  assert.equal(cached.cached, true);
  assert.equal(calls, firstCallCount);
});

test('mint authority lookup fails closed when the mint account is unavailable', async () => {
  const client = createHeliusRiskClient({
    apiKey: 'test-key',
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.method === 'getAccountInfo') return { ok: true, json: async () => ({ result: { value: null } }) };
      return { ok: true, json: async () => ({ result: { token_accounts: [] } }) };
    }
  });
  const result = await client.getHolderRisk('So11111111111111111111111111111111111111112');
  assert.equal(result.mintAuthority.status, 'unknown');
  assert.equal(result.mintAuthority.mintAuthorityRevoked, null);
});
