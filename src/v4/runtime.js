import { createEventBuffer } from './events.js';
import { calculateFeatures } from './features.js';
import { detectIgnition, detectMomentum } from './detectors.js';
import { createBitqueryStream } from './bitquery.js';

const buffer=createEventBuffer();
const latestFeatures=new Map();
const status={provider:'bitquery',state:'not_started',received:0,persisted:0,lastEventAt:null,lastError:null};
let stream=null, persistEvent=async()=>{};
const signals=[];
export function startV4({token=process.env.BITQUERY_ACCESS_TOKEN,saveEvent=async()=>{}}={}) {
  if(stream)return stream;
  persistEvent=saveEvent;
  stream=createBitqueryStream({token,onTrade:event=>{
    if(!buffer.add(event))return;
    status.received++;status.lastEventAt=event.receivedAt;
    const features=calculateFeatures(buffer,event.mint);
    latestFeatures.set(event.mint,features);
    // Sprint 1 records observations only. Signal publication remains disabled until
    // security/liquidity enrichment and full signal lifecycle are wired in Sprint 2.
    Promise.resolve(persistEvent(event)).then(()=>status.persisted++).catch(error=>{status.lastError=error.message;});
  },onStatus:next=>Object.assign(status,next)});
  return stream;
}
export function stopV4(){stream?.stop();stream=null;}
export function v4Status(){return {...status,trackedTokens:buffer.tokens().length,mode:'paper',liveTradingAvailable:false,signalPublicationEnabled:false};}
export function v4Features(mint){return latestFeatures.get(mint)||null;}
export function v4TopActivity(limit=50){return [...latestFeatures.values()].sort((a,b)=>(b.netBuyUsd1m||0)-(a.netBuyUsd1m||0)).slice(0,limit);}
