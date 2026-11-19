'use strict';

class AlertThrottle {
  constructor({ cooldownMs = 30000, retentionMs = 10 * 60 * 1000, maxEntries = 5000 } = {}) {
    this.cooldownMs = cooldownMs;
    this.retentionMs = retentionMs;
    this.maxEntries = maxEntries;
    this.lastByKey = new Map();
  }

  shouldAllow(key, timestamp = Date.now()) {
    if (typeof key !== 'string' || !key || !Number.isFinite(Number(timestamp))) return false;
    const at = Number(timestamp);
    const previous = this.lastByKey.get(key);
    if (previous !== undefined && (at <= previous || at - previous <= this.cooldownMs)) return false;
    this.lastByKey.delete(key);
    this.lastByKey.set(key, at);
    const cutoff = at - this.retentionMs;
    for (const [entryKey, lastAt] of this.lastByKey) {
      if (lastAt < cutoff) this.lastByKey.delete(entryKey);
    }
    while (this.lastByKey.size > this.maxEntries) {
      this.lastByKey.delete(this.lastByKey.keys().next().value);
    }
    return true;
  }
}

module.exports = { AlertThrottle };
