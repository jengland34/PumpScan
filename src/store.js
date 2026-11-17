import fs from 'node:fs';
import path from 'node:path';
const DATA_DIR = path.resolve('data');
const FILE = path.join(DATA_DIR, 'state.json');
const initial = {
  mode: 'paper',
  scanner: { enabled: false, autoPaper: false, minLiquidityUsd: 10000, minVolume5mUsd: 1500, maxPairAgeHours: 72, maxRiskScore: 35, minEntryScore: 55, newLaunchMaxAgeHours: 24, scanIntervalSeconds: 90 },
  candidates: [],
  rules: { stakeGbp: 30, takeProfitMultiple: 2, firstExitFraction: 0.5, trailingStopPct: 0.2, hardStopPct: 0.25, profitProtectionMultiple: 1.4, runnerTrailTiers: [{ multiple: 3, pct: 0.22 }, { multiple: 5, pct: 0.25 }], maxOpenPositions: 3, dailyLossLimitGbp: 30 },
  marketHistory: {},
  tokenTracking: {},
  watchlist: [{ address: 'BRf3SXRk8BdXmBZDJfKyEhbYmqBVf8843ctEMcD4pump', label: 'COGE' }],
  positions: [],
  trades: [],
  events: [],
  createdAt: new Date().toISOString()
};
export function loadState() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) saveState(initial);
  try { const s=JSON.parse(fs.readFileSync(FILE, 'utf8')); s.scanner = { ...structuredClone(initial.scanner), ...(s.scanner || {}) }; if (s.scanner.minLiquidityUsd === 20000) s.scanner.minLiquidityUsd = initial.scanner.minLiquidityUsd; if (s.scanner.minVolume5mUsd === 5000) s.scanner.minVolume5mUsd = initial.scanner.minVolume5mUsd; s.rules = { ...structuredClone(initial.rules), ...(s.rules || {}) }; s.marketHistory ||= {}; s.tokenTracking ||= {}; s.candidates ||= []; return s; }
  catch { saveState(initial); return structuredClone(initial); }
}
export function saveState(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE);
}
