const { analysePressure } = require('./pressure-engine');
const MAX_TRADES = 5000;
const MAX_SNAPSHOTS = 1000;
const SNAPSHOT_RETENTION_MS = 60 * 60 * 1000;
const RISK_MAX_AGE_MS = 5 * 60 * 1000;
class PressureStore {
  constructor({ clock = () => Date.now() } = {}) { this.clock = clock; this.byMint = new Map(); }
  ensure(mint) { if (!this.byMint.has(mint)) this.byMint.set(mint, { trades: [], snapshots: [], risk: { liquidityUsd: null, holderConcentrationPct: null, walletRisk: 'unknown', riskCheckedAt: null } }); return this.byMint.get(mint); }
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
    const state = this.ensure(mint);
    // Do not count the same cached provider quote as a new price observation.
    if (state.snapshots.some(existing => existing.timestamp === timestamp)) return false;
    state.snapshots.push({ timestamp, priceUsd });
    state.snapshots.sort((a, b) => a.timestamp - b.timestamp);
    state.snapshots = state.snapshots.filter(s => this.clock() - s.timestamp <= SNAPSHOT_RETENTION_MS).slice(-MAX_SNAPSHOTS);
    return true;
  }
  updateLiquidity(mint, liquidityUsd) {
    const state = this.ensure(mint);
    state.risk.liquidityUsd = liquidityUsd !== null && liquidityUsd !== undefined && liquidityUsd !== '' &&
      Number.isFinite(Number(liquidityUsd)) && Number(liquidityUsd) >= 0
      ? Number(liquidityUsd)
      : null;
  }
  updateHolderRisk(mint, risk = {}) {
    const state = this.ensure(mint);
    const value = risk.holderConcentrationPct;
    state.risk.holderConcentrationPct = value !== null && value !== undefined && value !== '' &&
      Number.isFinite(Number(value)) && Number(value) >= 0
      ? Number(value)
      : null;
    state.risk.walletRisk = ['low','medium','high','unknown'].includes(risk.walletRisk)
      ? risk.walletRisk
      : 'unknown';
    const checkedAt = risk.checkedAt == null ? this.clock() : (typeof risk.checkedAt === 'string' ? Date.parse(risk.checkedAt) : Number(risk.checkedAt));
    state.risk.riskCheckedAt = Number.isFinite(checkedAt) && checkedAt <= this.clock() + 5000 ? checkedAt : null;
  }
  setRisk(mint, risk = {}, observedAt = null) {
    const state = this.ensure(mint);
    for (const key of ['liquidityUsd','holderConcentrationPct']) {
      const value = risk[key];
      state.risk[key] = value !== null && value !== undefined && value !== '' &&
        Number.isFinite(Number(value)) && Number(value) >= 0
        ? Number(value)
        : null;
    }
    state.risk.walletRisk = ['low','medium','high','unknown'].includes(risk.walletRisk) ? risk.walletRisk : 'unknown';
    const rawCheckedAt = risk.checkedAt ?? observedAt ?? this.clock();
    const checkedAt = typeof rawCheckedAt === 'string' ? Date.parse(rawCheckedAt) : Number(rawCheckedAt);
    state.risk.riskCheckedAt = Number.isFinite(checkedAt) && checkedAt <= this.clock() + 5000 ? checkedAt : null;
  }
  restoreObservation(mint, kind, observedAt, payload) {
    if (!mint || !payload || !['trade','snapshot','risk'].includes(kind)) return false;
    if (kind === 'trade') return this.recordTrade(mint, { ...payload, timestamp: Number(payload.timestamp ?? new Date(observedAt).getTime()) });
    if (kind === 'snapshot') return this.recordSnapshot(mint, { ...payload, timestamp: Number(payload.timestamp ?? new Date(observedAt).getTime()) });
    if (kind === 'risk') { this.setRisk(mint, payload, new Date(observedAt).getTime()); return true; }
    return false;
  }
  analyse(mint) { const state = this.byMint.get(mint); if (!state) return { signal:'WAIT', tradeDecision:{action:'WAIT',reasons:['No collected trade or market data yet.'],automaticTrading:false}, indicators:{ready:false,observations:0,ema9:null,ema20:null,ema50:null,rsi14:null}, reasons:['No collected trade or market data yet.'], automaticTrading:false, dataQuality:{recentTradeCount:0,snapshotCount:0} }; const riskFresh = state.risk.riskCheckedAt !== null && this.clock() - state.risk.riskCheckedAt >= 0 && this.clock() - state.risk.riskCheckedAt <= RISK_MAX_AGE_MS; return analysePressure({ ...state.risk, holderConcentrationPct: riskFresh ? state.risk.holderConcentrationPct : null, walletRisk: riskFresh ? state.risk.walletRisk : 'unknown', trades:state.trades, snapshots:state.snapshots, now:this.clock() }); }
  getStats() { let tradeCount=0, snapshotCount=0; for (const s of this.byMint.values()) { tradeCount+=s.trades.length; snapshotCount+=s.snapshots.length; } return { tokens:this.byMint.size, tradeCount, snapshotCount, snapshotRetentionMinutes:60, riskMaxAgeMinutes:5, persistence:'in-memory analysis; PostgreSQL recovery depends on configured database', automaticTrading:false }; }
}
module.exports = { PressureStore, RISK_MAX_AGE_MS };
