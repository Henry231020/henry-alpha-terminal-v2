'use strict';

function parseMintAccountInfo(accountInfo) {
  const value = accountInfo && accountInfo.value;
  const data = value && value.data;
  if (!value || !Array.isArray(data) || typeof data[0] !== 'string' || data[1] !== 'base64') {
    return { status: 'unknown', reason: 'Mint account data unavailable', mintAuthorityRevoked: null, freezeAuthorityRevoked: null, initialized: null, tokenProgram: value && value.owner || null };
  }
  let bytes;
  try { bytes = Buffer.from(data[0], 'base64'); } catch (_) {
    return { status: 'unknown', reason: 'Mint account data could not be decoded', mintAuthorityRevoked: null, freezeAuthorityRevoked: null, initialized: null, tokenProgram: value.owner || null };
  }
  if (bytes.length < 82) {
    return { status: 'unknown', reason: 'Mint account data is shorter than the SPL mint layout', mintAuthorityRevoked: null, freezeAuthorityRevoked: null, initialized: null, tokenProgram: value.owner || null };
  }
  const mintAuthorityOption = bytes.readUInt32LE(0);
  const freezeAuthorityOption = bytes.readUInt32LE(46);
  if (![0, 1].includes(mintAuthorityOption) || ![0, 1].includes(freezeAuthorityOption)) {
    return { status: 'unknown', reason: 'Mint authority option fields are invalid', mintAuthorityRevoked: null, freezeAuthorityRevoked: null, initialized: null, tokenProgram: value.owner || null };
  }
  const initialized = bytes[45] === 1;
  return {
    status: 'observed',
    reason: 'Base SPL mint fields decoded from on-chain account data; Token-2022 extensions are not assessed here',
    mintAuthorityRevoked: mintAuthorityOption === 0,
    freezeAuthorityRevoked: freezeAuthorityOption === 0,
    initialized,
    tokenProgram: value.owner || null
  };
}

module.exports = { parseMintAccountInfo };
