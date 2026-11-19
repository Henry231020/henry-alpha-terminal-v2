'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('dashboard inline JavaScript parses without syntax errors', () => {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length > 0, 'dashboard script block is missing');
  for (const script of scripts) assert.doesNotThrow(() => new vm.Script(script[1]));
});

test('selected token refreshes market data and refreshes its BUY/SELL analysis', () => {
  assert.match(html, /api\('\/api\/token\/'\+encodeURIComponent\(state\.selectedMint\)\)/);
  assert.match(html, /api\('\/api\/pressure\?mint='\+encodeURIComponent\(current\.mint\)\)/);
});

test('paper learning panel renders entry factors and exit outcomes', () => {
  assert.match(html, /learning\.factorStats/);
  assert.match(html, /learning\.exitStats/);
  assert.match(html, /WHAT ENTRY CONDITIONS HAVE WORKED/);
  assert.match(html, /HOW EXIT SIGNALS PERFORMED/);
});


test('wallet coverage is shown as unverified rather than zero when evidence is missing', () => {
  assert.match(html, /walletCoverageMarkup\(wi\)/);
  assert.match(html, /hasRows\?number\(wi\.uniqueBuyers\):'UNVERIFIED'/);
  assert.match(html, /earlyVerified\?number\(wi\.earlyBuyers\):'UNVERIFIED'/);
  assert.doesNotMatch(html, /number\(wi\.uniqueBuyers\|\|0\)/);
});
