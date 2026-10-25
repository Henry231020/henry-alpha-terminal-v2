/** HENRY ALPHA TERMINAL V2 pressure engine. Alert-only; never signs or submits transactions. */
const finite = (n) => n === null || n === undefined || n === '' ? null : (Number.isFinite(Number(n)) ? Number(n) : null);
function analysePressure({ trades = [], snapshots = [], liquidityUsd = null, holderConcentrationPct = null, walletRisk = 'unknown', now = Date.now() } = {}) {
  const validTrades = trades.filter(t => Number.isFinite(Number(t.timestamp)) && now >= Number(t.timestamp) && now - Number(t.timestamp) <= 300000 && ['buy','sell'].includes(String(t.side).toLowerCase()) && finite(t.usdValue) !== null && Number(t.usdValue) >= 0).map(t => ({ side: String(t.side).toLowerCase(), usdValue: Number(t.usdValue), timestamp: Number(t.timestamp) })).sort((a,b) => a.timestamp-b.timestamp);
  const recent = validTrades.filter(t => now - t.timestamp <= 60000);
  const prior = validTrades.filter(t => now - t.timestamp > 60000);
  const sum = (list) => list.reduce((a,t) => { a[t.side] += t.usdValue; a[t.side+'Count']++; return a; }, {buy:0,sell:0,buyCount:0,sellCount:0});
  const r = sum(recent), p = sum(prior), total = r.buy+r.sell, priorTotal = p.buy+p.sell;
  const imbalance = total > 0 ? (r.buy-r.sell)/total : null;
  const acceleration = priorTotal > 0 ? total/(priorTotal/4) : null;
  const prices = snapshots.filter(s => Number.isFinite(Number(s.timestamp)) && finite(s.priceUsd) > 0 && now >= Number(s.timestamp) && now-Number(s.timestamp) <= 600000).map(s => ({timestamp:Number(s.timestamp),priceUsd:Number(s.priceUsd)})).sort((a,b)=>a.timestamp-b.timestamp);
  const first = prices[0], last = prices[prices.length-1];
  const priceChangePct = first && last && first.priceUsd > 0 ? (last.priceUsd/first.priceUsd-1)*100 : null;
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
  let signal = 'WAIT', reasons = [];
  if (urgentDump) { signal = 'URGENT DUMP PRESSURE'; reasons.push('Strong sell imbalance and acceleration; no price-confirmation wait.'); }
  else if (buyAlert) { signal = 'BUY PRESSURE CONFIRMED (ALERT ONLY)'; reasons.push('Buy imbalance, acceleration, positive observed price change and all risk gates passed.'); }
  else {
    if (!enoughTrades) reasons.push('Insufficient recent trade count or USD volume.');
    if (!buyPressure && !sellPressure) reasons.push('No decisive buy/sell imbalance.');
    if (!accelerating) reasons.push('Pressure acceleration not confirmed.');
    if (buyPressure && !priceConfirmed) reasons.push('Positive price confirmation unavailable or absent.');
    if (!liquidityOk) reasons.push('Liquidity missing or below $10,000.');
    if (!concentrationOk) reasons.push('Holder concentration missing or at least 35%.');
    if (!walletOk) reasons.push('Wallet risk is not verified low.');
  }
  return { signal, asOf:new Date(now).toISOString(), metrics:{buyUsd:r.buy,sellUsd:r.sell,buyCount:r.buyCount,sellCount:r.sellCount,imbalancePct:imbalance===null?null:Number((imbalance*100).toFixed(2)),acceleration:acceleration===null?null:Number(acceleration.toFixed(2)),observedPriceChangePct:priceChangePct===null?null:Number(priceChangePct.toFixed(2)),liquidityUsd:liq,holderConcentrationPct:concentration}, gates:{enoughTrades,buyPressure,sellPressure,accelerating,priceConfirmed,liquidityOk,concentrationOk,walletRisk}, reasons, automaticTrading:false, dataQuality:{recentTradeCount:recent.length,snapshotCount:prices.length,note:'Heuristic alert, not a prediction. Unknown data never passes a risk gate.'} };
}
module.exports = { analysePressure };
