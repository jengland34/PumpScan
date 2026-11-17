import { io } from 'socket.io-client';
import { normaliseShrineTrade, normaliseShrineLaunch } from './events.js';

// These are the protocol identifiers accepted by Shrine's new-token feed.
const ENDPOINT='https://sol.shrine.trade';
const PROTOCOLS=['PUMPFUN','PUMPSWAP','METEORA','RAYDIUM','ORCA','BONK','STONKFUN'];
const MAX_SUBS=50;

export function createShrineStream({onTrade,onLaunch=()=>{},onStatus=()=>{},ioFactory=io,endpoint=ENDPOINT,apiKey=process.env.SHRINE_API_KEY||''}={}){
 let socket,stopped=false,connectedAt=null,lastEventAt=null,lastLaunchAt=null,lastTradeAt=null;
 let received=0,rawTradeEvents=0,rejectedTradeEvents=0,launchEvents=0,reconnects=0;
 let lastError=null,launchFeedAck='pending',migrationFeedAck='pending',solUsd=null;
 const subscribed=new Set(),launchSeen=new Set();
 const status=(state,extra={})=>onStatus({
  provider:'shrine',state,connectedAt,lastEventAt,lastLaunchAt,lastTradeAt,
  received,rawTradeEvents,rejectedTradeEvents,launchEvents,reconnects,
  activeSubscriptions:subscribed.size,maxSubscriptions:MAX_SUBS,
  authentication:apiKey?'api_key':'free_keyless',launchFeedAck,migrationFeedAck,
  error:lastError,...extra
 });
 function subscribeToken(mint){
  if(!socket?.connected||!mint||subscribed.has(mint))return false;
  if(subscribed.size>=MAX_SUBS){
   const oldest=subscribed.values().next().value;
   if(oldest){socket.emit('unsubscribe_trades',{mint:oldest});subscribed.delete(oldest);}
  }
  socket.emit('subscribe_trades',{mint},ack=>{
   if(ack?.error){
    lastError='Trade subscription '+mint.slice(0,8)+': '+(ack.message||ack.error);
    status('degraded',{lastSubscriptionError:lastError});
    return;
   }
   subscribed.add(mint);
   status('connected',{lastSubscriptionError:null});
  });
  return true;
 }
 function connect(){
  if(stopped)return;
  status('connecting');
  socket=ioFactory(endpoint,{
   transports:['websocket','polling'],reconnection:true,reconnectionDelay:1000,
   reconnectionDelayMax:30000,timeout:15000,...(apiKey?{auth:{api_key:apiKey}}:{})
  });
  socket.on('connect',()=>{
   reconnects++;connectedAt=new Date().toISOString();lastError=null;
   subscribed.clear();launchFeedAck='pending';migrationFeedAck='pending';for(const mint of [...launchSeen].slice(-MAX_SUBS))subscribeToken(mint);
   socket.emit('subscribe_new_tokens',{protocols:PROTOCOLS},ack=>{
    if(ack?.error){launchFeedAck='rejected';lastError='Launch feed rejected: '+(ack.message||ack.error);status('degraded');}
    else{launchFeedAck='accepted';status('connected');}
   });
   socket.emit('subscribe_migrations',{protocols:['PUMPFUN']},ack=>{
    if(ack?.error){migrationFeedAck='rejected';status('degraded',{migrationError:ack.message||ack.error});}
    else{migrationFeedAck='accepted';status('connected');}
   });
   socket.emit('subscribe_sol_price',{},ack=>{
    if(ack?.error)status('connected',{solPriceError:ack.message||ack.error});
   });
   status('connected');
  });
  socket.on('new_token',row=>{
   const launch=normaliseShrineLaunch(row);
   if(!launch){status('connected',{lastRejectedEvent:'Malformed launch event (missing mint or invalid timestamp)'});return;}
   if(launchSeen.has(launch.mint))return;
   launchSeen.add(launch.mint);
   if(launchSeen.size>5000)launchSeen.delete(launchSeen.values().next().value);
   launchEvents++;lastLaunchAt=launch.receivedAt;lastEventAt=launch.receivedAt;
   onLaunch(launch);subscribeToken(launch.mint);
   status('connected');
  });
  socket.on('trade',row=>{
   rawTradeEvents++;
   const event=normaliseShrineTrade(row,new Date().toISOString(),solUsd);
   if(!event){
    rejectedTradeEvents++;
    const missing=[];
    if(!row?.mint&&!row?.tokenMint)missing.push('mint');
    if(!row?.signature&&!row?.tx)missing.push('signature');
    if(!(row?.action||typeof row?.is_buy==='boolean'))missing.push('buy/sell side');
    if(!(Number(row?.usdValue||row?.amountUsd||row?.volumeUsd||0)>0)&&!(Number(row?.priceUSD||row?.priceUsd||0)>0)&&!(Number(row?.price||0)>0))missing.push('price/value');
    status('connected',{lastRejectedEvent:'Trade normaliser rejected event: '+(missing.join(', ')||'unrecognised payload')});
    return;
   }
   received++;lastTradeAt=event.receivedAt;lastEventAt=event.receivedAt;
   onTrade(event);status('connected');
  });
  socket.on('sol_price',row=>{
   const n=Number(row?.priceUSD??row?.priceUsd??row?.price);
   if(n>0){solUsd=n;status('connected',{solUsd});}
  });
  socket.on('migration',row=>{
   if(row?.mint)subscribeToken(row.mint);
   status('connected',{lastMigrationAt:new Date().toISOString()});
  });
  socket.on('connect_error',error=>{lastError=error.message;status('error');});
  socket.on('disconnect',reason=>{subscribed.clear();status('reconnecting',{disconnectReason:reason});});
  socket.on('subscription_error',error=>{
   lastError=error?.message||error?.error||'Subscription error';status('degraded');
  });
 }
 connect();
 return{
  stop(){stopped=true;socket?.removeAllListeners();socket?.disconnect();status('stopped');},
  getStatus(){return{
   provider:'shrine',state:stopped?'stopped':socket?.connected?'connected':'connecting',
   connectedAt,lastEventAt,lastLaunchAt,lastTradeAt,received,rawTradeEvents,
   rejectedTradeEvents,launchEvents,reconnects,activeSubscriptions:subscribed.size,
   maxSubscriptions:MAX_SUBS,authentication:apiKey?'api_key':'free_keyless',
   launchFeedAck,migrationFeedAck,error:lastError
  };}
 };
}
