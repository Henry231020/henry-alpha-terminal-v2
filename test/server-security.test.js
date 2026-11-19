'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('dashboard API does not expose wildcard cross-origin access', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.doesNotMatch(server, /Access-Control-Allow-Origin['"]\s*,\s*['"]\*['"]/);
  assert.match(server, /X-Content-Type-Options/);
  assert.match(server, /Referrer-Policy/);
  assert.match(server, /X-Frame-Options/);
  assert.match(server, /Permissions-Policy/);
  assert.match(server, /Content-Security-Policy/);
  assert.match(server, /object-src 'none'/);
  assert.match(server, /new URL\(origin\)\.host !== req\.headers\.host/);
  assert.match(server, /Origin not allowed/);
});
