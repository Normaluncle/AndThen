import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatParagraphs,articleLength} from './article-format.js';
test('automatic paragraph layout preserves every original character and existing structure',()=>{
 const raw='这是作者本人提供的一段完整经历，没有添加任何新事实。'.repeat(12);
 const formatted=formatParagraphs(raw);assert.ok(formatted.includes('\n\n'));assert.equal(formatted.replaceAll('\n',''),raw);
 assert.equal(formatParagraphs('## 当时\n- 第一件事\n\n后来如此'),'## 当时\n- 第一件事\n\n后来如此');
 assert.equal(articleLength([{text:'后来好了',question:'很长的问题',visibility:'public'},{text:'私有内容',visibility:'private'}]),4);
});
