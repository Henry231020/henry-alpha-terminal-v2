'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseObservedTrades, PUMP_PROGRAMS } = require('../lib/helius-trade-stream');

function tx({ tokenBefore = '0', tokenAfter = '100', solBefore = 2_000_000_000, solAfter = 1_000_000_000 } = {}) {
  return {
    blockTime: 1800000000,
    transaction: { message: { accountKeys: [{ pubkey: 'TraderWallet111111111111111111111111111111', signer: true }] } },
    meta: {
      err: null,
      fee: 5000,
      preBalances: [solBefore],
      postBalances: [solAfter],
      preTokenBalances: tokenBefore === null ? [] : [{
        owner: 'TraderWallet111111111111111111111111111111',
        mint: 'TokenMint111111111111111111111111111111111',
        uiTokenAmount: { uiAmountString: tokenBefore }
      }],
      postTokenBalances: tokenAfter === null ? [] : [{
        owner: 'TraderWallet111111111111111111111111111111',
        mint: 'TokenMint111111111111111111111111111111111',
        uiTokenAmount: { uiAmountString: tokenAfter }
      }]
    }
  };
}

test('recognises a buy from confirmed signer token and SOL balance changes', () => {
  const rows = parseObservedTrades(tx(), 1800000000000);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].side, 'buy');
  assert.equal(rows[0].wallet, 'TraderWallet111111111111111111111111111111');
  assert.equal(rows[0].mint, 'TokenMint111111111111111111111111111111111');
  assert.ok(Math.abs(rows[0].solAmount - 0.999995) < 1e-9);
  assert.equal(rows[0].timestamp, 1800000000000);
  assert.equal(rows[0].estimate, true);
});

test('recognises a sell and adds back the fee paid by the signer', () => {
  const rows = parseObservedTrades(tx({ tokenBefore: '100', tokenAfter: '40', solBefore: 1_000_000_000, solAfter: 1_500_000_000 }), 1800000000000);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].side, 'sell');
  assert.ok(Math.abs(rows[0].solAmount - 0.500005) < 1e-9);
});

test('rejects failed transactions and transactions without a signer owner', () => {
  const failed = tx();
  failed.meta.err = { InstructionError: [0, 'Custom'] };
  assert.deepEqual(parseObservedTrades(failed), []);
  const noSigner = tx();
  noSigner.transaction.message.accountKeys[0].signer = false;
  assert.deepEqual(parseObservedTrades(noSigner), []);
});

test('program filters cover Pump.fun and PumpSwap', () => {
  assert.equal(PUMP_PROGRAMS.length, 2);
  assert.ok(PUMP_PROGRAMS.includes('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'));
  assert.ok(PUMP_PROGRAMS.includes('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA'));
});
