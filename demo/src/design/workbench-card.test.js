import test from 'node:test';
import assert from 'node:assert/strict';
import {liveWorkbenchCard} from './workbench-card.js';

test('real cards preserve zero demand and API reasons without borrowing preview statistics',()=>{
 const card=liveWorkbenchCard({id:'case-a',title:'回答 A',interest_count:0,reader_interests:{tags:[{tag:'现在的变化',percentage:0}]}});
 assert.equal(card.interestCount,0);
 assert.deepEqual(card.reasons,[{label:'现在的变化',percentage:0}]);
 assert.equal(card.crop,undefined);
 assert.equal(card.excerpt,undefined);
 assert.equal(card.fixture,undefined);
 const missing=liveWorkbenchCard({id:'case-b'});
 assert.equal(missing.interestCount,null);
 assert.deepEqual(missing.reasons,[]);
});
test('waiting cards open participation, while existing interviews and drafts keep their exact IDs',()=>{
 assert.equal(liveWorkbenchCard({id:'a'}).action.invite,true);
 assert.deepEqual(liveWorkbenchCard({id:'b',interview_id:'interview-b'}).action,{label:'继续写后来',screen:'06',options:{interview:'interview-b'}});
 assert.deepEqual(liveWorkbenchCard({id:'c',status:'published',interview_id:'interview-c',draft_id:'draft-c'}).action,{label:'查看草稿与发布记录',screen:'07',options:{draft:'draft-c'}});
});
