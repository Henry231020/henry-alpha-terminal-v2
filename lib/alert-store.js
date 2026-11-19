'use strict';

class AlertStore {
  constructor({ maxAlerts = 500 } = {}) {
    this.maxAlerts = Math.max(1, Math.min(5000, Number(maxAlerts) || 500));
    this.items = [];
    this.keys = new Set();
  }

  record(alert) {
    if (!alert || typeof alert.mint !== 'string' || !alert.mint || typeof alert.signal !== 'string') return false;
    const at = Date.parse(alert.receivedAt || '');
    if (!Number.isFinite(at)) return false;
    const key = alert.mint + ':' + at + ':' + alert.signal;
    if (this.keys.has(key)) return false;
    const item = { ...alert, receivedAt: new Date(at).toISOString() };
    this.items.unshift(item);
    this.keys.add(key);
    while (this.items.length > this.maxAlerts) {
      const removed = this.items.pop();
      this.keys.delete(removed.mint + ':' + Date.parse(removed.receivedAt) + ':' + removed.signal);
    }
    return true;
  }

  recent(limit = 20, mint = null) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    return this.items.filter(item => !mint || item.mint === mint).slice(0, safeLimit);
  }
}

module.exports = { AlertStore };
