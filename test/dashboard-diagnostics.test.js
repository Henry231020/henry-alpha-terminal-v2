const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('dashboard contains all live trade feed diagnostic counters', () => {
  for (const id of ['tradeFeedState', 'feedMessages', 'feedValidTrades', 'feedRecordedTrades', 'feedPriceUnavailable', 'feedStoreRejected', 'feedRejectedTrades', 'feedMalformed', 'feedLastSeen']) {
    assert.match(html, new RegExp('id="' + id + '"'), 'missing dashboard element: ' + id);
  }
});

test('dashboard reads free GeckoTerminal diagnostics from status endpoint without enabling trading', () => {
  assert.match(html, /api\('\\/api\\/status'\)/);
  assert.match(html, /status\.geckoTradeFeed/);
  assert.match(html, /gecko\.calls/);
  assert.match(html, /gecko\.tradesSeen/);
  assert.match(html, /gecko\.tradesRecorded/);
  assert.match(html, /gecko\.duplicateOrStale/);
  assert.match(html, /gecko\.errors/);
  assert.match(html, /Last pool trade/);
  assert.match(html, /Free GeckoTerminal public API/);
  assert.match(html, /No automatic real-money trading/);
});

test('token detail requests Helius and RugCheck risk and labels incomplete results unverified', () => {
  assert.match(html, /api\('\/api\/risk\/'\+encodeURIComponent\(mint\)\)/);
  assert.match(html, /TOKEN SECURITY & HOLDER RISK/);
  assert.match(html, /RugCheck classification/);
  assert.match(html, /wallet-risk gate remains closed/);
  assert.match(html, /riskByMint\[mint\]=riskResult/);
  assert.match(html, /No automatic real-money trading/);
});
