'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRugCheckRiskClient } = require('../lib/rugcheck-risk');

function report(overrides = {}) {
  return {
    mint: 'So11111111111111111111111111111111111111112',
    token: { mintAuthority: null, freezeAuthority: null },
    risks: [],
    score: 100,
    score_normalised: 10,
    graphInsidersDetected: 0,
    insiderNetworks: [],
    ...overrides
  };
}

test('classifies low only when score, revoked authorities and complete insider checks pass', async () => {
  const client = createRugCheckRiskClient({ fetchImpl: async () => ({ ok: true, json: async () => report() }) });
  const result = await client.getTokenRisk('So11111111111111111111111111111111111111112');
  assert.equal(result.status, 'observed');
  assert.equal(result.walletRisk, 'low');
});

test('danger findings and detected insider networks block low-risk classification', async () => {
  const dangerous = report({
    risks: [{ name: 'Danger', level: 'danger', description: 'Risk detected' }],
    graphInsidersDetected: 3,
    insiderNetworks: [{ size: 3 }]
  });
  const client = createRugCheckRiskClient({ fetchImpl: async () => ({ ok: true, json: async () => dangerous }) });
  const result = await client.getTokenRisk('So11111111111111111111111111111111111111112');
  assert.equal(result.walletRisk, 'high');
  assert.equal(result.dangerRisks.length, 1);
});

test('missing insider coverage or authority fields never pass as low risk', async () => {
  const incomplete = report({ graphInsidersDetected: undefined, insiderNetworks: undefined, token: {} });
  const client = createRugCheckRiskClient({ fetchImpl: async () => ({ ok: true, json: async () => incomplete }) });
  const result = await client.getTokenRisk('So11111111111111111111111111111111111111112');
  assert.equal(result.status, 'observed');
  assert.equal(result.walletRisk, 'unknown');
});

test('mismatched report mint is rejected', async () => {
  const client = createRugCheckRiskClient({ fetchImpl: async () => ({ ok: true, json: async () => report({ mint: '11111111111111111111111111111111' }) }) });
  const result = await client.getTokenRisk('So11111111111111111111111111111111111111112');
  assert.equal(result.status, 'unknown');
  assert.equal(result.walletRisk, 'unknown');
});

test('caches successful reports and preserves their original observation time', async () => {
  let calls = 0, now = 1000;
  const client = createRugCheckRiskClient({ clock: () => now, fetchImpl: async () => { calls++; return { ok: true, json: async () => report() }; } });
  const mint = 'So11111111111111111111111111111111111111112';
  const first = await client.getTokenRisk(mint);
  now = 2000;
  const cached = await client.getTokenRisk(mint);
  assert.equal(calls, 1);
  assert.equal(first.checkedAt, 1000);
  assert.equal(cached.cached, true);
  assert.equal(cached.checkedAt, 1000);
});
