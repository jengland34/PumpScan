const WINDOWS = { '10s':10_000, '1m':60_000, '5m':300_000, '15m':900_000, '1h':3_600_000 };
export function calculateFeatures(buffer, mint, at = Date.now()) {
  const raw = buffer.snapshot(mint, at).windows;
  const get = name => raw[WINDOWS[name]] || {};
  const w10=get('10s'), w1=get('1m'), w5=get('5m'), w15=get('15m'), w60=get('1h');
  const ratio=(a,b)=>b>0?a/b:null;
  return {
    mint, asOf:new Date(at).toISOString(),
    windows:{'10s':w10,'1m':w1,'5m':w5,'15m':w15,'1h':w60},
    buySellValueRatio1m:ratio(w1.buyUsd,w1.sellUsd),
    buySellValueRatio5m:ratio(w5.buyUsd,w5.sellUsd),
    netBuyUsd1m:w1.netBuyUsd||0, netBuyUsd5m:w5.netBuyUsd||0,
    uniqueBuyers1m:w1.uniqueBuyers||0, uniqueBuyers5m:w5.uniqueBuyers||0,
    tradeRateAcceleration:ratio((w10.trades||0)*6,w1.trades||0),
    buyerAcceleration:ratio((w1.uniqueBuyers||0)*5,w5.uniqueBuyers||0),
    volumeAcceleration:ratio((w1.buyUsd+w1.sellUsd)*5,w5.buyUsd+w5.sellUsd),
    topBuyerShare5m:w5.topBuyerShare||0,top3BuyerShare1m:w1.top3BuyerShare||0,top3BuyerShare5m:w5.top3BuyerShare||0,repeatBuyerShare5m:w5.repeatBuyerShare||0,buyerBreadth1m:w1.buyerBreadth||0,buyerBreadth5m:w5.buyerBreadth||0,sameSlotBuyShare5m:w5.sameSlotBuyShare||0,sameSlotBuyerCount5m:w5.sameSlotBuyerCount||0,
    latestPriceUsd:w10.latestPriceUsd||w1.latestPriceUsd||w5.latestPriceUsd||null,
    dataQuality:{events1m:w1.trades||0,events5m:w5.trades||0,hasRecentActivity:(w1.trades||0)>0}
  };
}
