'use strict';

function createRateLimiter({ limit = 5, windowMs = 60000, clock = () => Date.now() } = {}) {
  const safeLimit = Math.max(1, Math.floor(Number(limit) || 5));
  const safeWindow = Math.max(1000, Math.floor(Number(windowMs) || 60000));
  let windowStartedAt = clock();
  let used = 0;

  return function allow() {
    const now = clock();
    if (now < windowStartedAt || now - windowStartedAt >= safeWindow) {
      windowStartedAt = now;
      used = 0;
    }
    if (used >= safeLimit) {
      return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((safeWindow - (now - windowStartedAt)) / 1000)) };
    }
    used++;
    return { allowed: true, remaining: safeLimit - used, retryAfterSeconds: 0 };
  };
}

module.exports = { createRateLimiter };
