import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreCandidate } from '../src/scanner.js';

const market = {
  priceUsd: 0.001,
  liquidityUsd: 25000,
  volume5mUsd: 9000,
  buys5m: 90,
  sells5m: 10,
  priceChange5m: 6,
  pairAgeHours: 8
};
const safeReport = { available: true, scoreNormalised: 12, risks: [] };
const history = [
  { volume5mUsd: 4000, buys5m: 35, liquidityUsd: 24000 },
  { volume5mUsd: 6000, buys5m: 55, liquidityUsd: 24500 }
];

test('new-launch model labels young pairs', () => {
  const result = scoreCandidate(market, safeReport, history);
  assert.equal(result.model, 'new_launch');
  assert.equal(result.modelLabel, 'New launch');
});
test('unknown security data is a hard fail regardless of momentum', () => {
  const result = scoreCandidate(market, { available: false, risks: [] }, history);
  assert.equal(result.safetyPassed, false);
  assert.equal(result.passed, false);
});
test('requires at least two historical observations before entry', () => {
  const result = scoreCandidate(market, safeReport, []);
  assert.equal(result.historyReady, false);
  assert.equal(result.passed, false);
});
test('penalises an already vertical five-minute move', () => {
  const result = scoreCandidate({ ...market, priceChange5m: 35 }, safeReport, history);
  assert.ok(result.signals.extensionPenalty < 0);
});
test('established model applies after new-launch age window', () => {
  const result = scoreCandidate({ ...market, pairAgeHours: 36 }, safeReport, history);
  assert.equal(result.model, 'established');
});
