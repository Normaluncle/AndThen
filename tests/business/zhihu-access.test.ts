import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHarness, seedUser, auth, type Harness } from './helpers.js';
let h: Harness;
beforeAll(async()=>{h=await createHarness();});
afterAll(async()=>{await h.close();});
it('only administrators can use the configured credential account, with no client identity override', async()=>{
  const author=await seedUser(h,'author'),admin=await seedUser(h,'admin');
  for(const path of ['/contents','/content?url=https://www.zhihu.com/answer/1','/comments?url=https://www.zhihu.com/answer/1']){
    const url='/api/integrations/zhihu/creator'+path;
    expect((await h.app.inject({url})).statusCode).toBe(401);
    expect((await h.app.inject({url,headers:auth(author.token)})).statusCode).toBe(403);
    expect((await h.app.inject({url,headers:auth(admin.token)})).statusCode).toBe(503);
  }
  expect((await h.app.inject({url:'/api/integrations/zhihu/creator/contents?user_id='+author.user.id,headers:auth(admin.token)})).statusCode).toBe(400);
});
