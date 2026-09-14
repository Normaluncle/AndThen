import {test} from 'node:test';
import assert from 'node:assert/strict';
import {frontendEntry} from './frontend-entry.js';
test('ordinary, account and OAuth URLs keep the current interface; only explicit legacy URLs opt out',()=>{
 for(const url of ['', '?screen=01','?screen=09&tab=settings','?oauth=success','?oauth=error','?mode=unknown'])assert.equal(frontendEntry(url),'current');
 assert.equal(frontendEntry('?mode=live'),'legacy');
});
