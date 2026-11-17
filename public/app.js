const $=s=>document.querySelector(s);
const CACHE_KEY='pumpwatch:last-good-dashboard:v1';
let cachedDashboard={};try{cachedDashboard=JSON.parse(localStorage.getItem(CACHE_KEY)||'{}')}catch{}
let state=cachedDashboard.state||{},v4=cachedDashboard.v4||{},activity=cachedDashboard.activity||[],launches=cachedDashboard.launches||[],signals=cachedDashboard.signals||[];
let usingCachedDashboard=!!cachedDashboard.savedAt;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>'£'+Number(n||0).toFixed(2);
const compact=n=>{n=Number(n||0);return n>=1e6?'$'+(n/1e6).toFixed(2)+'m':n>=1e3?'$'+(n/1e3).toFixed(1)+'k':'$'+n.toFixed(0)};
async function api(url,opts){const r=await fetch(url,{...opts,headers:{'content-type':'application/json',...(opts?.headers||{})},cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error||r.statusText);return d}
function notify(t){const el=$('#toast');if(!el)return;el.textContent=t;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2600)}
function card(c){return '<article class="token"><div class="tokenTop"><div><b>'+esc(c.symbol||'TOKEN')+'</b><small>'+esc(c.name||c.address||'')+'</small></div><strong>'+Number(c.score||0)+'<small>/100</small></strong></div><div class="tokenMetrics"><span>Price <b>$'+Number(c.priceUsd||0).toPrecision(5)+'</b></span><span>5m vol <b>'+compact(c.volume5mUsd)+'</b></span><span>Liquidity <b>'+compact(c.liquidityUsd)+'</b></span></div><p>'+esc(c.modelLabel||c.model||'Candidate')+' · '+esc(c.refreshStatus||'')+' · '+esc((c.rejectionReasons||[]).slice(0,2).join(' / ')||'Awaiting model evaluation')+'</p><div class="tokenActions"><code>'+esc((c.address||'').slice(0,7)+'…'+(c.address||'').slice(-5))+'</code>'+(c.url?'<a href="'+esc(c.url)+'" target="_blank" rel="noopener">Chart ↗</a>':'')+'<button data-buy="'+esc(c.address)+'" '+(!c.passed||c.refreshStatus!=='fresh'?'disabled':'')+'>Paper buy</button></div></article>'}
function render(){
 const candidates=state.candidates||[];const universe=$('#universe');if(universe)universe.textContent=(state.universe?.total||0)+' in universe';
 const q=($('#search')?.value||'').toLowerCase(),type=$('#type')?.value||'all',sort=$('#sort')?.value||'score';
 let list=candidates.filter(c=>(!q||[c.symbol,c.name,c.address].some(x=>String(x||'').toLowerCase().includes(q)))&&(type==='all'||c.model===type));
 list.sort((a,b)=>sort==='volume'?(b.volume5mUsd||0)-(a.volume5mUsd||0):sort==='liquidity'?(b.liquidityUsd||0)-(a.liquidityUsd||0):(b.score||0)-(a.score||0));
 $('#candidates').innerHTML=list.map(card).join('')||'<div class="empty">No matching candidates yet. Discovery is running automatically.</div>';
 const positions=state.positions||[],open=positions.filter(p=>p.remainingFraction>0);
 const unrealised=open.reduce((sum,p)=>{const price=Number(state.market?.[p.address]?.priceUsd||p.entryPrice),pct=p.entryPrice>0?price/p.entryPrice-1:0;return sum+p.stakeGbp*p.remainingFraction*pct},0);
 $('#openCount').textContent=open.length;$('#unrealized').textContent=(unrealised>=0?'+':'')+money(unrealised);
 $('#positions').innerHTML=open.map(p=>{const price=Number(state.market?.[p.address]?.priceUsd||p.entryPrice),u=p.stakeGbp*p.remainingFraction*(price/p.entryPrice-1);return '<article class="token"><div class="tokenTop"><b>'+esc(p.symbol)+'</b><span>'+(p.automatic?'AUTO · '+esc(p.v4Model||'MODEL'):'MANUAL')+'</span></div><p>Entry $'+Number(p.entryPrice).toPrecision(5)+' · Now $'+price.toPrecision(5)+' · stake '+money(p.stakeGbp)+' · remaining '+Math.round(p.remainingFraction*100)+'%</p><b>Unrealised '+(u>=0?'+':'')+money(u)+' · Realised '+money(p.realisedPnlGbp)+'</b><button data-sell="'+esc(p.id)+'">Close position</button></article>'}).join('')||'<div class="empty">No open paper positions. Enable automatic paper trading in Settings or use a candidate’s Paper buy button.</div>';
 $('#paperModeStatus').textContent=state.v4Paper?.enabled?'AUTO PAPER ON · '+(state.v4Paper.ignition?'Ignition ':'')+(state.v4Paper.momentum?'Momentum':'')+' · '+money(state.v4Paper.stakeGbp)+' per entry':'Automatic paper trading is off. Configure it in Settings.';
 const closed=positions.filter(p=>p.remainingFraction<=0),trades=state.trades||[];
 $('#closedCount').textContent=closed.length;$('#realized').textContent=money(closed.reduce((s,p)=>s+(p.realisedPnlGbp||0),0));$('#profitFactor').textContent='—';$('#drawdown').textContent='—';
 $('#history').innerHTML='<h3>Recent paper activity</h3>'+trades.slice(0,20).map(t=>'<p class="history">'+esc(t.type)+' · '+esc(t.symbol)+' · '+money(t.realisedPnlGbp)+' · '+new Date(t.at).toLocaleString()+'</p>').join('');
 $('#enabled').checked=!!state.scanner?.enabled;
 const cfg=state.v4Paper||{};
 $('#v4Auto').checked=!!cfg.enabled;$('#v4Ignition').checked=cfg.ignition!==false;$('#v4Momentum').checked=cfg.momentum!==false;
 $('#v4Stake').value=cfg.stakeGbp??25;$('#v4MaxPositions').value=cfg.maxOpenPositions??3;$('#v4Liquidity').value=cfg.minLiquidityUsd??5000;$('#v4Risk').value=cfg.maxRiskScore??40;
 $('#v4Stop').value=(cfg.hardStopPct??.15)*100;$('#v4Target').value=cfg.takeProfitMultiple??1.5;$('#v4Trail').value=(cfg.trailingStopPct??.10)*100;
 $('#v4Hold').value=cfg.maxHoldMinutes??120;$('#v4Cooldown').value=cfg.cooldownMinutes??30;$('#v4DailyLoss').value=cfg.dailyLossLimitGbp??50;
 $('#discoveryStatus').textContent=state.discoveryBusy?'Scan running…':state.lastDiscoveryError?'Last scan failed: '+state.lastDiscoveryError:state.discoveryDiagnostics?'Last scan '+new Date(state.discoveryDiagnostics.lastAttemptAt).toLocaleString()+' · '+(state.discoveryDiagnostics.candidateCount||0)+' fresh candidates · '+(state.discoveryDiagnostics.passedCount||0)+' passed':'Waiting for first discovery scan';
 $('#scanStatus').textContent=state.discoveryBusy?'Discovery scan running in background…':state.discoveryDiagnostics?'Last scan: '+(state.discoveryDiagnostics.newDiscoveries||0)+' new discoveries, '+(state.discoveryDiagnostics.evaluatedCount||0)+' evaluated, '+(state.discoveryDiagnostics.passedCount||0)+' passed. '+(state.discoveryDiagnostics.lastError||''):'Discovery runs automatically every '+(state.scanner?.scanIntervalSeconds||120)+' seconds.';
 $('#performanceNote').textContent=closed.length<30?'Early paper sample ('+closed.length+' closed trades). No statistical edge is claimed until at least 30 completed trades.':'Sample available; model-separated analysis still required.';
 const stats=['ignition','momentum'].map(model=>{const rows=signals.filter(x=>x.model===model&&x.status!=='active'&&x.outcome),wins=rows.filter(x=>x.outcome.returnPct>0),g=wins.reduce((n,x)=>n+x.outcome.returnPct,0),l=-rows.filter(x=>x.outcome.returnPct<0).reduce((n,x)=>n+x.outcome.returnPct,0);return '<p><b>'+model.toUpperCase()+'</b> · '+rows.length+' completed · '+(rows.length?Math.round(wins.length/rows.length*100)+'% wins':'—')+' · PF '+(l?(g/l).toFixed(2):'—')+'</p>'}).join('');
 $('#v4Performance').innerHTML='<h3>V4 signal outcomes</h3>'+stats+'<small>Signal returns are indicative mark-to-market observations, not executable fills.</small>';
}
function renderV4(){
 const s=v4;$('#feed').textContent=String(s.state||'UNKNOWN').toUpperCase();$('#feed').className='state '+(s.state==='connected'?'good':'');
 $('#connection').textContent=(s.state||'unknown')+(s.error?' · '+s.error:'');$('#trades').textContent=s.received||0;$('#launches').textContent=s.launches||launches.length||0;$('#tracked').textContent=(s.trackedTokens||0)+' / 50';
 $('#subText').textContent=(s.activeSubscriptions||0)+' / '+(s.maxSubscriptions||50)+' active token subscriptions · launch feed: '+(s.launchFeedAck||'pending')+' · raw trades: '+(s.rawTradeEvents||0)+' · rejected: '+(s.rejectedTradeEvents||0);
 $('#subMeter').style.width=Math.min(100,(s.activeSubscriptions||0)/50*100)+'%';$('#lastEvent').textContent=s.lastEventAt?'Last event '+new Date(s.lastEventAt).toLocaleTimeString():'Waiting for first event';
 $('#activity').innerHTML=activity.length?activity.slice(0,12).map((f,i)=>'<article class="activity"><div><b>#'+(i+1)+' '+esc(f.symbol||f.mint?.slice(0,8)||'Token')+'</b><small>'+esc(f.mint||'')+'</small></div><div><strong class="'+(f.netBuyUsd1m>=0?'green':'red')+'">'+compact(f.netBuyUsd1m)+'</strong><small>net buy · '+(f.uniqueBuyers1m||0)+' buyers · '+(f.buySellValueRatio1m?Number(f.buySellValueRatio1m).toFixed(2)+'×':'—')+'</small></div></article>').join(''):'<div class="empty">No live trades received yet. Connection status above is authoritative.</div>';
 $('#launchList').innerHTML=launches.length?launches.slice(0,15).map(x=>'<div class="launch"><b>'+esc(x.symbol||'New token')+'</b><small>'+esc(x.mint)+' · '+esc(x.protocol||'Solana')+'</small></div>').join(''):'No launch events received.';
 $('#ignitionCount').textContent=signals.filter(x=>x.model==='ignition'&&x.status==='active').length;$('#momentumCount').textContent=signals.filter(x=>x.model==='momentum'&&x.status==='active').length;
 const names={data:'Trade sample',security:'Security',liquidity:'Liquidity',marketData:'Market data',concentration:'Buyer concentration',netBuying:'Net buying',buyerGrowth:'Buyer growth',buyPressure:'Buy pressure',participation:'Wallet participation',buyerCount:'Unique buyers',buyerAcceleration:'Buyer acceleration',tradeAcceleration:'Trade acceleration',notOverextended:'Not overextended',positiveMove:'Positive price move',notExhausted:'Not exhausted'};
 const diag=model=>{const rows=activity.filter(x=>x[model]?.gates).slice(0,8);return rows.length?rows.map(x=>{const g=x[model].gates;return '<article class="activity"><div><b>'+esc(x.symbol||x.mint.slice(0,8))+' · '+Object.values(g).filter(Boolean).length+'/'+Object.keys(g).length+' gates</b><small>'+Object.entries(g).map(([k,v])=>(v?'✓ ':'✕ ')+(names[k]||k)).join(' · ')+'</small><small>Security '+(x.risk?.available?(x.risk.passed?'PASS':'FAIL'):'UNAVAILABLE')+' · Liquidity '+compact(x.risk?.liquidityUsd)+' · '+esc(x.risk?.marketDataStatus||'no market data')+'</small></div></article>'}).join(''):'<div class="empty">Waiting for live trade activity before gate evaluation can be displayed.</div>'};
 $('#ignitionDiagnostics').innerHTML='<h3>Live eligibility · recent active tokens</h3>'+diag('ignition');$('#momentumDiagnostics').innerHTML='<h3>Live eligibility · recent active tokens</h3>'+diag('momentum');
 const sigs=model=>{const rows=signals.filter(x=>x.model===model);return rows.length?rows.slice(0,12).map(x=>'<article class="activity"><div><b>'+esc((x.mint||'').slice(0,7)+'…')+' · '+esc(x.status)+'</b><small>'+esc((x.reasons||[]).join(' · '))+'</small></div><div><strong>'+ (x.outcome?Number(x.outcome.returnPct).toFixed(1)+'%':'LIVE')+'</strong><small>peak '+Number(x.outcome?.peakReturnPct||0).toFixed(1)+'% · '+esc(x.risk?.provider||'risk')+'</small></div></article>').join(''):'<div class="empty">No qualifying '+model+' signals yet. Risk gates fail closed.</div>'};
 $('#ignitionList').innerHTML=sigs('ignition');$('#momentumList').innerHTML=sigs('momentum');
}
async function refresh(){
 const results=await Promise.allSettled([api('/api/state'),api('/api/v4/status'),api('/api/v4/activity'),api('/api/v4/launches'),api('/api/v4/signals')]);
 const failures=[];
 if(results[0].status==='fulfilled'){const incoming=results[0].value;const previous=state;state=incoming;if(!(incoming.candidates||[]).length&&(previous.candidates||[]).length){state={...incoming,candidates:previous.candidates,universe:incoming.universe?.total?incoming.universe:previous.universe,discoveryDiagnostics:incoming.discoveryDiagnostics||previous.discoveryDiagnostics};usingCachedDashboard=true;}else usingCachedDashboard=false;}else failures.push('Dashboard: '+results[0].reason.message);
 if(results[1].status==='fulfilled')v4=results[1].value;else failures.push('Feed status: '+results[1].reason.message);
 if(results[2].status==='fulfilled')activity=results[2].value.items||[];else failures.push('Activity: '+results[2].reason.message);
 if(results[3].status==='fulfilled')launches=results[3].value.items||[];else failures.push('Launches: '+results[3].reason.message);
 if(results[4].status==='fulfilled')signals=results[4].value.items||[];else failures.push('Signals: '+results[4].reason.message);
 if(state&&Object.keys(state).length){
  try{localStorage.setItem(CACHE_KEY,JSON.stringify({state,v4,activity,launches,signals,savedAt:new Date().toISOString()}));}catch(e){console.warn('Dashboard cache unavailable',e);}
  render();
 }
 renderV4();
 const cacheNote=usingCachedDashboard?'Showing last saved token snapshot while reconnecting. ':'';
 if(failures.length){$('#connection').textContent=cacheNote+failures.join(' · ');$('#connection').title=failures.join('\n');}
 else if(usingCachedDashboard){$('#connection').textContent='Showing saved snapshot';}
}
$('#nav').addEventListener('click',e=>{const b=e.target.closest('[data-view]');if(!b)return;document.querySelectorAll('#nav button').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id===b.dataset.view));});
['search','type','sort'].forEach(id=>$('#'+id).addEventListener('input',render));
$('#scan').addEventListener('click',async()=>{const b=$('#scan');b.disabled=true;try{await api('/api/scanner/run',{method:'POST'});notify('Discovery scan started');}catch(e){notify(e.message)}finally{b.disabled=false;}});
$('#saveSettings').addEventListener('click',async()=>{try{await api('/api/scanner/settings',{method:'POST',body:JSON.stringify({enabled:$('#enabled').checked})});await refresh();notify('Discovery settings saved');}catch(e){notify(e.message);}});
$('#saveV4Paper').addEventListener('click',async()=>{try{await api('/api/v4/paper/settings',{method:'POST',body:JSON.stringify({enabled:$('#v4Auto').checked,ignition:$('#v4Ignition').checked,momentum:$('#v4Momentum').checked,stakeGbp:Number($('#v4Stake').value),maxOpenPositions:Number($('#v4MaxPositions').value),minLiquidityUsd:Number($('#v4Liquidity').value),maxRiskScore:Number($('#v4Risk').value),hardStopPct:Number($('#v4Stop').value)/100,takeProfitMultiple:Number($('#v4Target').value),trailingStopPct:Number($('#v4Trail').value)/100,maxHoldMinutes:Number($('#v4Hold').value),cooldownMinutes:Number($('#v4Cooldown').value),dailyLossLimitGbp:Number($('#v4DailyLoss').value)})});await refresh();notify('Automatic paper strategy saved');}catch(e){notify('Save failed: '+e.message);}});
document.addEventListener('click',async e=>{const buy=e.target.closest('[data-buy]'),sell=e.target.closest('[data-sell]');try{if(buy){await api('/api/scanner/buy/'+encodeURIComponent(buy.dataset.buy),{method:'POST'});notify('Paper position opened');}if(sell){await api('/api/paper/sell/'+encodeURIComponent(sell.dataset.sell),{method:'POST'});notify('Position closed');}if(buy||sell)await refresh();}catch(x){notify(x.message);}});
refresh();setInterval(refresh,5000);
