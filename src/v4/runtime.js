import { createEventBuffer } from './events.js';
import { calculateFeatures } from './features.js';
import { detectIgnition, detectMomentum } from './detectors.js';
import { createShrineStream } from './shrine.js';
import { getTokenMarket, getTokenMarkets } from '../market.js';

const buffer=createEventBuffer(),latestFeatures=new Map(),launches=new Map(),signals=new Map(),riskCache=new Map(),liquidityObservations=new Map(),evaluating=new Set();
const status={provider:'shrine',state:'not_started',received:0,persisted:0,lastEventAt:null,lastError:null,launches:0,signals:0,riskChecks:0,riskPasses:0,riskFailures:0,liquidityPasses:0,liquidityFailures:0,marketFailures:0,modelEvaluations:{ignition:0,momentum:0},modelEligible:{ignition:0,momentum:0},gateFailures:{ignition:{},momentum:{}},lastEvaluatedAt:null,lastEvaluatedMint:null,lastGateSnapshot:{ignition:null,momentum:null},lastSignalAt:null};
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
 const signal={id:key+':'+now,mint:features.mint,symbol:features.symbol||market?.symbol||'UNKNOWN',model:result.model,status:'active',score:result.score,reasons:result.reasons,gates:result.gates,risk,entryPriceUsd:market?.priceUsd||features.latestPriceUsd||null,peakPriceUsd:market?.priceUsd||features.latestPriceUsd||null,lastPriceUsd:market?.priceUsd||features.latestPriceUsd||null,createdAt:new Date(now).toISOString(),lastSeenAt:new Date(now).toISOString(),occurrences:1,version:result.version,outcome:null};
 signals.set(key,signal);status.signals=signals.size;status.lastSignalAt=signal.createdAt;
 Promise.resolve(persistSignal(signal)).catch(error=>{status.lastError='Signal persistence: '+error.message;});
 if(signals.size>MAX_SIGNALS){const oldest=[...signals.entries()].sort((a,b)=>Date.parse(a[1].createdAt)-Date.parse(b[1].createdAt))[0];if(oldest)signals.delete(oldest[0]);}
}
function updateSignalOutcome(signal,market,now=Date.now()){
 if(!market?.priceUsd||!signal?.entryPriceUsd)return;
 const created=Date.parse(signal.createdAt),ageMs=now-created;if(!Number.isFinite(created)||ageMs<0||ageMs>24*60*60_000)return;
 const move=(market.priceUsd/signal.entryPriceUsd-1)*100;
 signal.lastPriceUsd=market.priceUsd;signal.peakPriceUsd=Math.max(signal.peakPriceUsd||0,market.priceUsd);
 signal.troughPriceUsd=signal.troughPriceUsd?Math.min(signal.troughPriceUsd,market.priceUsd):market.priceUsd;
 signal.lastSeenAt=new Date(now).toISOString();
 signal.outcome={returnPct:move,ageMinutes:ageMs/60000,peakReturnPct:(signal.peakPriceUsd/signal.entryPriceUsd-1)*100,adverseReturnPct:(signal.troughPriceUsd/signal.entryPriceUsd-1)*100};
 signal.forwardReturns||={};
 for(const [key,minutes] of Object.entries({'1m':1,'5m':5,'15m':15,'30m':30,'60m':60,'4h':240,'24h':1440})){
  if(ageMs>=minutes*60_000&&!signal.forwardReturns[key])signal.forwardReturns[key]={returnPct:move,observedAt:new Date(now).toISOString(),delayMinutes:ageMs/60000};
 }
 if(signal.status==='active'&&(move<=-20||(ageMs>60*60_000&&move<2)))signal.status='expired';
 Promise.resolve(persistSignal(signal)).catch(()=>{});
}
export async function refreshV4SignalOutcomes(limit=60){
 const now=Date.now(),rows=[...signals.values()].filter(s=>s?.entryPriceUsd&&now-Date.parse(s.createdAt||0)<=24*60*60_000).sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt)).slice(-Math.max(1,Math.min(100,limit)));
 if(!rows.length)return 0;
 const results=await getTokenMarkets([...new Set(rows.map(s=>s.mint))]);let updated=0;
 for(const signal of rows){const market=results.get(signal.mint)?.value;if(!market?.priceUsd||['stale','partial'].includes(market.dataStatus))continue;updateSignalOutcome(signal,market,now);updated++;}
 return updated;
}
function assessLiquidityTrend(mint,market,risk){
 const now=Date.now(),liquidity=Number(market?.liquidityUsd||0),previous=liquidityObservations.get(mint);let change=null,sampleAgeMs=null,shock=!!(previous?.shockUntil&&previous.shockUntil>now);
 if(previous&&previous.liquidityUsd>0&&now-previous.at<=5*60_000){change=(liquidity/previous.liquidityUsd-1)*100;sampleAgeMs=now-previous.at;if(change<=-20)shock=true;}
 if(liquidity>0)liquidityObservations.set(mint,{liquidityUsd:liquidity,at:now,shockUntil:shock?(previous?.shockUntil>now?previous.shockUntil:now+5*60_000):0});
 return{...risk,liquidityChangePct:change,liquidityTrendSampleAgeMs:sampleAgeMs,liquidityShock:shock,liquidityPassed:risk.liquidityPassed&&!shock};
}
function recordModelEvaluation(result,features){
 const model=result.model,now=new Date().toISOString(),gates=result.gates||{},failures=Object.entries(gates).filter(([,passed])=>!passed).map(([name])=>name);
 status.modelEvaluations[model]=(status.modelEvaluations[model]||0)+1;
 if(result.eligible)status.modelEligible[model]=(status.modelEligible[model]||0)+1;
 const counts=status.gateFailures[model]||(status.gateFailures[model]={});
 for(const name of failures)counts[name]=(counts[name]||0)+1;
 status.lastEvaluatedAt=now;status.lastEvaluatedMint=features.mint;
 status.lastGateSnapshot[model]={mint:features.mint,symbol:features.symbol||'UNKNOWN',at:now,eligible:!!result.eligible,score:result.score,gates:{...gates},rejectionReasons:failures};
}
async function evaluateMint(mint){
 if(evaluating.has(mint))return;evaluating.add(mint);
 try{
  const features=latestFeatures.get(mint);if(!features)return;
  const market=await getTokenMarket(mint);
  if(market.dataStatus==='stale'||market.dataStatus==='partial'||!market.priceUsd){status.marketFailures++;return;}
  const risk=assessLiquidityTrend(mint,market,await assessRisk(mint,market));
  const evaluated={...features,latestPriceUsd:market.priceUsd,symbol:features.symbol||market.symbol||'UNKNOWN',market:{priceUsd:market.priceUsd,liquidityUsd:market.liquidityUsd,volume5mUsd:market.volume5mUsd,priceChange5m:market.priceChange5m,dataStatus:market.dataStatus,source:market.marketDataSource},risk};
  const ignition=detectIgnition(evaluated,risk),momentum=detectMomentum(evaluated,risk);
  recordModelEvaluation(ignition,evaluated);recordModelEvaluation(momentum,evaluated);
  evaluated.ignition=ignition;evaluated.momentum=momentum;
  latestFeatures.set(mint,evaluated);
  if(ignition.eligible)publishSignal(ignition,risk,evaluated,market);
  if(momentum.eligible)publishSignal(momentum,risk,evaluated,market);
  for(const signal of signals.values())if(signal.mint===mint)updateSignalOutcome(signal,market,Date.now());
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
export function v4Status(){return{...status,trackedTokens:buffer.tokens().length,discoveredLaunches:launches.size,mode:'paper',liveTradingAvailable:false,signalPublicationEnabled:true,signalModels:['ignition','momentum'],riskProvider:'RugCheck',liquidityProvider:'DexScreener',liquidityFloorUsd:MIN_LIQUIDITY_USD,maxNormalisedRisk:MAX_NORMALISED_RISK,liquidityShockThresholdPct:-20};}
export function v4Features(mint){return latestFeatures.get(mint)||null;}
export function v4TopActivity(limit=50){return[...latestFeatures.values()].sort((a,b)=>(b.netBuyUsd1m||0)-(a.netBuyUsd1m||0)).slice(0,limit);}
export function v4RecentLaunches(limit=100){return[...launches.values()].slice(-limit).reverse();}
export function restoreV4Signals(rows=[]){
 signals.clear();
 for(const signal of rows){
  if(!signal?.mint||!signal?.model||!signal?.id)continue;
  const key=signalKey(signal.mint,signal.model);
  const current=signals.get(key);
  if(!current||Date.parse(signal.createdAt||0)>Date.parse(current.createdAt||0))signals.set(key,signal);
 }
 while(signals.size>MAX_SIGNALS){const oldest=[...signals.entries()].sort((a,b)=>Date.parse(a[1].createdAt)-Date.parse(b[1].createdAt))[0];if(oldest)signals.delete(oldest[0]);}
 status.signals=signals.size;
 return signals.size;
}
export function v4Signals(limit=100){return[...signals.values()].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).slice(0,limit);}
