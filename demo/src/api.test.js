import {test} from 'node:test';
import assert from 'node:assert/strict';
import {api,setToken} from './api.js';

test('bodyless actions omit JSON content type; requests with bodies retain it', async()=>{
 const original=globalThis.fetch;
 const calls=[];
 globalThis.fetch=async(path,options)=>{calls.push({path,...options});return {ok:true,json:async()=>({data:{ok:true}})};};
 try {
  setToken('test-fixture-session');
  await api('/interviews/fixture/draft','POST');
  assert.equal(calls[0].headers['Content-Type'],undefined);
  assert.equal(calls[0].headers.Authorization,'Bearer test-fixture-session');
  assert.equal(calls[0].credentials,'same-origin');
  assert.equal(calls[0].headers['X-AndThen-Web'],'1');
  await api('/stories/fixture/interest','PUT',{active:true});
  assert.equal(calls[1].headers['Content-Type'],'application/json');
  assert.equal(calls[1].body,'{"active":true}');
 }finally{setToken('');globalThis.fetch=original;}
});
