'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPressurePersistence } = require('../lib/pressure-persistence');

test('database missing stays in memory fallback and does not save', async () => {
  const store = createPressurePersistence({ connectionString: '', pool: null });
  const init = await store.initialize();
  assert.equal(init.enabled, false);
  assert.equal(await store.save('mint', 'trade', Date.now(), { side: 'buy' }), false);
  assert.deepEqual(await store.recent('mint'), []);
  assert.equal(store.status().mode, 'memory fallback');
});

test('writes and reads use parameterized SQL and bounded limits', async () => {
  const calls = [];
  const pool = { query: async (sql, args) => {
    calls.push({ sql, args });
    if (sql.startsWith('SELECT')) return { rows: [{ kind: 'trade', payload: { side: 'buy' } }] };
    return { rows: [] };
  } };
  const store = createPressurePersistence({ connectionString: 'postgres://test', pool });
  assert.equal((await store.initialize()).ready, true);
  assert.equal(await store.save('mint', 'trade', Date.now(), { side: 'buy' }), true);
  const rows = await store.recent('mint', 99999);
  assert.equal(rows.length, 1);
  assert.equal(calls[2].args[1], 1000);
  assert.match(calls[1].sql, /\$1/);
});

test('invalid observation kind is rejected', async () => {
  const pool = { query: async () => ({ rows: [] }) };
  const store = createPressurePersistence({ connectionString: 'postgres://test', pool });
  await store.initialize();
  assert.equal(await store.save('mint', 'anything', Date.now(), {}), false);
});
