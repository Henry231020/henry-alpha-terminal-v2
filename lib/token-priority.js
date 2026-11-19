'use strict';

function newestTokenMints(tokens, limit = 20) {
  if (!Array.isArray(tokens)) return [];
  const safeLimit = Math.max(0, Math.min(2000, Math.floor(Number(limit) || 0)));
  return tokens
    .filter(token => token && typeof token.mint === 'string' && token.mint)
    .sort((a, b) => {
      const aTime = Date.parse(a.firstSeenAt || '') || 0;
      const bTime = Date.parse(b.firstSeenAt || '') || 0;
      return bTime - aTime;
    })
    .slice(0, safeLimit)
    .map(token => token.mint);
}

function prioritisedTokenMints(tokens, selectedMints = [], limit = 20) {
  if (!Array.isArray(tokens)) return [];
  const safeLimit = Math.max(0, Math.min(2000, Math.floor(Number(limit) || 0)));
  if (!safeLimit) return [];
  const known = new Set(tokens.filter(token => token && typeof token.mint === 'string').map(token => token.mint));
  const selected = [];
  const seen = new Set();
  for (const mint of selectedMints) {
    if (typeof mint === 'string' && known.has(mint) && !seen.has(mint)) {
      selected.push(mint);
      seen.add(mint);
      if (selected.length >= safeLimit) return selected;
    }
  }
  for (const mint of newestTokenMints(tokens, safeLimit)) {
    if (!seen.has(mint)) {
      selected.push(mint);
      seen.add(mint);
      if (selected.length >= safeLimit) break;
    }
  }
  return selected;
}

module.exports = { newestTokenMints, prioritisedTokenMints };
