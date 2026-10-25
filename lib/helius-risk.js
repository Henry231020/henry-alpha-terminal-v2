'use strict';

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_HOLDER_PAGES = 20;
const PAGE_SIZE = 1000;

function createHeliusRiskClient(options = {}) {
  const apiKey = options.apiKey || process.env.HELIUS_API_KEY || '';
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

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
        const balances = Array.from(balancesByOwner.values()).filter(value => value > 0).sort((a, b) => b - a);
        const total = balances.reduce((sum, value) => sum + value, 0);
        if (!balances.length || !Number.isFinite(total) || total <= 0) {
          return { status: 'unknown', reason: 'No usable token balances returned', holderCount: balances.length, top10ConcentrationPct: null };
        }
        const top10 = balances.slice(0, 10).reduce((sum, value) => sum + value, 0);
        return {
          status: 'observed',
          reason: 'All holder-account pages retrieved; concentration is based on unique owners and excludes zero balances',
          holderCount: balances.length,
          accountCount,
          top10ConcentrationPct: Number(((top10 / total) * 100).toFixed(4))
        };
      }
      accountCount += rows.length;
      for (const row of rows) {
        const owner = row && row.owner;
        const amount = Number(row && row.amount);
        if (typeof owner !== 'string' || !owner || !Number.isFinite(amount) || amount < 0) {
          return { status: 'unknown', reason: 'Incomplete owner or balance data; concentration cannot be verified', holderCount: balancesByOwner.size, accountCount, top10ConcentrationPct: null };
        }
        balancesByOwner.set(owner, (balancesByOwner.get(owner) || 0) + amount);
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

  return { getHolderRisk };
}

module.exports = { createHeliusRiskClient };
