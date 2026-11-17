// V4 signal models: all market/safety gates are mandatory; model-specific flow gates distinguish early ignition from confirmed momentum.
function result(model,gates,reasons,features,version){
 const failed=Object.entries(gates).filter(([,passed])=>!passed).map(([name])=>name);
 const passed=Object.values(gates).filter(Boolean).length;
 // Do not retain the full feature object here: runtime attaches detector results
 // back onto that same feature object, which would create a circular API payload.
 return{model,eligible:failed.length===0,score:Math.round(passed/Object.keys(gates).length*100),gates,reasons,rejectionReasons:failed,version};
}
export function detectIgnition(f,risk={}){
 const reasons=[],priceMove=Number(f?.market?.priceChange5m??NaN);
 const gates={
  sample:Number(f?.dataQuality?.events1m||0)>=3,
  buyerCount:Number(f?.uniqueBuyers1m||0)>=3,
  buyerAcceleration:Number(f?.buyerAcceleration||0)>=1.1,
  tradeAcceleration:Number(f?.tradeRateAcceleration||0)>=1.1,
  netBuying:Number(f?.netBuyUsd1m||0)>=100,
  concentration:Number(f?.topBuyerShare5m??1)<0.35,
  notOverextended:Number.isFinite(priceMove)&&priceMove>=-5&&priceMove<=12,
  security:risk.available===true&&risk.passed===true,
  liquidity:risk.liquidityPassed===true,
  marketData:risk.marketDataFresh===true,
  liquidityStability:risk.liquidityShock!==true
 };
 if(gates.sample)reasons.push('3+ trades in one minute');
 if(gates.buyerCount)reasons.push('At least 3 distinct buyers');
 if(gates.buyerAcceleration)reasons.push('Buyer participation accelerating');
 if(gates.tradeAcceleration)reasons.push('Trade rate accelerating');
 if(gates.netBuying)reasons.push('At least $100 net buying in one minute');
 if(gates.concentration)reasons.push('No single buyer controls the flow');
 if(gates.notOverextended)reasons.push('Price move remains early, not extended');
 if(gates.liquidityStability)reasons.push('No sharp liquidity withdrawal observed');
 return result('ignition',gates,reasons,f,'v4-ignition-0.3');
}
export function detectMomentum(f,risk={}){
 const reasons=[],priceMove=Number(f?.market?.priceChange5m??NaN);
 const gates={
  sample:Number(f?.dataQuality?.events5m||0)>=10,
  buyPressure:Number(f?.buySellValueRatio5m||0)>=1.25,
  netBuying:Number(f?.netBuyUsd5m||0)>=250,
  participation:Number(f?.uniqueBuyers5m||0)>=5,
  buyerAcceleration:Number(f?.buyerAcceleration||0)>=1,
  concentration:Number(f?.topBuyerShare5m??1)<0.4,
  positiveMove:Number.isFinite(priceMove)&&priceMove>=1,
  notExhausted:Number.isFinite(priceMove)&&priceMove<=18,
  security:risk.available===true&&risk.passed===true,
  liquidity:risk.liquidityPassed===true,
  marketData:risk.marketDataFresh===true,
  liquidityStability:risk.liquidityShock!==true
 };
 if(gates.sample)reasons.push('10+ trades in five minutes');
 if(gates.buyPressure)reasons.push('Buy/sell value ratio at least 1.25×');
 if(gates.netBuying)reasons.push('At least $250 net buying in five minutes');
 if(gates.participation)reasons.push('At least 5 distinct buyers');
 if(gates.buyerAcceleration)reasons.push('Buyer participation holding up');
 if(gates.concentration)reasons.push('Buyer concentration controlled');
 if(gates.positiveMove)reasons.push('Positive five-minute price momentum');
 if(gates.notExhausted)reasons.push('Move not yet excessively extended');
 if(gates.liquidityStability)reasons.push('No sharp liquidity withdrawal observed');
 return result('momentum',gates,reasons,f,'v4-momentum-0.3');
}
