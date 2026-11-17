import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseBitqueryTrade, createEventBuffer } from '../src/v4/events.js';
import { calculateFeatures } from '../src/v4/features.js';
import { detectIgnition, detectMomentum } from '../src/v4/detectors.js';

const base={Side:'buy',Trader:{Address:'wallet-a'},TransactionHeader:{Hash:'sig-1',Index:0},Amounts:{Base:100,Quote:1},AmountsInUsd:{Base:100,Quote:100},Block:{Time:'2026-11-17T12:00:00Z'},Pair:{Market:{Address:'pool-1',Program:'raydium'},Token:{Address:'mint-1',Symbol:'TEST',Name:'Test Token'}}};

test('normalises a Bitquery Solana trade into a stable canonical event',()=>{
 const event=normaliseBitqueryTrade(base,'2026-11-17T12:00:01Z');
 assert.equal(event.id,'sig-1:0');assert.equal(event.mint,'mint-1');assert.equal(event.side,'buy');assert.equal(event.trader,'wallet-a');assert.equal(event.usd,100);
});
test('rejects incomplete or unsupported trade rows',()=>{
 assert.equal(normaliseBitqueryTrade({...base,Side:'transfer'}),null);
 assert.equal(normaliseBitqueryTrade({...base,TransactionHeader:{}}),null);
});
test('deduplicates events and calculates rolling buyer and net-flow features',()=>{
 const buffer=createEventBuffer();
 const t=(id,side,trader,usd,receivedAt)=>({id,mint:'mint-1',side,trader,usd,priceUsd:0.001,receivedAt});
 const at='2026-11-17T12:00:00.000Z';
 assert.equal(buffer.add(t('1','buy','a',100,at)),true);
 assert.equal(buffer.add(t('1','buy','a',100,at)),false);
 buffer.add(t('2','buy','b',50,at));buffer.add(t('3','sell','c',20,at));
 const f=calculateFeatures(buffer,'mint-1',Date.parse(at));
 assert.equal(f.netBuyUsd1m,130);assert.equal(f.uniqueBuyers1m,2);assert.equal(f.dataQuality.events1m,3);
});
test('detectors remain independent and fail closed when safety data is missing',()=>{
 const features={dataQuality:{events1m:8,events5m:20},netBuyUsd1m:200,netBuyUsd5m:500,uniqueBuyers1m:4,uniqueBuyers5m:8,buySellValueRatio5m:2,topBuyerShare5m:.1};
 assert.equal(detectIgnition(features).eligible,false);
 assert.equal(detectMomentum(features).eligible,false);
 const risk={available:true,passed:true,liquidityPassed:true};
 assert.equal(detectIgnition(features,risk).eligible,true);
 assert.equal(detectMomentum(features,risk).eligible,true);
});
