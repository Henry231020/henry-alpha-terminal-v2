'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('selected-token detail endpoint exists and returns the dashboard contract', () => {
  const routeStart = serverSource.indexOf("if (url.pathname.startsWith('/api/token/'))");
  const routeEnd = serverSource.indexOf("if (url.pathname === '/api/tokens')", routeStart);
  assert.ok(routeStart >= 0, 'selected-token route must be registered');
  assert.ok(routeEnd > routeStart, 'selected-token route must be before the token-list route');
  const route = serverSource.slice(routeStart, routeEnd);
  assert.match(route, /tokens\.get\(mint\)/);
  assert.match(route, /subscribeMintTrades\(mint\)/);
  assert.match(route, /await refreshOneToken\(mint\)/);
  assert.match(route, /token: current/);
  assert.match(route, /recentEvents: recentTokenEvents/);
  assert.match(route, /dataNotes: \{ market: marketNote \}/);
});

test('selected-token route fails closed for unknown tokens', () => {
  const routeStart = serverSource.indexOf("if (url.pathname.startsWith('/api/token/'))");
  const routeEnd = serverSource.indexOf("if (url.pathname === '/api/tokens')", routeStart);
  const route = serverSource.slice(routeStart, routeEnd);
  assert.match(route, /if \(!token\) return sendJson\(res, 404/);
});

test('does not register a second unreachable token detail route', () => {
  assert.equal((serverSource.match(/url\.pathname\.match\(\^\\\\\/api\\\\\/token/g) || []).length, 0);
});
