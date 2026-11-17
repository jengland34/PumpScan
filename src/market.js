const BASE = 'https://api.dexscreener.com/latest/dex/tokens/';
const CACHE_TTL_MS = 45_000;
const MIN_REQUEST_INTERVAL_MS = 300;
const BASE_429_COOLDOWN_MS = 60_000;
const MAX_429_COOLDOWN_MS = 15 * 60_000;
const cache = new Map();
const cooldowns = new Map();
const failures = new Map();
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
    const wait = Math.max(0, MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt));
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
    return fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'PumpWatch/4.0' },
      signal: AbortSignal.timeout(10_000)
    });
  });
  requestQueue = task.catch(() => {});
  return task;
}

async function fetchMarket(address) {
  const response = await scheduledFetch(`${BASE}${encodeURIComponent(address)}`);
  if (!response.ok) {
    const status = response.status;
    if (status === 429 || status === 403) {
      global429Failures += 1;
      const exponential = Math.min(MAX_429_COOLDOWN_MS, BASE_429_COOLDOWN_MS * (2 ** Math.min(global429Failures - 1, 4)));
      globalCooldownUntil = Date.now() + Math.max(exponential, retryAfterMs(response));
      cooldowns.set(address, globalCooldownUntil);
    }
    throw new Error(`Market data request failed (${status})`);
  }
  const body = await response.json();
  const pairs = (body.pairs || []).filter(p => p.chainId === 'solana' && Number(p.priceUsd) > 0);
  pairs.sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0));
  const p = pairs[0];
  if (!p) throw new Error('No Solana trading pair found for this mint');
  const value = {
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
  cache.set(address, { at: Date.now(), value });
  cooldowns.delete(address);
  failures.delete(address);
  global429Failures = 0;
  globalCooldownUntil = 0;
  return value;
}

export async function getTokenMarket(address) {
  const now = Date.now();
  const cached = cache.get(address);
  if (cached && now - cached.at <= CACHE_TTL_MS) {
    return { ...cached.value, dataStatus: 'cached', dataAgeMs: now - cached.at };
  }
  const until = Math.max(cooldowns.get(address) || 0, globalCooldownUntil);
  if (now < until) {
    const reason = `DexScreener cooldown (${Math.ceil((until - now) / 1000)}s remaining)`;
    const stale = staleSnapshot(address, cached, reason);
    if (stale) return stale;
    throw new Error(reason);
  }
  if (inFlight.has(address)) return inFlight.get(address);
  const request = fetchMarket(address).catch(error => {
    const stale = staleSnapshot(address, cached, error.message);
    if (stale) return stale;
    throw error;
  }).finally(() => inFlight.delete(address));
  inFlight.set(address, request);
  return request;
}

export const MARKET_CACHE_TTL_MS = CACHE_TTL_MS;
export const MARKET_FRESHNESS_LIMIT_MS = 90_000;
