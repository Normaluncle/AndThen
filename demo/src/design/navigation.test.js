import test from 'node:test';
import assert from 'node:assert/strict';
import {personalTabs,developerScreens,routeFor,readRoute,routeUrl,mayOpenRoute,nextRoute,draftVersionRoute} from './navigation.js';
test('personal tabs have distinct URLs within one account shell',()=>{
  const routes=personalTabs.map(([tab])=>routeFor('09',{tab}));
  assert.equal(new Set(routes.map(routeUrl)).size,personalTabs.length);
  routes.forEach(route=>assert.deepEqual(readRoute(routeUrl(route).slice(2)),route));
  assert.deepEqual(readRoute('?screen=04'),routeFor('09',{tab:'notifications'}));
  assert.deepEqual(readRoute('?screen=03'),routeFor('09',{tab:'following'}));
});
test('every developer page is denied to visitors, readers, authors and researchers',()=>{
  for(const screen of developerScreens){
    for(const role of [undefined,'reader','author','researcher','developer']) assert.equal(mayOpenRoute(readRoute(`?screen=${screen}&role=admin`),role?{role}:null),false);
    assert.equal(mayOpenRoute(routeFor(screen),{role:'admin'}),true);
  }
  assert.equal(mayOpenRoute(routeFor('01'),null),true);
});
test('story identity survives reading and author workflow; explicit selections replace it',()=>{
  let route=routeFor('11',{story:'study'});
  for(const screen of ['06','07','08','02']){route=nextRoute(route,screen);assert.equal(route.story,'study');}
  assert.equal(nextRoute(route,'02',{story:'career'}).story,'career');
  assert.equal(nextRoute(route,'01').story,undefined);
  assert.deepEqual(readRoute(routeUrl(route).slice(2)),route);
});
test('invalid destinations and tabs have safe defaults',()=>{
  assert.equal(readRoute('?screen=99').screen,'01');
  assert.equal(readRoute('?screen=09&tab=admin').tab,'settings');
});
test('a page accepts only its own resource so mixed query IDs cannot render incompatible payloads',()=>{
  for(const [screen,key] of Object.entries({'02':'source','06':'interview','07':'draft','08':'followup','11':'case'})){
    const route=readRoute(`?screen=${screen}&source=s&interview=i&draft=d&followup=f&case=c&story=career`);
    assert.deepEqual(Object.keys(route),['screen',key]);
    assert.deepEqual(readRoute(routeUrl(route).slice(2)),route);
  }
  assert.deepEqual(readRoute('?screen=01&draft=private-id'),{screen:'01'});
  assert.deepEqual(nextRoute({screen:'02',story:'career'},'07',{draft:'new-id'}),{screen:'07',draft:'new-id'});
});
test('a candidate click becomes a story-detail URL instead of staying on the home overlay',()=>{
  const route=routeFor('02',{candidate:'cand-1'});
  assert.deepEqual(route,{screen:'02',candidate:'cand-1'});
  assert.deepEqual(readRoute(routeUrl(route).slice(2)),route);
  assert.equal(routeFor('02',{source:'s',candidate:'c'}).candidate,undefined);
});
test('a newly saved or AI-generated draft replaces the addressable version; unchanged versions stay put',()=>{
  const current=routeFor('07',{draft:'old-id'});
  const next=draftVersionRoute(current,{id:'new-id'});
  assert.deepEqual(readRoute(routeUrl(next).slice(2)),{screen:'07',draft:'new-id'});
  assert.equal(draftVersionRoute(current,{id:'old-id'}),null);
  assert.equal(draftVersionRoute(current,null),null);
  assert.equal(draftVersionRoute(routeFor('01'),{id:'new-id'}),null);
});
