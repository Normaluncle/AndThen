import {afterAll,beforeAll,afterEach,it,expect,vi} from 'vitest';
import {createHarness,type Harness} from './helpers.js';
let h:Harness;
const origin='https://example.test';
const web={'x-andthen-web':'1',origin};
beforeAll(async()=>{h=await createHarness();Object.assign(h.ctx.env,{PUBLIC_BASE_URL:origin,NODE_ENV:'production',ZHIHU_APP_ID:'fixture',ZHIHU_APP_KEY:'fixture',ZHIHU_REDIRECT_URI:origin+'/api/auth/zhihu/callback',ZHIHU_TOKEN_ENCRYPTION_KEY:'ab'.repeat(32),ZHIHU_OAUTH_STATE_VERIFIED:true});});
afterAll(async()=>h.close());afterEach(()=>vi.unstubAllGlobals());
function cookies(r:any){return ([] as string[]).concat(r.headers['set-cookie']||[]).map(x=>x.split(';')[0]).join('; ');}
async function reader(){return h.app.inject({method:'POST',url:'/api/auth/readers',headers:web,payload:{consent:{accepted:true,version:'v1'}}});}
it('persists browser sessions, rejects CSRF and expires the cookie on logout',async()=>{
 const r=await reader();expect(r.statusCode).toBe(200);
 expect(String(r.headers['set-cookie'])).toContain('__Host-andthen_session=');expect(String(r.headers['set-cookie'])).toContain('HttpOnly; Secure; SameSite=Lax');
 const cookie=cookies(r);
 for(let i=0;i<2;i++)expect((await h.app.inject({url:'/api/me',headers:{cookie}})).json().data.user.id).toBe(r.json().data.user.id);
 for(const headers of [{cookie},{cookie,...web,origin:'https://evil.test'}])expect((await h.app.inject({method:'POST',url:'/api/auth/logout',headers})).statusCode).toBe(403);
 const logout=await h.app.inject({method:'POST',url:'/api/auth/logout',headers:{cookie,...web}});expect(logout.statusCode).toBe(200);expect(String(logout.headers['set-cookie'])).toContain('Max-Age=0');
 expect((await h.app.inject({url:'/api/me',headers:{cookie}})).statusCode).toBe(401);
 expect((await h.app.inject({method:'POST',url:'/api/auth/readers',headers:{...web,origin:'https://evil.test'},payload:{consent:{accepted:true,version:'v1'}}})).statusCode).toBe(403);
});
it('completes browser OAuth directly into an existing account and redirects without secrets',async()=>{
 const transport=vi.fn<typeof fetch>();vi.stubGlobal('fetch',transport);
 let identity:string|undefined;
 for(let i=0;i<2;i++){
  const r=await reader();const initial=cookies(r);
  const started=await h.app.inject({method:'POST',url:'/api/auth/zhihu/start',headers:{cookie:initial,...web},payload:{}});
  expect(started.statusCode).toBe(200);
  const state=new URL(started.json().data.authorization_url).searchParams.get('state');
  transport.mockResolvedValueOnce(new Response(JSON.stringify({access_token:'fixture-secret',expires_in:3600,token_type:'Bearer'}))).mockResolvedValueOnce(new Response('{"uid":"881188","fullname":"虚构测试作者"}'));
  const url='/api/auth/zhihu/callback?code=fixture-code&state='+state;
  const callback=await h.app.inject({url,headers:{cookie:initial+'; '+cookies(started),accept:'text/html'}});
  expect(callback.statusCode).toBe(303);expect(callback.headers.location).toBe('/?oauth=success#account');expect(callback.body).not.toContain('fixture-secret');
  const restored=await h.app.inject({url:'/api/me',headers:{cookie:cookies(callback)}});expect(restored.statusCode).toBe(200);
  identity??=restored.json().data.user.id;expect(restored.json().data.user.id).toBe(identity);
  expect((await h.app.inject({url:'/api/me/zhihu',headers:{cookie:cookies(callback)}})).json().data.authorized).toBe(true);
  const replay=await h.app.inject({url,headers:{cookie:initial+'; '+cookies(started),accept:'text/html'}});expect(replay.headers.location).toBe('/?oauth=failed#account');
 }
});
it('returns browser callback failures to the account page without logging or exposing provider values',async()=>{
 const r=await h.app.inject({url:'/api/auth/zhihu/callback?error=access_denied',headers:{accept:'text/html'}});
 expect(r.statusCode).toBe(303);expect(r.headers.location).toBe('/?oauth=failed#account');
});
it('surfaces the verified avatar and name on the account so the header is not a placeholder',async()=>{
 const transport=vi.fn<typeof fetch>();vi.stubGlobal('fetch',transport);
 const r=await reader();const initial=cookies(r);
 // A reader who has not authorized has the fields but no values.
 expect(r.json().data.user.avatar_url).toBeNull();
 expect(r.json().data.user.display_name).toBeNull();
 const started=await h.app.inject({method:'POST',url:'/api/auth/zhihu/start',headers:{cookie:initial,...web},payload:{}});
 const state=new URL(started.json().data.authorization_url).searchParams.get('state');
 transport.mockResolvedValueOnce(new Response(JSON.stringify({access_token:'fixture-secret',expires_in:3600,token_type:'Bearer'})))
  .mockResolvedValueOnce(new Response('{"uid":"770077","fullname":"虚构头像作者","avatar_path":"https://pic.example.test/avatar/770077.jpg"}'));
 const callback=await h.app.inject({url:'/api/auth/zhihu/callback?code=fixture-code&state='+state,headers:{cookie:initial+'; '+cookies(started),accept:'text/html'}});
 expect(callback.statusCode).toBe(303);
 const me=await h.app.inject({url:'/api/me',headers:{cookie:cookies(callback)}});
 expect(me.json().data.user.avatar_url).toBe('https://pic.example.test/avatar/770077.jpg');
 expect(me.json().data.user.display_name).toBe('虚构头像作者');
});
