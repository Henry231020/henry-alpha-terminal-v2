'use strict';

function parseTradeMessage(data) {
  const candidate = Boolean(data && typeof data === 'object' && (
    Object.hasOwn(data, 'txType') ||
    Object.hasOwn(data, 'solAmount') ||
    Object.hasOwn(data, 'traderPublicKey')
  ));

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, candidate: false, reason: 'message is not an object' };
  }
  if (typeof data.mint !== 'string' || data.mint.trim() === '') {
    return { ok: false, candidate, reason: 'missing mint string' };
  }
  const side = String(data.txType || '').toLowerCase();
  if (!['buy', 'sell'].includes(side)) {
    return { ok: false, candidate, reason: 'txType is not buy/sell' };
  }
  if (data.solAmount === null || data.solAmount === undefined || data.solAmount === '') {
    return { ok: false, candidate: true, reason: 'solAmount missing or invalid' };
  }
  const solAmount = Number(data.solAmount);
  if (!Number.isFinite(solAmount) || solAmount <= 0) {
    return { ok: false, candidate: true, reason: 'solAmount must be a positive finite number' };
  }
  return {
    ok: true,
    candidate: true,
    trade: {
      mint: data.mint.trim(),
      side,
      solAmount,
      wallet: typeof data.traderPublicKey === 'string' && data.traderPublicKey.trim()
        ? data.traderPublicKey.trim()
        : null
    }
  };
}

module.exports = { parseTradeMessage };
