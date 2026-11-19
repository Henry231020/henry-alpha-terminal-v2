'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {WalletIntelligence}=require('../lib/wallet-intelligence');
test('classifies first five-minute buyers',()=>{let now=1000000;const x=new WalletIntelligence({clock:()=>now}),first=new Date(now-1000).toISOString();x.recordTrade('mint',{wallet:'a',side:'buy',usdValue:10,timestamp:now-500},first);x.recordTrade('mint',{wallet:'b',side:'buy',usdValue:20,timestamp:now},first);const r=x.analyse('mint',first);assert.equal(r.uniqueBuyers,2);assert.equal(r.earlyBuyers,2);});
test('does not label trades before token first-seen as early',()=>{let now=2000000;const x=new WalletIntelligence({clock:()=>now}),first=new Date(now-1000).toISOString();x.recordTrade('mint',{wallet:'a',side:'buy',timestamp:now-5000},first);assert.equal(x.analyse('mint',first).earlyBuyers,0);});
test('flags five distinct buyers in a ten-second burst as a review signal',()=>{let now=3000000;const x=new WalletIntelligence({clock:()=>now}),first=new Date(now-1000).toISOString();for(let i=0;i<5;i++)x.recordTrade('mint',{wallet:'w'+i,side:'buy',usdValue:10,timestamp:now-i*100},first);const r=x.analyse('mint',first);assert.equal(r.coordinatedBurst,true);assert.equal(r.burstBuyerCount,5);});
test('ignores missing wallet labels',()=>{const x=new WalletIntelligence();assert.equal(x.recordTrade('mint',{side:'buy',timestamp:Date.now()},new Date().toISOString()),false);assert.equal(x.analyse('mint').earlyBuyers,0);});

test('uses earliest buy timestamp even when trade messages arrive out of order',()=>{
  let now=4000000;const x=new WalletIntelligence({clock:()=>now}),first=new Date(now-10000).toISOString();
  x.recordTrade('mint',{wallet:'wallet-a',side:'buy',timestamp:now-1000,usdValue:5},first);
  x.recordTrade('mint',{wallet:'wallet-a',side:'buy',timestamp:now-9000,usdValue:5},first);
  const row=x.analyse('mint',first).wallets.find(w=>w.wallet==='wallet-a');
  assert.equal(Date.parse(row.firstBuyAt),now-9000);
});
test('retains token first-seen time for restored wallet observations',()=>{
  let now=5000000;const x=new WalletIntelligence({clock:()=>now}),first=new Date(now-2000).toISOString();
  x.recordTrade('mint',{wallet:'wallet-a',side:'buy',timestamp:now-1000,usdValue:5,tokenFirstSeenAt:first},first);
  assert.equal(x.analyse('mint').earlyBuyers,1);
});
test('does not count future-dated trades in a coordinated burst',()=>{
  let now=6000000;const x=new WalletIntelligence({clock:()=>now}),first=new Date(now-1000).toISOString();
  for(let i=0;i<5;i++)x.recordTrade('mint',{wallet:'future-'+i,side:'buy',timestamp:now+4000,usdValue:5},first);
  assert.equal(x.analyse('mint',first).coordinatedBurst,false);
});

test('repeat early buyers require early activity on at least two tokens', () => {
  let now=7000000;const x=new WalletIntelligence({clock:()=>now});
  const firstA=new Date(now-10000).toISOString(),firstB=new Date(now-10000).toISOString();
  x.recordTrade('mint-a',{wallet:'repeat-wallet',side:'buy',timestamp:now-9000,usdValue:5},firstA);
  x.recordTrade('mint-b',{wallet:'repeat-wallet',side:'buy',timestamp:now-8000,usdValue:5},firstB);
  assert.equal(x.analyse('mint-a',firstA).repeatEarlyBuyers,1);
  assert.equal(x.analyse('mint-b',firstB).repeatEarlyBuyers,1);
});
test('a wallet that trades a second token late is not counted as a repeat early buyer', () => {
  let now=8000000;const x=new WalletIntelligence({clock:()=>now});
  const firstA=new Date(now-10000).toISOString(),firstB=new Date(now-600000).toISOString();
  x.recordTrade('mint-a',{wallet:'late-wallet',side:'buy',timestamp:now-9000,usdValue:5},firstA);
  x.recordTrade('mint-b',{wallet:'late-wallet',side:'buy',timestamp:now-1000,usdValue:5},firstB);
  assert.equal(x.analyse('mint-a',firstA).repeatEarlyBuyers,0);
});
