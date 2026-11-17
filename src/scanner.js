import { getTokenMarket } from './market.js';

const DEX = 'https://api.dexscreener.com';
const GT = 'https://api.geckoterminal.com/api/v2';
const DEFAULT_SCAN_CONFIG = Object.freeze({ minLiquidityUsd: 10000, minVolume5mUsd: 1500, maxPairAgeHours: 72, maxRiskScore: 35, minEntryScore: 55, newLaunchMaxAgeHours: 24 });

async function json(url, timeout = 12000) {
  const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'PumpWatch/3.2' }, signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`Provider returned ${response.status}`);
  return response.json();
}
async function rugcheck(mint) {
  try {
    const data = await json(`https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mint)}/report/summary`, 10000);
    return { available: true, scoreNormalised: Number.isFinite(Number(data.score_normalised)) ? Number(data.score_normalised) : null, score: Number(data.score), lpLockedPct: data.lpLockedPct == null ? null : Number(data.lpLockedPct), risks: Array.isArray(data.risks) ? data.risks.map(x => ({ name:x.name, level:x.level, description:x.description })) : [], mintAuthority:data.mintAuthority??null, freezeAuthority:data.freezeAuthority??null };
  } catch { return { available:false, risks:[] }; }
}
function ratio(a,b){return Number.isFinite(a)&&Number.isFinite(b)&&b>0?a/b:null;}

export function scoreCandidate(market, report, history = [], config = {}) {
  const cfg={...DEFAULT_SCAN_CONFIG,...config}, age=market.pairAgeHours;
  const model=age!==null&&age<=cfg.newLaunchMaxAgeHours?'new_launch':'established';
  const levels=(report?.risks||[]).map(x=>String(x.level||'').toLowerCase());
  const risk=Number.isFinite(report?.scoreNormalised)?report.scoreNormalised:null;
  const checks={price:Number.isFinite(market.priceUsd)&&market.priceUsd>0,liquidity:Number(market.liquidityUsd)>=cfg.minLiquidityUsd,security:report?.available===true&&risk!==null&&risk<cfg.maxRiskScore&&!levels.some(x=>['danger','critical'].includes(x)),age:age!==null&&age>=0&&age<=cfg.maxPairAgeHours,minimumActivity:Number.isFinite(Number(market.volume5mUsd))&&Number(market.volume5mUsd)>=cfg.minVolume5mUsd};
  const prev=history.length?history[history.length-1]:null;
  const va=prev&&Number.isFinite(Number(market.volume5mUsd))?ratio(Number(market.volume5mUsd),Number(prev.volume5mUsd)):null, ba=prev&&Number.isFinite(Number(market.buys5m))?ratio(Number(market.buys5m),Number(prev.buys5m)):null;
  const lc=prev&&prev.liquidityUsd>0?(market.liquidityUsd/prev.liquidityUsd-1)*100:null;
  const buys=Number(market.buys5m),sells=Number(market.sells5m),hasFlow=Number.isFinite(buys)&&Number.isFinite(sells)&&buys+sells>0,buyRatio=hasFlow?buys/(buys+sells):0,pc=Number(market.priceChange5m);
  const signals={};
  if(model==='new_launch'){
    signals.buyPressure=!hasFlow?0:buyRatio>=.70?25:buyRatio>=.60?18:buyRatio>=.52?9:0;
    signals.buyerAcceleration=ba===null?0:ba>=2?25:ba>=1.35?17:ba>=1.1?8:0;
    signals.volumeAcceleration=va===null?0:va>=2?15:va>=1.35?10:va>=1.1?5:0;
    signals.priceAction=Number.isFinite(pc)?(pc>=1&&pc<=10?10:pc>10&&pc<=18?5:pc>=0&&pc<1?4:0):0;
    signals.liquidityStability=lc===null?5:lc>=-2?10:lc>=-7?4:0;
    signals.activity=market.volume5mUsd>=cfg.minVolume5mUsd*3?5:market.volume5mUsd>=cfg.minVolume5mUsd*1.5?4:2;
  } else {
    signals.volumeAcceleration=va===null?0:va>=2?25:va>=1.35?18:va>=1.1?8:0;
    signals.buyPressure=!hasFlow?0:buyRatio>=.70?15:buyRatio>=.60?11:buyRatio>=.52?5:0;
    signals.buyerAcceleration=ba===null?0:ba>=2?15:ba>=1.35?10:ba>=1.1?5:0;
    signals.priceAction=Number.isFinite(pc)?(pc>=1&&pc<=8?20:pc>8&&pc<=15?12:pc>=0&&pc<1?5:0):0;
    signals.liquidityStability=lc===null?5:lc>=-2?10:lc>=-7?4:0;
    signals.activity=market.volume5mUsd>=cfg.minVolume5mUsd*3?10:market.volume5mUsd>=cfg.minVolume5mUsd*1.5?7:4;
  }
  signals.extensionPenalty=Number.isFinite(pc)?(pc>30?-25:pc>20?-12:0):0;
  const raw=Object.values(signals).reduce((s,n)=>s+n,0),score=Math.max(0,Math.min(100,raw));
  const marketSentimentScore=Math.max(0,Math.min(100,Object.entries(signals).filter(([k])=>k!=='extensionPenalty').reduce((sum,[,v])=>sum+Math.max(0,v),0)));
  const sentimentBasis=model==='new_launch'?'Buy pressure, buyer acceleration, volume acceleration, price action and liquidity stability':'Volume acceleration, buy pressure, buyer acceleration, price action and liquidity stability';
  const safetyPassed=checks.price&&checks.liquidity&&checks.security&&checks.age,historyReady=history.length>=2;
  const passed=safetyPassed&&checks.minimumActivity&&historyReady&&score>=cfg.minEntryScore;
  return {model,modelLabel:model==='new_launch'?'New launch':'Established',score,marketSentimentScore,sentimentBasis,minEntryScore:cfg.minEntryScore,checks,safetyPassed,historyReady,observations:history.length+1,passed,signals,metrics:{buyRatio,volumeAcceleration:va,buyerAcceleration:ba,liquidityChangePct:lc},rejectionReasons:Object.entries(checks).filter(([,v])=>!v).map(([k])=>k).concat(!historyReady?['history']:[],score<cfg.minEntryScore?['entry_score']:[])};
}


function includedTokenMap(a=[]){return new Map(a.filter(x=>x.type==='token').map(x=>[x.id,x.attributes||{}]));}
const cache=new Map(),blocked=new Map();let jupNext=0;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function provider(key,url,ttl=300000,headers={}){const now=Date.now(),c=cache.get(key),until=blocked.get(key)||0;if(c&&now-c.at<ttl)return{status:'cached',value:c.value,error:null};if(now<until)return{status:c?'stale-cache':'cooldown',value:c?.value||null,error:'cooldown'};try{const r=await fetch(url,{headers:{accept:'application/json','user-agent':'PumpWatch/3.3',...headers},signal:AbortSignal.timeout(12000)});if(!r.ok){if(r.status===429)blocked.set(key,now+Math.max(180000,Number(r.headers.get('retry-after'))*1000||0));throw Error('HTTP '+r.status);}const value=await r.json();cache.set(key,{at:now,value});blocked.delete(key);return{status:'live',value,error:null};}catch(e){return{status:c?'stale-cache':'rejected',value:c?.value||null,error:e.message};}}
async function jupiterFeeds(){const out=[];for(const [n,u] of [['recent','https://api.jup.ag/tokens/v2/recent'],['trending','https://api.jup.ag/tokens/v2/toptrending/5m?limit=100'],['organic','https://api.jup.ag/tokens/v2/toporganicscore/5m?limit=100']]){await pause(Math.max(0,jupNext-Date.now()));jupNext=Date.now()+2200;out.push({name:n,...await provider('jup-'+n,u,300000,process.env.JUPITER_API_KEY?{'x-api-key':process.env.JUPITER_API_KEY}:{})});}return out;}
async function discoverySources(){
 const [profiles,boosts,pools]=await Promise.all([provider('dex-profile',DEX+'/token-profiles/latest/v1'),provider('dex-boost',DEX+'/token-boosts/latest/v1'),provider('gecko',GT+'/networks/solana/new_pools?include=base_token,quote_token,dex&page=1')]);
 const jup=await jupiterFeeds(),rows=new Map();
 const add=(id,m,src,created=null,pool=null)=>{if(!id)return;const x=rows.get(id)||{tokenAddress:id,sources:[],symbol:m?.symbol,name:m?.name,poolCreatedAt:created};if(!x.sources.includes(src))x.sources.push(src);x.symbol=x.symbol||m?.symbol;x.name=x.name||m?.name;x.poolCreatedAt=x.poolCreatedAt||created;if(pool&&!x.geckoPool)x.geckoPool=pool;if(m?.organicScore!==undefined)x.jupiterOrganicScore=Number(m.organicScore);if(m?.isVerified!==undefined)x.jupiterVerified=!!m.isVerified;if(m?.audit)x.jupiterAudit=m.audit;rows.set(id,x);};
 if(Array.isArray(profiles.value))for(const x of profiles.value)if(x.chainId==='solana')add(x.tokenAddress,x,'DexScreener profiles');
 if(Array.isArray(boosts.value))for(const x of boosts.value)if(x.chainId==='solana')add(x.tokenAddress,x,'DexScreener boosts');
 if(pools.value)for(const p of pools.value.data||[]){const rel=p.relationships?.base_token?.data,b=includedTokenMap(pools.value.included).get(rel?.id),id=b?.address||rel?.id?.replace(/^solana_/,'');if(id)add(id,b||{},'GeckoTerminal pools',p.attributes?.pool_created_at||null,p.attributes||null);}
 for(const f of jup)if(Array.isArray(f.value))for(const x of f.value)add(x.id,x,'Jupiter '+f.name);
 // Independent discovery fallbacks. These feeds are only used when the
 // primary DexScreener/GeckoTerminal/Jupiter sources return no candidates.
 let pumpfun=null,dexpaprika=null;
 if(rows.size===0){
   pumpfun=await provider('pumpfun-new','https://frontend-api-v3.pump.fun/coins?offset=0&limit=50&sort=created_timestamp&order=DESC&includeNsfw=false',300000);
   const coins=Array.isArray(pumpfun.value)?pumpfun.value:(pumpfun.value?.coins||pumpfun.value?.data||[]);
   for(const x of coins)if(x?.mint)add(x.mint,x,'Pump.fun new launches',x.created_timestamp?(Number(x.created_timestamp)<1e12?new Date(Number(x.created_timestamp)*1000).toISOString():new Date(Number(x.created_timestamp)).toISOString()):null);
 }
 if(rows.size===0){
   dexpaprika=await provider('dexpaprika-solana-new','https://api.dexpaprika.com/networks/solana/pools/search?order_by=created_at&sort=desc&limit=50&detailed=true',300000);
   const pools=dexpaprika.value?.results||dexpaprika.value?.data||[];
   for(const p of pools){
     const tokens=Array.isArray(p.tokens)?p.tokens:[p.base_token,p.token0,p.token].filter(Boolean);
     for(const t of tokens){
       const id=t?.address||t?.token_address||t?.id||t?.mint;
       if(id)add(id,{symbol:t.symbol,name:t.name},'DexPaprika new pools',p.created_at||p.createdAt||null);
     }
   }
 }
 const red={items:[],status:'disabled',checkedAt:new Date().toISOString()};
 for(const x of rows.values()){const sym=String(x.symbol||'').trim().replace(/[^a-z0-9]/gi,''),name=String(x.name||'').trim();if(sym.length<3)continue;const hits=red.items.filter(y=>{const t=y.text;return new RegExp('(^|[^a-z0-9])'+sym+'([^a-z0-9]|$)','i').test(t)||(name.length>4&&t.toLowerCase().includes(name.toLowerCase()));}),ss=hits.map(y=>sentiment(y.text));x.socialSentiment={provider:'Reddit RSS',status:red.status,mentions:hits.length,uniqueAuthors:new Set(hits.map(y=>y.author).filter(Boolean)).size,score:ss.length?Math.round(ss.reduce((a,z)=>a+z.score,0)/ss.length):0,positive:ss.reduce((a,z)=>a+z.p,0),negative:ss.reduce((a,z)=>a+z.n,0),checkedAt:red.checkedAt};}
 return{rows:[...rows.values()],sourceStatus:{profiles:{status:profiles.status,count:profiles.value?.length||0,error:profiles.error},boosts:{status:boosts.status,count:boosts.value?.length||0,error:boosts.error},newPools:{status:pools.status,count:pools.value?.data?.length||0,error:pools.error},jupiter:Object.fromEntries(jup.map(x=>[x.name,{status:x.status,count:x.value?.length||0,error:x.error}])),pumpfun:pumpfun?{status:pumpfun.status,count:(Array.isArray(pumpfun.value)?pumpfun.value.length:(pumpfun.value?.coins||pumpfun.value?.data||[]).length),error:pumpfun.error}:{status:'not-needed',count:0,error:null},dexpaprika:dexpaprika?{status:dexpaprika.status,count:(dexpaprika.value?.results||dexpaprika.value?.data||[]).length,error:dexpaprika.error}:{status:'not-needed',count:0,error:null}}};
}
function geckoMarketFallback(item){
 const p=item.geckoPool;if(!p)return null;
 const n=v=>{const x=Number(v);return Number.isFinite(x)?x:0;};
 const volume=p.volume_usd||{};
 const price=n(p.base_token_price_usd),liquidity=n(p.reserve_in_usd);
 if(!(price>0))return null;
 return {address:item.tokenAddress,name:item.name||'Unknown token',symbol:item.symbol||'TOKEN',priceUsd:price,liquidityUsd:liquidity,volume24hUsd:n(volume.h24),marketCapUsd:0,pairAddress:p.address||null,dexId:p.dex_id||'GeckoTerminal',url:null,priceChange24h:null,priceChange5m:null,volume5mUsd:null,buys5m:null,sells5m:null,pairCreatedAt:p.pool_created_at?Date.parse(p.pool_created_at):null,marketDataSource:'GeckoTerminal fallback (price/liquidity only; 5m metrics unavailable)',fetchedAt:new Date().toISOString()};
}
async function mapLimit(items,concurrency,fn){const out=new Array(items.length);let next=0;await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{while(true){const i=next++;if(i>=items.length)return;try{out[i]=await fn(items[i])}catch(e){out[i]={address:items[i].tokenAddress,symbol:items[i].symbol||'UNKNOWN',name:items[i].name||'Unknown token',source:items[i].sources.join(' + '),error:e.message,passed:false,safetyPassed:false,score:0,checks:{price:false,liquidity:false,security:false,age:false,minimumActivity:false},rejectionReasons:['market_data']};}}}));return out;}

export async function refreshCandidates(items=[],config={},historyByAddress={}){
 const selected=items.filter(x=>x?.tokenAddress||x?.address).map(x=>({tokenAddress:x.tokenAddress||x.address,symbol:x.symbol,name:x.name,sources:Array.isArray(x.sources)?x.sources:[x.source||'Previously discovered'],poolCreatedAt:x.poolCreatedAt||x.pairCreatedAt||null}));
 const candidates=await mapLimit(selected,3,async item=>{
  const [marketResult,report]=await Promise.all([getTokenMarket(item.tokenAddress).then(value=>({value})).catch(error=>({error})),rugcheck(item.tokenAddress)]);
  const market=marketResult.value;
  if(!market)throw new Error('Market data unavailable: '+(marketResult.error?.message||'no market snapshot'));
  const pairCreatedAt=market.pairCreatedAt||(item.poolCreatedAt?Date.parse(item.poolCreatedAt):null);
  const pairAgeHours=pairCreatedAt?Math.max(0,(Date.now()-pairCreatedAt)/3600000):null;
  const candidate={...market,address:item.tokenAddress,symbol:market.symbol||item.symbol||'UNKNOWN',name:market.name||item.name||'Unknown token',pairAgeHours,pairCreatedAt,rugcheck:report,source:item.sources.join(' + '),scannedAt:new Date().toISOString()};
  return {...candidate,...scoreCandidate(candidate,report,historyByAddress[item.tokenAddress]||[],config)};
 });
 return candidates.map((c,i)=>({...c,rejectionReasons:c.rejectionReasons||['market_data'],source:selected[i]?.sources?.join(' + ')||'Previously discovered'}));
}

function pearson(a,b){const n=Math.min(a.length,b.length);if(n<4)return null;const x=a.slice(-n),y=b.slice(-n),mx=x.reduce((s,v)=>s+v,0)/n,my=y.reduce((s,v)=>s+v,0)/n;let z=0,dx=0,dy=0;for(let i=0;i<n;i++){const u=x[i]-mx,v=y[i]-my;z+=u*v;dx+=u*u;dy+=v*v;}return dx&&dy?z/Math.sqrt(dx*dy):null;}function addPeerCorrelation(cs,hs){const vs=new Map();for(const c of cs){const h=(hs[c.address]||[]).filter(x=>x.priceUsd>0).slice(-8),r=[];for(let i=1;i<h.length;i++)r.push(h[i].priceUsd/h[i-1].priceUsd-1);vs.set(c.address,r);}for(const c of cs){const peers=[];for(const o of cs){if(o.address===c.address)continue;const v=pearson(vs.get(c.address)||[],vs.get(o.address)||[]);if(v!==null&&v>=.65)peers.push({symbol:o.symbol,address:o.address,correlation:+v.toFixed(2),priceChange5m:+(o.priceChange5m||0)});}const up=peers.filter(p=>p.priceChange5m>0);c.localCorrelation={peerCount:peers.length,positivePeerCount:up.length,averagePeerPriceChange5m:up.length?+(up.reduce((n,p)=>n+p.priceChange5m,0)/up.length).toFixed(2):0,peers:peers.sort((a,b)=>b.correlation-a.correlation).slice(0,5),clusterMomentum:peers.length>=2&&up.length>=2?'positive cluster':peers.length>=2?'correlated cluster':'no clear cluster',rankBoost:Math.min(8,up.length*2)};}}
export async function discoverCandidates(limit=60,config={},historyByAddress={}){
  const {rows,sourceStatus}=await discoverySources();
  // Empty discovery is not a failed scan: the persistent universe must still be re-evaluated.
  const selected=rows.slice(0,Math.max(limit,1));
  const candidates=await mapLimit(selected,3,async item=>{
    const [marketResult,report]=await Promise.all([getTokenMarket(item.tokenAddress).then(value=>({value})).catch(error=>({error})),rugcheck(item.tokenAddress)]);
    const market=marketResult.value||geckoMarketFallback(item);
    if(!market)throw new Error('Market data unavailable: '+(marketResult.error?.message||'no usable GeckoTerminal pool snapshot'));
    const pairCreatedAt=market.pairCreatedAt||(item.poolCreatedAt?Date.parse(item.poolCreatedAt):null);
    const pairAgeHours=pairCreatedAt?Math.max(0,(Date.now()-pairCreatedAt)/3600000):null;
    const candidate={...market,address:item.tokenAddress,symbol:market.symbol||item.symbol||'UNKNOWN',name:market.name||item.name||'Unknown token',pairAgeHours,pairCreatedAt,rugcheck:report,source:item.sources.join(' + '),jupiterOrganicScore:item.jupiterOrganicScore??null,jupiterVerified:item.jupiterVerified??false,jupiterAudit:item.jupiterAudit??null,socialSentiment:item.socialSentiment??null,scannedAt:new Date().toISOString()};
    const scored=scoreCandidate(candidate,report,historyByAddress[item.tokenAddress]||[],config);
    return {...candidate,...scored};
  });
  for(const c of candidates){c.sourceStatus=sourceStatus;if(!c.rejectionReasons)c.rejectionReasons=['market_data'];}
  addPeerCorrelation(candidates,historyByAddress);
  candidates.sort((a,b)=>Number(b.passed)-Number(a.passed)||((b.score+(b.localCorrelation?.rankBoost||0)+(b.socialSentiment?.mentions>=3&&b.socialSentiment?.uniqueAuthors>=2&&b.socialSentiment?.score>0?Math.min(4,b.socialSentiment.mentions):0)+(b.jupiterOrganicScore>=60?2:0))-(a.score+(a.localCorrelation?.rankBoost||0)+(a.socialSentiment?.mentions>=3&&a.socialSentiment?.uniqueAuthors>=2&&a.socialSentiment?.score>0?Math.min(4,a.socialSentiment.mentions):0)+(a.jupiterOrganicScore>=60?2:0)))||(Number(b.volume5mUsd)||0)-(Number(a.volume5mUsd)||0));
  candidates.sourceStatus=sourceStatus;
  return candidates;
}
