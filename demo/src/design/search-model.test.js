import test from 'node:test';
import assert from 'node:assert/strict';
import {searchOptions,internalSearchUrl,selectCover,coverCaption,storySharePath} from './search-model.js';
import {readRoute,routeUrl,nextRoute} from './navigation.js';
test('topic search creates addressable discovery results and preserves filters through refresh',()=>{
 const route=nextRoute({screen:'02',story:'career'},'01',{q:' 职业选择 ',from:'2020-01-01',to:'2024-12-31',sort:'newest',page:'2'});
 assert.equal(route.q,'职业选择');assert.equal(route.story,undefined);
 assert.deepEqual(readRoute(routeUrl(route).slice(2)),route);
 const url=new URL(internalSearchUrl(route),'http://local');assert.equal(url.searchParams.get('offset'),'10');assert.equal(url.searchParams.get('limit'),'10');assert.equal(url.searchParams.get('from'),'2020-01-01');
 assert.deepEqual(searchOptions({q:' ',from:'invalid',sort:'evil',page:-1}),{});
});
test('clean cover selection is stable and respects tags with an explicit missing-image result',()=>{
 const pool=[{src:'career1',tags:['职场']},{src:'career2',tags:['职场']},{src:'study',tags:['学习']}],item={id:'abc',category:'职场'};
 assert.ok(['career1','career2'].includes(selectCover(item,pool).src));assert.deepEqual(selectCover(item,pool),selectCover(item,pool));assert.equal(selectCover(item,[]),null);assert.equal(selectCover({category:'未知'},pool),null);
});

test('cover captions use source publication metadata and keep date separate from wording',()=>{assert.deepEqual(coverCaption({date:'2021-06-12',cover_caption:'2021.06 我选择了出发'}),['2021年6月','我选择了出发']);assert.deepEqual(coverCaption({published_at:'2025-09-01T00:00:00Z'}),['2025年9月','原回答']);assert.deepEqual(coverCaption({cover_caption:'原回答'}),['','原回答']);assert.deepEqual(coverCaption({}),['','原回答']);});

test('share keeps the exact public later version instead of sending readers to the original answer',()=>{assert.equal(storySharePath({followupId:'version-id',sourceId:'source-id'}),'/?screen=08&followup=version-id');assert.equal(storySharePath({sourceId:'source-id'}),'/?screen=02&source=source-id');assert.equal(storySharePath({fixtureId:'study',screen:'08'}),'/?screen=08&story=study');});

test('candidate detail survives refresh and does not resolve to a source route',()=>{const route=nextRoute({screen:'01'},'02',{candidate:'candidate-id'});assert.equal(route.candidate,'candidate-id');assert.deepEqual(readRoute(routeUrl(route).slice(2)),route);});
