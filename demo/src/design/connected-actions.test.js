import test from 'node:test';
import assert from 'node:assert/strict';
import {startOwnInterview,publishOwnDraft,notificationTarget} from './connected-actions.js';
test('opening/declining the writing dialog does not create an interview; all consents required',async()=>{
 const calls=[];const request=async(...args)=>{calls.push(args);return {session:{id:'session-a'}};};
 await assert.rejects(()=>startOwnInterview(request,{id:'case-a',source_id:'source-a'},{ownsContent:true,privateInterview:true,modelProcessing:false}));
 assert.equal(calls.length,0);
 const result=await startOwnInterview(request,{id:'case-a',source_id:'source-a'},{ownsContent:true,privateInterview:true,modelProcessing:true});
 assert.equal(result.session.id,'session-a');
 assert.deepEqual(calls.map(([path])=>path),['/sources/source-a/consents','/sources/source-a/consents','/cases/case-a/decision','/cases/case-a/interviews']);
 assert.equal(calls.some(([, ,body])=>body.purpose==='demo_public_display'),false);
});
test('failed permission save stops the interview sequence',async()=>{
 const calls=[];await assert.rejects(()=>startOwnInterview(async path=>{calls.push(path);throw new Error('403');},{id:'a',source_id:'b'},{ownsContent:true,privateInterview:true,modelProcessing:true}));
 assert.deepEqual(calls,['/sources/b/consents']);
});
test('publication requires explicit confirmation and the current account case mapping',async()=>{
 const calls=[];const request=async(...args)=>{calls.push(args);return args[0]==='/me/workbench'?{items:[{id:'case-a',source_id:'source-a'}]}:{id:'draft-a'};};
 const draft={id:'draft-a',caseId:'case-a',contentHash:'current-hash'};
 await assert.rejects(()=>publishOwnDraft(request,draft,false));assert.equal(calls.length,0);
 await publishOwnDraft(request,draft,true);
 assert.deepEqual(calls[2],['/drafts/draft-a/publish','POST',{content_hash:'current-hash',confirms_publication:true}]);
 await assert.rejects(()=>publishOwnDraft(async()=>({items:[]}),draft,true));
});
test('each notification targets its own version and withdrawn versions stay unavailable',()=>{
 assert.deepEqual(notificationTarget({followupVersionId:'version-b'}),{followup:'version-b'});
 assert.throws(()=>notificationTarget({followupVersionId:'version-b',status:'withdrawn'}));
 assert.throws(()=>notificationTarget({}));
});
