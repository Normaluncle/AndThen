import {it,expect} from 'vitest';
import {attachInterviewQuestions} from '../../src/modules/followups/questions.js';
import {contentHash} from '../../src/ai/evidence.js';
import {parseZhihuShare} from '../../src/modules/zhihu/client.js';
import {PROMPTS} from '../../src/ai/prompts.js';
it('preserves each answer question and changes the confirmation hash; never guesses a missing question',()=>{
 const s={id:'answer',text:'差不多吧',kind:'author_report' as const,visibility:'public' as const,evidence_refs:['message:a']};
 const output=attachInterviewQuestions([s],[{id:'q',sequence:1,role:'ai',question:'这段经历怎样改变了你的生活？',authorMessage:null,visibility:'private'},{id:'a',sequence:2,role:'author',question:null,authorMessage:s.text,visibility:'public'}]);
 expect(output[0]?.question).toBe('这段经历怎样改变了你的生活？');expect(contentHash(output)).not.toBe(contentHash([s]));
 expect(attachInterviewQuestions([s],[])[0]?.question).toBeUndefined();
});
it('extracts a single canonical URL from share text and Markdown without network access',()=>{
 expect(parseZhihuShare('角色技能架构图 2010 - 游戏人孙韬的文章 - 知乎\n[https://zhuanlan.zhihu.com/p/22987569](https://zhuanlan.zhihu.com/p/22987569)')).toBe('https://zhuanlan.zhihu.com/p/22987569');
 expect(parseZhihuShare('回答 https://www.zhihu.com/question/123/answer/456?utm_source=x')).toBe('https://www.zhihu.com/answer/456');
 expect(()=>parseZhihuShare('https://zhuanlan.zhihu.com/p/1 https://zhuanlan.zhihu.com/p/2')).toThrow();
 expect(()=>parseZhihuShare('https://www.zhihu.com.evil.test/answer/1')).toThrow();
});
it('keeps the five-question narrative and reader-data boundaries in the interview contract',()=>{
 expect(PROMPTS.ai_b_interview).toContain('总共只有五个主问题');expect(PROMPTS.ai_b_interview).toContain('最后1问');expect(PROMPTS.ai_b_interview).toContain('一小篇');expect(PROMPTS.ai_b_interview).toContain('不是作者事实');
 expect(PROMPTS.ai_b_interview).toContain('第五问（remaining_questions=1）');
 expect(PROMPTS.ai_b_interview).toContain('若作者此前尚未表达给相似处境读者的建议或寄语');
 expect(PROMPTS.ai_b_interview).toContain('若已经表达过，就不重复索要建议');
});
