'use strict';

function summarizeWalletActivity(trades, options = {}) {
  const launchMs = options.launchAt ? new Date(options.launchAt).getTime() : NaN;
  const windowMs = Math.max(60000, Math.min(30 * 60 * 1000, Number(options.windowMs) || 10 * 60 * 1000));
  const limit = Math.max(1, Math.min(100, Number(options.limit) || 25));
  if (!Number.isFinite(launchMs)) {
    return { status: 'unavailable', reason: 'Token first-seen time is not available.', launchAt: null, windowMs, earlyBuyers: [], walletsObserved: 0 };
  }
  const wallets = new Map();
  for (const trade of Array.isArray(trades) ? trades : []) {
    const wallet = typeof trade?.wallet === 'string' ? trade.wallet.trim() : '';
    const side = String(trade?.side || '').toLowerCase();
    const timestamp = Number(trade?.timestamp);
    const usdValue = Number(trade?.usdValue);
    if (!wallet || !['buy', 'sell'].includes(side) || !Number.isFinite(timestamp) || !Number.isFinite(usdValue) || usdValue < 0) continue;
    let row = wallets.get(wallet);
    if (!row) {
      row = { wallet, firstObservedAt: timestamp, firstBuyAt: null, buyCount: 0, sellCount: 0, buyUsd: 0, sellUsd: 0 };
      wallets.set(wallet, row);
    }
    row.firstObservedAt = Math.min(row.firstObservedAt, timestamp);
    if (side === 'buy') {
      row.buyCount++;
      row.buyUsd += usdValue;
      row.firstBuyAt = row.firstBuyAt === null ? timestamp : Math.min(row.firstBuyAt, timestamp);
    } else {
      row.sellCount++;
      row.sellUsd += usdValue;
    }
  }
  const all = [...wallets.values()].map(row => ({
    ...row,
    firstObservedAt: new Date(row.firstObservedAt).toISOString(),
    firstBuyAt: row.firstBuyAt === null ? null : new Date(row.firstBuyAt).toISOString(),
    minutesAfterFirstSeen: row.firstBuyAt === null ? null : Number(((row.firstBuyAt - launchMs) / 60000).toFixed(2)),
    netBuyUsd: Number((row.buyUsd - row.sellUsd).toFixed(2)),
    buyUsd: Number(row.buyUsd.toFixed(2)),
    sellUsd: Number(row.sellUsd.toFixed(2)),
    early: row.firstBuyAt !== null && row.firstBuyAt >= launchMs && row.firstBuyAt <= launchMs + windowMs
  })).sort((a, b) => {
    if (a.firstBuyAt === null) return 1;
    if (b.firstBuyAt === null) return -1;
    return Date.parse(a.firstBuyAt) - Date.parse(b.firstBuyAt);
  });
  const earlyBuyers = all.filter(row => row.early).slice(0, limit);
  return {
    status: 'observed',
    launchAt: new Date(launchMs).toISOString(),
    windowMs,
    walletsObserved: all.length,
    earlyBuyerCount: all.filter(row => row.early).length,
    earlyBuyers,
    note: 'Earliest buyers observed by this feed after the token first-seen event; not proof of the first on-chain buyers. Feed gaps and subscription limits can omit wallets.'
  };
}

module.exports = { summarizeWalletActivity };
