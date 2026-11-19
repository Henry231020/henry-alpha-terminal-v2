'use strict';

const BASE58_MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

class RiskRequestGuard {
  constructor({ cooldownMs = 30000, maxConcurrent = 3, clock = () => Date.now() } = {}) {
    this.cooldownMs = cooldownMs;
    this.maxConcurrent = maxConcurrent;
    this.clock = clock;
    this.lastByMint = new Map();
    this.inFlight = new Set();
  }

  begin(mint) {
    if (typeof mint !== 'string' || !BASE58_MINT.test(mint)) {
      return { ok: false, status: 400, reason: 'Invalid Solana mint address' };
    }
    if (this.inFlight.has(mint)) {
      return { ok: false, status: 429, reason: 'Risk check already in progress for this token' };
    }
    if (this.inFlight.size >= this.maxConcurrent) {
      return { ok: false, status: 429, reason: 'Risk-check capacity reached; retry shortly' };
    }
    const now = this.clock();
    const previous = this.lastByMint.get(mint);
    if (previous !== undefined && now - previous < this.cooldownMs) {
      return { ok: false, status: 429, reason: 'Risk check cooldown active', retryAfterMs: this.cooldownMs - (now - previous) };
    }
    this.lastByMint.delete(mint);
    this.lastByMint.set(mint, now);
    while (this.lastByMint.size > 2000) this.lastByMint.delete(this.lastByMint.keys().next().value);
    this.inFlight.add(mint);
    return { ok: true, release: () => this.inFlight.delete(mint) };
  }
}

module.exports = { RiskRequestGuard, BASE58_MINT };
