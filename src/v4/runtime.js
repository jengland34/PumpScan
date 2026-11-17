import { createEventBuffer } from './events.js';
import { calculateFeatures } from './features.js';
import { createShrineStream } from './shrine.js';
const buffer=createEventBuffer(),latestFeatures=new Map(),launches=new Map();
const status={provider:'shrine',state:'not_started',received:0,persisted:0,lastEventAt:null,lastError:null,launches:0};
let stream=null,persistEvent=async()=>{};
export function startV4({apiKey=process.env.SHRINE_API_KEY,saveEvent=async()=>{}}={}){if(stream)return stream;persistEvent=saveEvent;stream=createShrineStream({apiKey,onLaunch:launch=>{launches.set(launch.mint,launch);status.launches=launches.size;},onTrade:event=>{if(!buffer.add(event))return;status.received++;status.lastEventAt=event.receivedAt;latestFeatures.set(event.mint,calculateFeatures(buffer,event.mint));Promise.resolve(persistEvent(event)).then(ok=>{if(ok!==false)status.persisted++;}).catch(error=>{status.lastError=error.message;});},onStatus:next=>Object.assign(status,next)});return stream;}
export function stopV4(){stream?.stop();stream=null;}
export function v4Status(){return{...status,trackedTokens:buffer.tokens().length,discoveredLaunches:launches.size,mode:'paper',liveTradingAvailable:false,signalPublicationEnabled:false};}
export function v4Features(mint){return latestFeatures.get(mint)||null;}
export function v4TopActivity(limit=50){return[...latestFeatures.values()].sort((a,b)=>(b.netBuyUsd1m||0)-(a.netBuyUsd1m||0)).slice(0,limit);}
export function v4RecentLaunches(limit=100){return[...launches.values()].slice(-limit).reverse();}
