import { createEventBuffer } from './events.js';
import { calculateFeatures } from './features.js';
import { detectIgnition, detectMomentum } from './detectors.js';
import { createShrineStream } from './shrine.js';
import { getTokenMarket } from '../market.js';

const buffer=createEventBuffer(),latestFeatures=new Map(),launches=new Map(),signals=new Map(),riskCache=new Map(),evaluating=new Set();
const status={provider:'shrine',state:'not_started',received:0,persisted:0,lastEventAt:null,lastError:null,launches:0,signals:0,riskChecks:0,riskPasses:0,riskFailures:0,liquidityPasses:0,liquidityFailures:0,marketFailures:0};
let stream=null,persistEvent=async()=>{},persistSignal=async()=>{};
const SIGNAL_COOLDOWN_MS=15*60_000,MAX_SIGNALS=2000,MIN_LIQUIDITY_USD=5000,MAX_NORMALISED_RISK=40;

async function assessRisk(mint,market){
 const cached=riskCache.get(mint);
 if(cached&&Date.now()-cached.at<60_000)return cached.value;
 const liquidity=Number(market?.liquidityUsd||0);
 let security={available:false,passed:false,score:null,rawScore:null,risks:[],provider:'RugCheck',error:null};
 try{
  const response=await fetch('https://api.rugcheck.xyz/v1/tokens/'+encodeURIComponent(mint)+'/report/summary',{headers:{accept:'application/json'},signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw new Error('RugCheck HTTP '+response.status);
  const data=await response.json();
  // RugCheck's normalized score is the user-facing 0–100 score; raw score is not comparable.
  const normalized=Number(data.score_normalised??data.scoreNormalized??NaN);
  const raw=Number(data.score??NaN);
  const risks=Array.isArray(data.risks)?data.risks:[];
  const severe=risks.filter(x=>/danger|critical|high/i.test(String(x.level||x.severity||'')));
  const warnings=risks.filter(x=>/warn|medium/i.test(String(x.level||x.severity||'')));
  security={available:true,passed:Number.isFinite(normalized)&&normalized<=MAX_NORMALISED_RISK&&severe.length===0,score:Number.isFinite(normalized)?normalized:null,rawScore:Number.isFinite(raw)?raw:null,risks:risks.slice(0,10).map(x=>({name:x.name||x.description||'Risk flag',level:x.level||x.severity||'unknown',value:x.value||null})),severeRiskCount:severe.length,warningCount:warnings.length,provider:'RugCheck'};
 }catch(error){security.error=error.message;}
 const marketFresh=!!market?.priceUsd&&market.dataStatus!=='stale'&&market.dataStatus!=='partial'&&Number(market.dataAgeMs||0)<=90_000;
 const value={available:security.available,passed:security.passed,score:security.score,rawScore:security.rawScore,risks:security.risks,severeRiskCount:security.severeRiskCount||0,warningCount:security.warningCount||0,provider:security.provider,error:security.error,liquidityPassed:liquidity>=MIN_LIQUIDITY_USD,liquidityUsd:liquidity,liquidityProvider:market?.marketDataSource||'DexScreener',marketDataFresh,marketDataStatus:market?.dataStatus||'unavailable',marketDataSource:market?.marketDataSource||'unknown',assessedAt:new Date().toISOString()};
 riskCache.set(mint,{at:Date.now(),value});
 status.riskChecks++;if(value.available&&value.passed)status.riskPasses++;else status.riskFailures++;
 if(value.liquidityPassed)status.liquidityPasses++;else status.liquidityFailures++;
 if(!marketFresh)status.marketFailures++;
 return value;
}
function signalKey(mint,model){return model+':'+mint;}
function publishSignal(result,risk,features,market){
 const key=signalKey(features.mint,result.model),prior=signals.get(key),now=Date.now();
 if(prior&&prior.status==='active'&&now-Date.parse(prior.lastSeenAt)<SIGNAL_COOLDOWN_MS){prior.lastSeenAt=new Date(now).toISOString();prior.lastFeatures=features;prior.occurrences++;return;}
 const signal={id:key+':'+now,mint:features.mint,symbol:features.symbol||market?.symbol||'UNKNOWN',model:result.model,status:'active',score:Math.round(result.reasons.length/4*100),reasons:result.reasons,gates:result.gates,risk,entryPriceUsd:market?.priceUsd||features.latestPriceUsd||null,peakPriceUsd:market?.priceUsd||features.latestPriceUsd||null,lastPriceUsd:market?.priceUsd||features.latestPriceUsd||null,createdAt:new Date(now).toISOString(),lastSeenAt:new Date(now).toISOString(),occurrences:1,version:result.version,outcome:null};
 signals.set(key,signal);status.signals=signals.size;
 Promise.resolve(persistSignal(signal)).catch(error=>{status.lastError='Signal persistence: '+error.message;});
 if(signals.size>MAX_SIGNALS){const oldest=[...signals.entries()].sort((a,b)=>Date.parse(a[1].createdAt)-Date.parse(b[1].createdAt))[0];if(oldest)signals.delete(oldest[0]);}
}
async function evaluateMint(mint){
 if(evaluating.has(mint))return;evaluating.add(mint);
 try{
  const features=latestFeatures.get(mint);if(!features)return;
  const market=await getTokenMarket(mint);
  if(market.dataStatus==='stale'||market.dataStatus==='partial'||!market.priceUsd){status.marketFailures++;return;}
  const risk=await assessRisk(mint,market);
  const evaluated={...features,latestPriceUsd:market.priceUsd,symbol:features.symbol||market.symbol||'UNKNOWN',market:{priceUsd:market.priceUsd,liquidityUsd:market.liquidityUsd,volume5mUsd:market.volume5mUsd,priceChange5m:market.priceChange5m,dataStatus:market.dataStatus,source:market.marketDataSource},risk};
  const ignition=detectIgnition(evaluated,risk),momentum=detectMomentum(evaluated,risk);
  evaluated.ignition=ignition;evaluated.momentum=momentum;
  latestFeatures.set(mint,evaluated);
  if(ignition.eligible)publishSignal(ignition,risk,evaluated,market);
  if(momentum.eligible)publishSignal(momentum,risk,evaluated,market);
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
export function v4Status(){return{...status,trackedTokens:buffer.tokens().length,discoveredLaunches:launches.size,mode:'paper',liveTradingAvailable:false,signalPublicationEnabled:true,signalModels:['ignition','momentum'],riskProvider:'RugCheck',liquidityProvider:'DexScreener',liquidityFloorUsd:MIN_LIQUIDITY_USD,maxNormalisedRisk:MAX_NORMALISED_RISK};}
export function v4Features(mint){return latestFeatures.get(mint)||null;}
export function v4TopActivity(limit=50){return[...latestFeatures.values()].sort((a,b)=>(b.netBuyUsd1m||0)-(a.netBuyUsd1m||0)).slice(0,limit);}
export function v4RecentLaunches(limit=100){return[...launches.values()].slice(-limit).reverse();}
export function v4Signals(limit=100){return[...signals.values()].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).slice(0,limit);}
