'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFeedDiagnostics } = require('../lib/feed-diagnostics');

test('records message and valid-trade timestamps independently', () => {
  const diagnostics = createFeedDiagnostics();
  diagnostics.recordMessage('2026-10-25T00:00:00.000Z');
  diagnostics.recordValidTrade('2026-10-25T00:00:01.000Z');
  assert.deepEqual(diagnostics.snapshot(), {
    messagesReceived: 1,
    validTradeMessages: 1,
    recordedTrades: 0,
    priceUnavailable: 0,
    storeRejectedTrades: 0,
    rejectedTradeCandidates: 0,
    malformedJsonMessages: 0,
    lastMessageAt: '2026-10-25T00:00:00.000Z',
    lastValidTradeAt: '2026-10-25T00:00:01.000Z',
    lastRecordedTradeAt: null,
    lastProcessingIssue: null,
    lastRejectedReason: null
  });
});

test('counts malformed and rejected candidates without marking them valid', () => {
  const diagnostics = createFeedDiagnostics();
  diagnostics.recordMalformedJson();
  diagnostics.recordRejected('missing mint string');
  const snapshot = diagnostics.snapshot();
  assert.equal(snapshot.malformedJsonMessages, 1);
  assert.equal(snapshot.rejectedTradeCandidates, 1);
  assert.equal(snapshot.lastRejectedReason, 'missing mint string');
  assert.equal(snapshot.validTradeMessages, 0);
});

test('a valid trade clears the most recent rejection reason', () => {
  const diagnostics = createFeedDiagnostics();
  diagnostics.recordRejected('solAmount missing or invalid');
  diagnostics.recordValidTrade('2026-10-25T00:00:02.000Z');
  assert.equal(diagnostics.snapshot().lastRejectedReason, null);
});

test('snapshot is a copy and cannot mutate internal counters', () => {
  const diagnostics = createFeedDiagnostics();
  const snapshot = diagnostics.snapshot();
  snapshot.messagesReceived = 999;
  assert.equal(diagnostics.snapshot().messagesReceived, 0);
});

test('distinguishes validated trades from recorded trades and processing failures', () => {
  const diagnostics = createFeedDiagnostics();
  diagnostics.recordValidTrade('2026-10-25T00:00:01.000Z');
  diagnostics.recordPriceUnavailable();
  diagnostics.recordStoreRejected();
  diagnostics.recordTradeRecorded('2026-10-25T00:00:02.000Z');
  assert.deepEqual({
    valid: diagnostics.snapshot().validTradeMessages,
    recorded: diagnostics.snapshot().recordedTrades,
    priceUnavailable: diagnostics.snapshot().priceUnavailable,
    storeRejected: diagnostics.snapshot().storeRejectedTrades,
    lastRecorded: diagnostics.snapshot().lastRecordedTradeAt,
    issue: diagnostics.snapshot().lastProcessingIssue
  }, {
    valid: 1,
    recorded: 1,
    priceUnavailable: 1,
    storeRejected: 1,
    lastRecorded: '2026-10-25T00:00:02.000Z',
    issue: null
  });
});
