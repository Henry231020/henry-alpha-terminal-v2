'use strict';

const { isIP } = require('node:net');

function isPrivateIpv4(address) {
  const octets = address.split('.').map(Number);
  const [a,b] = octets;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19));
}

function isPrivateIpv6(address) {
  const value = address.toLowerCase();
  if (value === '::' || value === '::1' || value.startsWith('fc') ||
      value.startsWith('fd') || /^fe[89ab]/.test(value) || value.startsWith('ff')) return true;
  const dottedMapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dottedMapped) return isPrivateIpv4(dottedMapped[1]);
  const hexMapped = value.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const high = parseInt(hexMapped[1], 16), low = parseInt(hexMapped[2], 16);
    return isPrivateIpv4([high >> 8, high & 255, low >> 8, low & 255].join('.'));
  }
  return false;
}

function isSafeMetadataUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (!host || host === 'localhost' || host.endsWith('.localhost') ||
        host.endsWith('.local') || host.endsWith('.internal') ||
        host === 'metadata.google.internal') return false;
    const ipVersion = isIP(host);
    if (ipVersion === 4 && isPrivateIpv4(host)) return false;
    if (ipVersion === 6 && isPrivateIpv6(host)) return false;
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { isSafeMetadataUrl, isPrivateIpv4, isPrivateIpv6 };
