'use strict';

function pressureAlertSignal(analysis = {}) {
  const action = analysis.tradeDecision?.action;
  if (action === 'BUY SETUP') return 'BUY SETUP';
  if (action === 'SELL / EXIT WARNING') return 'SELL / EXIT WARNING';
  if (analysis.signal === 'URGENT DUMP PRESSURE') return 'URGENT DUMP PRESSURE';
  if (analysis.signal === 'BUY PRESSURE CONFIRMED (ALERT ONLY)') return 'BUY PRESSURE CONFIRMED (ALERT ONLY)';
  return null;
}

module.exports = { pressureAlertSignal };
