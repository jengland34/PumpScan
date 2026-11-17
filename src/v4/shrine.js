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
 const subscribed=new Set(),pendingSubscriptions=new Set(),launchSeen=new Set(),rejectedReasons={};
 const status=(state,extra={})=>onStatus({
  provider:'shrine',state,connectedAt,lastEventAt,lastLaunchAt,lastTradeAt,
  received,rawTradeEvents,rejectedTradeEvents,launchEvents,reconnects,
  activeSubscriptions:subscribed.size+pendingSubscriptions.size,maxSubscriptions:MAX_SUBS,
  authentication:apiKey?'api_key':'free_keyless',launchFeedAck,migrationFeedAck,
  error:lastError,...extra
 });
 function subscribeToken(mint){
  if(!socket?.connected||!mint||subscribed.has(mint)||pendingSubscriptions.has(mint))return false;
  if(subscribed.size+pendingSubscriptions.size>=MAX_SUBS){
   const oldest=subscribed.values().next().value;
   if(oldest){socket.emit('unsubscribe_trades',{mint:oldest});subscribed.delete(oldest);}
   else{lastError='Trade subscription capacity reached ('+MAX_SUBS+'); waiting for an acknowledgement';status('degraded',{lastSubscriptionError:lastError});return false;}
  }
  pendingSubscriptions.add(mint);
  status('connected');
  socket.emit('subscribe_trades',{mint},ack=>{
   pendingSubscriptions.delete(mint);
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
   subscribed.clear();pendingSubscriptions.clear();launchFeedAck='pending';migrationFeedAck='pending';for(const mint of [...launchSeen].slice(-MAX_SUBS))subscribeToken(mint);
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
    if(!(Number(row?.tokenAmount??row?.token_amount??row?.baseAmount??row?.base_amount??0)>0))missing.push('token amount');
    if(!Number.isFinite(new Date(typeof (row?.timestamp??row?.time??Date.now())==='number'?(Number(row?.timestamp??row?.time)<1e10?Number(row?.timestamp??row?.time)*1000:Number(row?.timestamp??row?.time)):(row?.timestamp??row?.time??Date.now())).getTime()))missing.push('timestamp');
    const reason=missing.join(', ')||'unrecognised payload';rejectedReasons[reason]=(rejectedReasons[reason]||0)+1;
    status('connected',{lastRejectedEvent:'Trade normaliser rejected event: '+reason,rejectedReasons:{...rejectedReasons}});
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
  socket.on('disconnect',reason=>{subscribed.clear();pendingSubscriptions.clear();status('reconnecting',{disconnectReason:reason});});
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
