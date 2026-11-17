// Independent paper-only models. Every external safety/data gate must pass.
export function detectIgnition(f,risk={}){
 const reasons=[],gates={
  data:Number(f?.dataQuality?.events1m||0)>=3,
  security:risk.available===true&&risk.passed===true,
  liquidity:risk.liquidityPassed===true,
  marketData:risk.marketDataFresh===true,
  concentration:(f?.topBuyerShare5m??1)<0.35,
  netBuying:(f?.netBuyUsd1m??0)>0,
  buyerGrowth:(f?.uniqueBuyers1m??0)>=3
 };
 if(gates.data)reasons.push('3+ trades in the last minute');
 if(gates.netBuying)reasons.push('Positive net buying over one minute');
 if(gates.buyerGrowth)reasons.push('3+ distinct buyers active');
 if(gates.concentration)reasons.push('No single buyer dominates five-minute flow');
 return{model:'ignition',eligible:Object.values(gates).every(Boolean),gates,reasons,features:f,version:'v4-ignition-0.2'};
}
export function detectMomentum(f,risk={}){
 const reasons=[],ratio=f?.buySellValueRatio5m??0;
 const gates={
  data:Number(f?.dataQuality?.events5m||0)>=10,
  security:risk.available===true&&risk.passed===true,
  liquidity:risk.liquidityPassed===true,
  marketData:risk.marketDataFresh===true,
  concentration:(f?.topBuyerShare5m??1)<0.4,
  buyPressure:ratio>=1.25,
  netBuying:(f?.netBuyUsd5m??0)>0,
  participation:(f?.uniqueBuyers5m??0)>=5
 };
 if(gates.buyPressure)reasons.push('Buy-side traded value exceeds sell-side');
 if(gates.netBuying)reasons.push('Positive five-minute net buying');
 if(gates.participation)reasons.push('5+ distinct buyers active');
 if(gates.concentration)reasons.push('Buyer concentration below threshold');
 return{model:'momentum',eligible:Object.values(gates).every(Boolean),gates,reasons,features:f,version:'v4-momentum-0.2'};
}
