/** HENRY ALPHA TERMINAL V2 pressure + trade-decision engine.
 * Signals are analytical suggestions only; this module never places orders.
 */
const finite = (n) => n === null || n === undefined || n === '' ? null : (Number.isFinite(Number(n)) ? Number(n) : null);

function ema(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const alpha = 2 / (period + 1);
  let value = values.slice(0, period).reduce((sum, n) => sum + n, 0) / period;
  for (const next of values.slice(period)) value = (next * alpha) + (value * (1 - alpha));
  return value;
}

function calculateRsi(values, period = 14) {
  if (!Array.isArray(values) || values.length <= period) return null;
  const changes = [];
  for (let i = 1; i < values.length; i++) changes.push(values[i] - values[i - 1]);
  const recent = changes.slice(-period);
  const gains = recent.reduce((sum, change) => sum + Math.max(0, change), 0) / period;
  const losses = recent.reduce((sum, change) => sum + Math.max(0, -change), 0) / period;
  if (losses === 0) return gains === 0 ? 50 : 100;
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

function analysePressure({ trades = [], snapshots = [], liquidityUsd = null, holderConcentrationPct = null, walletRisk = 'unknown', now = Date.now() } = {}) {
  const validTrades = trades.filter(t => Number.isFinite(Number(t.timestamp)) && now >= Number(t.timestamp) && now - Number(t.timestamp) <= 300000 && ['buy','sell'].includes(String(t.side).toLowerCase()) && finite(t.usdValue) !== null && Number(t.usdValue) >= 0).map(t => ({ side: String(t.side).toLowerCase(), usdValue: Number(t.usdValue), timestamp: Number(t.timestamp), wallet: typeof t.wallet === 'string' ? t.wallet : null })).sort((a,b) => a.timestamp-b.timestamp);
  const recent = validTrades.filter(t => now - t.timestamp <= 60000);
  const prior = validTrades.filter(t => now - t.timestamp > 60000);
  const sum = (list) => list.reduce((a,t) => { a[t.side] += t.usdValue; a[t.side+'Count']++; return a; }, {buy:0,sell:0,buyCount:0,sellCount:0});
  const r = sum(recent), p = sum(prior), total = r.buy+r.sell, priorTotal = p.buy+p.sell;
  const imbalance = total > 0 ? (r.buy-r.sell)/total : null;
  const acceleration = priorTotal > 0 ? total/(priorTotal/4) : null;
  const prices = snapshots.filter(s => Number.isFinite(Number(s.timestamp)) && finite(s.priceUsd) > 0 && now >= Number(s.timestamp) && now-Number(s.timestamp) <= 3600000).map(s => ({timestamp:Number(s.timestamp),priceUsd:Number(s.priceUsd)})).sort((a,b)=>a.timestamp-b.timestamp);
  const values = prices.map(s => s.priceUsd);
  const last = prices[prices.length-1] || null;
  const first = prices[0] || null;
  const priceSpanMs = first && last ? last.timestamp - first.timestamp : 0;
  const priceChangePct = first && last && priceSpanMs >= 15000 && first.priceUsd > 0 ? (last.priceUsd/first.priceUsd-1)*100 : null;
  const ema9 = ema(values, 9), ema20 = ema(values, 20), ema50 = ema(values, 50);
  const rsi14 = calculateRsi(values, 14);
  const indicatorsReady = ema9 !== null && ema20 !== null && ema50 !== null && rsi14 !== null;
  const priceFresh = Boolean(last && now - last.timestamp <= 120000);
  const liq = finite(liquidityUsd), concentration = finite(holderConcentrationPct);
  const enoughTrades = recent.length >= 8 && total >= 1000;
  const buyPressure = imbalance !== null && imbalance >= 0.25 && r.buyCount > r.sellCount;
  const sellPressure = imbalance !== null && imbalance <= -0.25 && r.sellCount > r.buyCount;
  const accelerating = acceleration !== null && acceleration >= 1.5;
  const priceConfirmed = priceChangePct !== null && priceChangePct > 0;
  const liquidityOk = liq !== null && liq >= 10000;
  const concentrationOk = concentration !== null && concentration < 35;
  const walletOk = walletRisk === 'low';
  const urgentDump = sellPressure && accelerating;
  const buyAlert = !urgentDump && enoughTrades && buyPressure && accelerating && priceConfirmed && liquidityOk && concentrationOk && walletOk;
  const bullishTrend = indicatorsReady && ema9 > ema20 && ema20 > ema50 && last.priceUsd > ema9;
  const bearishTrend = indicatorsReady && ema9 < ema20 && last.priceUsd < ema20;
  const overheatedReversal = indicatorsReady && rsi14 >= 80 && last.priceUsd < ema9;
  let signal = 'WAIT', reasons = [];
  if (urgentDump) { signal = 'URGENT DUMP PRESSURE'; reasons.push('Strong sell imbalance and acceleration; no price-confirmation wait.'); }
  else if (buyAlert) { signal = 'BUY PRESSURE CONFIRMED (ALERT ONLY)'; reasons.push('Buy imbalance, acceleration, positive observed price change and all existing risk gates passed.'); }
  else {
    if (!enoughTrades) reasons.push('Insufficient recent trade count or USD volume.');
    if (!buyPressure && !sellPressure) reasons.push('No decisive buy/sell imbalance.');
    if (!accelerating) reasons.push('Pressure acceleration not confirmed.');
    if (buyPressure && !priceConfirmed) reasons.push('Positive price confirmation unavailable or absent.');
    if (!liquidityOk) reasons.push('Liquidity missing or below $10,000.');
    if (!concentrationOk) reasons.push('Holder concentration missing or at least 35%.');
    if (!walletOk) reasons.push('Wallet risk is not verified low.');
  }

  let tradeAction = 'WAIT';
  const tradeReasons = [];
  if (!indicatorsReady) {
    tradeReasons.push('Building price history: EMA 9/20/50 and RSI 14 require at least 50 valid price observations.');
  } else if (!priceFresh) {
    tradeReasons.push('Latest price observation is stale; wait for a fresh market update.');
  } else if (urgentDump || bearishTrend || overheatedReversal) {
    tradeAction = 'SELL / EXIT WARNING';
    if (urgentDump) tradeReasons.push('Accelerating sell pressure detected.');
    if (bearishTrend) tradeReasons.push('Price is below EMA 20 and EMA 9 is below EMA 20.');
    if (overheatedReversal) tradeReasons.push('RSI is extremely high and price has fallen below EMA 9.');
  } else if (bullishTrend && rsi14 >= 50 && rsi14 <= 72 && enoughTrades && buyPressure && accelerating && liquidityOk && concentrationOk && walletOk) {
    tradeAction = 'BUY SETUP';
    tradeReasons.push('EMA 9 > EMA 20 > EMA 50, RSI is in the momentum band, buying pressure is accelerating, and the available risk gates passed.');
  } else {
    if (!bullishTrend) tradeReasons.push('Bullish EMA alignment is not confirmed.');
    if (rsi14 < 50 || rsi14 > 72) tradeReasons.push('RSI is outside the preferred entry band (50–72).');
    if (!enoughTrades || !buyPressure || !accelerating) tradeReasons.push('Recent trade flow does not confirm an accelerating buy entry.');
    if (!liquidityOk || !concentrationOk || !walletOk) tradeReasons.push('One or more liquidity, holder-concentration or wallet-risk checks did not pass.');
  }

  const entryPrice = tradeAction === 'BUY SETUP' && last ? last.priceUsd : null;
  const tradePlan = entryPrice ? {
    referenceEntryPrice: entryPrice,
    stopLossPrice: Number((entryPrice * 0.85).toPrecision(10)),
    takeProfit1Price: Number((entryPrice * 1.5).toPrecision(10)),
    takeProfit2Price: Number((entryPrice * 2).toPrecision(10)),
    stopLossPct: -15,
    takeProfit1Pct: 50,
    takeProfit2Pct: 100,
    note: 'Illustrative initial plan only; fixed thresholds require paper-trading validation and do not account for slippage, fees or sudden liquidity loss.'
  } : null;

  return {
    signal,
    tradeDecision: { action: tradeAction, reasons: tradeReasons, automaticTrading: false },
    tradePlan,
    indicators: {
      ema9: ema9 === null ? null : Number(ema9.toPrecision(10)),
      ema20: ema20 === null ? null : Number(ema20.toPrecision(10)),
      ema50: ema50 === null ? null : Number(ema50.toPrecision(10)),
      rsi14: rsi14 === null ? null : Number(rsi14.toFixed(2)),
      observations: values.length,
      ready: indicatorsReady,
      priceFresh
    },
    asOf:new Date(now).toISOString(),
    metrics:{buyUsd:r.buy,sellUsd:r.sell,buyCount:r.buyCount,sellCount:r.sellCount,imbalancePct:imbalance===null?null:Number((imbalance*100).toFixed(2)),acceleration:acceleration===null?null:Number(acceleration.toFixed(2)),observedPriceChangePct:priceChangePct===null?null:Number(priceChangePct.toFixed(2)),liquidityUsd:liq,holderConcentrationPct:concentration},
    gates:{enoughTrades,buyPressure,sellPressure,accelerating,priceConfirmed,liquidityOk,concentrationOk,walletRisk},
    reasons,
    automaticTrading:false,
    dataQuality:{recentTradeCount:recent.length,snapshotCount:prices.length,note:'Heuristic analysis, not a prediction. Unknown data never passes a risk gate.'}
  };
}
module.exports = { analysePressure, ema, calculateRsi };
