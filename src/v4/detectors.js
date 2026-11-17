// V4 detectors are deliberately separate. Thresholds are provisional and paper-only.
export function detectIgnition(f, risk = {}) {
  const reasons=[], gates={data:f?.dataQuality?.events1m>=3,security:risk.available===true&&risk.passed===true,liquidity:risk.liquidityPassed===true,concentration:(f?.topBuyerShare5m??1)<0.35,netBuying:(f?.netBuyUsd1m??0)>0,buyerGrowth:(f?.uniqueBuyers1m??0)>=3};
  if(gates.data)reasons.push('At least three recent trades'); if(gates.netBuying)reasons.push('Positive net buying over one minute'); if(gates.buyerGrowth)reasons.push('Multiple distinct buyers active'); if(gates.concentration)reasons.push('No single buyer dominates five-minute flow');
  return {model:'ignition',eligible:Object.values(gates).every(Boolean),gates,reasons,features:f,version:'v4-ignition-0.1'};
}
export function detectMomentum(f, risk = {}) {
  const reasons=[], ratio=f?.buySellValueRatio5m??0;
  const gates={data:f?.dataQuality?.events5m>=10,security:risk.available===true&&risk.passed===true,liquidity:risk.liquidityPassed===true,concentration:(f?.topBuyerShare5m??1)<0.4,buyPressure:ratio>=1.25,netBuying:(f?.netBuyUsd5m??0)>0,participation:(f?.uniqueBuyers5m??0)>=5};
  if(gates.buyPressure)reasons.push('Buy-side traded value exceeds sell-side'); if(gates.netBuying)reasons.push('Positive five-minute net buying'); if(gates.participation)reasons.push('Broad wallet participation'); if(gates.concentration)reasons.push('Buyer concentration below threshold');
  return {model:'momentum',eligible:Object.values(gates).every(Boolean),gates,reasons,features:f,version:'v4-momentum-0.1'};
}
