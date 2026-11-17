const HORIZONS = Object.freeze({
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000
});

export const MAX_HISTORY_PER_TOKEN = 480;
export const MAX_TRACKED_TOKENS = 100;
export const TRACKED_REFRESH_PER_SCAN = 20;

export function createObservation(market, at = new Date().toISOString()) {
  return {
    at,
    priceUsd: Number(market.priceUsd) || 0,
    liquidityUsd: Number(market.liquidityUsd) || 0,
    volume5mUsd: Number(market.volume5mUsd) || 0,
    volume24hUsd: Number(market.volume24hUsd) || 0,
    buys5m: Number(market.buys5m) || 0,
    sells5m: Number(market.sells5m) || 0,
    priceChange5m: Number(market.priceChange5m) || 0,
    marketCapUsd: Number(market.marketCapUsd) || 0
  };
}

export function appendObservation(history = [], market, at = new Date().toISOString(), limit = MAX_HISTORY_PER_TOKEN) {
  const next = createObservation(market, at);
  const rows = Array.isArray(history) ? history : [];
  const last = rows[rows.length - 1];
  if (last?.at === at) return [...rows.slice(0, -1), next].slice(-limit);
  return [...rows, next].slice(-limit);
}

export function updateTokenTracker(existing, market, scored = null, at = new Date().toISOString()) {
  const price = Number(market.priceUsd);
  if (!Number.isFinite(price) || price <= 0) return existing || null;

  const tracker = existing ? structuredClone(existing) : {
    address: market.address,
    symbol: market.symbol || 'UNKNOWN',
    name: market.name || 'Unknown token',
    firstSeenAt: at,
    firstSeenPriceUsd: price,
    peakPriceUsd: price,
    troughPriceUsd: price,
    observations: 0,
    firstSignalAt: null,
    firstSignalPriceUsd: null,
    firstSignalModel: null,
    firstSignalScore: null,
    signalPeakPriceUsd: null,
    signalTroughPriceUsd: null,
    horizons: {}
  };

  tracker.symbol = market.symbol || tracker.symbol;
  tracker.name = market.name || tracker.name;
  tracker.lastSeenAt = at;
  tracker.lastPriceUsd = price;
  tracker.observations = (tracker.observations || 0) + 1;
  tracker.peakPriceUsd = Math.max(tracker.peakPriceUsd || price, price);
  tracker.troughPriceUsd = Math.min(tracker.troughPriceUsd || price, price);
  tracker.peakMultipleFromFirstSeen = tracker.peakPriceUsd / tracker.firstSeenPriceUsd;
  tracker.troughMultipleFromFirstSeen = tracker.troughPriceUsd / tracker.firstSeenPriceUsd;

  if (!tracker.firstSignalAt && scored?.passed) {
    tracker.firstSignalAt = at;
    tracker.firstSignalPriceUsd = price;
    tracker.firstSignalModel = scored.model || 'unknown';
    tracker.firstSignalScore = Number(scored.score) || 0;
    tracker.signalPeakPriceUsd = price;
    tracker.signalTroughPriceUsd = price;
  }

  if (tracker.firstSignalAt && tracker.firstSignalPriceUsd > 0) {
    tracker.signalPeakPriceUsd = Math.max(tracker.signalPeakPriceUsd || price, price);
    tracker.signalTroughPriceUsd = Math.min(tracker.signalTroughPriceUsd || price, price);
    tracker.signalPeakMultiple = tracker.signalPeakPriceUsd / tracker.firstSignalPriceUsd;
    tracker.signalTroughMultiple = tracker.signalTroughPriceUsd / tracker.firstSignalPriceUsd;
    const elapsedMs = Date.parse(at) - Date.parse(tracker.firstSignalAt);
    for (const [label, durationMs] of Object.entries(HORIZONS)) {
      if (!tracker.horizons[label] && elapsedMs >= durationMs) {
        tracker.horizons[label] = {
          observedAt: at,
          elapsedMinutes: Math.round(elapsedMs / 60000),
          returnMultiple: price / tracker.firstSignalPriceUsd,
          returnPct: ((price / tracker.firstSignalPriceUsd) - 1) * 100
        };
      }
    }
  }

  return tracker;
}

export function trimTracking(trackers = {}, max = MAX_TRACKED_TOKENS) {
  const entries = Object.entries(trackers || {});
  if (entries.length <= max) return trackers;
  entries.sort((a, b) => Date.parse(b[1].lastSeenAt || b[1].firstSeenAt) - Date.parse(a[1].lastSeenAt || a[1].firstSeenAt));
  return Object.fromEntries(entries.slice(0, max));
}

export function telemetrySummary(trackers = {}) {
  const rows = Object.values(trackers || {});
  const signalled = rows.filter(row => row.firstSignalAt);
  const byModel = { new_launch: 0, established: 0, unknown: 0 };
  for (const row of signalled) byModel[row.firstSignalModel] = (byModel[row.firstSignalModel] || 0) + 1;
  const milestones = { '2x': 0, '3x': 0, '5x': 0, '10x': 0 };
  for (const row of signalled) {
    const peak = Number(row.signalPeakMultiple) || 0;
    for (const [label, multiple] of [['2x', 2], ['3x', 3], ['5x', 5], ['10x', 10]]) if (peak >= multiple) milestones[label]++;
  }
  return { trackedTokens: rows.length, qualifiedSignals: signalled.length, byModel, peakMilestones: milestones };
}
