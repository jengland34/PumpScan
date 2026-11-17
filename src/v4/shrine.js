import { io } from 'socket.io-client';
import { normaliseShrineTrade, normaliseShrineLaunch } from './events.js';
const ENDPOINT='https://sol.shrine.trade', PROTOCOLS=['PUMPFUN','PUMPFUN_MAYHEM','PUMPSWAP','METEORA','RAYDIUM','RAYDIUM_CLMM','ORCA','BONK','STONKFUN'], MAX_SUBS=50;
export function createShrineStream({onTrade,onLaunch=()=>{},onStatus=()=>{},ioFactory=io,endpoint=ENDPOINT,apiKey=process.env.SHRINE_API_KEY||''}={}){
 let socket,stopped=false,connectedAt=null,lastEventAt=null,received=0,lastError=null,solUsd=null,reconnects=0;
 const subscribed=new Set(),launchSeen=new Set();
 const status=(state,extra={})=>onStatus({provider:'shrine',state,connectedAt,lastEventAt,received,reconnects,activeSubscriptions:subscribed.size,maxSubscriptions:MAX_SUBS,authentication:apiKey?'api_key':'free_keyless',error:lastError,...extra});
 function subscribeToken(mint){if(!socket?.connected||!mint||subscribed.has(mint))return false;if(subscribed.size>=MAX_SUBS){const oldest=subscribed.values().next().value;if(oldest){socket.emit('unsubscribe_trades',{mint:oldest});subscribed.delete(oldest);}}socket.emit('subscribe_trades',{mint},ack=>{if(ack?.error){lastError=`Trade subscription ${mint}: ${ack.error}`;status('degraded');return;}subscribed.add(mint);status('connected');});return true;}
 function connect(){if(stopped)return;status('connecting');socket=ioFactory(endpoint,{transports:['websocket','polling'],reconnection:true,reconnectionDelay:1000,reconnectionDelayMax:30000,timeout:15000,...(apiKey?{auth:{api_key:apiKey}}:{})});
 socket.on('connect',()=>{reconnects++;connectedAt=new Date().toISOString();lastError=null;const restore=[...launchSeen].slice(-MAX_SUBS);subscribed.clear();for(const mint of restore)subscribeToken(mint);socket.emit('subscribe_new_tokens',{protocols:PROTOCOLS},ack=>{if(ack?.error){lastError=`Launch feed: ${ack.error}`;status('degraded');}});socket.emit('subscribe_migrations',{protocols:['PUMPFUN']});socket.emit('subscribe_sol_price');status('connected');});
 socket.on('new_token',row=>{const launch=normaliseShrineLaunch(row);if(!launch||launchSeen.has(launch.mint))return;launchSeen.add(launch.mint);if(launchSeen.size>5000)launchSeen.delete(launchSeen.values().next().value);onLaunch(launch);subscribeToken(launch.mint);lastEventAt=launch.receivedAt;status('connected');});
 socket.on('trade',row=>{const event=normaliseShrineTrade(row,new Date().toISOString(),solUsd);if(!event)return;received++;lastEventAt=event.receivedAt;if(subscribed.has(event.mint)){subscribed.delete(event.mint);subscribed.add(event.mint);}onTrade(event);});
 socket.on('sol_price',row=>{const n=Number(row?.priceUSD??row?.priceUsd??row?.price);if(n>0)solUsd=n;});
 socket.on('migration',row=>{if(row?.mint)subscribeToken(row.mint);status('connected',{lastMigrationAt:new Date().toISOString()});});
 socket.on('connect_error',error=>{lastError=error.message;status('error');});
 socket.on('disconnect',reason=>{subscribed.clear();status('reconnecting',{disconnectReason:reason});});
 socket.on('subscription_error',error=>{lastError=error?.message||error?.error||'Subscription error';status('degraded');});
 }
 connect();
 return{stop(){stopped=true;socket?.removeAllListeners();socket?.disconnect();status('stopped');},getStatus(){return{provider:'shrine',state:stopped?'stopped':socket?.connected?'connected':'connecting',connectedAt,lastEventAt,received,reconnects,activeSubscriptions:subscribed.size,maxSubscriptions:MAX_SUBS,authentication:apiKey?'api_key':'free_keyless',error:lastError};}};
}
