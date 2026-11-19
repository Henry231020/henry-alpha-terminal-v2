'use strict';

const MAX_TRADE_AGE_MS = 3 * 60 * 1000;

function parseGeckoTrades(payload, mint, priceOrientation = 'base-token', now = Date.now()) {
  if (!payload || !Array.isArray(payload.data) || typeof mint !== 'string' || !mint) return [];
  const invert = priceOrientation === 'quote-token-inverted';
  const result = [];
  for (const row of payload.data) {
    const a = row && row.attributes;
    if (!a) continue;
    let side = String(a.kind || '').toLowerCase();
    if (!['buy', 'sell'].includes(side)) continue;
    if (invert) side = side === 'buy' ? 'sell' : 'buy';
    const usdValue = Number(a.volume_in_usd);
    const timestamp = Date.parse(a.block_timestamp || '');
    const txHash = typeof a.tx_hash === 'string' ? a.tx_hash : (typeof row.id === 'string' ? row.id : '');
    if (!txHash || !Number.isFinite(usdValue) || usdValue <= 0 || !Number.isFinite(timestamp)) continue;
    if (timestamp > now + 5000 || now - timestamp > MAX_TRADE_AGE_MS) continue;
    result.push({
      side,
      usdValue,
      timestamp,
      wallet: typeof a.tx_from_address === 'string' && a.tx_from_address ? a.tx_from_address : null,
      txHash
    });
  }
  return result.sort((a, b) => a.timestamp - b.timestamp);
}

module.exports = { parseGeckoTrades, MAX_TRADE_AGE_MS };
