'use strict';

function boundedInteger(value, { fallback, min = 1, max = 100 } = {}) {
  if (value === null || value === undefined || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

module.exports = { boundedInteger };
