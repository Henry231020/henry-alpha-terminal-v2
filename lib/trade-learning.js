'use strict';

// Paper-only feedback loop. It records the conditions behind each simulated
// entry and exit; it never submits or signs a transaction.
const MAX_CLOSED_TRADES = 5000;
const STOP_LOSS_PCT = -15;
const TAKE_PROFIT_PCT = 50;

class TradeLearningEngine {
  constructor({ clock = () => Date.now(), maxClosedTrades = MAX_CLOSED_TRADES } = {}) {
    this.clock = clock;
    this.maxClosedTrades = maxClosedTrades;
    this.openByMint = new Map();
    this.closed = [];
    this.lastDecisionAt = new Map();
  }

  observe({ mint, analysis, priceUsd, timestamp = this.clock() } = {}) {
    if (typeof mint !== 'string' || !mint || !analysis || !Number.isFinite(Number(priceUsd)) || Number(priceUsd) <= 0) {
      return { accepted: false, reason: 'Missing mint, analysis or valid market price.' };
    }
    const at = Number(timestamp);
    if (!Number.isFinite(at) || at > this.clock() + 5000) return { accepted: false, reason: 'Invalid observation timestamp.' };
    const priorAt = this.lastDecisionAt.get(mint) || 0;
    if (at <= priorAt) return { accepted: false, reason: 'Duplicate or out-of-order observation.' };
    this.lastDecisionAt.set(mint, at);

    const price = Number(priceUsd);
    const open = this.openByMint.get(mint);
    if (open) {
      const pnlPct = (price / open.entryPrice - 1) * 100;
      let exitReason = null;
      if (pnlPct <= STOP_LOSS_PCT) exitReason = 'Paper stop-loss threshold reached (-15%).';
      else if (pnlPct >= TAKE_PROFIT_PCT) exitReason = 'Paper take-profit threshold reached (+50%).';
      else if (analysis.tradeDecision?.action === 'SELL / EXIT WARNING') {
        exitReason = (analysis.tradeDecision.reasons || []).join(' ') || 'SELL / EXIT WARNING observed.';
      }
      if (exitReason) return { accepted: true, trade: this.close(mint, price, at, exitReason, analysis) };
      return { accepted: true, trade: null, status: 'paper position remains open' };
    }

    if (analysis.tradeDecision?.action !== 'BUY SETUP') return { accepted: true, trade: null, status: 'no paper entry' };
    const indicators = analysis.indicators || {};
    const metrics = analysis.metrics || {};
    const gates = analysis.gates || {};
    if (!indicators.ready || indicators.priceFresh !== true || !Object.values(gates).every(v => v === true || v === 'low')) {
      return { accepted: true, trade: null, status: 'BUY setup rejected by paper-learning data-quality gate' };
    }
    const entry = {
      id: mint + ':' + at,
      mint,
      entryAt: at,
      entryPrice: price,
      entryReasons: [...(analysis.tradeDecision.reasons || [])],
      entryConditions: {
        ema9: indicators.ema9 ?? null,
        ema20: indicators.ema20 ?? null,
        ema50: indicators.ema50 ?? null,
        rsi14: indicators.rsi14 ?? null,
        observations: indicators.observations ?? 0,
        buyUsd: metrics.buyUsd ?? null,
        sellUsd: metrics.sellUsd ?? null,
        buyCount: metrics.buyCount ?? null,
        sellCount: metrics.sellCount ?? null,
        imbalancePct: metrics.imbalancePct ?? null,
        acceleration: metrics.acceleration ?? null,
        liquidityUsd: metrics.liquidityUsd ?? null,
        holderConcentrationPct: metrics.holderConcentrationPct ?? null,
        walletRisk: gates.walletRisk ?? 'unknown'
      }
    };
    this.openByMint.set(mint, entry);
    return { accepted: true, trade: { ...entry, status: 'paper entry opened', automaticTrading: false } };
  }

  close(mint, exitPrice, exitAt, exitReason, analysis = {}) {
    const open = this.openByMint.get(mint);
    if (!open) return null;
    const pnlPct = (exitPrice / open.entryPrice - 1) * 100;
    const closed = {
      ...open,
      exitAt,
      exitPrice,
      exitReason,
      exitConditions: {
        action: analysis.tradeDecision?.action || 'PRICE THRESHOLD',
        reasons: [...(analysis.tradeDecision?.reasons || [])],
        rsi14: analysis.indicators?.rsi14 ?? null,
        ema9: analysis.indicators?.ema9 ?? null,
        ema20: analysis.indicators?.ema20 ?? null,
        ema50: analysis.indicators?.ema50 ?? null
      },
      pnlPct: Number(pnlPct.toFixed(4)),
      outcome: pnlPct > 0 ? 'WIN' : pnlPct < 0 ? 'LOSS' : 'BREAKEVEN',
      status: 'closed paper trade',
      automaticTrading: false
    };
    this.openByMint.delete(mint);
    this.closed.push(closed);
    if (this.closed.length > this.maxClosedTrades) this.closed.splice(0, this.closed.length - this.maxClosedTrades);
    return closed;
  }

  restoreTrade(trade) {
    if (!trade || typeof trade.mint !== 'string' || !trade.mint || !Number.isFinite(Number(trade.entryPrice)) || Number(trade.entryPrice) <= 0) return false;
    const entryAt = Number(trade.entryAt);
    if (!Number.isFinite(entryAt)) return false;
    this.lastDecisionAt.set(trade.mint, Math.max(this.lastDecisionAt.get(trade.mint) || 0, Number(trade.exitAt) || entryAt));
    if (trade.status === 'open paper trade' || (!trade.exitAt && !trade.exitPrice)) {
      this.openByMint.set(trade.mint, trade);
      return true;
    }
    if (!Number.isFinite(Number(trade.exitPrice)) || !Number.isFinite(Number(trade.pnlPct))) return false;
    this.closed.push(trade);
    if (this.closed.length > this.maxClosedTrades) this.closed.splice(0, this.closed.length - this.maxClosedTrades);
    return true;
  }

  summary(limit = 50) {
    const wins = this.closed.filter(t => t.outcome === 'WIN');
    const losses = this.closed.filter(t => t.outcome === 'LOSS');
    const count = this.closed.length;
    const average = list => list.length ? Number((list.reduce((sum, t) => sum + t.pnlPct, 0) / list.length).toFixed(4)) : null;
    const recent = this.closed.slice(-Math.max(1, Math.min(200, Number(limit) || 50))).reverse();
    const conditionStats = {};
    for (const trade of this.closed) {
      const rsi = trade.entryConditions.rsi14;
      const band = rsi === null ? 'unknown' : rsi < 60 ? '50-59' : rsi < 70 ? '60-69' : '70+';
      const key = 'entry RSI ' + band;
      conditionStats[key] ||= { trades: 0, wins: 0, losses: 0, averagePnlPct: 0 };
      const row = conditionStats[key];
      row.trades++;
      if (trade.outcome === 'WIN') row.wins++;
      if (trade.outcome === 'LOSS') row.losses++;
      row.averagePnlPct += trade.pnlPct;
    }
    for (const row of Object.values(conditionStats)) row.averagePnlPct = Number((row.averagePnlPct / row.trades).toFixed(4));
    return {
      mode: 'paper learning only',
      closedTrades: count,
      openPaperPositions: this.openByMint.size,
      wins: wins.length,
      losses: losses.length,
      breakeven: count - wins.length - losses.length,
      winRatePct: count ? Number((wins.length / count * 100).toFixed(2)) : null,
      averagePnlPct: average(this.closed),
      averageWinPct: average(wins),
      averageLossPct: average(losses),
      conditionStats,
      recentTrades: recent,
      openPositions: [...this.openByMint.values()].map(t => ({ ...t, status: 'open paper trade' })),
      learningNote: count < 20
        ? 'Early sample: fewer than 20 closed paper trades. Do not change strategy rules from this sample.'
        : 'Descriptive historical patterns only. Review sample size and market conditions; no automatic strategy changes are made.',
      automaticTrading: false
    };
  }
}

module.exports = { TradeLearningEngine, STOP_LOSS_PCT, TAKE_PROFIT_PCT };
