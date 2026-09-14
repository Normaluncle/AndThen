import test from 'node:test';
import assert from 'node:assert/strict';
import {followingItems} from './following-items.js';
test('a followed pending candidate retains its detail link instead of an unavailable story placeholder',()=>{
 const candidate={candidate_id:'candidate',linked_source_id:'source'};
 assert.deepEqual(followingItems([{source_id:'source',available:false}],[candidate]),{stories:[],candidates:[candidate]});
 const story={source_id:'source',available:true};
 assert.deepEqual(followingItems([story],[candidate]),{stories:[story],candidates:[]});
 assert.deepEqual(followingItems([{source_id:'withdrawn',available:false}],[]).stories,[{source_id:'withdrawn',available:false}]);
});
