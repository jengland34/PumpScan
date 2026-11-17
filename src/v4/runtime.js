import { createEventBuffer } from './events.js';
import { calculateFeatures } from './features.js';
import { detectIgnition, detectMomentum } from './detectors.js';
import { createShrineStream } from './shrine.js';
import { getTokenMarket } from '../market.js';

const buffer=createEventBuffer(),latestFeatures=new Map(),launches=new Map(),signals=new Map(),riskCache=new Map(),evaluating=new Set();
const status={provider:'shrine',state:'not_started',received:0,persisted:0,lastEventAt:null,lastError:null,launches:0,signals:0};
let stream=null,persistEvent=async()=>{},persistSignal=async()=>{};
const SIGNAL_COOLDOWN_MS=15*60_000;
const MAX_SIGNALS=2000;

async function assessRisk(mint,market){
  const cached=riskCache.get(mint);
  if(cached&&Date.now()-cached.at<60_000)return cached.value;
  const liquidity=Number(market?.liquidityUsd||0);
  let security={available:false,passed:false,score:null,risks:[],provider:'RugCheck'};
  try{
    const response=await fetch('https://api.rugcheck.xyz/v1/tokens/'+encodeURIComponent(mint)+'/report/summary',{headers:{accept:'application/json'},signal:AbortSignal.timeout(8000)});
    if(response.ok){
      const data=await response.json(),score=Number(data.score??data.score_normalised??NaN);
      const risks=Array.isArray(data.risks)?data.risks:[];
      const severe=risks.filter(x=>/critical|danger|high/i.test(String(x.level||x.severity||'')));
      security={available:true,passed:Number.isFinite(score)&&score<500&&severe.length===0,score:Number.isFinite(score)?score:null,risks:risks.slice(0,8).map(x=>({name:x.name||x.description||'Risk flag',level:x.level||x.severity||'unknown'})),provider:'RugCheck'};
    }else security={...security,error:'RugCheck HTTP '+response.status};
  }catch(error){security={...security,error:error.message};}
  const value={available:security.available,passed:security.passed,score:security.score,risks:security.risks,provider:security.provider,liquidityPassed:liquidity>=5000,liquidityUsd:liquidity,marketDataFresh:market?.dataStatus!=='stale'&&Number(market?.priceUsd)>0,assessedAt:new Date().toISOString(),error:security.error||null};
  riskCache.set(mint,{at:Date.now(),value});return value;
}
function signalKey(mint,model){return model+':'+mint}
function publishSignal(result,risk,features){
  const key=signalKey(features.mint,result.model),prior=signals.get(key),now=Date.now();
  if(prior&&now-Date.parse(prior.lastSeenAt)<SIGNAL_COOLDOWN_MS){
    prior.lastSeenAt=new Date(now).toISOString();prior.lastFeatures=features;prior.occurrences++;return;
  }
  const signal={id:key+':'+now,mint:features.mint,model:result.model,status:'active',score:Math.round((result.reasons.length/(result.model==='ignition'?4:4))*100),reasons:result.reasons,gates:result.gates,risk,entryPriceUsd:features.latestPriceUsd||null,peakPriceUsd:features.latestPriceUsd||null,lastPriceUsd:features.latestPriceUsd||null,createdAt:new Date(now).toISOString(),lastSeenAt:new Date(now).toISOString(),occurrences:1,version:result.version,outcome:null};
  signals.set(key,signal);status.signals=signals.size;
  Promise.resolve(persistSignal(signal)).catch(error=>{status.lastError='Signal persistence: '+error.message;});
  if(signals.size>MAX_SIGNALS){const oldest=[...signals.entries()].sort((a,b)=>Date.parse(a[1].createdAt)-Date.parse(b[1].createdAt))[0];if(oldest)signals.delete(oldest[0]);}
}
async function evaluateMint(mint){
  if(evaluating.has(mint))return;evaluating.add(mint);
  try{
    const features=latestFeatures.get(mint);if(!features)return;
    const market=await getTokenMarket(mint);
    if(market.dataStatus==='stale'||!market.priceUsd)return;
    const risk=await assessRisk(mint,market);
    const ignition=detectIgnition(features,risk),momentum=detectMomentum(features,risk);
    features.market={priceUsd:market.priceUsd,liquidityUsd:market.liquidityUsd,volume5mUsd:market.volume5mUsd,dataStatus:market.dataStatus};
    features.risk=risk;features.ignition=ignition;features.momentum=momentum;
    if(ignition.eligible)publishSignal(ignition,risk,features);
    if(momentum.eligible)publishSignal(momentum,risk,features);
    for(const signal of signals.values())if(signal.mint===mint&&signal.status==='active'){
      signal.lastPriceUsd=market.priceUsd;signal.peakPriceUsd=Math.max(signal.peakPriceUsd||0,market.priceUsd);signal.lastSeenAt=new Date().toISOString();
      const move=signal.entryPriceUsd>0?(market.priceUsd/signal.entryPriceUsd-1)*100:0;
      signal.outcome={returnPct:move,ageMinutes:(Date.now()-Date.parse(signal.createdAt))/60000,peakReturnPct:signal.entryPriceUsd>0?(signal.peakPriceUsd/signal.entryPriceUsd-1)*100:0};
      if(move<=-20||((Date.now()-Date.parse(signal.createdAt))>60*60_000&&move<2))signal.status='expired';
      Promise.resolve(persistSignal(signal)).catch(()=>{});
    }
  }catch(error){status.lastError='Evaluation '+mint.slice(0,8)+': '+error.message;}
  finally{evaluating.delete(mint);}
}
export function startV4({apiKey=process.env.SHRINE_API_KEY,saveEvent=async()=>{},saveSignal=async()=>{}}={}){
 if(stream)return stream;persistEvent=saveEvent;persistSignal=saveSignal;
 stream=createShrineStream({apiKey,onLaunch:launch=>{launches.set(launch.mint,launch);status.launches=launches.size;},onTrade:event=>{
  if(!buffer.add(event))return;status.received++;status.lastEventAt=event.receivedAt;
  latestFeatures.set(event.mint,{...calculateFeatures(buffer,event.mint),symbol:event.symbol||launches.get(event.mint)?.symbol||'UNKNOWN'});
  Promise.resolve(persistEvent(event)).then(ok=>{if(ok!==false)status.persisted++;}).catch(error=>{status.lastError=error.message;});
  evaluateMint(event.mint);
 },onStatus:next=>Object.assign(status,next)});return stream;
}
export function stopV4(){stream?.stop();stream=null;}
export function v4Status(){return{...status,trackedTokens:buffer.tokens().length,discoveredLaunches:launches.size,mode:'paper',liveTradingAvailable:false,signalPublicationEnabled:true,signalModels:['ignition','momentum'],riskProvider:'RugCheck',liquidityFloorUsd:5000};}
export function v4Features(mint){return latestFeatures.get(mint)||null;}
export function v4TopActivity(limit=50){return[...latestFeatures.values()].sort((a,b)=>(b.netBuyUsd1m||0)-(a.netBuyUsd1m||0)).slice(0,limit);}
export function v4RecentLaunches(limit=100){return[...launches.values()].slice(-limit).reverse();}
export function v4Signals(limit=100){return[...signals.values()].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).slice(0,limit);}
