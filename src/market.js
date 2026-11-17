const BASE = 'https://api.dexscreener.com/latest/dex/tokens/';
export async function getTokenMarket(address) {
  const response = await fetch(`${BASE}${encodeURIComponent(address)}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Market data request failed (${response.status})`);
  const body = await response.json();
  const pairs = (body.pairs || []).filter(p => p.chainId === 'solana' && Number(p.priceUsd) > 0);
  pairs.sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0));
  const p = pairs[0];
  if (!p) throw new Error('No Solana trading pair found for this mint');
  return {
    address,
    name: p.baseToken?.name || 'Unknown token',
    symbol: p.baseToken?.symbol || 'TOKEN',
    priceUsd: Number(p.priceUsd),
    liquidityUsd: Number(p.liquidity?.usd || 0),
    volume24hUsd: Number(p.volume?.h24 || 0),
    marketCapUsd: Number(p.marketCap || p.fdv || 0),
    pairAddress: p.pairAddress,
    dexId: p.dexId,
    url: p.url,
    priceChange24h: Number(p.priceChange?.h24 || 0),
    priceChange5m: Number(p.priceChange?.m5 || 0),
    volume5mUsd: Number(p.volume?.m5 || 0),
    buys5m: Number(p.txns?.m5?.buys || 0),
    sells5m: Number(p.txns?.m5?.sells || 0),
    pairCreatedAt: p.pairCreatedAt || null,
    raw: p,
    fetchedAt: new Date().toISOString()
  };
}
