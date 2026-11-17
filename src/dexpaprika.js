// Shared conservative limiter for every DexPaprika REST call in this process.
// Keyless limits are shared by outbound IP, so do not burst per-token fallback calls.
const MIN_INTERVAL_MS = 8_500;
const MAX_PER_MINUTE = 6;
const WINDOW_MS = 60_000;
let queue = Promise.resolve();
let lastRequestAt = 0;
let requestTimes = [];
let blockedUntil = 0;
let blockedReason = '';

function retryAfterMs(response) {
  const value = response.headers.get('retry-after');
  if (!value) return 60_000;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(1_000, date - Date.now()) : 60_000;
}

export function dexPaprikaFetch(url, options = {}) {
  const task = queue.then(async () => {
    const now = Date.now();
    if (now < blockedUntil) throw new Error('DexPaprika cooldown (' + Math.ceil((blockedUntil - now) / 1000) + 's remaining): ' + blockedReason);
    requestTimes = requestTimes.filter(t => now - t < WINDOW_MS);
    if (requestTimes.length >= MAX_PER_MINUTE) throw new Error('DexPaprika safety limit reached (6 requests/minute); waiting for next window');
    const wait = Math.max(0, MIN_INTERVAL_MS - (now - lastRequestAt));
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    const afterWait = Date.now();
    if (afterWait < blockedUntil) throw new Error('DexPaprika cooldown (' + Math.ceil((blockedUntil - afterWait) / 1000) + 's remaining): ' + blockedReason);
    requestTimes = requestTimes.filter(t => afterWait - t < WINDOW_MS);
    if (requestTimes.length >= MAX_PER_MINUTE) throw new Error('DexPaprika safety limit reached (6 requests/minute); waiting for next window');
    lastRequestAt = afterWait;
    requestTimes.push(afterWait);
    const headers = { accept: 'application/json', 'user-agent': 'PumpWatch/4.0', ...(options.headers || {}) };
    if (process.env.DEXPAPRIKA_API_KEY) headers.Authorization = process.env.DEXPAPRIKA_API_KEY;
    const response = await fetch(url, { ...options, headers, signal: options.signal || AbortSignal.timeout(12_000) });
    if (response.status === 429) {
      const waitMs = retryAfterMs(response);
      blockedUntil = Date.now() + waitMs;
      blockedReason = 'HTTP 429 rate limit; Retry-After ' + Math.ceil(waitMs / 1000) + 's';
    }
    return response;
  });
  queue = task.catch(() => {});
  return task;
}

export function dexPaprikaLimiterStatus() {
  const now = Date.now();
  requestTimes = requestTimes.filter(t => now - t < WINDOW_MS);
  return { requestsLastMinute: requestTimes.length, maxPerMinute: MAX_PER_MINUTE, cooldownSeconds: Math.max(0, Math.ceil((blockedUntil - now) / 1000)) };
}
