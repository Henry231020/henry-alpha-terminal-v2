const { analysePressure } = require('./pressure-engine');
const MAX_TRADES = 5000;
const MAX_SNAPSHOTS = 1000;
class PressureStore {
  constructor({ clock = () => Date.now() } = {}) { this.clock = clock; this.byMint = new Map(); }
  ensure(mint) { if (!this.byMint.has(mint)) this.byMint.set(mint, { trades: [], snapshots: [], risk: { liquidityUsd: null, holderConcentrationPct: null, walletRisk: 'unknown' } }); return this.byMint.get(mint); }
  recordTrade(mint, trade) {
    if (!mint || !trade || !['buy','sell'].includes(String(trade.side).toLowerCase())) return false;
    const timestamp = Number(trade.timestamp); const usdValue = Number(trade.usdValue);
    if (!Number.isFinite(timestamp) || !Number.isFinite(usdValue) || usdValue < 0 || timestamp > this.clock() + 5000) return false;
    const state = this.ensure(mint); state.trades.push({ side: String(trade.side).toLowerCase(), usdValue, timestamp, wallet: typeof trade.wallet === 'string' ? trade.wallet : null });
    state.trades = state.trades.filter(t => this.clock() - t.timestamp <= 300000).slice(-MAX_TRADES); return true;
  }
  recordSnapshot(mint, snapshot) {
    if (!mint || !snapshot) return false; const timestamp = Number(snapshot.timestamp); const priceUsd = Number(snapshot.priceUsd);
    if (!Number.isFinite(timestamp) || !Number.isFinite(priceUsd) || priceUsd <= 0 || timestamp > this.clock() + 5000) return false;
    const state = this.ensure(mint); state.snapshots.push({ timestamp, priceUsd }); state.snapshots = state.snapshots.filter(s => this.clock() - s.timestamp <= 600000).slice(-MAX_SNAPSHOTS); return true;
  }
  setRisk(mint, risk = {}) {
    const state = this.ensure(mint);
    for (const key of ['liquidityUsd','holderConcentrationPct']) { const value = risk[key]; if (value === null || value === undefined) state.risk[key] = null; else if (Number.isFinite(Number(value)) && Number(value) >= 0) state.risk[key] = Number(value); }
    state.risk.walletRisk = ['low','medium','high','unknown'].includes(risk.walletRisk) ? risk.walletRisk : 'unknown';
  }
  analyse(mint) { const state = this.byMint.get(mint); if (!state) return { signal:'WAIT', reasons:['No collected trade or market data yet.'], automaticTrading:false, dataQuality:{recentTradeCount:0,snapshotCount:0} }; return analysePressure({ ...state.risk, trades:state.trades, snapshots:state.snapshots, now:this.clock() }); }
  getStats() { let tradeCount=0, snapshotCount=0; for (const s of this.byMint.values()) { tradeCount+=s.trades.length; snapshotCount+=s.snapshots.length; } return { tokens:this.byMint.size, tradeCount, snapshotCount, persistence:'memory-only; restart clears observations', automaticTrading:false }; }
}
module.exports = { PressureStore };
