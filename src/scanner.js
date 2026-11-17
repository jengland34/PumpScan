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

function includedTokenMap(included=[]){return new Map(included.filter(x=>x.type==='token').map(x=>[x.id,x.attributes||{}]));}
let discoveryCooldownUntil=0;
async function discoverySources(){\n  if(Date.now()<discoveryCooldownUntil)throw new Error(`Discovery providers rate-limited; retry after ${Math.ceil((discoveryCooldownUntil-Date.now())/1000)} seconds.`);
  const settled=await Promise.allSettled([
    json(`${DEX}/token-profiles/latest/v1`),
    json(`${DEX}/token-boosts/latest/v1`),
    json(`${GT}/networks/solana/new_pools?include=base_token,quote_token,dex&page=1`)
  ]);
  const [profiles,boosts,pools]=settled;\n  if(settled.some(x=>x.status==='rejected'&&Number(x.reason?.message?.match(/\\b429\\b/)?.[0])===429)){discoveryCooldownUntil=Date.now()+180000;}
  const rows=new Map();
  const add=(address,meta,source,poolCreatedAt=null)=>{
    if(!address)return;
    const old=rows.get(address)||{tokenAddress:address,sources:[],symbol:meta?.symbol,name:meta?.name,poolCreatedAt};
    if(!old.sources.includes(source))old.sources.push(source);
    if(!old.symbol&&meta?.symbol)old.symbol=meta.symbol;
    if(!old.name&&meta?.name)old.name=meta.name;
    if(!old.poolCreatedAt&&poolCreatedAt)old.poolCreatedAt=poolCreatedAt;
    rows.set(address,old);
  };
  if(profiles.status==='fulfilled'&&Array.isArray(profiles.value))for(const x of profiles.value)if(x.chainId==='solana')add(x.tokenAddress,x,'DexScreener profile');
  if(boosts.status==='fulfilled'&&Array.isArray(boosts.value))for(const x of boosts.value)if(x.chainId==='solana')add(x.tokenAddress,x,'DexScreener boost');
  if(pools.status==='fulfilled'){
    const data=pools.value?.data||[],tokens=includedTokenMap(pools.value?.included);
    for(const pool of data){
      const rel=pool.relationships?.base_token?.data,quote=pool.relationships?.quote_token?.data;
      const base=tokens.get(rel?.id),q=tokens.get(quote?.id);
      const baseAddress=base?.address||rel?.id?.replace(/^solana_/,'');
      const quoteAddress=q?.address||quote?.id?.replace(/^solana_/,'');
      const a=pool.attributes||{},created=a.pool_created_at||null;
      // Avoid treating wrapped SOL/stablecoin quote assets as the speculative token.
      const quoteSym=String(q?.symbol||'').toUpperCase();
      const token=(baseAddress&&baseAddress!==quoteAddress)?{address:baseAddress,meta:base}:null;
      if(token)add(token.address,token.meta||{},'GeckoTerminal new pool',created);
      else if(quoteAddress)add(quoteAddress,q||{},'GeckoTerminal new pool',created);
    }
  }
  const failure=(x)=>x.status==='rejected'?(x.reason?.cause?.code||x.reason?.code||x.reason?.message||String(x.reason)):null;
  const sourceStatus={profiles:profiles.status,boosts:boosts.status,newPools:pools.status,profileCount:profiles.status==='fulfilled'?(profiles.value?.length||0):0,boostCount:boosts.status==='fulfilled'?(boosts.value?.length||0):0,poolCount:pools.status==='fulfilled'?(pools.value?.data?.length||0):0,profilesError:failure(profiles),boostsError:failure(boosts),newPoolsError:failure(pools)};
  return {rows:[...rows.values()],sourceStatus};
}
async function mapLimit(items,concurrency,fn){const out=new Array(items.length);let next=0;await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{while(true){const i=next++;if(i>=items.length)return;try{out[i]=await fn(items[i])}catch(e){out[i]={address:items[i].tokenAddress,symbol:items[i].symbol||'UNKNOWN',name:items[i].name||'Unknown token',source:items[i].sources.join(' + '),error:e.message,passed:false,safetyPassed:false,score:0,checks:{price:false,liquidity:false,security:false,age:false,minimumActivity:false},rejectionReasons:['market_data']};}}}));return out;}

export async function discoverCandidates(limit=15,config={},historyByAddress={}){
  const {rows,sourceStatus}=await discoverySources();
  if(!rows.length)throw new Error(`Discovery providers returned no Solana tokens. Dex profiles: ${sourceStatus.profiles} (${sourceStatus.profileCount}; ${sourceStatus.profilesError||'no error detail'}), boosts: ${sourceStatus.boosts} (${sourceStatus.boostCount}; ${sourceStatus.boostsError||'no error detail'}), Gecko pools: ${sourceStatus.newPools} (${sourceStatus.poolCount}; ${sourceStatus.newPoolsError||'no error detail'}).`);
  const selected=rows.slice(0,Math.max(limit,1));
  const candidates=await mapLimit(selected,6,async item=>{
    const [market,report]=await Promise.all([getTokenMarket(item.tokenAddress),rugcheck(item.tokenAddress)]);
    const pairCreatedAt=market.pairCreatedAt||(item.poolCreatedAt?Date.parse(item.poolCreatedAt):null);
    const pairAgeHours=pairCreatedAt?Math.max(0,(Date.now()-pairCreatedAt)/3600000):null;
    const candidate={...market,address:item.tokenAddress,symbol:market.symbol||item.symbol||'UNKNOWN',name:market.name||item.name||'Unknown token',pairAgeHours,pairCreatedAt,rugcheck:report,source:item.sources.join(' + '),scannedAt:new Date().toISOString()};
    const scored=scoreCandidate(candidate,report,historyByAddress[item.tokenAddress]||[],config);
    return {...candidate,...scored};
  });
  for(const c of candidates){c.sourceStatus=sourceStatus;if(!c.rejectionReasons)c.rejectionReasons=['market_data'];}
  candidates.sort((a,b)=>Number(b.passed)-Number(a.passed)||b.score-a.score||(Number(b.volume5mUsd)||0)-(Number(a.volume5mUsd)||0));
  candidates.sourceStatus=sourceStatus;
  return candidates;
}
