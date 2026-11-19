'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { newestTokenMints, prioritisedTokenMints } = require('../lib/token-priority');

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

test('recently selected older tokens stay in the refresh rotation ahead of newest launches', () => {
  const tokens = [
    { mint: 'old-selected', firstSeenAt: '2026-11-19T00:00:00.000Z' },
    { mint: 'newest-a', firstSeenAt: '2026-11-19T03:00:00.000Z' },
    { mint: 'newest-b', firstSeenAt: '2026-11-19T02:00:00.000Z' },
    { mint: 'newest-c', firstSeenAt: '2026-11-19T01:00:00.000Z' }
  ];
  assert.deepEqual(prioritisedTokenMints(tokens, ['old-selected'], 3), ['old-selected', 'newest-a', 'newest-b']);
});

test('selected-token priority ignores unknown and duplicate mints and respects the cap', () => {
  const tokens = [{ mint: 'a', firstSeenAt: '2026-11-19T01:00:00Z' }, { mint: 'b', firstSeenAt: '2026-11-19T02:00:00Z' }];
  assert.deepEqual(prioritisedTokenMints(tokens, ['missing', 'a', 'a', 'b'], 2), ['a', 'b']);
  assert.deepEqual(prioritisedTokenMints(tokens, ['a'], 0), []);
});
