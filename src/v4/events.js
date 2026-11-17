export function normaliseBitqueryTrade(row, receivedAt = new Date().toISOString()) {
  const trade = row?.Trade || {};
  const pair = row?.Pair || {};
  const token = pair.Token || {};
  const side = String(row?.Side || '').toLowerCase();
  const trader = row?.Trader?.Address || row?.TransactionHeader?.Sender || null;
  const signature = row?.TransactionHeader?.Hash || null;
  const index = row?.TransactionHeader?.Index ?? 0;
  const mint = token.Address || token.Id || token.TokenId || null;
  const usd = Number(row?.AmountsInUsd?.Base ?? row?.AmountsInUsd?.Quote ?? 0);
  const priceUsd = Number(row?.Price ?? row?.PriceInUsd ?? 0);
  const timestamp = row?.Block?.Timestamp || row?.Block?.Time || receivedAt;
  if (!mint || !signature || !['buy','sell'].includes(side) || !(usd > 0)) return null;
  const parsedTime = typeof timestamp === 'number' ? new Date(timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp) : new Date(timestamp);
  if (!Number.isFinite(parsedTime.getTime())) return null;
  const occurredAt = parsedTime.toISOString();
  return {
    id: `${signature}:${index}`, chain: 'solana', provider: 'bitquery',
    mint, symbol: token.Symbol || pair.Currency?.Symbol || 'UNKNOWN',
    tokenName: token.Name || pair.Currency?.Name || null,
    pool: pair.Market?.Address || null, protocol: pair.Market?.Program || null,
    side, trader, usd, priceUsd: Number.isFinite(priceUsd) && priceUsd > 0 ? priceUsd : null,
    baseAmount: Number(row?.Amounts?.Base || 0), quoteAmount: Number(row?.Amounts?.Quote || 0),
    signature, index: Number(index), occurredAt, receivedAt
  };
}

export function createEventBuffer({ maxEventsPerToken = 5000, windowsMs = [10_000,60_000,300_000,900_000,3_600_000] } = {}) {
  const events = new Map(), seen = new Map();
  function add(event) {
    if (!event?.mint || !event.id) return false;
    if (seen.has(event.id)) return false;
    const now = Date.parse(event.receivedAt || new Date().toISOString());
    seen.set(event.id, now);
    const rows = events.get(event.mint) || [];
    rows.push(event);
    const cutoff = now - Math.max(...windowsMs);
    while (rows.length && Date.parse(rows[0].receivedAt) < cutoff) rows.shift();
    if (rows.length > maxEventsPerToken) rows.splice(0, rows.length - maxEventsPerToken);
    events.set(event.mint, rows);
    if (seen.size > maxEventsPerToken * 20) {
      for (const [id, at] of seen) if (at < cutoff) seen.delete(id);
    }
    return true;
  }
  function snapshot(mint, at = Date.now()) {
    const rows = events.get(mint) || [];
    const result = {};
    for (const windowMs of windowsMs) {
      const selected = rows.filter(e => at - Date.parse(e.receivedAt) <= windowMs);
      const buys = selected.filter(e => e.side === 'buy'), sells = selected.filter(e => e.side === 'sell');
      const sum = list => list.reduce((n,e)=>n+e.usd,0);
      result[windowMs] = {
        windowMs, trades: selected.length, buys: buys.length, sells: sells.length,
        buyUsd: sum(buys), sellUsd: sum(sells), netBuyUsd: sum(buys)-sum(sells),
        uniqueBuyers: new Set(buys.map(e=>e.trader).filter(Boolean)).size,
        uniqueSellers: new Set(sells.map(e=>e.trader).filter(Boolean)).size,
        latestPriceUsd: [...selected].reverse().find(e=>e.priceUsd)?.priceUsd ?? null,
        topBuyerShare: (()=>{const m=new Map();for(const e of buys)if(e.trader)m.set(e.trader,(m.get(e.trader)||0)+e.usd);const total=sum(buys);return total?Math.max(0,...m.values())/total:0})()
      };
    }
    return { mint, asOf: new Date(at).toISOString(), windows: result };
  }
  return { add, snapshot, tokens: () => [...events.keys()], size: mint => (events.get(mint)||[]).length };
}
