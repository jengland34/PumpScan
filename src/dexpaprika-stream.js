// DexPaprika live Solana token-price feed (SSE).
// One free-key stream supports up to 25 tokens; keep one stream per PumpWatch instance.
const ENDPOINT = 'https://streaming.dexpaprika.com/sse/prices';
let desired = new Set();
let activeKey = '';
let controller = null;
let restartTimer = null;
let retryTimer = null;
let retryDelayMs = 3000;
let onPriceHandler = () => {};
let onStatusHandler = () => {};
let stopped = false;

function emitStatus(state, detail = null) {
  try { onStatusHandler({ state, detail, tokens: desired.size }); } catch {}
}
function parseFrame(lines) {
  let event = 'message', data = '';
  for (const line of lines) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += (data ? '\n' : '') + line.slice(5).trimStart();
  }
  if (!data) return;
  let value;
  try { value = JSON.parse(data); } catch { return; }
  if (event === 'token_price') {
    const address = String(value.address || '').trim();
    const priceUsd = Number(value.price);
    const timestamp = Number(value.timestamp || Date.now() / 1000);
    if (address && Number.isFinite(priceUsd) && priceUsd > 0) {
      try { onPriceHandler({ address, priceUsd, timestamp, receivedAt: Date.now() }); } catch {}
    }
  } else if (event === 'error' || event === 'warning') {
    emitStatus(event, data.slice(0, 240));
  }
}

async function consume(signal, key) {
  const assets = [...desired].slice(-25).map(address => ({ chain: 'solana', address, method: 'token_price' }));
  if (!assets.length) return;
  const headers = { accept: 'text/event-stream', 'content-type': 'application/json' };
  if (process.env.DEXPAPRIKA_API_KEY) headers.Authorization = process.env.DEXPAPRIKA_API_KEY;
  emitStatus('connecting');
  const response = await fetch(ENDPOINT, {
    method: 'POST', headers, body: JSON.stringify(assets), signal,
    // Node fetch uses HTTP/1.1 for this origin; do not buffer SSE.
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 240);
    throw new Error('DexPaprika price stream HTTP ' + response.status + (detail ? ': ' + detail : ''));
  }
  if (!response.body) throw new Error('DexPaprika price stream returned no response body');
  emitStatus('connected');
  retryDelayMs = 3000;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', frame = [];
  try {
    while (!signal.aborted && key === activeKey) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, boundary).replace(/\r$/, '');
        buffer = buffer.slice(boundary + 1);
        if (!line) { parseFrame(frame); frame = []; }
        else if (!line.startsWith(':')) frame.push(line);
      }
    }
  } finally {
    try { await reader.cancel(); } catch {}
  }
}

function scheduleRestart() {
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    if (stopped || desired.size === 0) return;
    const key = [...desired].slice(-25).sort().join('|');
    if (key === activeKey && controller && !controller.signal.aborted) return;
    activeKey = key;
    controller?.abort();
    controller = new AbortController();
    const localController = controller;
    consume(localController.signal, key).catch(error => {
      if (localController.signal.aborted || stopped) return;
      emitStatus('error', error.message);
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        retryDelayMs = Math.min(30_000, retryDelayMs * 2);
        activeKey = '';
        scheduleRestart();
      }, retryDelayMs);
    });
  }, 500);
}

export function subscribeDexPaprikaPrices(addresses = [], onPrice = () => {}, onStatus = () => {}) {
  stopped = false;
  onPriceHandler = onPrice;
  onStatusHandler = onStatus;
  for (const address of addresses) if (typeof address === 'string' && address) desired.add(address);
  if (desired.size > 25) desired = new Set([...desired].slice(-25));
  scheduleRestart();
  return {
    add(address) {
      if (!address || desired.has(address)) return;
      desired.add(address);
      if (desired.size > 25) desired.delete(desired.values().next().value);
      scheduleRestart();
    },
    stop() {
      stopped = true;
      if (restartTimer) clearTimeout(restartTimer);
      if (retryTimer) clearTimeout(retryTimer);
      controller?.abort();
      desired.clear(); activeKey = '';
      emitStatus('stopped');
    }
  };
}
