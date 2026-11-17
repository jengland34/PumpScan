import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseShrineTrade, normaliseShrineLaunch, createEventBuffer } from '../src/v4/events.js';
import { calculateFeatures } from '../src/v4/features.js';
import { detectIgnition, detectMomentum } from '../src/v4/detectors.js';

const base={mint:'mint-1',pool:'pool-1',signature:'sig-1',txIndex:4,action:'buy',trader:'wallet-a',tokenAmount:100,quoteAmount:1,quoteMint:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',price:0.01,timestamp:1794916800,protocol:'PUMPSWAP'};
test('normalises a Shrine trade with stablecoin quote into a canonical event',()=>{
 const event=normaliseShrineTrade(base,'2026-11-17T12:00:01Z');
 assert.equal(event.mint,'mint-1');assert.equal(event.side,'buy');assert.equal(event.trader,'wallet-a');assert.equal(event.usd,1);assert.equal(event.provider,'shrine');
});
test('normalises SOL-quoted trade using live SOL/USD and refuses unknown USD conversion',()=>{
 const sol={...base,quoteMint:'So11111111111111111111111111111111111111112',quoteAmount:2,price:0.01};
 assert.equal(normaliseShrineTrade(sol,'2026-11-17T12:00:01Z',150).usd,300);
 assert.equal(normaliseShrineTrade(sol,'2026-11-17T12:00:01Z'),null);
});
test('rejects unsupported or incomplete trades',()=>{
 assert.equal(normaliseShrineTrade({...base,action:'transfer'}),null);
 assert.equal(normaliseShrineTrade({...base,signature:null}),null);
});
test('normalises launch metadata without inventing a trade',()=>{
 const launch=normaliseShrineLaunch({mint:'mint-2',symbol:'NEW',timestamp:1794916800});
 assert.equal(launch.side,'launch');assert.equal(launch.usd,0);
});
test('deduplicates events and calculates rolling buyer and net-flow features',()=>{
 const buffer=createEventBuffer(),at='2026-11-17T12:00:00.000Z';
 const t=(id,side,trader,usd)=>({id,mint:'mint-1',side,trader,usd,priceUsd:.001,receivedAt:at});
 assert.equal(buffer.add(t('1','buy','a',100)),true);assert.equal(buffer.add(t('1','buy','a',100)),false);
 buffer.add(t('2','buy','b',50));buffer.add(t('3','sell','c',20));
 const f=calculateFeatures(buffer,'mint-1',Date.parse(at));
 assert.equal(f.netBuyUsd1m,130);assert.equal(f.uniqueBuyers1m,2);assert.equal(f.dataQuality.events1m,3);
});
test('detectors remain independent and fail closed when safety data is missing',()=>{
 const features={dataQuality:{events1m:8,events5m:20},netBuyUsd1m:200,netBuyUsd5m:500,uniqueBuyers1m:4,uniqueBuyers5m:8,buySellValueRatio5m:2,topBuyerShare5m:.1};
 assert.equal(detectIgnition(features).eligible,false);assert.equal(detectMomentum(features).eligible,false);
 const risk={available:true,passed:true,liquidityPassed:true};
 assert.equal(detectIgnition(features,risk).eligible,true);assert.equal(detectMomentum(features,risk).eligible,true);
});

test('wallet-flow quality metrics describe observed buyer concentration',()=>{
 const buffer=createEventBuffer(),at='2026-11-17T12:00:00.000Z';
 const trade=(id,trader,usd)=>({id,mint:'mint-wallets',side:'buy',trader,usd,priceUsd:.01,receivedAt:at});
 buffer.add(trade('a1','wallet-a',100));buffer.add(trade('a2','wallet-a',50));
 buffer.add(trade('b1','wallet-b',50));buffer.add(trade('c1','wallet-c',50));
 const f=calculateFeatures(buffer,'mint-wallets',Date.parse(at));
 assert.equal(f.topBuyerShare5m,.4);
 assert.equal(f.top3BuyerShare5m,1);
 assert.equal(f.repeatBuyerShare5m,.5);
 assert.equal(f.buyerBreadth5m,.75);
});
