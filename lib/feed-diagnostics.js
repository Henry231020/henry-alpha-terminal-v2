'use strict';

function createFeedDiagnostics() {
  const state = {
    messagesReceived: 0,
    validTradeMessages: 0,
    rejectedTradeCandidates: 0,
    malformedJsonMessages: 0,
    lastMessageAt: null,
    lastValidTradeAt: null,
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
    snapshot() {
      return { ...state };
    }
  };
}

module.exports = { createFeedDiagnostics };
