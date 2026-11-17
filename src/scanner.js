import { getTokenMarket } from './market.js';

const DEX = 'https://api.dexscreener.com';
const DEFAULT_SCAN_CONFIG = Object.freeze({
  minLiquidityUsd: 10000,
  minVolume5mUsd: 1500,
  maxPairAgeHours: 72,
  maxRiskScore: 35,
  minEntryScore: 55,
  newLaunchMaxAgeHours: 24
});

async function json(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`Market provider returned ${response.status}`);
  return response.json();
}

async function rugcheck(mint) {
  try {
    const response = await fetch(`https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mint)}/report/summary`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return { available: false, risks: [] };
    const data = await response.json();
    return {
      available: true,
      scoreNormalised: Number.isFinite(Number(data.score_normalised)) ? Number(data.score_normalised) : null,
      score: Number(data.score),
      lpLockedPct: data.lpLockedPct == null ? null : Number(data.lpLockedPct),
      risks: Array.isArray(data.risks) ? data.risks.map(item => ({
        name: item.name, level: item.level, description: item.description
      })) : [],
      mintAuthority: data.mintAuthority ?? null,
      freezeAuthority: data.freezeAuthority ?? null
    };
  } catch {
    return { available: false, risks: [] };
  }
}

function ratio(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  return current / previous;
}

/** Pure scoring function, exported for deterministic tests. */
export function scoreCandidate(market, report, history = [], config = {}) {
  const cfg = { ...DEFAULT_SCAN_CONFIG, ...config };
  const ageHours = market.pairAgeHours;
  const isNewLaunch = ageHours !== null && ageHours <= cfg.newLaunchMaxAgeHours;
  const model = isNewLaunch ? 'new_launch' : 'established';
  const riskLevels = (report?.risks || []).map(item => String(item.level || '').toLowerCase());
  const severeRisk = riskLevels.some(level => ['danger', 'critical'].includes(level));
  const riskScore = Number.isFinite(report?.scoreNormalised) ? report.scoreNormalised : null;

  // Safety checks are hard gates. Momentum cannot compensate for unsafe/unknown security.
  const checks = {
    price: Number.isFinite(market.priceUsd) && market.priceUsd > 0,
    liquidity: market.liquidityUsd >= cfg.minLiquidityUsd,
    security: report?.available === true && riskScore !== null && riskScore < cfg.maxRiskScore && !severeRisk,
    age: ageHours !== null && ageHours >= 0 && ageHours <= cfg.maxPairAgeHours,
    minimumActivity: market.volume5mUsd >= cfg.minVolume5mUsd
  };

  const previous = history.length ? history[history.length - 1] : null;
  const volumeAcceleration = previous ? ratio(market.volume5mUsd, previous.volume5mUsd) : null;
  const buyerAcceleration = previous ? ratio(market.buys5m, previous.buys5m) : null;
  const liquidityChangePct = previous && previous.liquidityUsd > 0
    ? ((market.liquidityUsd / previous.liquidityUsd) - 1) * 100 : null;
  const buyRatio = market.buys5m + market.sells5m > 0
    ? market.buys5m / (market.buys5m + market.sells5m) : 0;
  const priceChange5m = Number(market.priceChange5m || 0);

  const signals = {};
  if (model === 'new_launch') {
    // New launches: reward buyer growth and persistent buy-side pressure more heavily.
    signals.buyPressure = buyRatio >= 0.70 ? 25 : buyRatio >= 0.60 ? 18 : buyRatio >= 0.52 ? 9 : 0;
    signals.buyerAcceleration = buyerAcceleration === null ? 0 : buyerAcceleration >= 2 ? 25 : buyerAcceleration >= 1.35 ? 17 : buyerAcceleration >= 1.1 ? 8 : 0;
    signals.volumeAcceleration = volumeAcceleration === null ? 0 : volumeAcceleration >= 2 ? 15 : volumeAcceleration >= 1.35 ? 10 : volumeAcceleration >= 1.1 ? 5 : 0;
    signals.priceAction = priceChange5m >= 1 && priceChange5m <= 10 ? 10 : priceChange5m > 10 && priceChange5m <= 18 ? 5 : priceChange5m >= 0 && priceChange5m < 1 ? 4 : 0;
    signals.liquidityStability = liquidityChangePct === null ? 5 : liquidityChangePct >= -2 ? 10 : liquidityChangePct >= -7 ? 4 : 0;
    signals.activity = market.volume5mUsd >= cfg.minVolume5mUsd * 3 ? 5 : market.volume5mUsd >= cfg.minVolume5mUsd * 1.5 ? 4 : 2;
  } else {
    // Established pairs: require stronger volume expansion and a controlled breakout profile.
    signals.volumeAcceleration = volumeAcceleration === null ? 0 : volumeAcceleration >= 2 ? 25 : volumeAcceleration >= 1.35 ? 18 : volumeAcceleration >= 1.1 ? 8 : 0;
    signals.buyPressure = buyRatio >= 0.70 ? 15 : buyRatio >= 0.60 ? 11 : buyRatio >= 0.52 ? 5 : 0;
    signals.buyerAcceleration = buyerAcceleration === null ? 0 : buyerAcceleration >= 2 ? 15 : buyerAcceleration >= 1.35 ? 10 : buyerAcceleration >= 1.1 ? 5 : 0;
    signals.priceAction = priceChange5m >= 1 && priceChange5m <= 8 ? 20 : priceChange5m > 8 && priceChange5m <= 15 ? 12 : priceChange5m >= 0 && priceChange5m < 1 ? 5 : 0;
    signals.liquidityStability = liquidityChangePct === null ? 5 : liquidityChangePct >= -2 ? 10 : liquidityChangePct >= -7 ? 4 : 0;
    signals.activity = market.volume5mUsd >= cfg.minVolume5mUsd * 3 ? 10 : market.volume5mUsd >= cfg.minVolume5mUsd * 1.5 ? 7 : 4;
  }

  // Penalise chasing an already vertical move; do not reward a high 5m candle by itself.
  signals.extensionPenalty = priceChange5m > 30 ? -25 : priceChange5m > 20 ? -12 : 0;
  const score = Object.values(signals).reduce((sum, value) => sum + value, 0);

  const safetyPassed = checks.price && checks.liquidity && checks.security && checks.age;
  const historyReady = history.length >= 2;
  const passed = safetyPassed && checks.minimumActivity && historyReady && score >= cfg.minEntryScore;
  return {
    model,
    modelLabel: model === 'new_launch' ? 'New launch' : 'Established',
    score,
    minEntryScore: cfg.minEntryScore,
    checks,
    safetyPassed,
    historyReady,
    observations: history.length + 1,
    passed,
    signals,
    metrics: { buyRatio, volumeAcceleration, buyerAcceleration, liquidityChangePct }
  };
}

export async function discoverCandidates(limit = 24, config = {}, historyByAddress = {}) {
  const [profiles, boosts] = await Promise.allSettled([
    json(`${DEX}/token-profiles/latest/v1`),
    json(`${DEX}/token-boosts/latest/v1`)
  ]);
  const items = [
    ...(profiles.status === 'fulfilled' && Array.isArray(profiles.value) ? profiles.value : []),
    ...(boosts.status === 'fulfilled' && Array.isArray(boosts.value) ? boosts.value : [])
  ];
  const seen = new Set();
  const mints = items.filter(item => item.chainId === 'solana' && item.tokenAddress && !seen.has(item.tokenAddress) && seen.add(item.tokenAddress)).slice(0, limit);
  const rows = [];

  // Keep provider calls sequential to reduce the chance of rate limiting.
  for (const item of mints) {
    try {
      const market = await getTokenMarket(item.tokenAddress);
      const pairAgeHours = market.pairCreatedAt
        ? Math.max(0, (Date.now() - market.pairCreatedAt) / 3600000)
        : null;
      const report = await rugcheck(item.tokenAddress);
      const candidate = {
        ...market,
        pairAgeHours,
        rugcheck: report,
        source: items.some(entry => entry.tokenAddress === item.tokenAddress && entry.amount) ? 'Boosted/profile' : 'Profile',
        scannedAt: new Date().toISOString()
      };
      const scored = scoreCandidate(candidate, report, historyByAddress[item.tokenAddress] || [], config);
      rows.push({ ...candidate, ...scored });
    } catch (error) {
      rows.push({
        address: item.tokenAddress,
        symbol: item.symbol || 'UNKNOWN',
        name: item.name || 'Unknown token',
        error: error.message,
        passed: false,
        safetyPassed: false,
        score: 0,
        checks: { price: false, liquidity: false, security: false, age: false, minimumActivity: false }
      });
    }
  }

  rows.sort((a, b) => Number(b.passed) - Number(a.passed) || b.score - a.score || b.volume5mUsd - a.volume5mUsd);
  return rows;
}
