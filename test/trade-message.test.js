'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTradeMessage } = require('../lib/trade-message');

test('normalizes a valid buy message without changing the mint', () => {
  assert.deepEqual(parseTradeMessage({
    mint: 'MintAddress',
    txType: 'BUY',
    solAmount: '1.25',
    traderPublicKey: 'WalletAddress'
  }), {
    ok: true,
    candidate: true,
    trade: { mint: 'MintAddress', side: 'buy', solAmount: 1.25, wallet: 'WalletAddress' }
  });
});

test('accepts sell messages and missing optional wallet', () => {
  assert.deepEqual(parseTradeMessage({ mint: 'MintAddress', txType: 'sell', solAmount: 0.5 }).trade, {
    mint: 'MintAddress', side: 'sell', solAmount: 0.5, wallet: null
  });
});

test('rejects non-object messages and non-trade provider events', () => {
  assert.equal(parseTradeMessage(null).ok, false);
  assert.equal(parseTradeMessage('text').ok, false);
  assert.equal(parseTradeMessage({ mint: 'MintAddress', name: 'New token' }).candidate, false);
});

test('rejects missing mint, invalid side, missing amount and non-positive amounts', () => {
  for (const message of [
    { txType: 'buy', solAmount: 1 },
    { mint: 'MintAddress', txType: 'hold', solAmount: 1 },
    { mint: 'MintAddress', txType: 'buy' },
    { mint: 'MintAddress', txType: 'sell', solAmount: 0 },
    { mint: 'MintAddress', txType: 'buy', solAmount: -1 },
    { mint: 'MintAddress', txType: 'buy', solAmount: 'NaN' }
  ]) assert.equal(parseTradeMessage(message).ok, false, JSON.stringify(message));
});

test('does not treat unrelated launch messages as rejected trade candidates', () => {
  const result = parseTradeMessage({ mint: 'MintAddress', name: 'New token', symbol: 'ABC' });
  assert.equal(result.ok, false);
  assert.equal(result.candidate, false);
});
