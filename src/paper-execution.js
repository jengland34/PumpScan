export function estimatePaperFill({priceUsd,liquidityUsd=0,notionalUsd=0,side='buy',baseSlippageBps=100,maxSlippageBps=500}={}) {
 const price=Number(priceUsd),liquidity=Number(liquidityUsd),notional=Math.max(0,Number(notionalUsd)||0);
 if(!(price>0)||!Number.isFinite(price))throw new RangeError('A positive market price is required');
 const base=Math.max(0,Number(baseSlippageBps)||0),max=Math.max(base,Number(maxSlippageBps)||500);
 const impact=liquidity>0?Math.min(400,(notional/liquidity)*10000*0.5):0;
 const slippageBps=Math.min(max,base+impact),direction=side==='sell'?-1:1;
 return{referencePriceUsd:price,fillPriceUsd:price*(1+direction*slippageBps/10000),slippageBps,impactBps:impact,side};
}
export function calculatePaperPnl({stakeGbp,soldFraction,entryPriceUsd,exitPriceUsd,entryFeeGbp=0,feeBps=100}={}) {
 const stake=Number(stakeGbp),fraction=Math.max(0,Math.min(1,Number(soldFraction))),entry=Number(entryPriceUsd),exit=Number(exitPriceUsd);
 if(!(stake>=0)||!(entry>0)||!(exit>0))throw new RangeError('Invalid paper position values');
 const grossPnlGbp=stake*fraction*(exit/entry-1),entryFee=Number(entryFeeGbp||0)*fraction;
 const exitNotional=stake*fraction*(exit/entry),exitFeeGbp=exitNotional*Math.max(0,Number(feeBps)||0)/10000;
 return{grossPnlGbp,entryFeeGbp:entryFee,exitFeeGbp,netPnlGbp:grossPnlGbp-entryFee-exitFeeGbp,exitNotionalGbp:exitNotional};
}
