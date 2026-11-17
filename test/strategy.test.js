import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePosition, DEFAULT_RULES } from '../src/strategy.js';

const position = { entryPrice: 1, peakPrice: 1, remainingFraction: 1, firstTargetHit: false };

test('holds below protection activation', () => assert.equal(evaluatePosition(position, 1.3).action, 'hold'));
test('activates profit protection after 1.4x peak', () => {
  const result = evaluatePosition({ ...position, peakPrice: 1.5 }, 1.19);
  assert.equal(result.action, 'sell_all');
  assert.equal(result.reason, 'Profit-protection stop');
});
test('does not trigger profit protection on ordinary pullback above stop', () => {
  const result = evaluatePosition({ ...position, peakPrice: 1.6 }, 1.35);
  assert.equal(result.action, 'hold');
});
test('sells half at 2x', () => {
  const result = evaluatePosition(position, 2);
  assert.equal(result.action, 'sell_partial');
  assert.equal(result.fraction, 0.5);
  assert.equal(result.position.firstTargetHit, true);
});
test('hard stop remains active before profit protection', () => {
  const result = evaluatePosition(position, 0.74);
  assert.equal(result.action, 'sell_all');
  assert.equal(result.reason, 'Hard stop-loss');
});
test('runner trailing stop closes remaining half after first target', () => {
  const afterTarget = { ...position, firstTargetHit: true, remainingFraction: 0.5, peakPrice: 3 };
  const result = evaluatePosition(afterTarget, 2.3);
  assert.equal(result.action, 'sell_all');
  assert.equal(result.reason, 'Runner trailing stop');
});
test('runner trail widens modestly after 5x to allow larger moves', () => {
  const afterTarget = { ...position, firstTargetHit: true, remainingFraction: 0.5, peakPrice: 6 };
  assert.equal(evaluatePosition(afterTarget, 4.6).action, 'hold');
  assert.equal(evaluatePosition(afterTarget, 4.4).action, 'sell_all');
});
test('default stake remains thirty pounds', () => assert.equal(DEFAULT_RULES.stakeGbp, 30));
