import {test} from 'node:test';
import assert from 'node:assert/strict';
import {draftActions, interviewActions, poll, readAiTask} from './workflow.js';

test('unsaved edits cannot confirm or publish an earlier server version', () => {
  const saved = [{id:'1',text:'原文'}];
  const original = JSON.stringify(saved);
  assert.equal(draftActions({status:'draft',statements:saved},original).confirm,true);
  for (const status of ['draft','confirmed']) {
    const actions = draftActions({status,statements:[{id:'1',text:'作者新修改'}]},original);
    assert.equal(actions.dirty,true);
    assert.equal(actions.save,true);
    assert.equal(actions.confirm,false);
    assert.equal(actions.publish,false);
  }
  assert.equal(draftActions({status:'confirmed',statements:saved},original).publish,true);
  assert.equal(draftActions({status:'published',statements:saved},original).withdraw,true);
  assert.equal(draftActions({status:'withdrawn',statements:saved},original).publish,false);
});

test('interview waits for a question and disables answers after pause or finish', () => {
  assert.equal(interviewActions({status:'active',mode:'ai'},[]).waiting,true);
  assert.equal(interviewActions({status:'active',mode:'ai'},[{role:'ai'}]).answer,true);
  assert.equal(interviewActions({status:'active',mode:'ai'},[{role:'author'}]).answer,false);
  assert.equal(interviewActions({status:'paused'},[{role:'ai'}]).answer,false);
  assert.equal(interviewActions({status:'paused'},[]).resume,true);
  assert.equal(interviewActions({status:'finished'},[]).finish,false);
  assert.equal(interviewActions({status:'active',mode:'manual'},[]).answer,true);
});

test('polling ignores results arriving after navigation and stops after failure', async () => {
  let resolve, calls=0, delivered=0;
  const stop=poll(()=>{calls++;return new Promise(r=>{resolve=r;});},()=>delivered++,()=>assert.fail(),1);
  await new Promise(r=>setTimeout(r,10));
  assert.equal(calls,1);
  stop(); resolve({});
  await new Promise(r=>setTimeout(r,10));
  assert.equal(delivered,0);
  let errors=0;
  const stopFailure=poll(async()=>{throw new Error('offline');},()=>assert.fail(),()=>errors++,1);
  await new Promise(r=>setTimeout(r,20));
  stopFailure();
  assert.equal(errors,1);
});

test('completed queue tasks with failed or missing AI output never replace the draft',async()=>{
  for(const job of [
    {status:'succeeded',result:{error_code:'invalid_output',draft_id:'unsafe'}},
    {status:'succeeded',result:{draft_id:null}},
    {status:'failed'}, {status:'cancelled'},
  ]) {
    let requests=0;
    const result=await readAiTask(async path=>{requests++;assert.equal(path,'/jobs/test');return job;},'test','draft');
    assert.equal(result.status,'failed');assert.equal(result.draft,undefined);assert.equal(requests,1);
  }
});

test('AI task reads fetch only a successful generated draft and keep validation distinct',async()=>{
  const calls=[];
  const draft={id:'new',version:3,status:'draft'};
  const result=await readAiTask(async path=>{calls.push(path);return path==='/jobs/test'?{status:'succeeded',result:{draft_id:'new'}}:draft;},'test','draft');
  assert.deepEqual(calls,['/jobs/test','/drafts/new']);assert.deepEqual(result.draft,draft);
  const validation={blocking:true,findings:[{severity:'blocking',message:'需补依据'}]};
  assert.deepEqual(await readAiTask(async()=>({status:'succeeded',result:{validation}}),'test','validation'),{status:'succeeded',validation});
  assert.deepEqual(await readAiTask(async()=>({status:'running'}),'test','draft'),{status:'running'});
});
