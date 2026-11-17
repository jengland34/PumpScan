import test from 'node:test';
import assert from 'node:assert/strict';
import { selectFairRefreshBatch } from '../src/rotation.js';

test('refresh queue selects oldest attempts across the whole pool, not just leaders',()=>{
  const rows=Array.from({length:60},(_,i)=>({address:'mint-'+i,score:100-i,lastRefreshAttemptAt:new Date(Date.now()-((i+1)*60000)).toISOString()}));
  const {batch,eligibleCount}=selectFairRefreshBatch(rows,new Set(),20);
  assert.equal(eligibleCount,60);
  assert.equal(batch.length,20);
  assert.deepEqual(batch.map(x=>x.address),rows.slice().reverse().slice(0,20).map(x=>x.address));
});

test('fresh discoveries are excluded from the refresh batch',()=>{
  const rows=[{address:'new',lastRefreshAttemptAt:'2026-01-01'},{address:'old',lastRefreshAttemptAt:'2025-01-01'}];
  const {batch}=selectFairRefreshBatch(rows,new Set(['new']),20);
  assert.deepEqual(batch.map(x=>x.address),['old']);
});

test('failed attempts move to the back when lastRefreshAttemptAt is updated',()=>{
  const now=Date.now();
  const rows=[{address:'a',lastRefreshAttemptAt:new Date(now-30000).toISOString()},{address:'b',lastRefreshAttemptAt:new Date(now-20000).toISOString()},{address:'c',lastRefreshAttemptAt:new Date(now-10000).toISOString()}];
  const first=selectFairRefreshBatch(rows,new Set(),2).batch;
  const retried=first.map(x=>({...x,lastRefreshAttemptAt:new Date(now).toISOString()}));
  const next=selectFairRefreshBatch([...rows.filter(x=>!first.some(y=>y.address===x.address)),...retried],new Set(),2).batch;
  assert.deepEqual(next.map(x=>x.address),['c','a']);
});
