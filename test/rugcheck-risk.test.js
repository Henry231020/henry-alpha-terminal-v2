'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeRugCheckReport, createRugCheckClient } = require('../lib/rugcheck-risk');

function cleanReport() {
  return {
    score_normalised: 10,
    creator: 'CreatorWallet11111111111111111111111111111',
    creatorTokens: null,
    insiderNetworks: [],
    topHolders: [{ address: 'HolderWallet1111111111111111111111111111', insider: false }],
    risks: [],
    tokenMeta: { mutable: false },
    token_extensions: {},
    detectedAt: '2026-11-17T00:00:00.000Z'
  };
}

test('classifies only complete clean RugCheck reports as low wallet risk', () => {
  const result = summarizeRugCheckReport(cleanReport());
  assert.equal(result.status, 'observed');
  assert.equal(result.walletRisk, 'low');
  assert.equal(result.scoreNormalized, 10);
});

test('danger scores and insider networks classify as high risk', () => {
  const danger = cleanReport();
  danger.risks = [{ name: 'Danger flag', level: 'danger', description: 'Danger' }];
  assert.equal(summarizeRugCheckReport(danger).walletRisk, 'high');
  const insider = cleanReport();
  insider.insiderNetworks = [{ id: 'network-1' }];
  assert.equal(summarizeRugCheckReport(insider).walletRisk, 'high');
});

test('warnings, creator history, mutable metadata and extensions do not pass low-risk gate', () => {
  for (const mutate of [
    report => { report.risks = [{ name: 'Warning', level: 'warn' }]; },
    report => { report.creatorTokens = [{ mint: 'PreviousToken' }]; },
    report => { report.tokenMeta.mutable = true; },
    report => { report.token_extensions = { permanentDelegate: true }; }
  ]) {
    const report = cleanReport();
    mutate(report);
    assert.notEqual(summarizeRugCheckReport(report).walletRisk, 'low');
  }
});

test('incomplete RugCheck reports remain unknown', () => {
  assert.equal(summarizeRugCheckReport(null).walletRisk, 'unknown');
  const report = cleanReport();
  delete report.insiderNetworks;
  assert.equal(summarizeRugCheckReport(report).walletRisk, 'unknown');
});

test('RugCheck client caches reports and fails closed on provider errors', async () => {
  let calls = 0;
  const mint = 'So11111111111111111111111111111111111111112';
  const client = createRugCheckClient({
    fetchImpl: async () => {
      calls++;
      return { ok: true, json: async () => cleanReport() };
    }
  });
  const first = await client.getRisk(mint);
  const second = await client.getRisk(mint);
  assert.equal(first.walletRisk, 'low');
  assert.equal(second.cached, true);
  assert.equal(calls, 1);

  const failed = createRugCheckClient({ fetchImpl: async () => ({ ok: false, status: 503 }) });
  assert.equal((await failed.getRisk(mint)).walletRisk, 'unknown');
});
