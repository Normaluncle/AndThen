import { expect, it, vi } from 'vitest';
import { authorizationUrl, callbackCode, exchangeCode, authorizedProfile, sealToken, openToken } from '../../src/modules/zhihu/oauth-client.js';

const app = { appId: 'fixture-app', appKey: 'fixture-secret', redirectUri: 'https://example.test/api/auth/zhihu/callback?fixed=1' };
const state = 'fixture_state_abcdefghijklmnopqrstuvwxyz';

it('builds an exact registered callback without putting the app key in a URL and rejects uncorrelated callbacks', () => {
  const url = new URL(authorizationUrl(app, state));
  expect(url.origin).toBe('https://openapi.zhihu.com');
  expect(url.searchParams.get('redirect_uri')).toBe(app.redirectUri);
  expect(url.searchParams.get('state')).toBe(state);
  expect(url.toString()).not.toContain(app.appKey);
  expect(callbackCode({ state, authorization_code: 'fixture-code' }, state)).toBe('fixture-code');
  expect(callbackCode({ state, code: 'fixture-code' }, state)).toBe('fixture-code');
  for (const query of [{ authorization_code: 'code' }, {state:'other',code:'code'}, {state,code:['a','b']}, {state,code:'a',authorization_code:'b'}, {state,code:'a',error:'denied'}]) expect(() => callbackCode(query,state)).toThrow();
  expect(() => authorizationUrl({...app,redirectUri:'http://example.test/callback'},state)).toThrow();
  expect(() => authorizationUrl({...app,redirectUri:'invalid-secret'},state)).not.toThrow('invalid-secret');
});

it('exchanges code server-side with form encoding and accepts documented 20000 success', async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({code:20000,access_token:'fixture-token',token_type:'Bearer',expires_in:3600})));
  expect((await exchangeCode(app,'a+b&c',transport)).access_token).toBe('fixture-token');
  const [url,init] = transport.mock.calls[0]!;
  expect(url).toBe('https://openapi.zhihu.com/access_token');
  const form = new URLSearchParams(String(init!.body));
  expect(form.get('code')).toBe('a+b&c');
  expect(form.get('redirect_uri')).toBe(app.redirectUri);
  expect(form.get('app_key')).toBe(app.appKey);
  expect(init!.redirect).toBe('error');
  expect(init!.headers).not.toHaveProperty('Authorization');
});

it('uses only OAuth bearer identity and preserves long IDs without importing sensitive profile fields', async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"code":20000,"uid":969570047710216200,"hash_id":"fixture-hash","fullname":"Fixture","email":"private@example.test","phone":"private"}'));
  expect(await authorizedProfile('fixture-user-token',transport)).toEqual({uid:'969570047710216200',hash_id:'fixture-hash',fullname:'Fixture'});
  expect(transport.mock.calls[0]![1]!.headers).toEqual({Authorization:'Bearer fixture-user-token'});
  expect(transport.mock.calls[0]![0]).toBe('https://openapi.zhihu.com/user');
  transport.mockResolvedValue(new Response('{"code":404,"data":"User does not exist"}'));
  await expect(authorizedProfile('fixture-user-token',transport)).rejects.toThrow('valid user identity');
});

it('accepts absent display fields but rejects invalid identity and unsafe avatar schemes', async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"uid":"123","fullname":null,"headline":"","avatar_path":null}'));
  expect(await authorizedProfile('fixture-user-token',transport)).toMatchObject({uid:'123'});
  for (const raw of ['{"uid":"0"}', '{"uid":-1}', '{"uid":"123","avatar_path":"javascript:alert(1)"}']) {
    transport.mockResolvedValue(new Response(raw));
    await expect(authorizedProfile('fixture-user-token',transport)).rejects.toThrow('valid user identity');
  }
});

it('bounds responses and does not propagate provider secrets or transport errors', async () => {
  for (const response of [new Response('provider-secret',{status:401}),new Response('x'.repeat(65537)),new Response('{"access_token":"provider-secret","expires_in":0}')]) {
    await expect(exchangeCode(app,'fixture-code',vi.fn<typeof fetch>().mockResolvedValue(response))).rejects.not.toThrow('provider-secret');
  }
  await expect(authorizedProfile('fixture-token',vi.fn<typeof fetch>().mockRejectedValue(new Error('fixture-token')))).rejects.not.toThrow('fixture-token');
});

it('encrypts tokens with random IVs and binds ciphertext to its account', () => {
  const key='ab'.repeat(32), token='fixture-access-token';
  const sealed=sealToken(token,key,'account-a');
  expect(sealed).not.toContain(token);
  expect(sealToken(token,key,'account-a')).not.toBe(sealed);
  expect(openToken(sealed,key,'account-a')).toBe(token);
  expect(()=>openToken(sealed,key,'account-b')).toThrow();
  expect(()=>openToken(sealed,'cd'.repeat(32),'account-a')).toThrow();
  expect(()=>openToken(sealed.replace('v1.','v2.'),key,'account-a')).toThrow();
  expect(()=>sealToken(token,'invalid','account-a')).toThrow();
});
