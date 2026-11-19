'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseGeckoTrades } = require('../lib/gecko-trades');

const now = Date.parse('2026-11-19T04:30:00Z');

test('parses recent GeckoTerminal buys and sells with USD value and wallet', () => {
  const result = parseGeckoTrades({ data: [
    { id: 'sig1', attributes: { kind: 'buy', volume_in_usd: '12.5', block_timestamp: '2026-11-19T04:29:30Z', tx_hash: 'sig1', tx_from_address: 'wallet1' } },
    { id: 'sig2', attributes: { kind: 'sell', volume_in_usd: '7', block_timestamp: '2026-11-19T04:29:40Z', tx_hash: 'sig2', tx_from_address: 'wallet2' } }
  ] }, 'Mint', 'base-token', now);
  assert.deepEqual(result.map(x => [x.side, x.usdValue, x.wallet]), [['buy', 12.5, 'wallet1'], ['sell', 7, 'wallet2']]);
});

test('inverts buy/sell when tracked mint is the quote token', () => {
  const result = parseGeckoTrades({ data: [
    { id: 'sig1', attributes: { kind: 'buy', volume_in_usd: '2', block_timestamp: '2026-11-19T04:29:30Z', tx_hash: 'sig1' } }
  ] }, 'Mint', 'quote-token-inverted', now);
  assert.equal(result[0].side, 'sell');
});

test('rejects stale, future, malformed and zero-value trades', () => {
  const result = parseGeckoTrades({ data: [
    { attributes: { kind: 'buy', volume_in_usd: '2', block_timestamp: '2026-11-19T04:20:00Z', tx_hash: 'old' } },
    { attributes: { kind: 'sell', volume_in_usd: '2', block_timestamp: '2026-11-19T04:31:00Z', tx_hash: 'future' } },
    { attributes: { kind: 'buy', volume_in_usd: '0', block_timestamp: '2026-11-19T04:29:00Z', tx_hash: 'zero' } },
    { attributes: { kind: 'swap', volume_in_usd: '2', block_timestamp: '2026-11-19T04:29:00Z', tx_hash: 'unknown' } }
  ] }, 'Mint', 'base-token', now);
  assert.equal(result.length, 0);
});

test('handles malformed provider payloads safely', () => {
  assert.deepEqual(parseGeckoTrades(null, 'Mint', 'base-token', now), []);
  assert.deepEqual(parseGeckoTrades({ data: {} }, 'Mint', 'base-token', now), []);
});
