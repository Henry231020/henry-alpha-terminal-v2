'use strict';

function createFeedDiagnostics() {
  const state = {
    messagesReceived: 0,
    validTradeMessages: 0,
    recordedTrades: 0,
    priceUnavailable: 0,
    storeRejectedTrades: 0,
    rejectedTradeCandidates: 0,
    malformedJsonMessages: 0,
    lastMessageAt: null,
    lastValidTradeAt: null,
    lastRecordedTradeAt: null,
    lastProcessingIssue: null,
    lastRejectedReason: null
  };

  return {
    state,
    recordMessage(at = new Date().toISOString()) {
      state.messagesReceived++;
      state.lastMessageAt = at;
    },
    recordMalformedJson() {
      state.malformedJsonMessages++;
    },
    recordRejected(reason) {
      state.rejectedTradeCandidates++;
      state.lastRejectedReason = reason;
    },
    recordValidTrade(at = new Date().toISOString()) {
      state.validTradeMessages++;
      state.lastValidTradeAt = at;
      state.lastRejectedReason = null;
    },
    recordPriceUnavailable() {
      state.priceUnavailable++;
      state.lastProcessingIssue = 'SOL/USD price unavailable; validated trade was not recorded';
    },
    recordStoreRejected(reason = 'Pressure store rejected trade') {
      state.storeRejectedTrades++;
      state.lastProcessingIssue = reason;
    },
    recordTradeRecorded(at = new Date().toISOString()) {
      state.recordedTrades++;
      state.lastRecordedTradeAt = at;
      state.lastProcessingIssue = null;
    },
    snapshot() {
      return { ...state };
    }
  };
}

module.exports = { createFeedDiagnostics };
