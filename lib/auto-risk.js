'use strict';

// Fail-closed trade policy. Paper mode is the default; live mode requires
// explicit server-side enablement plus all independent risk checks.
const DEFAULTS = Object.freeze({
  mode: 'paper',
  enabled: false,
  maxBuySol: 0.02,
  maxOpenPositions: 2,
  maxDailyLossSol: 0.05,
  stopLossPct: 20,
  takeProfitPct: 50,
  maxSlippageBps: 100,
  minLiquidityUsd: 10000,
  maxTop10ConcentrationPct: 35,
  maxMarketDataAgeMs: 15000,
  cooldownMs: 60000
});

function readConfig(env = process.env) {
  const number = (key, fallback) => {
    const value = Number(env[key]);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };
  const mode = env.TRADING_MODE === 'live' ? 'live' : 'paper';
  return Object.freeze({
    ...DEFAULTS,
    mode,
    enabled: env.AUTO_TRADING_ENABLED === 'true' && mode === 'live',
    maxBuySol: number('MAX_BUY_SOL', DEFAULTS.maxBuySol),
    maxOpenPositions: Math.max(1, Math.floor(number('MAX_OPEN_POSITIONS', DEFAULTS.maxOpenPositions))),
    maxDailyLossSol: number('MAX_DAILY_LOSS_SOL', DEFAULTS.maxDailyLossSol),
    stopLossPct: number('STOP_LOSS_PCT', DEFAULTS.stopLossPct),
    takeProfitPct: number('TAKE_PROFIT_PCT', DEFAULTS.takeProfitPct),
    maxSlippageBps: Math.min(500, Math.floor(number('MAX_SLIPPAGE_BPS', DEFAULTS.maxSlippageBps))),
    minLiquidityUsd: number('MIN_LIQUIDITY_USD', DEFAULTS.minLiquidityUsd),
    maxTop10ConcentrationPct: number('MAX_TOP10_CONCENTRATION_PCT', DEFAULTS.maxTop10ConcentrationPct),
    maxMarketDataAgeMs: number('MAX_MARKET_DATA_AGE_MS', DEFAULTS.maxMarketDataAgeMs),
    cooldownMs: number('TRADE_COOLDOWN_MS', DEFAULTS.cooldownMs)
  });
}

function evaluateBuy({ token, analysis, risk, openPositions = 0, dailyRealizedLossSol = 0, lastTradeAt = 0, now = Date.now(), config = DEFAULTS }) {
  const reasons = [];
  if (config.mode === 'live' && !config.enabled) reasons.push('Live trading is not explicitly enabled.');
  if (!token || !token.mint) reasons.push('Token identity is missing.');
  if (!analysis || analysis.signal !== 'BUY PRESSURE CONFIRMED (ALERT ONLY)') reasons.push('Buy-pressure signal is not confirmed.');
  const liquidity = Number(token && token.liquidityUsd);
  if (!Number.isFinite(liquidity) || liquidity < config.minLiquidityUsd) reasons.push('Liquidity is missing or below the configured minimum.');
  const price = Number(token && token.priceUsd);
  if (!Number.isFinite(price) || price <= 0) reasons.push('Current token price is missing or invalid.');
  const updatedAt = Date.parse(token && (token.updatedAt || token.checkedAt) || '');
  if (!Number.isFinite(updatedAt) || now - updatedAt > config.maxMarketDataAgeMs || updatedAt > now + 5000) reasons.push('Market data is stale or has no trustworthy timestamp.');
  if (!risk || risk.status !== 'observed') reasons.push('Complete holder data is unavailable.');
  const concentration = Number(risk && risk.top10ConcentrationPct);
  if (!Number.isFinite(concentration) || concentration > config.maxTop10ConcentrationPct) reasons.push('Top-10 holder concentration is missing or above the configured maximum.');
  if (!analysis || !analysis.gates || analysis.gates.walletRisk !== 'low') reasons.push('Wallet/creator risk is not independently verified low.');
  if (openPositions >= config.maxOpenPositions) reasons.push('Maximum open-position count reached.');
  if (dailyRealizedLossSol >= config.maxDailyLossSol) reasons.push('Daily loss limit reached.');
  if (lastTradeAt && now - lastTradeAt < config.cooldownMs) reasons.push('Trade cooldown is active.');
  return {
    allowed: reasons.length === 0 && (config.mode !== 'live' || config.enabled),
    mode: config.mode,
    reasons,
    maxBuySol: config.maxBuySol,
    stopLossPct: config.stopLossPct,
    takeProfitPct: config.takeProfitPct,
    maxSlippageBps: config.maxSlippageBps
  };
}

function evaluateExit({ entryPriceUsd, currentPriceUsd, config = DEFAULTS }) {
  const entry = Number(entryPriceUsd), current = Number(currentPriceUsd);
  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(current) || current <= 0) {
    return { shouldExit: false, reason: 'Price data unavailable; do not fabricate an exit.' };
  }
  const changePct = (current / entry - 1) * 100;
  if (changePct <= -config.stopLossPct) return { shouldExit: true, reason: 'STOP_LOSS', changePct };
  if (changePct >= config.takeProfitPct) return { shouldExit: true, reason: 'TAKE_PROFIT', changePct };
  return { shouldExit: false, reason: 'HOLD', changePct };
}

module.exports = { DEFAULTS, readConfig, evaluateBuy, evaluateExit };
