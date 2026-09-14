import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {iconPaths} from './icon-paths.js';
test('all literal SVG icons used in restored pages have actual paths',()=>{const dir=new URL('./design/',import.meta.url);const names=readdirSync(dir).filter(x=>x.endsWith('.jsx'));let checked=0;for(const file of names){const text=readFileSync(new URL(file,dir),'utf8');for(const match of text.matchAll(/<Icon name="([^"]+)"/g)){assert.ok(iconPaths[match[1]],`${file}: missing ${match[1]}`);checked++;}}assert.ok(checked>25);});
test('authorization, pause and privacy have distinct icon shapes',()=>{for(const name of ['lock','shield','pause','users','memory','download','logout'])assert.match(iconPaths[name],/^M/);assert.notEqual(iconPaths.lock,iconPaths.author);assert.notEqual(iconPaths.link,iconPaths.search);assert.notEqual(iconPaths.pause,iconPaths.ai);});
