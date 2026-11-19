'use strict';

function parseTradeMessage(data) {
  // PumpPortal create events also contain traderPublicKey (and txType=create).
  // Count only trade-shaped messages so launch events do not inflate rejections.
  const sideHint = String(data?.txType || '').toLowerCase();
  const nonTradeEvent = ['create', 'complete', 'create_pool'].includes(sideHint);
  const candidate = Boolean(data && typeof data === 'object' && !nonTradeEvent && (
    ['buy', 'sell'].includes(sideHint) ||
    (!sideHint && Object.hasOwn(data, 'solAmount'))
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
