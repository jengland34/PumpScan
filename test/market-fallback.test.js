import test from 'node:test';
import assert from 'node:assert/strict';
import { getTokenMarkets } from '../src/market.js';

test('DexPaprika supplies live five-minute metrics when DexScreener is rate limited', async () => {
  const originalFetch = globalThis.fetch;
  const mint = 'FallbackMint111111111111111111111111111111';
  globalThis.fetch = async url => {
    if (String(url).includes('api.dexscreener.com')) return new Response('rate limited', { status: 429, headers: { 'retry-after': '60' } });
    assert.ok(String(url).includes('/networks/solana/tokens/' + mint));
    return new Response(JSON.stringify({
      id: mint, name: 'Fallback Token', symbol: 'FALL',
      summary: { price_usd: 0.002, liquidity_usd: 42000, fdv: 250000,
        '24h': { volume_usd: 90000, last_price_usd_change: 12 },
        '5m': { volume_usd: 4200, buys: 55, sells: 18, last_price_usd_change: 2.5 } }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await getTokenMarkets([mint]);
    const market = result.get(mint).value;
    assert.equal(market.dataStatus, 'live');
    assert.equal(market.marketDataSource, 'DexPaprika fallback');
    assert.equal(market.priceUsd, 0.002);
    assert.equal(market.liquidityUsd, 42000);
    assert.equal(market.volume5mUsd, 4200);
    assert.equal(market.buys5m, 55);
    assert.equal(market.sells5m, 18);
  } finally { globalThis.fetch = originalFetch; }
});
