import { describe, it, expect } from 'vitest';
import { ownContent, ownContents, ownComments, nextPage } from '../../src/modules/zhihu/creator.js';
import { officialSearch } from '../../src/modules/zhihu/client.js';

const url = 'https://www.zhihu.com/answer/2079528466408654123';
describe('official creator capabilities', () => {
  it('preserves numeric big IDs and upstream pagination without assuming a short page ends', async () => {
    const calls: {url: string; headers: NonNullable<Parameters<typeof fetch>[1]>['headers']}[] = [];
    const transport: typeof fetch = async (input, options) => {
      calls.push({ url: String(input), headers: options?.headers });
      return new Response('{"Code":0,"Data":{"Items":[{"Comment":{"ID":2079528466408654123,"Type":"comment","Content":"fixture","CreatedAt":10,"LikeCount":2,"DislikeCount":0,"AuthorToken":"author-token"},"Children":[]}],"Paging":{"IsEnd":false,"NextOffset":"2079528466408654124"}}}');
    };
    const result = await ownComments('fixture-key', url, '0', transport);
    expect(result.items[0]).toMatchObject({ id:'2079528466408654123', author_url:'https://www.zhihu.com/people/author-token' });
    expect(result.paging).toEqual({ is_end:false, next_offset:'2079528466408654124', stopped_reason:null });
    expect(new URL(calls[0]!.url).searchParams.get('Order')).toBe('ascending');
    expect(calls[0]!.headers).not.toHaveProperty('X-OAuth-Token');
  });
  it('does not invent a cursor or complete child-comment coverage', async () => {
    const result = await ownComments('fixture', url, '20', async()=>new Response(JSON.stringify({Code:0,Data:{Items:[],Paging:{IsEnd:false,NextOffset:'20'}}})));
    expect(result.paging).toEqual({is_end:false,next_offset:null,stopped_reason:'invalid_upstream_cursor'});
    expect(result.coverage).toBe('paged_roots_with_partial_children');
    expect(nextPage({IsEnd:false},'0').next_offset).toBeNull();
    expect(nextPage({IsEnd:true},'0').is_end).toBe(true);
  });
  it('returns HTML as untrusted text and rejects mismatched content URLs', async () => {
    const data = {ContentType:'answer',ContentToken:'2079528466408654123',Url:url,Title:'fixture',Body:'<script>bad()</script>'};
    const result = await ownContent('fixture',url,async()=>new Response(JSON.stringify({Code:0,Data:data})));
    expect(result.body_format).toBe('untrusted_html');
    await expect(ownContent('fixture',url,async()=>new Response(JSON.stringify({Code:0,Data:{...data,Url:'https://www.zhihu.com/answer/9'}})))).rejects.toMatchObject({code:'service_unavailable'});
  });
  it('switches identity only on the explicitly OAuth-capable summary list', async () => {
    let headers: NonNullable<Parameters<typeof fetch>[1]>['headers'];
    const result = await ownContents('fixture','0',async(_input,options)=>{headers=options?.headers;return new Response(JSON.stringify({Code:0,Data:{Items:[],Paging:{IsEnd:true}}}));},'fixture-oauth');
    expect(headers).toHaveProperty('X-OAuth-Token','fixture-oauth');
    expect(result.identity_scope).toBe('oauth_user');
  });
  it.each([10001,20001,30001,30002,30003,90001])('stops on business error %s without exposing provider message or retrying', async Code => {
    let calls=0;
    const request = ownContent('fixture-secret',url,async()=>{calls++;return new Response(JSON.stringify({Code,Message:'secret fixture-secret'}));});
    await expect(request).rejects.not.toThrow('fixture-secret');
    expect(calls).toBe(1);
  });
  it('bounds response size and sanitizes malformed/transport failures for search too', async () => {
    await expect(officialSearch('fixture-secret','test',async()=>new Response('x'.repeat(1_000_001)))).rejects.toMatchObject({code:'service_unavailable'});
    await expect(officialSearch('fixture-secret','test',async()=>{throw Error('fixture-secret');})).rejects.not.toThrow('fixture-secret');
  });
});

