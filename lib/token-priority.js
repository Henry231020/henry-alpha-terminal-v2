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

module.exports = { newestTokenMints };
