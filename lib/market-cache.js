/* Conservative market-data cache and 429 backoff helper. Does not call providers until invoked. */
class MarketCache {
  constructor({ ttlMs = 120000, maxEntries = 1000, initialBackoffMs = 60000, maxBackoffMs = 900000 } = {}) {
    this.ttlMs = ttlMs; this.maxEntries = maxEntries; this.initialBackoffMs = initialBackoffMs; this.maxBackoffMs = maxBackoffMs;
    this.cache = new Map(); this.cooldownUntil = 0; this.backoffMs = 0;
  }
  get(key, now = Date.now()) { const entry = this.cache.get(key); if (!entry || now - entry.at >= this.ttlMs) return null; return entry.value; }
  set(key, value, now = Date.now()) { this.cache.delete(key); this.cache.set(key, { at: now, value }); while (this.cache.size > this.maxEntries) this.cache.delete(this.cache.keys().next().value); }
  canRequest(now = Date.now()) { return now >= this.cooldownUntil; }
  noteStatus(status, now = Date.now()) {
    if (Number(status) === 429) { this.backoffMs = this.backoffMs ? Math.min(this.backoffMs * 2, this.maxBackoffMs) : this.initialBackoffMs; this.cooldownUntil = now + this.backoffMs; return; }
    if (Number(status) >= 200 && Number(status) < 300) { this.backoffMs = 0; this.cooldownUntil = 0; }
  }
  getStats(now = Date.now()) { return { entries: this.cache.size, cooldownActive: now < this.cooldownUntil, cooldownUntil: this.cooldownUntil || null, backoffMs: this.backoffMs }; }
}
module.exports = { MarketCache };
