'use strict';

function numberOption(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function createPaperTrader(options = {}) {
  const startingBalanceUsd = numberOption(options.startingBalanceUsd);
  const positionSizeUsd = numberOption(options.positionSizeUsd);
  const stopLossPct = numberOption(options.stopLossPct);
  const takeProfitPct = numberOption(options.takeProfitPct);
  const trailingStopPct = numberOption(options.trailingStopPct);
  const dailyLossLimitUsd = numberOption(options.dailyLossLimitUsd);
  const maxOpenPositions = Math.floor(numberOption(options.maxOpenPositions) || 0);

  const valid = options.enabled === true &&
    startingBalanceUsd !== null && startingBalanceUsd > 0 &&
    positionSizeUsd !== null && positionSizeUsd > 0 && positionSizeUsd <= startingBalanceUsd &&
    stopLossPct !== null && stopLossPct > 0 && stopLossPct <= 100 &&
    takeProfitPct !== null && takeProfitPct > 0 && takeProfitPct <= 1000 &&
    trailingStopPct !== null && trailingStopPct >= 0 && trailingStopPct <= 100 &&
    dailyLossLimitUsd !== null && dailyLossLimitUsd > 0 &&
    maxOpenPositions >= 1 && maxOpenPositions <= 20;

  const enabled = Boolean(valid);
  const disabledReason = !options.enabled
    ? 'Paper trading is disabled by default'
    : valid ? null : 'Paper trading settings are incomplete or outside safe bounds';

  let cashUsd = startingBalanceUsd !== null && startingBalanceUsd > 0 ? startingBalanceUsd : 0;
  let realizedPnlUsd = 0;
  let dailyRealizedPnlUsd = 0;
  let currentDay = null;
  const positions = new Map();
  const history = [];

  function rollDay(now) {
    const day = new Date(now).toISOString().slice(0, 10);
    if (currentDay !== day) {
      currentDay = day;
      dailyRealizedPnlUsd = 0;
    }
  }

  function closePosition(position, priceUsd, now, reason) {
    const returnPct = (priceUsd / position.entryPriceUsd - 1) * 100;
    const pnlUsd = position.positionUsd * returnPct / 100;
    cashUsd += position.positionUsd + pnlUsd;
    realizedPnlUsd += pnlUsd;
    dailyRealizedPnlUsd += pnlUsd;
    positions.delete(position.mint);
    const event = {
      type: 'PAPER_SELL',
      mint: position.mint,
      reason,
      entryPriceUsd: position.entryPriceUsd,
      exitPriceUsd: priceUsd,
      positionUsd: position.positionUsd,
      pnlUsd: Number(pnlUsd.toFixed(4)),
      returnPct: Number(returnPct.toFixed(3)),
      openedAt: new Date(position.openedAt).toISOString(),
      closedAt: new Date(now).toISOString(),
      automaticTrading: false
    };
    history.unshift(event);
    if (history.length > 200) history.pop();
    return event;
  }

  function onMarketUpdate({ mint, priceUsd, analysis, now = Date.now() } = {}) {
    if (!enabled || typeof mint !== 'string' || !mint) return [];
    const price = numberOption(priceUsd);
    if (price === null || price <= 0 || !Number.isFinite(now)) return [];
    rollDay(now);
    const events = [];
    let position = positions.get(mint);

    if (position) {
      position.lastPriceUsd = price;
      position.highestPriceUsd = Math.max(position.highestPriceUsd, price);
      const returnPct = (price / position.entryPriceUsd - 1) * 100;
      let exitReason = null;
      if (returnPct <= -stopLossPct) exitReason = 'stop-loss';
      else if (returnPct >= takeProfitPct) exitReason = 'take-profit';
      else if (trailingStopPct > 0 && position.highestPriceUsd > position.entryPriceUsd &&
        price <= position.highestPriceUsd * (1 - trailingStopPct / 100)) exitReason = 'trailing-stop';
      if (exitReason) events.push(closePosition(position, price, now, exitReason));
      return events;
    }

    if (!analysis || analysis.signal !== 'BUY PRESSURE CONFIRMED (ALERT ONLY)') return events;
    if (dailyRealizedPnlUsd <= -dailyLossLimitUsd) return events;
    if (positions.size >= maxOpenPositions || cashUsd < positionSizeUsd) return events;
    const gates = analysis.gates || {};
    const allGatesPassed = ['enoughTrades','buyPressure','accelerating','priceConfirmed','liquidityOk','concentrationOk','creatorConcentrationOk','mintAuthorityOk','freezeAuthorityOk','mintInitializedOk','tokenProgramOk'].every(key => gates[key] === true) && gates.walletRisk === 'low';
    if (!allGatesPassed) return events;

    position = {
      mint,
      positionUsd: positionSizeUsd,
      entryPriceUsd: price,
      lastPriceUsd: price,
      highestPriceUsd: price,
      quantity: positionSizeUsd / price,
      openedAt: now
    };
    cashUsd -= positionSizeUsd;
    positions.set(mint, position);
    const event = {
      type: 'PAPER_BUY',
      mint,
      entryPriceUsd: price,
      positionUsd: positionSizeUsd,
      quantity: position.quantity,
      openedAt: new Date(now).toISOString(),
      automaticTrading: false
    };
    history.unshift(event);
    if (history.length > 200) history.pop();
    events.push(event);
    return events;
  }

  function summary() {
    let unrealizedPnlUsd = 0;
    let openValueUsd = 0;
    const openPositions = [...positions.values()].map(position => {
      const valueUsd = position.quantity * position.lastPriceUsd;
      const pnlUsd = valueUsd - position.positionUsd;
      openValueUsd += valueUsd;
      unrealizedPnlUsd += pnlUsd;
      return {
        mint: position.mint,
        positionUsd: position.positionUsd,
        entryPriceUsd: position.entryPriceUsd,
        lastPriceUsd: position.lastPriceUsd,
        highestPriceUsd: position.highestPriceUsd,
        unrealizedPnlUsd: Number(pnlUsd.toFixed(4)),
        returnPct: Number(((position.lastPriceUsd / position.entryPriceUsd - 1) * 100).toFixed(3)),
        openedAt: new Date(position.openedAt).toISOString()
      };
    });
    return {
      enabled,
      mode: 'paper-only',
      disabledReason,
      startingBalanceUsd: startingBalanceUsd || 0,
      cashUsd: Number(cashUsd.toFixed(4)),
      openValueUsd: Number(openValueUsd.toFixed(4)),
      realizedPnlUsd: Number(realizedPnlUsd.toFixed(4)),
      dailyRealizedPnlUsd: Number(dailyRealizedPnlUsd.toFixed(4)),
      unrealizedPnlUsd: Number(unrealizedPnlUsd.toFixed(4)),
      equityUsd: Number((cashUsd + openValueUsd).toFixed(4)),
      openPositions,
      recentHistory: history.slice(0, 25),
      config: enabled ? { positionSizeUsd, stopLossPct, takeProfitPct, trailingStopPct, dailyLossLimitUsd, maxOpenPositions } : null,
      note: 'Simulation uses observed market prices and excludes real execution, fees, slippage, priority fees and price impact. It never signs or submits transactions.',
      automaticTrading: false
    };
  }

  return { enabled, onMarketUpdate, summary };
}

function fromEnvironment(env = process.env) {
  return createPaperTrader({
    enabled: String(env.PAPER_TRADING_ENABLED || '').toLowerCase() === 'true',
    startingBalanceUsd: env.PAPER_STARTING_BALANCE_USD,
    positionSizeUsd: env.PAPER_POSITION_SIZE_USD,
    stopLossPct: env.PAPER_STOP_LOSS_PCT,
    takeProfitPct: env.PAPER_TAKE_PROFIT_PCT,
    trailingStopPct: env.PAPER_TRAILING_STOP_PCT,
    dailyLossLimitUsd: env.PAPER_DAILY_LOSS_LIMIT_USD,
    maxOpenPositions: env.PAPER_MAX_OPEN_POSITIONS
  });
}

module.exports = { createPaperTrader, fromEnvironment };
