const BASE = 'https://api.dexscreener.com/tokens/v1/solana/';
const CACHE_TTL_MS = 45_000;
const MIN_REQUEST_INTERVAL_MS = 300;
const BASE_429_COOLDOWN_MS = 60_000;
const MAX_429_COOLDOWN_MS = 15 * 60_000;
const MAX_BATCH_SIZE = 30;
const cache = new Map();
const cooldowns = new Map();
let requestQueue = Promise.resolve();
let lastRequestAt = 0;
let globalCooldownUntil = 0;
let global429Failures = 0;
const inFlight = new Map();

function retryAfterMs(response) {
  const value = response.headers.get('retry-after');
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

function staleSnapshot(address, entry, reason) {
  if (!entry) return null;
  return { ...entry.value, dataStatus: 'stale', dataAgeMs: Date.now() - entry.at, dataError: reason };
}

async function scheduledFetch(url) {
  const task = requestQueue.then(async () => {
    if (Date.now() < globalCooldownUntil) throw new Error(`DexScreener provider cooldown (${Math.ceil((globalCooldownUntil - Date.now()) / 1000)}s remaining)`);
    const wait = Math.max(0, MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt));
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    if (Date.now() < globalCooldownUntil) throw new Error(`DexScreener provider cooldown (${Math.ceil((globalCooldownUntil - Date.now()) / 1000)}s remaining)`);
    lastRequestAt = Date.now();
    return fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'PumpWatch/4.0' },
      signal: AbortSignal.timeout(12_000)
    });
  });
  requestQueue = task.catch(() => {});
  return task;
}

function choosePair(pairs, address) {
  const matching = pairs.filter(p => p.chainId === 'solana' &&
    String(p.baseToken?.address || '').toLowerCase() === address.toLowerCase() &&
    Number(p.priceUsd) > 0);
  matching.sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0));
  return matching[0] || null;
}

function normalizePair(address, p) {
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
    fetchedAt: new Date().toISOString(),
    dataStatus: 'live',
    dataAgeMs: 0
  };
}

async function fetchBatch(addresses) {
  const url = BASE + addresses.map(encodeURIComponent).join(',');
  const response = await scheduledFetch(url);
  if (!response.ok) {
    if (response.status === 429 || response.status === 403) {
      global429Failures += 1;
      const exponential = Math.min(MAX_429_COOLDOWN_MS, BASE_429_COOLDOWN_MS * (2 ** Math.min(global429Failures - 1, 4)));
      globalCooldownUntil = Date.now() + Math.max(exponential, retryAfterMs(response));
    }
    throw new Error(`Market data request failed (${response.status})`);
  }
  const body = await response.json();
  const pairs = Array.isArray(body) ? body : Array.isArray(body.pairs) ? body.pairs : [];
  const now = Date.now();
  for (const address of addresses) {
    const pair = choosePair(pairs, address);
    if (!pair) continue;
    const value = normalizePair(address, pair);
    cache.set(address, { at: now, value });
    cooldowns.delete(address);
  }
  global429Failures = 0;
  globalCooldownUntil = 0;
}

export async function getTokenMarkets(addresses = []) {
  const unique = [...new Set(addresses.filter(x => typeof x === 'string' && x.length > 0))];
  const result = new Map();
  const pending = [];
  const now = Date.now();
  for (const address of unique) {
    const cached = cache.get(address);
    if (cached && now - cached.at <= CACHE_TTL_MS) {
      result.set(address, { value: { ...cached.value, dataStatus: 'cached', dataAgeMs: now - cached.at } });
    } else if (inFlight.has(address)) {
      result.set(address, { promise: inFlight.get(address) });
    } else {
      pending.push(address);
    }
  }

  for (let i = 0; i < pending.length; i += MAX_BATCH_SIZE) {
    const batch = pending.slice(i, i + MAX_BATCH_SIZE);
    const blockedUntil = Math.max(globalCooldownUntil, ...batch.map(a => cooldowns.get(a) || 0));
    if (Date.now() < blockedUntil) {
      const reason = `DexScreener cooldown (${Math.ceil((blockedUntil - Date.now()) / 1000)}s remaining)`;
      for (const address of batch) {
        const stale = staleSnapshot(address, cache.get(address), reason);
        result.set(address, stale ? { value: stale } : { error: new Error(reason) });
      }
      continue;
    }
    const task = fetchBatch(batch);
    for (const address of batch) inFlight.set(address, task);
    try {
      await task;
      for (const address of batch) {
        const entry = cache.get(address);
        result.set(address, entry ? { value: { ...entry.value } } : { error: new Error('No fresh Solana trading pair found for this mint') });
      }
    } catch (error) {
      for (const address of batch) {
        const stale = staleSnapshot(address, cache.get(address), error.message);
        result.set(address, stale ? { value: stale } : { error });
      }
    } finally {
      for (const address of batch) inFlight.delete(address);
    }
  }

  for (const [address, entry] of result) {
    if (entry.promise) {
      try { result.set(address, { value: await entry.promise.then(() => {
        const cached = cache.get(address);
        return cached ? { ...cached.value } : null;
      }) }); }
      catch (error) { result.set(address, { error }); }
    }
  }
  return result;
}

export async function getTokenMarket(address) {
  const result = await getTokenMarkets([address]);
  const entry = result.get(address);
  if (entry?.value) return entry.value;
  throw entry?.error || new Error('Market data unavailable');
}

export const MARKET_CACHE_TTL_MS = CACHE_TTL_MS;
export const MARKET_FRESHNESS_LIMIT_MS = 90_000;
