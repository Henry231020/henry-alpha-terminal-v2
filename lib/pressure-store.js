const { analysePressure } = require('./pressure-engine');
const MAX_TRADES = 5000;
const MAX_SNAPSHOTS = 1000;
const MAX_TRACKED_MINTS = 2000;
const SNAPSHOT_RETENTION_MS = 60 * 60 * 1000;
const RISK_MAX_AGE_MS = 5 * 60 * 1000;
const LIQUIDITY_MAX_AGE_MS = 2 * 60 * 1000;
class PressureStore {
  constructor({ clock = () => Date.now() } = {}) { this.clock = clock; this.byMint = new Map(); }
  ensure(mint) {
    if (this.byMint.has(mint)) {
      // Refresh active mints so memory pressure evicts least-recently-used state.
      const existing = this.byMint.get(mint);
      this.byMint.delete(mint);
      this.byMint.set(mint, existing);
      return existing;
    }
    if (this.byMint.size >= MAX_TRACKED_MINTS) this.byMint.delete(this.byMint.keys().next().value);
    const state = { trades: [], snapshots: [], risk: { liquidityUsd: null, liquidityCheckedAt: null, holderConcentrationPct: null, walletRisk: 'unknown', riskCheckedAt: null } };
    this.byMint.set(mint, state);
    return state;
  }
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
  updateLiquidity(mint, liquidityUsd, observedAt = this.clock()) {
    const state = this.ensure(mint);
    const checkedAt = typeof observedAt === 'string' ? Date.parse(observedAt) : Number(observedAt);
    state.risk.liquidityUsd = liquidityUsd !== null && liquidityUsd !== undefined && liquidityUsd !== '' &&
      Number.isFinite(Number(liquidityUsd)) && Number(liquidityUsd) >= 0
      ? Number(liquidityUsd)
      : null;
    state.risk.liquidityCheckedAt = Number.isFinite(checkedAt) && checkedAt <= this.clock() + 5000 ? checkedAt : null;
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
    state.risk.liquidityCheckedAt = state.risk.riskCheckedAt;
  }
  restoreObservation(mint, kind, observedAt, payload) {
    if (!mint || !payload || !['trade','snapshot','risk'].includes(kind)) return false;
    if (kind === 'trade') return this.recordTrade(mint, { ...payload, timestamp: Number(payload.timestamp ?? new Date(observedAt).getTime()) });
    if (kind === 'snapshot') return this.recordSnapshot(mint, { ...payload, timestamp: Number(payload.timestamp ?? new Date(observedAt).getTime()) });
    if (kind === 'risk') { this.setRisk(mint, payload, new Date(observedAt).getTime()); return true; }
    return false;
  }
  analyse(mint) {
    const state = this.byMint.get(mint);
    if (!state) return { signal:'WAIT', tradeDecision:{action:'WAIT',reasons:['No collected trade or market data yet.'],automaticTrading:false}, indicators:{ready:false,observations:0,ema9:null,ema20:null,ema50:null,rsi14:null}, reasons:['No collected trade or market data yet.'], automaticTrading:false, dataQuality:{recentTradeCount:0,snapshotCount:0} };
    const now = this.clock();
    const riskAge = state.risk.riskCheckedAt === null ? Infinity : now - state.risk.riskCheckedAt;
    const riskFresh = riskAge >= 0 && riskAge <= RISK_MAX_AGE_MS;
    const liquidityAge = state.risk.liquidityCheckedAt === null ? Infinity : now - state.risk.liquidityCheckedAt;
    const liquidityFresh = liquidityAge >= 0 && liquidityAge <= LIQUIDITY_MAX_AGE_MS;
    return analysePressure({
      ...state.risk,
      liquidityUsd: liquidityFresh ? state.risk.liquidityUsd : null,
      holderConcentrationPct: riskFresh ? state.risk.holderConcentrationPct : null,
      walletRisk: riskFresh ? state.risk.walletRisk : 'unknown',
      trades: state.trades,
      snapshots: state.snapshots,
      now
    });
  }
  getStats() { let tradeCount=0, snapshotCount=0; for (const s of this.byMint.values()) { tradeCount+=s.trades.length; snapshotCount+=s.snapshots.length; } return { tokens:this.byMint.size, tradeCount, snapshotCount, snapshotRetentionMinutes:60, maxTrackedMints:MAX_TRACKED_MINTS, riskMaxAgeMinutes:5, liquidityMaxAgeMinutes:2, persistence:'in-memory analysis; PostgreSQL recovery depends on configured database', automaticTrading:false }; }
}
module.exports = { PressureStore, RISK_MAX_AGE_MS, LIQUIDITY_MAX_AGE_MS, MAX_TRACKED_MINTS };
