'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isSafeMetadataUrl, isPrivateIpv4, isPrivateIpv6 } = require('../lib/safe-metadata-url');

test('allows public HTTPS metadata hosts on the standard port', () => {
  assert.equal(isSafeMetadataUrl('https://metadata.example.com/token.json'), true);
  assert.equal(isSafeMetadataUrl('https://ipfs.io/ipfs/QmExample'), true);
});

test('rejects non-HTTPS, credentialed and non-standard-port URLs', () => {
  assert.equal(isSafeMetadataUrl('http://metadata.example.com/a'), false);
  assert.equal(isSafeMetadataUrl('https://user:pass@metadata.example.com/a'), false);
  assert.equal(isSafeMetadataUrl('https://metadata.example.com:8443/a'), false);
});

test('rejects localhost, internal names and private IPv4 destinations', () => {
  for (const host of ['localhost', 'node.localhost', 'router.local', 'service.internal', 'metadata.google.internal', '127.0.0.1', '10.0.0.8', '169.254.169.254', '192.168.1.2']) {
    assert.equal(isSafeMetadataUrl('https://' + host + '/metadata'), false, host);
  }
});

test('rejects private IPv6 and IPv4-mapped private IPv6 destinations', () => {
  assert.equal(isSafeMetadataUrl('https://[::1]/metadata'), false);
  assert.equal(isSafeMetadataUrl('https://[fd00::1]/metadata'), false);
  assert.equal(isSafeMetadataUrl('https://[fe80::1]/metadata'), false);
  assert.equal(isPrivateIpv6('::ffff:7f00:1'), true);
});

test('classifies reserved IPv4 ranges conservatively', () => {
  assert.equal(isPrivateIpv4('100.64.0.1'), true);
  assert.equal(isPrivateIpv4('172.20.0.1'), true);
  assert.equal(isPrivateIpv4('8.8.8.8'), false);
  assert.equal(isSafeMetadataUrl('not a url'), false);
});
