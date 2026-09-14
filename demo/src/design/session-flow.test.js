import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {continueAsRealReader,continueAsGuest,READER_CONSENT_VERSION,sessionTabs,judgeEntry,DEVELOPER_TAB_COPY} from './session-flow.js';

const reader={session_token:'session-token',user:{id:'user-a',display_name:null,avatar_url:null}};

test('continuing as a real reader always ends at the Zhihu authorization page',async()=>{
 const calls=[],assigned=[];const accepted=[];
 const request=async(...args)=>{calls.push(args);return args[0]==='/auth/readers'?reader:{authorization_url:'https://openapi.zhihu.com/authorize?state=server-state'};};
 await continueAsRealReader(request,{onReader:value=>accepted.push(value),assign:url=>assigned.push(url)});
 assert.deepEqual(calls.map(([path,method])=>[path,method]),[['/auth/readers','POST'],['/auth/zhihu/start','POST']]);
 assert.deepEqual(calls[0][2],{consent:{accepted:true,version:READER_CONSENT_VERSION}});
 assert.deepEqual(calls[1][2],{});
 assert.deepEqual(assigned,['https://openapi.zhihu.com/authorize?state=server-state']);
 assert.deepEqual(accepted,[reader]);
});

test('a refused authorization is an error, never a silent guest session',async()=>{
 const assigned=[];
 const request=async path=>{if(path==='/auth/readers')return reader;throw new Error('Zhihu OAuth awaits application credentials · service_unavailable');};
 await assert.rejects(()=>continueAsRealReader(request,{onReader:()=>{},assign:url=>assigned.push(url)}),/service_unavailable/);
 assert.deepEqual(assigned,[]);
 const missing=async path=>path==='/auth/readers'?reader:{};
 await assert.rejects(()=>continueAsRealReader(missing,{onReader:()=>{},assign:url=>assigned.push(url)}));
 assert.deepEqual(assigned,[]);
});

test('the reader session is applied before the redirect so a blocked navigation still signs the reader in',async()=>{
 const order=[];
 const request=async path=>{order.push(path);return path==='/auth/readers'?reader:{authorization_url:'https://openapi.zhihu.com/authorize'};};
 await continueAsRealReader(request,{onReader:()=>order.push('accepted'),assign:()=>order.push('redirect')});
 assert.deepEqual(order,['/auth/readers','accepted','/auth/zhihu/start','redirect']);
});

test('the explicit guest option never touches the authorization endpoint',async()=>{
 const calls=[];const request=async(...args)=>{calls.push(args);return reader;};
 await continueAsGuest(request,{onReader:()=>{}});
 assert.deepEqual(calls.map(([path])=>path),['/auth/readers']);
});

test('the developer tab copy never points at a tab that is not rendered',()=>{
 assert.deepEqual(sessionTabs(true),['真实使用','体验演示']);
 assert.deepEqual(sessionTabs(false),['真实使用','开发者']);
 // Demo accounts are off in production, and that is the only case where the
 // developer tab exists — so its copy must not send people to 「体验演示」.
 assert.equal(sessionTabs(false).includes('体验演示'),false);
 assert.equal(DEVELOPER_TAB_COPY.includes('体验演示'),false);
 assert.ok(sessionTabs(false).some(tab=>DEVELOPER_TAB_COPY.includes(tab)));
});

test('the demo accounts are offered on the judge link only',()=>{
 // Reviewers add the suffix; an ordinary visitor never sees the tab, which is what keeps a
 // deployment with demo logins switched on from showing them to the public.
 assert.equal(judgeEntry('?judge=1'),true);
 assert.equal(judgeEntry('judge=1'),true);
 assert.equal(judgeEntry('?screen=01&judge=true'),true);
 assert.equal(judgeEntry('?judge'),true);
 assert.equal(judgeEntry('?judge=0'),false);
 assert.equal(judgeEntry('?judge=false'),false);
 assert.equal(judgeEntry('?screen=02&candidate=x'),false);
 assert.equal(judgeEntry(''),false);
});

test('the panel requires both the server flag and the judge link',()=>{
 const panel=readFileSync(new URL('./SessionPanel.jsx',import.meta.url),'utf8');
 assert.match(panel,/data\.enabled&&judgeEntry\(location\.search\)/);
});
