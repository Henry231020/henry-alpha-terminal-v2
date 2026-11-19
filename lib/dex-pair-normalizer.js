'use strict';

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function finiteNonNegative(value) {
  const number = finiteNumber(value);
  return number !== null && number >= 0 ? number : null;
}

function finitePositive(value) {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? number : null;
}

function selectPairForMint(pairs, mint) {
  if (!Array.isArray(pairs) || typeof mint !== 'string' || !mint) return null;
  const target = mint.toLowerCase();
  const matches = pairs.filter(pair =>
    String(pair?.baseToken?.address || '').toLowerCase() === target ||
    String(pair?.quoteToken?.address || '').toLowerCase() === target
  );
  matches.sort((a, b) =>
    (finitePositive(b?.liquidity?.usd) || 0) - (finitePositive(a?.liquidity?.usd) || 0)
  );
  // Skip a higher-liquidity pool if its price orientation cannot be safely
  // converted into a USD price for the requested mint.
  return matches.find(pair => {
    const market = normalisePairForMint(pair, mint);
    return market && Number.isFinite(market.priceUsd) && market.priceUsd > 0;
  }) || null;
}

function normalisePairForMint(pair, mint) {
  if (!pair || typeof mint !== 'string' || !mint) return null;
  const target = mint.toLowerCase();
  const baseMatch = String(pair.baseToken?.address || '').toLowerCase() === target;
  const quoteMatch = String(pair.quoteToken?.address || '').toLowerCase() === target;
  if (!baseMatch && !quoteMatch) return null;

  const basePriceUsd = finitePositive(pair.priceUsd);
  const basePriceInQuote = finitePositive(pair.priceNative);
  const priceUsd = baseMatch
    ? basePriceUsd
    : (basePriceUsd !== null && basePriceInQuote !== null ? basePriceUsd / basePriceInQuote : null);
  const token = baseMatch ? pair.baseToken : pair.quoteToken;
  const buys24h = finiteNonNegative(quoteMatch ? pair.txns?.h24?.sells : pair.txns?.h24?.buys);
  const sells24h = finiteNonNegative(quoteMatch ? pair.txns?.h24?.buys : pair.txns?.h24?.sells);
  const inverseChange = value => {
    const change = finiteNumber(value);
    if (change === null || change <= -100) return null;
    return Number(((1 / (1 + change / 100) - 1) * 100).toFixed(6));
  };

  return {
    priceUsd,
    marketCapUsd: baseMatch ? finitePositive(pair.marketCap) ?? finitePositive(pair.fdv) : null,
    liquidityUsd: finiteNonNegative(pair.liquidity?.usd),
    volume24h: finiteNonNegative(pair.volume?.h24),
    txns24h: buys24h === null || sells24h === null ? null : buys24h + sells24h,
    buys24h,
    sells24h,
    priceChange24h: baseMatch
      ? finiteNumber(pair.priceChange?.h24)
      : inverseChange(pair.priceChange?.h24),
    image: pair.info?.imageUrl || null,
    pairAddress: pair.pairAddress || null,
    dexId: pair.dexId || null,
    dexUrl: pair.url || null,
    poolCreatedAt: pair.pairCreatedAt || null,
    baseName: token?.name || null,
    baseSymbol: token?.symbol || null,
    source: 'DexScreener',
    priceOrientation: baseMatch ? 'base-token' : 'quote-token-inverted',
    checkedAt: new Date().toISOString()
  };
}

module.exports = { selectPairForMint, normalisePairForMint };
