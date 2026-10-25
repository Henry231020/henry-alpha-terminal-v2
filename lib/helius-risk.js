'use strict';

const DEFAULT_TIMEOUT_MS = 8000;

function createHeliusRiskClient(options = {}) {
  const apiKey = options.apiKey || process.env.HELIUS_API_KEY || '';
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

  async function request(path) {
    if (!apiKey) return { ok: false, reason: 'HELIUS_API_KEY not configured' };
    if (typeof fetchImpl !== 'function') return { ok: false, reason: 'fetch unavailable' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl('https://mainnet.helius-rpc.com/?api-key=' + encodeURIComponent(apiKey), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'henry-alpha-risk', method: 'getTokenAccounts', params: { mint: path, page: 1, limit: 1000 } }),
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
    const result = await request(mint);
    if (!result.ok) {
      return { status: 'unknown', reason: result.reason, holderCount: null, top10ConcentrationPct: null };
    }
    const rows = result.data && Array.isArray(result.data.token_accounts) ? result.data.token_accounts : null;
    if (!rows || !rows.length) {
      return { status: 'unknown', reason: 'Holder account data unavailable or empty', holderCount: null, top10ConcentrationPct: null };
    }
    const amounts = rows.map(row => Number(row && row.amount)).filter(value => Number.isFinite(value) && value >= 0).sort((a, b) => b - a);
    const total = amounts.reduce((sum, value) => sum + value, 0);
    if (!amounts.length || total <= 0) {
      return { status: 'unknown', reason: 'No usable token balances returned', holderCount: amounts.length, top10ConcentrationPct: null };
    }
    // getTokenAccounts is paginated; this request reads only page 1 (up to 1,000
    // accounts). A top-10 percentage against that partial denominator is misleading.
    // Keep the sample count for diagnostics but fail closed for gating decisions.
    return {
      status: 'unknown',
      reason: 'Only a paginated account sample was checked; complete holder concentration is unverified',
      holderCount: amounts.length,
      top10ConcentrationPct: null
    };
  }

  return { getHolderRisk };
}

module.exports = { createHeliusRiskClient };
