export const DEFAULT_RULES = Object.freeze({
  stakeGbp: 30,
  takeProfitMultiple: 2,
  firstExitFraction: 0.5,
  hardStopPct: 0.25,
  profitProtectionMultiple: 1.4,
  trailingStopPct: 0.20,
  runnerTrailTiers: Object.freeze([
    Object.freeze({ multiple: 3, pct: 0.22 }),
    Object.freeze({ multiple: 5, pct: 0.25 })
  ]),
  maxOpenPositions: 3,
  dailyLossLimitGbp: 30
});

function trailPctForPeak(position, rules) {
  const multiple = position.peakPrice / position.entryPrice;
  const tiers = [...(rules.runnerTrailTiers || [])].sort((a, b) => a.multiple - b.multiple);
  let pct = rules.trailingStopPct;
  for (const tier of tiers) {
    if (multiple >= tier.multiple) pct = tier.pct;
  }
  return pct;
}

export function evaluatePosition(position, currentPrice, rules = DEFAULT_RULES) {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    return { action: 'hold', position, reason: 'Invalid price' };
  }

  const peakPrice = Math.max(position.peakPrice || position.entryPrice, currentPrice);
  const updated = { ...position, peakPrice };
  if (position.remainingFraction <= 0) return { action: 'hold', position: updated, reason: 'Already closed' };

  // Emergency loss boundary remains independent of profit management.
  if (currentPrice <= position.entryPrice * (1 - rules.hardStopPct)) {
    return { action: 'sell_all', fraction: position.remainingFraction, position: updated, reason: 'Hard stop-loss' };
  }

  // Take the first scale-out at the configured multiple.
  if (!position.firstTargetHit && currentPrice >= position.entryPrice * rules.takeProfitMultiple) {
    return {
      action: 'sell_partial',
      fraction: Math.min(rules.firstExitFraction, position.remainingFraction),
      position: { ...updated, firstTargetHit: true },
      reason: `${rules.takeProfitMultiple}x take-profit`
    };
  }

  // Before the first scale-out, activate a profit-protecting trailing floor once a meaningful gain exists.
  const protectionActive = peakPrice >= position.entryPrice * (rules.profitProtectionMultiple || 1.4);
  if (protectionActive) {
    const trailPct = trailPctForPeak(updated, rules);
    const stopPrice = peakPrice * (1 - trailPct);
    if (currentPrice <= stopPrice) {
      return {
        action: 'sell_all',
        fraction: position.remainingFraction,
        position: updated,
        reason: position.firstTargetHit ? 'Runner trailing stop' : 'Profit-protection stop'
      };
    }
  }

  return { action: 'hold', position: updated, reason: protectionActive ? 'Profit protected; monitoring' : 'Monitoring' };
}
