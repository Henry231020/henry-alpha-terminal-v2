const test = require('node:test');
const assert = require('node:assert/strict');
const { MarketCache } = require('../lib/market-cache');
test('cache returns fresh entries and expires old ones', () => {
  const cache = new MarketCache({ttlMs:100,maxEntries:2});
  cache.set('a',{price:1},1000);
  assert.deepEqual(cache.get('a',1050),{price:1});
  assert.equal(cache.get('a',1100),null);
});
test('429 responses apply exponential cooldown capped at maximum', () => {
  const cache = new MarketCache({initialBackoffMs:100,maxBackoffMs:250});
  cache.noteStatus(429,1000); assert.equal(cache.canRequest(1050),false); assert.equal(cache.getStats(1050).backoffMs,100);
  cache.noteStatus(429,1100); assert.equal(cache.getStats(1100).backoffMs,200);
  cache.noteStatus(429,1300); assert.equal(cache.getStats(1300).backoffMs,250);
  cache.noteStatus(200,1600); assert.equal(cache.canRequest(1600),true); assert.equal(cache.getStats(1600).backoffMs,0);
});
test('cache stays within configured entry bound', () => {
  const cache = new MarketCache({maxEntries:2}); cache.set('a',1); cache.set('b',2); cache.set('c',3);
  assert.equal(cache.getStats().entries,2); assert.equal(cache.get('a'),null);
});
