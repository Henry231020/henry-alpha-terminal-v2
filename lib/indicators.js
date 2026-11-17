'use strict';

// Indicators are calculated only from observed price samples. No missing candles
// or prices are invented. Samples are grouped into UTC one-minute buckets.
function normalizeSamples(samples) {
  const byTimestamp = new Map();
  for (const sample of Array.isArray(samples) ? samples : []) {
    const timestamp = Number(sample && sample.timestamp);
    const priceUsd = Number(sample && sample.priceUsd);
    if (!Number.isFinite(timestamp) || !Number.isFinite(priceUsd) || priceUsd <= 0) continue;
    byTimestamp.set(timestamp, { timestamp, priceUsd });
  }
  return [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp);
}

function buildMinuteCandles(samples) {
  const candles = new Map();
  for (const sample of normalizeSamples(samples)) {
    const timestamp = Math.floor(sample.timestamp / 60000) * 60000;
    let candle = candles.get(timestamp);
    if (!candle) {
      candle = { timestamp, open: sample.priceUsd, high: sample.priceUsd, low: sample.priceUsd, close: sample.priceUsd, samples: 0 };
      candles.set(timestamp, candle);
    }
    candle.high = Math.max(candle.high, sample.priceUsd);
    candle.low = Math.min(candle.low, sample.priceUsd);
    candle.close = sample.priceUsd;
    candle.samples++;
  }
  return [...candles.values()].sort((a, b) => a.timestamp - b.timestamp);
}

function calculateEma(values, period) {
  if (!Array.isArray(values) || !Number.isInteger(period) || period < 2 || values.length < period) return null;
  const seed = values.slice(0, period);
  if (seed.some(value => !Number.isFinite(value) || value <= 0)) return null;
  let ema = seed.reduce((sum, value) => sum + value, 0) / period;
  const alpha = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    if (!Number.isFinite(values[i]) || values[i] <= 0) return null;
    ema = values[i] * alpha + ema * (1 - alpha);
  }
  return Number(ema.toPrecision(12));
}

function calculateRsi(values, period = 14) {
  if (!Array.isArray(values) || !Number.isInteger(period) || period < 2 || values.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    if (!Number.isFinite(change)) return null;
    if (change > 0) gains += change;
    else losses -= change;
  }
  let averageGain = gains / period;
  let averageLoss = losses / period;
  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    if (!Number.isFinite(change)) return null;
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
  }
  if (averageLoss === 0) return averageGain === 0 ? 50 : 100;
  const relativeStrength = averageGain / averageLoss;
  return Number((100 - 100 / (1 + relativeStrength)).toFixed(2));
}

function calculateIndicators(samples) {
  const normalized = normalizeSamples(samples);
  const candles = buildMinuteCandles(normalized);
  const closes = candles.map(candle => candle.close);
  const firstAt = candles.length ? candles[0].timestamp : null;
  const lastAt = candles.length ? candles[candles.length - 1].timestamp : null;
  const spanMinutes = firstAt === null || lastAt === null ? 0 : Math.floor((lastAt - firstAt) / 60000) + 1;
  return {
    timeframe: '1m',
    source: 'UTC one-minute buckets aggregated from observed DexScreener price samples',
    sampleCount: normalized.length,
    candleCount: candles.length,
    spanMinutes,
    coveragePct: spanMinutes ? Number((candles.length / spanMinutes * 100).toFixed(1)) : 0,
    ema9: calculateEma(closes, 9),
    ema20: calculateEma(closes, 20),
    ema50: calculateEma(closes, 50),
    rsi14: calculateRsi(closes, 14),
    ema9Ready: closes.length >= 9,
    ema20Ready: closes.length >= 20,
    ema50Ready: closes.length >= 50,
    rsi14Ready: closes.length >= 15,
    candles: candles.slice(-60),
    note: 'Indicators are unavailable until enough observed samples exist. These are sampled-price candles, not exchange-native OHLCV.'
  };
}

module.exports = { normalizeSamples, buildMinuteCandles, calculateEma, calculateRsi, calculateIndicators };
