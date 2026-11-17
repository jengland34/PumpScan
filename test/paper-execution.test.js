import test from 'node:test';
import assert from 'node:assert/strict';
import {estimatePaperFill,calculatePaperPnl} from '../src/paper-execution.js';
test('paper fills apply adverse, liquidity-aware slippage',()=>{const b=estimatePaperFill({priceUsd:1,liquidityUsd:10000,notionalUsd:100,side:'buy',baseSlippageBps:100}),s=estimatePaperFill({priceUsd:1,liquidityUsd:10000,notionalUsd:100,side:'sell',baseSlippageBps:100});assert.ok(b.fillPriceUsd>1);assert.ok(s.fillPriceUsd<1);assert.ok(b.slippageBps>=100);});
test('paper P&L deducts entry and exit fees',()=>{const r=calculatePaperPnl({stakeGbp:100,soldFraction:1,entryPriceUsd:1,exitPriceUsd:1.1,entryFeeGbp:1,feeBps:100});assert.ok(r.netPnlGbp<10);assert.ok(r.netPnlGbp>7);});
test('paper fill rejects invalid prices',()=>assert.throws(()=>estimatePaperFill({priceUsd:0}),RangeError));
