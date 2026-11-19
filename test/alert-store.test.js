'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { AlertStore } = require('../lib/alert-store');

test('records recent urgent alerts in memory and filters by token', () => {
  const store = new AlertStore({ maxAlerts: 3 });
  const at = new Date('2026-11-19T00:00:00Z').toISOString();
  assert.equal(store.record({ mint: 'mint-a', signal: 'URGENT DUMP PRESSURE', receivedAt: at }), true);
  assert.equal(store.record({ mint: 'mint-b', signal: 'BUY PRESSURE CONFIRMED (ALERT ONLY)', receivedAt: at }), true);
  assert.equal(store.recent(10).length, 2);
  assert.equal(store.recent(10, 'mint-a').length, 1);
});

test('deduplicates identical alert events and bounds retained history', () => {
  const store = new AlertStore({ maxAlerts: 2 });
  const base = Date.parse('2026-11-19T00:00:00Z');
  const alert = n => ({ mint: 'mint-' + n, signal: 'URGENT DUMP PRESSURE', receivedAt: new Date(base + n * 1000).toISOString() });
  assert.equal(store.record(alert(1)), true);
  assert.equal(store.record(alert(1)), false);
  store.record(alert(2));
  store.record(alert(3));
  assert.deepEqual(store.recent(10).map(x => x.mint), ['mint-3', 'mint-2']);
});

test('rejects malformed alert records', () => {
  const store = new AlertStore();
  assert.equal(store.record({ mint: '', signal: 'WAIT', receivedAt: new Date().toISOString() }), false);
  assert.equal(store.record({ mint: 'mint', signal: 'WAIT', receivedAt: 'not-a-date' }), false);
});
