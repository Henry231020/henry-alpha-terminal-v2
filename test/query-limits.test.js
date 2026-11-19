'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { boundedInteger } = require('../lib/query-limits');

test('uses fallback for missing, blank, malformed and non-integer limits', () => {
  for (const value of [null, undefined, '', '  ', 'abc', '1.5', NaN, Infinity]) {
    assert.equal(boundedInteger(value, { fallback: 25, min: 1, max: 100 }), 25);
  }
});

test('clamps safe integers to the configured bounds', () => {
  assert.equal(boundedInteger('0', { fallback: 25, min: 1, max: 100 }), 1);
  assert.equal(boundedInteger('-5', { fallback: 25, min: 1, max: 100 }), 1);
  assert.equal(boundedInteger('500', { fallback: 25, min: 1, max: 100 }), 100);
  assert.equal(boundedInteger('42', { fallback: 25, min: 1, max: 100 }), 42);
});

test('does not accept unsafe integer precision', () => {
  assert.equal(boundedInteger('9007199254740992', { fallback: 25, min: 1, max: 100 }), 25);
});
