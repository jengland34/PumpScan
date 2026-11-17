import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreCandidate } from '../src/scanner.js';
import { updateTokenTracker, telemetrySummary, trimTracking } from '../src/telemetry.js';
const market={address:'Mint111111111111111111111111111111111111',symbol:'TEST',name:'Test',priceUsd:.001,liquidityUsd:25000,volume5mUsd:9000,buys5m:90,sells5m:10,priceChange5m:6,pairAgeHours:8};
const safe={available:true,scoreNormalised:12,risks:[]};
const history=[{at:new Date(Date.now()-600000).toISOString(),volume5mUsd:4000,buys5m:35,sells5m:12,liquidityUsd:24000},{at:new Date(Date.now()-300000).toISOString(),volume5mUsd:6000,buys5m:55,sells5m:18,liquidityUsd:24500}];
test('new-launch model labels young pairs',()=>assert.equal(scoreCandidate(market,safe,history).model,'new_launch'));
test('unknown security data is a hard fail',()=>assert.equal(scoreCandidate(market,{available:false},history).safetyPassed,false));
test('two historical observations required',()=>assert.equal(scoreCandidate(market,safe,[]).historyReady,false));
test('vertical five-minute move receives anti-chase penalty',()=>assert.ok(scoreCandidate({...market,priceChange5m:35},safe,history).signals.extensionPenalty<0));
test('established model applies after configured new-launch window',()=>assert.equal(scoreCandidate({...market,pairAgeHours:36},safe,history).model,'established'));
test('score is clamped to 0..100',()=>{const r=scoreCandidate({...market,priceChange5m:-1000},safe,history);assert.ok(r.score>=0&&r.score<=100)});
test('rejected token is retained without a valid price',()=>{const t=updateTokenTracker(null,{...market,priceUsd:0,error:'provider timeout',source:'GeckoTerminal'},{passed:false,score:0,rejectionReasons:['price','security']});assert.equal(t.latestPassed,false);assert.deepEqual(t.rejectionReasons,['price','security']);assert.equal(t.marketDataError,'provider timeout')});
test('qualified signal records first signal and milestones',()=>{let t=updateTokenTracker(null,market,{passed:true,model:'new_launch',score:80,checks:{}},'2026-01-01T00:00:00.000Z');t=updateTokenTracker(t,{...market,priceUsd:.003},null,'2026-01-01T01:00:00.000Z');const summary=telemetrySummary({[market.address]:t});assert.equal(summary.qualifiedSignals,1);assert.equal(summary.peakMilestones['3x'],1)});
test('tracking cap keeps most recently evaluated tokens',()=>{const t=trimTracking({a:{lastEvaluatedAt:'2026-01-01'},b:{lastEvaluatedAt:'2026-01-03'},c:{lastEvaluatedAt:'2026-01-02'}},2);assert.deepEqual(Object.keys(t),['b','c'])});

test('missing Gecko short-interval metrics fail the activity gate',()=>{const r=scoreCandidate({...market,volume5mUsd:null,buys5m:null,sells5m:null,priceChange5m:null},safe,history);assert.equal(r.checks.minimumActivity,false);assert.equal(r.passed,false)});
test('danger and critical RugCheck risks always fail security',()=>{for(const level of ['danger','critical'])assert.equal(scoreCandidate(market,{...safe,scoreNormalised:1,risks:[{level,name:'test'}]},history).checks.security,false)});

test('partial provider data cannot qualify or claim history readiness',()=>{const r=scoreCandidate({...market,dataStatus:'partial',volume5mUsd:null,buys5m:null,sells5m:null,priceChange5m:null},safe,history);assert.equal(r.checks.marketData,false);assert.equal(r.historyReady,false);assert.equal(r.passed,false)});
test('history must be consecutive and recent',()=>{const old=[{...history[0],at:new Date(Date.now()-3600000).toISOString()},history[1]];const r=scoreCandidate(market,safe,old);assert.equal(r.historyReady,false);assert.equal(r.passed,false)});
