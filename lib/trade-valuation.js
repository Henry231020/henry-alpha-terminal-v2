'use strict';

const MAX_TRADE_QUOTE_AGE_MS = 60000;

function valueTradeInUsd(item, quote) {
  const solAmount = Number(item && item.solAmount);
  const timestamp = Number(item && item.timestamp);
  const price = Number(quote && quote.price);
  const quoteCheckedAt = Number(quote && quote.checkedAt);
  const quoteAgeMs = quoteCheckedAt - timestamp;
  if (!Number.isFinite(solAmount) || solAmount <= 0 ||
      !Number.isFinite(timestamp) || timestamp <= 0 ||
      !Number.isFinite(price) || price <= 0 ||
      !Number.isFinite(quoteCheckedAt) ||
      Math.abs(quoteAgeMs) > MAX_TRADE_QUOTE_AGE_MS) return null;
  const usdValue = solAmount * price;
  if (!Number.isFinite(usdValue) || usdValue <= 0) return null;
  return {
    usdValue,
    solUsdPrice: price,
    solUsdQuoteAt: new Date(quoteCheckedAt).toISOString(),
    solUsdQuoteAgeMs: quoteAgeMs,
    usdValueApproximate: Math.abs(quoteAgeMs) > 30000
  };
}

module.exports = { valueTradeInUsd, MAX_TRADE_QUOTE_AGE_MS };
