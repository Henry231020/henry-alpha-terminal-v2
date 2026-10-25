const MAX_SUBSCRIPTIONS = 100;
class TradeSubscriptionManager {
  constructor({ socket, maxSubscriptions = MAX_SUBSCRIPTIONS, onSubscribe = () => {}, onUnsubscribe = () => {} } = {}) {
    this.socket = socket; this.maxSubscriptions = maxSubscriptions; this.onSubscribe = onSubscribe; this.onUnsubscribe = onUnsubscribe; this.mints = new Set();
  }
  setSocket(socket) { this.socket = socket; }
  subscribe(mint) {
    if (!mint || typeof mint !== 'string' || this.mints.has(mint) || this.mints.size >= this.maxSubscriptions) return false;
    if (!this.socket || this.socket.readyState !== 1 || typeof this.socket.send !== 'function') return false;
    this.socket.send(JSON.stringify({ method: 'subscribeTokenTrade', keys: [mint] }));
    this.mints.add(mint); this.onSubscribe(mint); return true;
  }
  unsubscribe(mint) {
    if (!this.mints.has(mint) || !this.socket || this.socket.readyState !== 1) return false;
    this.socket.send(JSON.stringify({ method: 'unsubscribeTokenTrade', keys: [mint] }));
    this.mints.delete(mint); this.onUnsubscribe(mint); return true;
  }
  clear() { this.mints.clear(); }
  stats() { return { subscribedMints: this.mints.size, maxSubscriptions: this.maxSubscriptions }; }
}
module.exports = { TradeSubscriptionManager, MAX_SUBSCRIPTIONS };
