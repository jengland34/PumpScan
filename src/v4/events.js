export function normaliseShrineTrade(row, receivedAt = new Date().toISOString(), solUsd = null) {
  const mint=row?.mint||row?.tokenMint||null, signature=row?.signature||row?.tx||null;
  const index=row?.txIndex??row?.ixIndex??row?.innerIndex??0;
  const side=String(row?.action||(row?.is_buy===true?'buy':row?.is_buy===false?'sell':'')).toLowerCase();
  const trader=row?.trader||row?.wallet||row?.tradersInvolved?.[0]||row?.breakdown?.[0]?.trader||row?.txSigner||null;
  const tokenAmount=Number(row?.tokenAmount??row?.token_amount??0), quoteAmount=Number(row?.quoteAmount??row?.quote_amount??0);
  const quoteMint=row?.quoteMint||row?.quote_mint||row?.quote||null, rawPrice=Number(row?.price??0);
  const explicitUsd=Number(row?.usdValue??row?.amountUsd??row?.volumeUsd??0), feedPriceUsd=Number(row?.priceUSD??row?.priceUsd??0);
  const stable=['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v','USD1'].includes(quoteMint);
  const priceUsd=feedPriceUsd>0?feedPriceUsd:(rawPrice>0&&quoteMint?.startsWith('So111')&&solUsd>0?rawPrice*solUsd:null);
  const usd=explicitUsd>0?explicitUsd:(priceUsd>0&&tokenAmount>0?priceUsd*tokenAmount:(stable?quoteAmount:(quoteMint?.startsWith('So111')&&solUsd>0?quoteAmount*solUsd:0)));
  const timestamp=row?.timestamp??row?.time??receivedAt;
  const parsed=typeof timestamp==='number'?new Date(timestamp<1e10?timestamp*1000:timestamp):new Date(timestamp);
  if(!mint||!signature||!['buy','sell'].includes(side)||!(usd>0)||!Number.isFinite(parsed.getTime()))return null;
  return {id:`${signature}:${row?.pool||'pool'}:${index}`,chain:'solana',provider:'shrine',mint,symbol:row?.symbol||'UNKNOWN',tokenName:row?.name||null,pool:row?.pool||null,protocol:row?.protocol||null,side,trader,usd,priceUsd:priceUsd>0?priceUsd:null,baseAmount:tokenAmount,quoteAmount,signature,index:Number(index),occurredAt:parsed.toISOString(),receivedAt,slot:row?.block??null,txIndex:row?.txIndex??null};
}
export function normaliseShrineLaunch(row,receivedAt=new Date().toISOString()){
 if(!row?.mint)return null;
 const t=row.timestamp??receivedAt, parsed=typeof t==='number'?new Date(t*1000):new Date(t);
 if(!Number.isFinite(parsed.getTime()))return null;
 return {id:`launch:${row.mint}`,chain:'solana',provider:'shrine',mint:row.mint,symbol:row.symbol||'UNKNOWN',tokenName:row.name||null,pool:row.pool||null,protocol:row.protocol||null,side:'launch',trader:row.creator||null,usd:0,priceUsd:null,signature:row.signature||row.tx||null,occurredAt:parsed.toISOString(),receivedAt,launchUri:row.uri||null};
}
export function createEventBuffer({maxEventsPerToken=5000,windowsMs=[10000,60000,300000,900000,3600000]}={}){
 const events=new Map(),seen=new Map();
 function add(event){if(!event?.mint||!event.id||seen.has(event.id))return false;const now=Date.parse(event.receivedAt||new Date().toISOString());seen.set(event.id,now);const rows=events.get(event.mint)||[];rows.push(event);const cutoff=now-Math.max(...windowsMs);while(rows.length&&Date.parse(rows[0].receivedAt)<cutoff)rows.shift();if(rows.length>maxEventsPerToken)rows.splice(0,rows.length-maxEventsPerToken);events.set(event.mint,rows);if(seen.size>maxEventsPerToken*20)for(const[id,at]of seen)if(at<cutoff)seen.delete(id);return true;}
 function snapshot(mint,at=Date.now()){const rows=events.get(mint)||[],result={};for(const windowMs of windowsMs){const selected=rows.filter(e=>at-Date.parse(e.receivedAt)<=windowMs),buys=selected.filter(e=>e.side==='buy'),sells=selected.filter(e=>e.side==='sell'),sum=list=>list.reduce((n,e)=>n+e.usd,0);result[windowMs]={windowMs,trades:selected.length,buys:buys.length,sells:sells.length,buyUsd:sum(buys),sellUsd:sum(sells),netBuyUsd:sum(buys)-sum(sells),uniqueBuyers:new Set(buys.map(e=>e.trader).filter(Boolean)).size,uniqueSellers:new Set(sells.map(e=>e.trader).filter(Boolean)).size,latestPriceUsd:[...selected].reverse().find(e=>e.priceUsd)?.priceUsd??null,topBuyerShare:(()=>{const m=new Map();for(const e of buys)if(e.trader)m.set(e.trader,(m.get(e.trader)||0)+e.usd);const total=sum(buys);return total?Math.max(0,...m.values())/total:0})()};}return{mint,asOf:new Date(at).toISOString(),windows:result};}
 return{add,snapshot,tokens:()=>[...events.keys()],size:mint=>(events.get(mint)||[]).length};
}
