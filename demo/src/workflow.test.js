import {test} from 'node:test';
import assert from 'node:assert/strict';
import {draftActions, interviewActions, poll} from './workflow.js';

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
