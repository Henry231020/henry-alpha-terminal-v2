'use strict';

function createJupiterPriceClient(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 8000);
  const cacheTtlMs = Math.max(5000, Number(options.cacheTtlMs) || 60000);
  const minIntervalMs = Math.max(2000, Number(options.minIntervalMs) || 2100);
  const cache = new Map();
  let nextAllowedAt = 0;
  let requestQueue = Promise.resolve();

  async function fetchBatch(mints) {
    const output = {};
    if (!mints.length || typeof fetchImpl !== 'function') return output;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = 'https://api.jup.ag/price/v3?ids=' + encodeURIComponent(mints.join(','));
      const response = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: controller.signal });
      if (!response.ok) {
        for (const mint of mints) output[mint] = { status: 'unavailable', reason: 'Jupiter Price API HTTP ' + response.status };
        return output;
      }
      const body = await response.json();
      for (const mint of mints) {
        const row = body && body[mint];
        const usdPrice = row && Number(row.usdPrice);
        output[mint] = Number.isFinite(usdPrice) && usdPrice > 0
          ? {
              status: 'observed',
              usdPrice,
              blockId: row.blockId !== null && row.blockId !== undefined && Number.isFinite(Number(row.blockId)) ? Number(row.blockId) : null,
              decimals: row.decimals !== null && row.decimals !== undefined && Number.isInteger(Number(row.decimals)) ? Number(row.decimals) : null,
              priceChange24h: row.priceChange24h !== null && row.priceChange24h !== undefined && Number.isFinite(Number(row.priceChange24h)) ? Number(row.priceChange24h) : null,
              source: 'Jupiter Price API V3'
            }
          : { status: 'unavailable', reason: 'Jupiter has no qualifying recent price for this mint' };
      }
      return output;
    } catch (error) {
      for (const mint of mints) output[mint] = { status: 'unavailable', reason: error && error.name === 'AbortError' ? 'Jupiter Price API timed out' : 'Jupiter Price API request failed' };
      return output;
    } finally {
      clearTimeout(timer);
    }
  }

  function scheduleBatch(mints) {
    const job = requestQueue.then(async () => {
      const waitMs = Math.max(0, nextAllowedAt - Date.now());
      if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
      nextAllowedAt = Date.now() + minIntervalMs;
      return fetchBatch(mints);
    });
    requestQueue = job.catch(() => ({}));
    return job;
  }

  async function getPrices(mints) {
    const requested = [...new Set((Array.isArray(mints) ? mints : []).filter(mint =>
      typeof mint === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)
    ))].slice(0, 50);
    if (!requested.length) return {};
    const now = Date.now();
    const result = {};
    const missing = [];
    for (const mint of requested) {
      const cached = cache.get(mint);
      if (cached && now - cached.at < cacheTtlMs) result[mint] = { ...cached.value, cached: true };
      else missing.push(mint);
    }
    if (missing.length) {
      const fetched = await scheduleBatch(missing);
      for (const mint of missing) {
        const value = fetched[mint] || { status: 'unavailable', reason: 'No Jupiter price response' };
        cache.set(mint, { at: Date.now(), value });
        result[mint] = value;
      }
      if (cache.size > 1000) cache.delete(cache.keys().next().value);
    }
    return result;
  }

  async function getPrice(mint) {
    const result = await getPrices([mint]);
    return result[mint] || { status: 'unavailable', reason: 'Invalid mint address' };
  }

  return { getPrices, getPrice };
}

module.exports = { createJupiterPriceClient };
