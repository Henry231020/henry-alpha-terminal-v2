'use strict';
const MAX_TOKENS = 2000, MAX_WALLETS = 20000, MAX_WALLET_PAIRS = 100000, EARLY_WINDOW_MS = 300000, BURST_WINDOW_MS = 10000;
class WalletIntelligence {
  constructor({ clock = () => Date.now(), maxWalletPairs = MAX_WALLET_PAIRS, maxWalletsPerMint = 2000 } = {}) {
    this.clock = clock;
    this.maxWalletPairs = Math.max(1, Number(maxWalletPairs) || MAX_WALLET_PAIRS);
    this.maxWalletsPerMint = Math.max(1, Number(maxWalletsPerMint) || 2000);
    this.byMint = new Map();
    this.wallets = new Map();
    // Global insertion/LRU order bounds the combined mint-wallet rows, not just
    // each individual token map. A busy launch cannot multiply memory without limit.
    this.walletPairOrder = new Map();
  }
  pairKey(mint, wallet) { return mint + '\\u0000' + wallet; }
  removePair(key) {
    const split = key.indexOf('\\u0000');
    if (split < 0) return;
    const mint = key.slice(0, split), wallet = key.slice(split + 1);
    this.byMint.get(mint)?.wallets.delete(wallet);
    this.walletPairOrder.delete(key);
  }
  touchPair(mint, wallet) {
    const key = this.pairKey(mint, wallet);
    this.walletPairOrder.delete(key);
    this.walletPairOrder.set(key, true);
  }
  recordTrade(mint, trade, tokenFirstSeenAt) {
    if (!mint || !trade || typeof trade.wallet !== 'string' || !trade.wallet.trim()) return false;
    const wallet = trade.wallet.trim(), timestamp = Number(trade.timestamp), side = String(trade.side || '').toLowerCase();
    if (!Number.isFinite(timestamp) || timestamp > this.clock() + 5000 || !['buy','sell'].includes(side)) return false;
    if (!this.byMint.has(mint)) { if (this.byMint.size >= MAX_TOKENS) this.byMint.delete(this.byMint.keys().next().value); this.byMint.set(mint,{wallets:new Map(),burst:[],tokenFirstSeenAt:null}); }
    const state = this.byMint.get(mint);
    const firstSeen = Date.parse(tokenFirstSeenAt || '');
    if (Number.isFinite(firstSeen) && (!Number.isFinite(state.tokenFirstSeenAt) || firstSeen < state.tokenFirstSeenAt)) state.tokenFirstSeenAt = firstSeen;
    if (!state.wallets.has(wallet)) {
      while (this.walletPairOrder.size >= this.maxWalletPairs) {
        const oldest = this.walletPairOrder.keys().next().value;
        if (oldest === undefined) break;
        this.removePair(oldest);
      }
      while (state.wallets.size >= this.maxWalletsPerMint) {
        const oldestWallet = state.wallets.keys().next().value;
        if (oldestWallet === undefined) break;
        this.removePair(this.pairKey(mint, oldestWallet));
      }
    }
    const row = state.wallets.get(wallet) || {wallet,firstTradeAt:timestamp,firstBuyAt:null,buys:0,sells:0,buyUsd:0,sellUsd:0};
    row.firstTradeAt = Math.min(row.firstTradeAt,timestamp);
    if (side === 'buy') { row.buys++; row.buyUsd += Math.max(0,Number(trade.usdValue)||0); row.firstBuyAt = row.firstBuyAt === null ? timestamp : Math.min(row.firstBuyAt, timestamp); }
    else { row.sells++; row.sellUsd += Math.max(0,Number(trade.usdValue)||0); }
    state.wallets.set(wallet,row);
    this.touchPair(mint, wallet);
    let global=this.wallets.get(wallet);
    if(!global){if(this.wallets.size>=MAX_WALLETS)this.wallets.delete(this.wallets.keys().next().value);global={tokens:new Set(),earlyTokens:new Set(),buys:0,sells:0,firstSeenAt:timestamp,lastSeenAt:timestamp};this.wallets.set(wallet,global);}
    if (!global.tokens.has(mint) && global.tokens.size >= 100) global.tokens.delete(global.tokens.values().next().value);
    global.tokens.add(mint); global.buys += side==='buy'?1:0; global.sells += side==='sell'?1:0;
    const tokenStart = state.tokenFirstSeenAt;
    if (side === 'buy' && Number.isFinite(tokenStart) && timestamp >= tokenStart && timestamp <= tokenStart + EARLY_WINDOW_MS) {
      if (!global.earlyTokens.has(mint) && global.earlyTokens.size >= 100) global.earlyTokens.delete(global.earlyTokens.values().next().value);
      global.earlyTokens.add(mint);
    }
    global.firstSeenAt=Math.min(global.firstSeenAt,timestamp); global.lastSeenAt=Math.max(global.lastSeenAt,timestamp);
    state.burst.push({wallet,timestamp,side}); state.burst.sort((a,b)=>a.timestamp-b.timestamp); state.burst=state.burst.filter(x=>this.clock()-x.timestamp<=BURST_WINDOW_MS && x.timestamp<=this.clock()+5000).slice(-500);
    return true;
  }
  analyse(mint, tokenFirstSeenAt) {
    const state=this.byMint.get(mint);
    if(!state)return {uniqueBuyers:0,earlyBuyers:0,repeatEarlyBuyers:0,observedWallets:0,coordinatedBurst:false,burstBuyerCount:0,wallets:[],coverage:'No wallet-labelled trade observations yet.'};
    const suppliedFirstSeen=Date.parse(tokenFirstSeenAt||''), firstSeen=Number.isFinite(suppliedFirstSeen)&&Number.isFinite(state.tokenFirstSeenAt)?Math.min(suppliedFirstSeen,state.tokenFirstSeenAt):Number.isFinite(suppliedFirstSeen)?suppliedFirstSeen:state.tokenFirstSeenAt, rows=[...state.wallets.values()], buyers=rows.filter(x=>x.buys>0);
    const early=Number.isFinite(firstSeen)?buyers.filter(x=>x.firstBuyAt!==null&&x.firstBuyAt>=firstSeen&&x.firstBuyAt<=firstSeen+EARLY_WINDOW_MS):[];
    const repeat=early.filter(x=>(this.wallets.get(x.wallet)?.earlyTokens.size||0)>=2);
    const now=this.clock(), burst=state.burst.filter(x=>x.timestamp<=now+5000&&now-x.timestamp>=0&&now-x.timestamp<=BURST_WINDOW_MS&&x.side==='buy'), distinct=new Set(burst.map(x=>x.wallet));
    return {uniqueBuyers:buyers.length,earlyBuyers:early.length,repeatEarlyBuyers:repeat.length,observedWallets:rows.length,coordinatedBurst:distinct.size>=5,burstBuyerCount:distinct.size,
      wallets:early.sort((a,b)=>(a.firstBuyAt||Infinity)-(b.firstBuyAt||Infinity)).slice(0,10).map(x=>({wallet:x.wallet,firstBuyAt:new Date(x.firstBuyAt).toISOString(),buys:x.buys,sells:x.sells,tokensSeen:this.wallets.get(x.wallet)?.tokens.size||1,earlyTokensSeen:this.wallets.get(x.wallet)?.earlyTokens.size||1})),
      coverage:Number.isFinite(firstSeen)?'Observed wallet-labelled trades since this server began tracking the token; not complete on-chain history.':'Token first-seen time unavailable; early-buyer classification withheld.'};
  }
}
module.exports={WalletIntelligence,EARLY_WINDOW_MS,BURST_WINDOW_MS,MAX_WALLET_PAIRS};
