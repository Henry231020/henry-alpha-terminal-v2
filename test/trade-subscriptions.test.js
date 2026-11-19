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

test('rotates the oldest subscription when a new token needs a live feed slot', () => {
  const ws = socket(); const manager = new TradeSubscriptionManager({ socket: ws, maxSubscriptions: 2 });
  assert.equal(manager.subscribeLatest('mint-a'), true);
  assert.equal(manager.subscribeLatest('mint-b'), true);
  assert.equal(manager.subscribeLatest('mint-c'), true);
  assert.deepEqual(manager.stats(), { subscribedMints: 2, maxSubscriptions: 2 });
  assert.deepEqual(ws.sent.map(item => item.method), [
    'subscribeTokenTrade','subscribeTokenTrade','unsubscribeTokenTrade','subscribeTokenTrade'
  ]);
  assert.deepEqual([...manager.mints], ['mint-b','mint-c']);
});
test('does not evict existing subscriptions while the socket is disconnected', () => {
  const ws = socket(); const manager = new TradeSubscriptionManager({ socket: ws, maxSubscriptions: 1 });
  manager.subscribe('mint-a');
  ws.readyState = 3;
  assert.equal(manager.subscribeLatest('mint-b'), false);
  assert.deepEqual([...manager.mints], ['mint-a']);
});


test('socket send failures do not corrupt subscription bookkeeping',()=>{
  const ws=socket();
  const manager=new TradeSubscriptionManager({socket:ws,maxSubscriptions:1});
  ws.send=()=>{throw new Error('socket closed during send');};
  assert.equal(manager.subscribe('mint-a'),false);
  assert.equal(manager.stats().subscribedMints,0);
  ws.send=function(value){this.sent.push(JSON.parse(value));};
  assert.equal(manager.subscribe('mint-a'),true);
  ws.send=()=>{throw new Error('socket closed during unsubscribe');};
  assert.equal(manager.unsubscribe('mint-a'),false);
  assert.deepEqual([...manager.mints],['mint-a']);
  assert.equal(manager.subscribeLatest('mint-b'),false);
  assert.deepEqual([...manager.mints],['mint-a']);
});
