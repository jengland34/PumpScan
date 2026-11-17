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
  const checks={price:Number.isFinite(market.priceUsd)&&market.priceUsd>0,liquidity:Number(market.liquidityUsd)>=cfg.minLiquidityUsd,security:report?.available===true&&risk!==null&&risk<cfg.maxRiskScore&&!levels.some(x=>['danger','critical'].includes(x)),age:age!==null&&age>=0&&age<=cfg.maxPairAgeHours,minimumActivity:Number(market.volume5mUsd)>=cfg.minVolume5mUsd};
  const prev=history.length?history[history.length-1]:null;
  const va=prev?ratio(market.volume5mUsd,prev.volume5mUsd):null, ba=prev?ratio(market.buys5m,prev.buys5m):null;
  const lc=prev&&prev.liquidityUsd>0?(market.liquidityUsd/prev.liquidityUsd-1)*100:null;
  const buys=Number(market.buys5m)||0,sells=Number(market.sells5m)||0,buyRatio=buys+sells?buys/(buys+sells):0,pc=Number(market.priceChange5m)||0;
  const signals={};
  if(model==='new_launch'){
    signals.buyPressure=buyRatio>=.70?25:buyRatio>=.60?18:buyRatio>=.52?9:0;
    signals.buyerAcceleration=ba===null?0:ba>=2?25:ba>=1.35?17:ba>=1.1?8:0;
    signals.volumeAcceleration=va===null?0:va>=2?15:va>=1.35?10:va>=1.1?5:0;
    signals.priceAction=pc>=1&&pc<=10?10:pc>10&&pc<=18?5:pc>=0&&pc<1?4:0;
    signals.liquidityStability=lc===null?5:lc>=-2?10:lc>=-7?4:0;
    signals.activity=market.volume5mUsd>=cfg.minVolume5mUsd*3?5:market.volume5mUsd>=cfg.minVolume5mUsd*1.5?4:2;
  } else {
    signals.volumeAcceleration=va===null?0:va>=2?25:va>=1.35?18:va>=1.1?8:0;
    signals.buyPressure=buyRatio>=.70?15:buyRatio>=.60?11:buyRatio>=.52?5:0;
    signals.buyerAcceleration=ba===null?0:ba>=2?15:ba>=1.35?10:ba>=1.1?5:0;
    signals.priceAction=pc>=1&&pc<=8?20:pc>8&&pc<=15?12:pc>=0&&pc<1?5:0;
    signals.liquidityStability=lc===null?5:lc>=-2?10:lc>=-7?4:0;
    signals.activity=market.volume5mUsd>=cfg.minVolume5mUsd*3?10:market.volume5mUsd>=cfg.minVolume5mUsd*1.5?7:4;
  }
  signals.extensionPenalty=pc>30?-25:pc>20?-12:0;
  const raw=Object.values(signals).reduce((s,n)=>s+n,0),score=Math.max(0,Math.min(100,raw));
  const safetyPassed=checks.price&&checks.liquidity&&checks.security&&checks.age,historyReady=history.length>=2;
  const passed=safetyPassed&&checks.minimumActivity&&historyReady&&score>=cfg.minEntryScore;
  return {model,modelLabel:model==='new_launch'?'New launch':'Established',score,minEntryScore:cfg.minEntryScore,checks,safetyPassed,historyReady,observations:history.length+1,passed,signals,metrics:{buyRatio,volumeAcceleration:va,buyerAcceleration:ba,liquidityChangePct:lc},rejectionReasons:Object.entries(checks).filter(([,v])=>!v).map(([k])=>k).concat(!historyReady?['history']:[],score<cfg.minEntryScore?['entry_score']:[])};
}


function includedTokenMap(a=[]){return new Map(a.filter(x=>x.type==='token').map(x=>[x.id,x.attributes||{}]));}
const cache=new Map(),blocked=new Map();let jupNext=0,reddit={at:0,items:[]};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function provider(key,url,ttl=300000,headers={}){const now=Date.now(),c=cache.get(key),until=blocked.get(key)||0;if(c&&now-c.at<ttl)return{status:'cached',value:c.value,error:null};if(now<until)return{status:c?'stale-cache':'cooldown',value:c?.value||null,error:'cooldown'};try{const r=await fetch(url,{headers:{accept:'application/json','user-agent':'PumpWatch/3.3',...headers},signal:AbortSignal.timeout(12000)});if(!r.ok){if(r.status===429)blocked.set(key,now+Math.max(180000,Number(r.headers.get('retry-after'))*1000||0));throw Error('HTTP '+r.status);}const value=await r.json();cache.set(key,{at:now,value});blocked.delete(key);return{status:'live',value,error:null};}catch(e){return{status:c?'stale-cache':'rejected',value:c?.value||null,error:e.message};}}
async function jupiterFeeds(){const out=[];for(const [n,u] of [['recent','https://api.jup.ag/tokens/v2/recent'],['trending','https://api.jup.ag/tokens/v2/toptrending/5m?limit=100'],['organic','https://api.jup.ag/tokens/v2/toporganicscore/5m?limit=100']]){await pause(Math.max(0,jupNext-Date.now()));jupNext=Date.now()+2200;out.push({name:n,...await provider('jup-'+n,u,300000,process.env.JUPITER_API_KEY?{'x-api-key':process.env.JUPITER_API_KEY}:{})});}return out;}
function cleanXml(x=''){return String(x).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();}
async function redditFeed(){if(Date.now()-reddit.at<900000)return{status:'cached',items:reddit.items,checkedAt:new Date(reddit.at).toISOString()};try{const r=await fetch('https://www.reddit.com/search.rss?q=Solana%20memecoin&sort=new&t=day&limit=100',{headers:{accept:'application/rss+xml, application/xml','user-agent':'PumpWatch/1.0 research'},signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Reddit RSS HTTP '+r.status);const xml=await r.text(),items=[...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(m=>{const b=m[1],g=k=>cleanXml((b.match(new RegExp('<'+k+'>([\\s\\S]*?)<\\/'+k+'>','i'))||[])[1]||'');return{title:g('title'),text:g('title')+' '+g('description'),author:g('author'),link:g('link')};}).filter(x=>x.title);reddit={at:Date.now(),items};return{status:'live',items,checkedAt:new Date().toISOString()};}catch(e){return{status:'unavailable',items:reddit.items,error:e.message,checkedAt:reddit.at?new Date(reddit.at).toISOString():null};}}
function sentiment(t){t=t.toLowerCase();const p=['bullish','moon','pump','breakout','gem','strong','buy','surge','adoption','🚀','10x'].filter(w=>t.includes(w)).length,n=['scam','rug','dump','sell','bearish','dead','honeypot','fake','warning','avoid'].filter(w=>t.includes(w)).length;return{p,n,score:p+n?Math.round((p-n)/(p+n)*100):0};}
async function discoverySources(){
 const [profiles,boosts,pools]=await Promise.all([provider('dex-profile',DEX+'/token-profiles/latest/v1'),provider('dex-boost',DEX+'/token-boosts/latest/v1'),provider('gecko',GT+'/networks/solana/new_pools?include=base_token,quote_token,dex&page=1')]);
 const [jup,red]=await Promise.all([jupiterFeeds(),redditFeed()]),rows=new Map();
 const add=(id,m,src,created=null)=>{if(!id)return;const x=rows.get(id)||{tokenAddress:id,sources:[],symbol:m?.symbol,name:m?.name,poolCreatedAt:created};if(!x.sources.includes(src))x.sources.push(src);x.symbol=x.symbol||m?.symbol;x.name=x.name||m?.name;x.poolCreatedAt=x.poolCreatedAt||created;if(m?.organicScore!==undefined)x.jupiterOrganicScore=Number(m.organicScore);if(m?.isVerified!==undefined)x.jupiterVerified=!!m.isVerified;if(m?.audit)x.jupiterAudit=m.audit;rows.set(id,x);};
 if(Array.isArray(profiles.value))for(const x of profiles.value)if(x.chainId==='solana')add(x.tokenAddress,x,'DexScreener profiles');
 if(Array.isArray(boosts.value))for(const x of boosts.value)if(x.chainId==='solana')add(x.tokenAddress,x,'DexScreener boosts');
 if(pools.value)for(const p of pools.value.data||[]){const rel=p.relationships?.base_token?.data,b=includedTokenMap(pools.value.included).get(rel?.id),id=b?.address||rel?.id?.replace(/^solana_/,'');if(id)add(id,b||{},'GeckoTerminal pools',p.attributes?.pool_created_at||null);}
 for(const f of jup)if(Array.isArray(f.value))for(const x of f.value)add(x.id,x,'Jupiter '+f.name);
 for(const x of rows.values()){const sym=String(x.symbol||'').trim(),name=String(x.name||'').trim();if(sym.length<3)continue;const hits=red.items.filter(y=>{const t=y.text.toLowerCase();return t.includes(sym.toLowerCase())||(name.length>4&&t.includes(name.toLowerCase()));}),ss=hits.map(y=>sentiment(y.text));x.socialSentiment={provider:'Reddit RSS',status:red.status,mentions:hits.length,uniqueAuthors:new Set(hits.map(y=>y.author).filter(Boolean)).size,score:ss.length?Math.round(ss.reduce((a,z)=>a+z.score,0)/ss.length):0,positive:ss.reduce((a,z)=>a+z.p,0),negative:ss.reduce((a,z)=>a+z.n,0),checkedAt:red.checkedAt};}
 return{rows:[...rows.values()],sourceStatus:{profiles:{status:profiles.status,count:profiles.value?.length||0,error:profiles.error},boosts:{status:boosts.status,count:boosts.value?.length||0,error:boosts.error},newPools:{status:pools.status,count:pools.value?.data?.length||0,error:pools.error},jupiter:Object.fromEntries(jup.map(x=>[x.name,{status:x.status,count:x.value?.length||0,error:x.error}])),reddit:{status:red.status,count:red.items?.length||0,error:red.error}}};
}
async function mapLimit(items,concurrency,fn){const out=new Array(items.length);let next=0;await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{while(true){const i=next++;if(i>=items.length)return;try{out[i]=await fn(items[i])}catch(e){out[i]={address:items[i].tokenAddress,symbol:items[i].symbol||'UNKNOWN',name:items[i].name||'Unknown token',source:items[i].sources.join(' + '),error:e.message,passed:false,safetyPassed:false,score:0,checks:{price:false,liquidity:false,security:false,age:false,minimumActivity:false},rejectionReasons:['market_data']};}}}));return out;}

function pearson(a,b){const n=Math.min(a.length,b.length);if(n<4)return null;const x=a.slice(-n),y=b.slice(-n),mx=x.reduce((s,v)=>s+v,0)/n,my=y.reduce((s,v)=>s+v,0)/n;let z=0,dx=0,dy=0;for(let i=0;i<n;i++){const u=x[i]-mx,v=y[i]-my;z+=u*v;dx+=u*u;dy+=v*v;}return dx&&dy?z/Math.sqrt(dx*dy):null;}function addPeerCorrelation(cs,hs){const vs=new Map();for(const c of cs){const h=(hs[c.address]||[]).filter(x=>x.priceUsd>0).slice(-8),r=[];for(let i=1;i<h.length;i++)r.push(h[i].priceUsd/h[i-1].priceUsd-1);vs.set(c.address,r);}for(const c of cs){const peers=[];for(const o of cs){if(o.address===c.address)continue;const v=pearson(vs.get(c.address)||[],vs.get(o.address)||[]);if(v!==null&&v>=.65)peers.push({symbol:o.symbol,address:o.address,correlation:+v.toFixed(2),priceChange5m:+(o.priceChange5m||0)});}const up=peers.filter(p=>p.priceChange5m>0);c.localCorrelation={peerCount:peers.length,positivePeerCount:up.length,averagePeerPriceChange5m:up.length?+(up.reduce((n,p)=>n+p.priceChange5m,0)/up.length).toFixed(2):0,peers:peers.sort((a,b)=>b.correlation-a.correlation).slice(0,5),clusterMomentum:peers.length>=2&&up.length>=2?'positive cluster':peers.length>=2?'correlated cluster':'no clear cluster',rankBoost:Math.min(8,up.length*2)};}}
export async function discoverCandidates(limit=60,config={},historyByAddress={}){
  const {rows,sourceStatus}=await discoverySources();
  if(!rows.length)throw new Error(`Discovery providers returned no Solana tokens. Dex profiles: ${sourceStatus.profiles} (${sourceStatus.profileCount}; ${sourceStatus.profilesError||'no error detail'}), boosts: ${sourceStatus.boosts} (${sourceStatus.boostCount}; ${sourceStatus.boostsError||'no error detail'}), Gecko pools: ${sourceStatus.newPools} (${sourceStatus.poolCount}; ${sourceStatus.newPoolsError||'no error detail'}).`);
  const selected=rows.slice(0,Math.max(limit,1));
  const candidates=await mapLimit(selected,3,async item=>{
    const [market,report]=await Promise.all([getTokenMarket(item.tokenAddress),rugcheck(item.tokenAddress)]);
    const pairCreatedAt=market.pairCreatedAt||(item.poolCreatedAt?Date.parse(item.poolCreatedAt):null);
    const pairAgeHours=pairCreatedAt?Math.max(0,(Date.now()-pairCreatedAt)/3600000):null;
    const candidate={...market,address:item.tokenAddress,symbol:market.symbol||item.symbol||'UNKNOWN',name:market.name||item.name||'Unknown token',pairAgeHours,pairCreatedAt,rugcheck:report,source:item.sources.join(' + '),jupiterOrganicScore:item.jupiterOrganicScore??null,jupiterVerified:item.jupiterVerified??false,jupiterAudit:item.jupiterAudit??null,socialSentiment:item.socialSentiment??null,scannedAt:new Date().toISOString()};
    const scored=scoreCandidate(candidate,report,historyByAddress[item.tokenAddress]||[],config);
    return {...candidate,...scored};
  });
  for(const c of candidates){c.sourceStatus=sourceStatus;if(!c.rejectionReasons)c.rejectionReasons=['market_data'];}
  addPeerCorrelation(candidates,historyByAddress);
  candidates.sort((a,b)=>Number(b.passed)-Number(a.passed)||(b.score+(b.localCorrelation?.rankBoost||0))-(a.score+(a.localCorrelation?.rankBoost||0))||(Number(b.volume5mUsd)||0)-(Number(a.volume5mUsd)||0));
  candidates.sourceStatus=sourceStatus;
  return candidates;
}
