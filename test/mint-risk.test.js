'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMintAccountInfo } = require('../lib/mint-risk');

function account({ mintAuthority = false, freezeAuthority = false, initialized = true } = {}) {
  const bytes = Buffer.alloc(82);
  bytes.writeUInt32LE(mintAuthority ? 1 : 0, 0);
  bytes[45] = initialized ? 1 : 0;
  bytes.writeUInt32LE(freezeAuthority ? 1 : 0, 46);
  return { value: { owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', data: [bytes.toString('base64'), 'base64'] } };
}

test('detects revoked mint and freeze authorities', () => {
  const result = parseMintAccountInfo(account());
  assert.equal(result.status, 'observed');
  assert.equal(result.mintAuthorityRevoked, true);
  assert.equal(result.freezeAuthorityRevoked, true);
  assert.equal(result.initialized, true);
});

test('flags active mint and freeze authorities', () => {
  const result = parseMintAccountInfo(account({ mintAuthority: true, freezeAuthority: true }));
  assert.equal(result.mintAuthorityRevoked, false);
  assert.equal(result.freezeAuthorityRevoked, false);
});

test('returns unknown for incomplete mint account data', () => {
  assert.equal(parseMintAccountInfo(null).status, 'unknown');
  assert.equal(parseMintAccountInfo({ value: { data: ['AA==', 'base64'] } }).status, 'unknown');
});
