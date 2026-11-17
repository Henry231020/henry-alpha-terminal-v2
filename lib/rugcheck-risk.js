'use strict';

function summarizeRugCheckReport(report) {
  if (!report || typeof report !== 'object') {
    return { status: 'unknown', walletRisk: 'unknown', reason: 'RugCheck report unavailable' };
  }
  const score = Number(report.score_normalised);
  const risks = Array.isArray(report.risks) ? report.risks : null;
  const insiderNetworks = Array.isArray(report.insiderNetworks) ? report.insiderNetworks : null;
  const topHolders = Array.isArray(report.topHolders) ? report.topHolders : null;
  const creatorTokensKnown = report.creatorTokens === null || Array.isArray(report.creatorTokens);
  const mutable = report.tokenMeta && typeof report.tokenMeta.mutable === 'boolean' ? report.tokenMeta.mutable : null;
  const token = report.token && typeof report.token === 'object' ? report.token : {};
  const extensions = report.token_extensions && typeof report.token_extensions === 'object'
    ? report.token_extensions
    : token.token_extensions && typeof token.token_extensions === 'object'
      ? token.token_extensions
      : null;

  if (!Number.isFinite(score) || score < 0 || score > 100 || !risks || !insiderNetworks || !topHolders || !creatorTokensKnown || mutable === null || extensions === null) {
    return { status: 'unknown', walletRisk: 'unknown', reason: 'RugCheck report is incomplete; wallet risk cannot be classified' };
  }

  const dangerRisks = risks.filter(item => String(item && item.level).toLowerCase() === 'danger');
  const insiderHolders = topHolders.filter(holder => holder && holder.insider === true);
  const creatorHistoryCount = Array.isArray(report.creatorTokens) ? report.creatorTokens.length : 0;
  const extensionCount = Object.keys(extensions).length;
  let walletRisk = 'medium';
  let reason = 'RugCheck reports warnings or unresolved risk indicators';

  if (dangerRisks.length > 0 || score >= 50 || insiderNetworks.length > 0 || insiderHolders.length > 0) {
    walletRisk = 'high';
    reason = 'RugCheck found danger-level risks, elevated score, or insider indicators';
  } else if (score <= 15 && risks.length === 0 && creatorHistoryCount === 0 && mutable === false && extensionCount === 0) {
    walletRisk = 'low';
    reason = 'RugCheck report is complete with low score and no listed risk or insider indicators';
  }

  return {
    status: 'observed',
    walletRisk,
    scoreNormalized: score,
    creator: typeof report.creator === 'string' ? report.creator : null,
    creatorHistoryCount,
    insiderNetworkCount: insiderNetworks.length,
    insiderHolderCount: insiderHolders.length,
    dangerRiskCount: dangerRisks.length,
    warningRiskCount: risks.filter(item => String(item && item.level).toLowerCase() === 'warn').length,
    metadataMutable: mutable,
    tokenExtensionCount: extensionCount,
    riskFlags: risks.slice(0, 12).map(item => ({
      name: typeof item.name === 'string' ? item.name : 'Unnamed risk',
      level: typeof item.level === 'string' ? item.level : 'unknown',
      description: typeof item.description === 'string' ? item.description.slice(0, 240) : ''
    })),
    reportDetectedAt: typeof report.detectedAt === 'string' ? report.detectedAt : null,
    reason
  };
}

function createRugCheckClient(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 8000);
  const cacheTtlMs = Math.max(60000, Number(options.cacheTtlMs) || 5 * 60 * 1000);
  const cache = new Map();
  const inFlight = new Map();
  let nextAllowedAt = 0;
  let requestQueue = Promise.resolve();

  async function fetchRisk(mint) {
    if (typeof mint !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
      return { status: 'unknown', walletRisk: 'unknown', reason: 'Invalid mint address' };
    }
    if (typeof fetchImpl !== 'function') return { status: 'unknown', walletRisk: 'unknown', reason: 'Fetch unavailable' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl('https://api.rugcheck.xyz/v1/tokens/' + encodeURIComponent(mint) + '/report', {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: controller.signal
      });
      if (!response.ok) return { status: 'unknown', walletRisk: 'unknown', reason: 'RugCheck HTTP ' + response.status };
      const report = await response.json();
      return summarizeRugCheckReport(report);
    } catch (error) {
      return { status: 'unknown', walletRisk: 'unknown', reason: error && error.name === 'AbortError' ? 'RugCheck request timed out' : 'RugCheck request failed' };
    } finally {
      clearTimeout(timer);
    }
  }

  function scheduleRiskFetch(mint) {
    const job = requestQueue.then(async () => {
      const waitMs = Math.max(0, nextAllowedAt - Date.now());
      if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs));
      nextAllowedAt = Date.now() + 1100;
      return fetchRisk(mint);
    });
    requestQueue = job.catch(() => {});
    return job;
  }

  async function getRisk(mint) {
    const cached = cache.get(mint);
    if (cached && Date.now() - cached.at < cacheTtlMs) return { ...cached.result, cached: true };
    if (inFlight.has(mint)) return inFlight.get(mint);
    const pending = scheduleRiskFetch(mint).then(result => {
      cache.set(mint, { at: Date.now(), result });
      if (cache.size > 500) cache.delete(cache.keys().next().value);
      return result;
    }).finally(() => inFlight.delete(mint));
    inFlight.set(mint, pending);
    return pending;
  }

  return { getRisk };
}

module.exports = { summarizeRugCheckReport, createRugCheckClient };
