import test from 'node:test';
import assert from 'node:assert/strict';
import { appendObservation, createObservation, telemetrySummary, trimTracking, updateTokenTracker } from '../src/telemetry.js';

test('observation stores timestamped market fields', () => {
  const row = createObservation({ address: 'mint', priceUsd: 2, buys5m: 8 }, '2026-01-01T00:00:00.000Z');
  assert.equal(row.priceUsd, 2);
  assert.equal(row.buys5m, 8);
  assert.equal(row.at, '2026-01-01T00:00:00.000Z');
});

test('history is capped and preserves newest observations', () => {
  const rows = appendObservation([{ at: 'a' }, { at: 'b' }], { priceUsd: 3 }, 'c', 2);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].priceUsd, 3);
});

test('tracker records first qualifying signal and peak multiple', () => {
  let tracker = updateTokenTracker(null, { address: 'mint', symbol: 'ABC', priceUsd: 1 }, null, '2026-01-01T00:00:00.000Z');
  tracker = updateTokenTracker(tracker, { address: 'mint', symbol: 'ABC', priceUsd: 1.2 }, { passed: true, model: 'new_launch', score: 72 }, '2026-01-01T00:02:00.000Z');
  tracker = updateTokenTracker(tracker, { address: 'mint', symbol: 'ABC', priceUsd: 2.5 }, null, '2026-01-01T00:04:00.000Z');
  assert.equal(tracker.firstSignalPriceUsd, 1.2);
  assert.equal(tracker.firstSignalModel, 'new_launch');
  assert.ok(Math.abs(tracker.signalPeakMultiple - (2.5 / 1.2)) < 1e-9);
});

test('horizon return is recorded at first observation after horizon', () => {
  let tracker = updateTokenTracker(null, { address: 'mint', priceUsd: 1 }, { passed: true, model: 'established', score: 60 }, '2026-01-01T00:00:00.000Z');
  tracker = updateTokenTracker(tracker, { address: 'mint', priceUsd: 1.5 }, null, '2026-01-01T00:16:00.000Z');
  assert.equal(tracker.horizons['15m'].returnMultiple, 1.5);
  assert.equal(tracker.horizons['1h'], undefined);
});

test('tracking cap keeps most recently observed tokens', () => {
  const trimmed = trimTracking({ a: { lastSeenAt: '2026-01-01T00:00:00Z' }, b: { lastSeenAt: '2026-01-02T00:00:00Z' } }, 1);
  assert.deepEqual(Object.keys(trimmed), ['b']);
});

test('summary reports model counts and pump milestones', () => {
  const summary = telemetrySummary({ a: { firstSignalAt: 'x', firstSignalModel: 'new_launch', signalPeakMultiple: 3 }, b: { firstSignalAt: 'x', firstSignalModel: 'established', signalPeakMultiple: 10 } });
  assert.equal(summary.qualifiedSignals, 2);
  assert.equal(summary.peakMilestones['3x'], 2);
  assert.equal(summary.peakMilestones['10x'], 1);
});
