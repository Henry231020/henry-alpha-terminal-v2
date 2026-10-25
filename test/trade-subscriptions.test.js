const test = require('node:test');
const assert = require('node:assert/strict');
const { TradeSubscriptionManager } = require('../lib/trade-subscriptions');
function socket() { return { readyState: 1, sent: [], send(v) { this.sent.push(JSON.parse(v)); } }; }
test('subscribes once per mint and stays within limit', () => {
  const ws = socket(); const manager = new TradeSubscriptionManager({socket:ws,maxSubscriptions:2});
  assert.equal(manager.subscribe('mint-a'),true);
  assert.equal(manager.subscribe('mint-a'),false);
  assert.equal(manager.subscribe('mint-b'),true);
  assert.equal(manager.subscribe('mint-c'),false);
  assert.equal(ws.sent.length,2);
  assert.equal(ws.sent[0].method,'subscribeTokenTrade');
  assert.deepEqual(ws.sent[0].keys,['mint-a']);
});
test('does not subscribe while disconnected and can unsubscribe', () => {
  const ws = socket(); const manager = new TradeSubscriptionManager({socket:ws,maxSubscriptions:3});
  ws.readyState=3; assert.equal(manager.subscribe('mint-a'),false);
  ws.readyState=1; assert.equal(manager.subscribe('mint-a'),true);
  assert.equal(manager.unsubscribe('mint-a'),true);
  assert.equal(ws.sent[1].method,'unsubscribeTokenTrade');
  assert.equal(manager.stats().subscribedMints,0);
});
