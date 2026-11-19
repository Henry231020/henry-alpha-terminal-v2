'use strict';

function finitePositive(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
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
  return matches[0] || null;
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
  const inverseChange = value => {
    const change = Number(value);
    if (!Number.isFinite(change) || change <= -100) return null;
    return Number(((1 / (1 + change / 100) - 1) * 100).toFixed(6));
  };

  return {
    priceUsd,
    marketCapUsd: baseMatch ? finitePositive(pair.marketCap) ?? finitePositive(pair.fdv) : null,
    liquidityUsd: finitePositive(pair.liquidity?.usd),
    volume24h: finitePositive(pair.volume?.h24),
    txns24h: (Number(pair.txns?.h24?.buys) || 0) + (Number(pair.txns?.h24?.sells) || 0),
    buys24h: Number.isFinite(Number(pair.txns?.h24?.buys)) ? Number(pair.txns.h24.buys) : null,
    sells24h: Number.isFinite(Number(pair.txns?.h24?.sells)) ? Number(pair.txns.h24.sells) : null,
    priceChange24h: baseMatch
      ? (Number.isFinite(Number(pair.priceChange?.h24)) ? Number(pair.priceChange.h24) : null)
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
