'use strict';

// Jupiter Swap API V2 client. This module never stores or derives a wallet key.
// The caller must provide a signer callback and keep signing authority outside ChatGPT.
const DEFAULT_BASE_URL = 'https://api.jup.ag/swap/v2';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

function createJupiterClient(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const apiKey = options.apiKey || process.env.JUPITER_API_KEY || '';
  const baseUrl = String(options.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  const timeoutMs = Number(options.timeoutMs || 12000);

  async function request(path, init = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = { accept: 'application/json', ...(init.headers || {}) };
      if (apiKey) headers['x-api-key'] = apiKey;
      const response = await fetchImpl(baseUrl + path, {
        ...init,
        headers,
        signal: controller.signal
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = body && (body.error || body.message);
        throw new Error('Jupiter HTTP ' + response.status + (message ? ': ' + String(message) : ''));
      }
      return body;
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('Jupiter request timed out');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function getOrder({ inputMint, outputMint, amount, taker, slippageBps }) {
    if (!inputMint || !outputMint || inputMint === outputMint) throw new Error('Valid, different inputMint and outputMint are required');
    if (!/^\d+$/.test(String(amount)) || Number(amount) <= 0) throw new Error('amount must be a positive integer in base units');
    if (!taker) throw new Error('taker wallet address is required');
    const query = new URLSearchParams({
      inputMint: String(inputMint),
      outputMint: String(outputMint),
      amount: String(amount),
      taker: String(taker)
    });
    if (Number.isInteger(slippageBps) && slippageBps >= 0) query.set('slippageBps', String(slippageBps));
    const order = await request('/order?' + query.toString());
    if (!order || !order.transaction || !order.requestId) throw new Error('Jupiter did not return a signable order');
    return order;
  }

  async function execute({ signedTransaction, requestId, lastValidBlockHeight }) {
    if (!signedTransaction || !requestId) throw new Error('signedTransaction and requestId are required');
    const payload = { signedTransaction: String(signedTransaction), requestId: String(requestId) };
    if (Number.isFinite(Number(lastValidBlockHeight))) payload.lastValidBlockHeight = Number(lastValidBlockHeight);
    return request('/execute', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  async function swap({ inputMint, outputMint, amount, taker, slippageBps, signTransaction }) {
    if (typeof signTransaction !== 'function') throw new Error('A wallet signTransaction callback is required');
    const order = await getOrder({ inputMint, outputMint, amount, taker, slippageBps });
    const signedTransaction = await signTransaction(order.transaction);
    if (typeof signedTransaction !== 'string' || !signedTransaction) throw new Error('Signer did not return a base64 signed transaction');
    const result = await execute({
      signedTransaction,
      requestId: order.requestId,
      lastValidBlockHeight: order.lastValidBlockHeight
    });
    return { order, result };
  }

  return { getOrder, execute, swap };
}

module.exports = { createJupiterClient, SOL_MINT };
