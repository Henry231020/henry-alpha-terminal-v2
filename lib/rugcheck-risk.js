'use strict';

const DEFAULT_TIMEOUT_MS = 8000;
const BASE_URL = 'https://api.rugcheck.xyz/v1/tokens/';

function createRugCheckRiskClient(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const apiKey = options.apiKey || process.env.RUGCHECK_API_KEY || '';
  const cacheTtlMs = options.cacheTtlMs || 5 * 60 * 1000;
  const clock = options.clock || (() => Date.now());
  const cache = new Map();

  async function getTokenRisk(mint) {
    if (typeof mint !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
      return { status: 'unknown', reason: 'Invalid mint address', walletRisk: 'unknown' };
    }
    const cached = cache.get(mint);
    if (cached && clock() - cached.at < cacheTtlMs) return { ...cached.value, cached: true };
    if (typeof fetchImpl !== 'function') return { status: 'unknown', reason: 'fetch unavailable', walletRisk: 'unknown' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = { Accept: 'application/json' };
      if (apiKey) headers['X-API-KEY'] = apiKey;
      const response = await fetchImpl(BASE_URL + encodeURIComponent(mint) + '/report', {
        headers,
        signal: controller.signal
      });
      if (!response.ok) return { status: 'unknown', reason: 'RugCheck HTTP ' + response.status, walletRisk: 'unknown' };
      const report = await response.json();
      if (!report || typeof report !== 'object' || report.mint !== mint || !report.token || !Array.isArray(report.risks)) {
        return { status: 'unknown', reason: 'RugCheck returned an incomplete or mismatched report', walletRisk: 'unknown' };
      }

      const score = Number(report.score_normalised);
      const insiders = Number(report.graphInsidersDetected);
      const insiderNetworks = Array.isArray(report.insiderNetworks) ? report.insiderNetworks : null;
      const dangerRisks = report.risks.filter(risk => String(risk?.level || '').toLowerCase() === 'danger');
      const authoritiesRevoked = report.token.mintAuthority === null && report.token.freezeAuthority === null;
      const insiderDataComplete = Number.isFinite(insiders) && insiderNetworks !== null;
      let walletRisk = 'unknown';
      if (dangerRisks.length || (Number.isFinite(insiders) && insiders > 0) || (insiderNetworks && insiderNetworks.length > 0) || (Number.isFinite(score) && score >= 40)) {
        walletRisk = 'high';
      } else if (Number.isFinite(score) && score > 20) {
        walletRisk = 'medium';
      } else if (Number.isFinite(score) && score >= 0 && score <= 20 && authoritiesRevoked && insiderDataComplete && insiders === 0 && insiderNetworks.length === 0) {
        walletRisk = 'low';
      }

      const value = {
        status: Number.isFinite(score) && Array.isArray(report.risks) ? 'observed' : 'unknown',
        reason: walletRisk === 'low'
          ? 'RugCheck reports a low score, revoked mint/freeze authorities and no detected insider network. This is not a safety guarantee.'
          : 'RugCheck report received; risk is not classified as low. Review the findings and missing checks.',
        walletRisk,
        scoreNormalised: Number.isFinite(score) ? score : null,
        rawScore: Number.isFinite(Number(report.score)) ? Number(report.score) : null,
        mintAuthority: report.token.mintAuthority,
        freezeAuthority: report.token.freezeAuthority,
        graphInsidersDetected: Number.isFinite(insiders) ? insiders : null,
        insiderNetworkCount: insiderNetworks ? insiderNetworks.length : null,
        dangerRisks: dangerRisks.map(risk => ({ name: String(risk.name || 'Risk'), description: String(risk.description || ''), level: 'danger' })),
        riskCount: report.risks.length,
        detectedAt: report.detectedAt || null
      };
      cache.set(mint, { at: clock(), value });
      return value;
    } catch (error) {
      return { status: 'unknown', reason: error && error.name === 'AbortError' ? 'RugCheck request timed out' : 'RugCheck request failed', walletRisk: 'unknown' };
    } finally {
      clearTimeout(timer);
    }
  }

  return { getTokenRisk };
}

module.exports = { createRugCheckRiskClient };
