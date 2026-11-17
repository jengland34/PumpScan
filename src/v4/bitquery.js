import { normaliseBitqueryTrade } from './events.js';
const ENDPOINT='wss://streaming.bitquery.io/graphql';
export const SOLANA_TRADES_SUBSCRIPTION = `subscription PumpWatchSolanaTrades {
  Trading {
    Trades(where: { Pair: { Market: { Network: { is: "Solana" } } } }) {
      Side
      Trader { Address }
      TransactionHeader { Hash Index Sender }
      Amounts { Base Quote }
      AmountsInUsd { Base Quote }
      Block { Time Timestamp }
      Pair {
        Currency { Id Name Symbol }
        Market { Address Program Network }
        Token { Address Id Name Symbol TokenId Network }
        QuoteToken { Address Id Symbol }
      }
      Price
      PriceInUsd
    }
  }
}`;

export function createBitqueryStream({ token, onTrade, onStatus = () => {}, WebSocketImpl = globalThis.WebSocket, endpoint = ENDPOINT } = {}) {
  let socket=null, stopped=false, reconnectTimer=null, watchdog=null, reconnectMs=1000, connectedAt=null, lastEventAt=null, lastMessageAt=null, received=0, error=null;
  function status(state, extra={}) { onStatus({provider:'bitquery',state,connectedAt,lastEventAt,received,error,...extra}); }
  function connect() {
    if(stopped)return;
    if(!token){error='BITQUERY_ACCESS_TOKEN is not configured';status('disabled');return;}
    if(typeof WebSocketImpl!=='function'){error='Node.js WebSocket support is unavailable; run on Node.js 22+';status('error');return;}
    status('connecting');
    clearInterval(watchdog);
    watchdog=setInterval(()=>{if(socket?.readyState===1&&lastMessageAt&&Date.now()-lastMessageAt>90_000){error='Bitquery stream silent for over 90 seconds';status('reconnecting');try{socket.close(4000,'stream watchdog');}catch{}}},15_000);
    const url=new URL(endpoint);url.searchParams.set('token',token);
    socket=new WebSocketImpl(url.toString(),['graphql-transport-ws']);
    socket.addEventListener('open',()=>{reconnectMs=1000;socket.send(JSON.stringify({type:'connection_init'}));});
    socket.addEventListener('message',event=>{
      lastMessageAt=Date.now();
      let msg;try{msg=JSON.parse(typeof event.data==='string'?event.data:String(event.data));}catch{return;}
      if(msg.type==='connection_ack'){
        connectedAt=new Date().toISOString();status('connected');
        socket.send(JSON.stringify({id:'pumpwatch-solana-trades',type:'subscribe',payload:{query:SOLANA_TRADES_SUBSCRIPTION}}));
      } else if(msg.type==='next'){
        const rows=msg.payload?.data?.Trading?.Trades||[];
        for(const row of rows){const trade=normaliseBitqueryTrade(row);if(trade){received++;lastEventAt=trade.receivedAt;onTrade(trade);}}
        status('connected');
      } else if(msg.type==='error'){error=JSON.stringify(msg.payload);status('error');}
      else if(msg.type==='ping')socket.send(JSON.stringify({type:'pong'}));
    });
    socket.addEventListener('error',()=>{error='Bitquery WebSocket transport error';status('error');});
    socket.addEventListener('close',()=>{clearInterval(watchdog);status('disconnected');if(!stopped){reconnectTimer=setTimeout(connect,reconnectMs);reconnectMs=Math.min(30000,reconnectMs*2);}});
  }
  connect();
  return { stop(){stopped=true;clearTimeout(reconnectTimer);clearInterval(watchdog);try{socket?.close(1000,'PumpWatch shutdown');}catch{}status('stopped');}, getStatus(){return {provider:'bitquery',state:stopped?'stopped':socket?.readyState===1?'connected':'connecting',connectedAt,lastEventAt,received,error};} };
}
