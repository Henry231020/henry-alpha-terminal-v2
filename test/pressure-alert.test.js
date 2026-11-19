'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pressureAlertSignal } = require('../lib/pressure-alert');

test('BUY SETUP takes priority as the actionable buy alert', () => {
  assert.equal(pressureAlertSignal({ signal: 'BUY PRESSURE CONFIRMED (ALERT ONLY)', tradeDecision: { action: 'BUY SETUP' } }), 'BUY SETUP');
});

test('SELL / EXIT WARNING is emitted as an actionable exit alert', () => {
  assert.equal(pressureAlertSignal({ signal: 'WAIT', tradeDecision: { action: 'SELL / EXIT WARNING' } }), 'SELL / EXIT WARNING');
});

test('pressure-only alerts remain available when no trade decision is ready', () => {
  assert.equal(pressureAlertSignal({ signal: 'URGENT DUMP PRESSURE', tradeDecision: { action: 'WAIT' } }), 'URGENT DUMP PRESSURE');
  assert.equal(pressureAlertSignal({ signal: 'BUY PRESSURE CONFIRMED (ALERT ONLY)', tradeDecision: { action: 'WAIT' } }), 'BUY PRESSURE CONFIRMED (ALERT ONLY)');
});

test('does not emit an alert for WAIT or unrecognised decisions', () => {
  assert.equal(pressureAlertSignal({ signal: 'WAIT', tradeDecision: { action: 'WAIT' } }), null);
  assert.equal(pressureAlertSignal({ signal: 'unknown', tradeDecision: { action: 'WATCHLIST — RISK UNVERIFIED' } }), null);
});
