'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { newestTokenMints } = require('../lib/token-priority');

test('prioritises first discovery time rather than last activity or map insertion order', () => {
  const tokens = [
    { mint: 'older-active', firstSeenAt: '2026-11-19T00:00:00.000Z', lastEventAt: '2026-11-19T02:00:00.000Z' },
    { mint: 'newest', firstSeenAt: '2026-11-19T01:30:00.000Z', lastEventAt: '2026-11-19T01:31:00.000Z' },
    { mint: 'middle', firstSeenAt: '2026-11-19T01:00:00.000Z', lastEventAt: '2026-11-19T01:05:00.000Z' }
  ];
  assert.deepEqual(newestTokenMints(tokens, 2), ['newest', 'middle']);
});

test('ignores malformed entries and bounds requested result count', () => {
  assert.deepEqual(newestTokenMints([null, {}, { mint: 'valid', firstSeenAt: '2026-11-19T01:00:00Z' }], 1), ['valid']);
  assert.deepEqual(newestTokenMints([{ mint: 'valid' }], 0), []);
});
