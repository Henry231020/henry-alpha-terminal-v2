'use strict';

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_HOLDER_PAGES = 20;
const PAGE_SIZE = 1000;
const DEFAULT_CACHE_TTL_MS = 60 * 1000;
const DEFAULT_MAX_CACHE_ENTRIES = 500;

function parseRawTokenAmount(value) {
  if (typeof value === 'bigint') return value >= 0n ? value : null;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    return BigInt(value);
  }
  if (typeof value !== 'string' || !/^\\d+$/.test(value)) return null;
  try { return BigInt(value); } catch (_) { return null; }
}

function createHeliusRiskClient(options = {}) {
  const apiKey = options.apiKey || process.env.HELIUS_API_KEY || '';
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const cacheTtlMs = options.cacheTtlMs || DEFAULT_CACHE_TTL_MS;
  const maxCacheEntries = Math.max(1, Number(options.maxCacheEntries) || DEFAULT_MAX_CACHE_ENTRIES);
  const clock = options.clock || (() => Date.now());
  const cache = new Map();

  function readCache(mint, now) {
    const entry = cache.get(mint);
    if (!entry) return null;
    if (now - entry.checkedAt < 0 || now - entry.checkedAt >= cacheTtlMs) { cache.delete(mint); return null; }
    cache.delete(mint); cache.set(mint, entry); return entry;
  }
  function writeCache(mint, value) {
    cache.delete(mint); cache.set(mint, value);
    while (cache.size > maxCacheEntries) cache.delete(cache.keys().next().value);
  }

  async function request(mint, page) {
    if (!apiKey) return { ok: false, reason: 'HELIUS_API_KEY not configured' };
    if (typeof fetchImpl !== 'function') return { ok: false, reason: 'fetch unavailable' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl('https://mainnet.helius-rpc.com/?api-key=' + encodeURIComponent(apiKey), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'henry-alpha-risk', method: 'getTokenAccounts', params: { mint, page, limit: PAGE_SIZE, displayOptions: {} } }),
        signal: controller.signal
      });
      if (!response.ok) return { ok: false, reason: 'Helius HTTP ' + response.status };
      const body = await response.json();
      if (body.error) return { ok: false, reason: 'Helius returned an RPC error' };
      return { ok: true, data: body.result || null };
    } catch (error) {
      return { ok: false, reason: error && error.name === 'AbortError' ? 'Helius request timed out' : 'Helius request failed' };
    } finally {
      clearTimeout(timer);
    }
  }

  async function getHolderRisk(mint) {
    if (typeof mint !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
      return { status: 'unknown', reason: 'Invalid mint address', holderCount: null, top10ConcentrationPct: null };
    }
    const cached = readCache(mint, clock());
    if (cached) return { ...cached.result, cached: true, checkedAt: cached.checkedAt };
    const balancesByOwner = new Map();
    let accountCount = 0;
    for (let page = 1; page <= MAX_HOLDER_PAGES; page++) {
      const result = await request(mint, page);
      if (!result.ok) {
        return { status: 'unknown', reason: result.reason, holderCount: null, top10ConcentrationPct: null };
      }
      const rows = result.data && Array.isArray(result.data.token_accounts) ? result.data.token_accounts : null;
      if (!rows) {
        return { status: 'unknown', reason: 'Holder account data unavailable', holderCount: null, top10ConcentrationPct: null };
      }
      if (rows.length === 0) {
        const balances = Array.from(balancesByOwner.values()).filter(value => value > 0n).sort((a, b) => a > b ? -1 : a < b ? 1 : 0);
        const total = balances.reduce((sum, value) => sum + value, 0n);
        if (!balances.length || total <= 0n) {
          return { status: 'unknown', reason: 'No usable token balances returned', holderCount: balances.length, top10ConcentrationPct: null };
        }
        const top10 = balances.slice(0, 10).reduce((sum, value) => sum + value, 0n);
        // Convert the exact BigInt ratio to a percentage rounded to four decimals.
        const concentrationScaled = (top10 * 1000000n + total / 2n) / total;
        const checkedAt = clock();
        const result = {
          status: 'observed',
          reason: 'All holder-account pages retrieved; concentration is based on unique owners and excludes zero balances',
          holderCount: balances.length,
          accountCount,
          top10ConcentrationPct: Number(concentrationScaled) / 10000,
          checkedAt
        };
        writeCache(mint, { result, checkedAt });
        return result;
      }
      accountCount += rows.length;
      for (const row of rows) {
        const owner = row && row.owner;
        const rawAmount = row && row.amount;
        const amount = parseRawTokenAmount(rawAmount);
        if (typeof owner !== 'string' || !owner || amount === null) {
          return { status: 'unknown', reason: 'Incomplete owner or balance data; concentration cannot be verified', holderCount: balancesByOwner.size, accountCount, top10ConcentrationPct: null };
        }
        balancesByOwner.set(owner, (balancesByOwner.get(owner) || 0n) + amount);
      }
      if (rows.length < PAGE_SIZE) {
        // Helius pagination should be exhausted by an empty page; a short page alone
        // is not treated as proof that no further accounts exist.
        continue;
      }
    }
    return {
      status: 'unknown',
      reason: 'Holder scan exceeded the configured page limit; complete concentration is unverified',
      holderCount: balancesByOwner.size,
      accountCount,
      top10ConcentrationPct: null
    };
  }

  return { getHolderRisk, cacheStats: () => ({ entries: cache.size, maxEntries: maxCacheEntries }) };
}

module.exports = { createHeliusRiskClient, parseRawTokenAmount };
