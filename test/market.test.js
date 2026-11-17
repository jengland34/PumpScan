import test from 'node:test';
import assert from 'node:assert/strict';
import { getTokenMarkets } from '../src/market.js';

test('market snapshots are fetched in batches of at most 30 mints', async () => {
  const originalFetch = globalThis.fetch;
  const addresses = Array.from({ length: 31 }, (_, i) => 'Mint' + i.toString(36).padStart(36, '0'));
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(String(url));
    const raw = String(url).split('/').pop();
    const mints = raw.split(',').map(decodeURIComponent);
    return new Response(JSON.stringify(mints.map((address, i) => ({
      chainId: 'solana',
      baseToken: { address, name: 'Token ' + address.slice(-2), symbol: 'T' + address.slice(-2) },
      priceUsd: '0.001',
      liquidity: { usd: 25000 + i },
      volume: { h24: 100000, m5: 5000 },
      txns: { m5: { buys: 40, sells: 10 } },
      priceChange: { h24: 10, m5: 3 },
      pairAddress: 'Pair' + address,
      pairCreatedAt: 1760000000000
    }))), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await getTokenMarkets(addresses);
    assert.equal(calls.length, 2);
    assert.ok(calls.every(url => url.includes('/tokens/v1/solana/')));
    assert.equal(result.size, 31);
    for (const address of addresses) {
      const item = result.get(address);
      assert.equal(item.value.address, address);
      assert.equal(item.value.dataStatus, 'live');
      assert.equal(item.value.volume5mUsd, 5000);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('429 responses activate provider-wide cooldown without retry storms', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response('rate limited', { status: 429, headers: { 'retry-after': '60' } });
  };
  try {
    const first = await getTokenMarkets(['RateLimitMint111111111111111111111111111111']);
    const second = await getTokenMarkets(['RateLimitMint222222222222222222222222222222']);
    assert.ok(first.get('RateLimitMint111111111111111111111111111111').error);
    assert.ok(second.get('RateLimitMint222222222222222222222222222222').error);
    assert.equal(calls, 3); // initial batch, first fallback, then fallback-only retry during cooldown
  } finally {
    globalThis.fetch = originalFetch;
  }
});
