import { issueWebCookie, setSessionCookie } from '../../http/session-cookie.js';
import { z } from 'zod';
import { eq, and,gt,isNull } from 'drizzle-orm';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { AppInstance, ModuleContext } from '../../shared/types.js';
import { requireAuthContext } from '../../http/auth.js';
import { AppError, success } from '../../http/errors.js';
import { envelopeSchema, errorEnvelopeSchema } from '../../http/envelope.js';
import { zhihuAccounts,zhihuOAuthAttempts,users, authorVerifications, consents,authorMemories } from '../../db/schema.js';
import {createSession} from '../identity/service.js';
import type { Database } from '../../db/client.js';
import { invalidateAuthorMemory } from '../memory/service.js';
import { queueOAuthSync } from './oauth-sync.js';
import { authorizationUrl, callbackCode, exchangeCode, authorizedProfile } from './oauth-client.js';
import { activeOAuthSession,clearExpiredOAuthAttempts, createOAuthAttempt, consumeOAuthAttempt } from './oauth-attempts.js';
import { bindOAuthAccount, disconnectOAuthAccount } from './oauth-accounts.js';

export function oauthReady(ctx: ModuleContext) {
  const e = ctx.env;
  return !!(e.ZHIHU_APP_ID && e.ZHIHU_APP_KEY && e.ZHIHU_TOKEN_ENCRYPTION_KEY && e.ZHIHU_OAUTH_STATE_VERIFIED && e.ZHIHU_REDIRECT_URI?.startsWith('https://'));
}
const cookieName = '__Secure-andthen_zhihu';
const cookieAttributes = '; Path=/api/auth/zhihu; HttpOnly; Secure; SameSite=Lax';
export async function registerOAuthRoutes(app: AppInstance, ctx: ModuleContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const response = {200:envelopeSchema(z.record(z.unknown())),400:errorEnvelopeSchema,401:errorEnvelopeSchema,403:errorEnvelopeSchema,409:errorEnvelopeSchema,503:errorEnvelopeSchema};
  function configured() {
    if (!oauthReady(ctx)) throw AppError.serviceUnavailable('Zhihu OAuth awaits application credentials and verified state callback');
    return {appId:ctx.env.ZHIHU_APP_ID!,appKey:ctx.env.ZHIHU_APP_KEY!,redirectUri:ctx.env.ZHIHU_REDIRECT_URI!};
  }
  r.post('/auth/zhihu/start',{preHandler:[app.authenticate],schema:{tags:['zhihu'],body:z.object({}).strict(),response}},async (request,reply)=>{
    const application = configured();
    await clearExpiredOAuthAttempts(ctx.db,ctx.now());
    const attempt = await createOAuthAttempt(ctx.db,requireAuthContext(request).sessionId,ctx.now());
    reply.header('Cache-Control','no-store').header('Set-Cookie',`${cookieName}=${attempt.browserProof}; Max-Age=600${cookieAttributes}`);
    return success(request.id,{attempt_id:attempt.attemptId,authorization_url:authorizationUrl(application,attempt.state),expires_at:attempt.expiresAt.toISOString()});
  });
  r.get('/auth/zhihu/callback',{schema:{tags:['zhihu'],querystring:z.object({state:z.string().max(128).optional(),authorization_code:z.string().max(4096).optional(),code:z.string().max(4096).optional(),error:z.string().max(256).optional()}).strict(),response}},async (request,reply)=>{
    reply.header('Cache-Control','no-store').header('Referrer-Policy','no-referrer').header('Set-Cookie',`${cookieName}=; Max-Age=0${cookieAttributes}`);
    const browser = request.headers.accept?.includes('text/html');
    try {
    const application = configured();
    const state = request.query.state ?? '';
    const code = callbackCode(request.query,state);
    const proofs = (request.headers.cookie ?? '').split(';').map(x=>x.trim()).filter(x=>x.startsWith(cookieName+'='));
    if(proofs.length!==1)throw AppError.forbidden('OAuth browser correlation is missing');
    const attempt=await consumeOAuthAttempt(ctx.db,state,proofs[0]!.slice(cookieName.length+1),ctx.now());
    const token=await exchangeCode(application,code);
    const identity=await authorizedProfile(token.access_token);
    const binding=await bindOAuthAccount(ctx.db,attempt.attemptId,identity,token,ctx.env.ZHIHU_TOKEN_ENCRYPTION_KEY!,ctx.now(),true);
    if (browser) {
      const session = await ctx.db.transaction(async tx => {
        const [a] = await tx.select().from(zhihuOAuthAttempts).where(eq(zhihuOAuthAttempts.id,attempt.attemptId)).for('update');
        if (!a?.completedUserId || a.deliveredAt) throw AppError.conflict('OAuth result already delivered');
        const [u] = await tx.select().from(users).where(eq(users.id,a.completedUserId));
        if (!u || u.disabledAt) throw AppError.unauthorized();
        const issued = await createSession(tx,{userId:u.id,cohort:u.cohort,ttlSeconds:ctx.env.SESSION_TTL_SECONDS,now:ctx.now()});
        await tx.update(zhihuOAuthAttempts).set({deliveredAt:ctx.now()}).where(eq(zhihuOAuthAttempts.id,a.id));
        return issued;
      });
      setSessionCookie(reply,ctx.env,session.token);
      return reply.redirect('/?oauth=success#account',303);
    }
    return success(request.id,{...binding,message:'授权已绑定。请关闭此页，回到原页面刷新账号状态。资料处理同意仍需另行选择。'});
    } catch (error) {
      if (!browser) throw error;
      ctx.logger.warn({requestId:request.id},'Browser OAuth did not complete');
      return reply.redirect('/?oauth=failed#account',303);
    }
  });
  r.post('/auth/zhihu/finish',{preHandler:[app.authenticate],schema:{tags:['zhihu'],body:z.object({attempt_id:z.string().uuid()}).strict(),response}},async (request,reply)=>{
    const auth=requireAuthContext(request);
    const data=await ctx.db.transaction(async tx=>{
      await activeOAuthSession(tx,auth.sessionId,ctx.now());
      const [attempt]=await tx.select().from(zhihuOAuthAttempts).where(and(eq(zhihuOAuthAttempts.id,request.body.attempt_id),eq(zhihuOAuthAttempts.sessionId,auth.sessionId),gt(zhihuOAuthAttempts.expiresAt,ctx.now()),isNull(zhihuOAuthAttempts.deliveredAt))).for('update');
      if(!attempt)throw AppError.conflict('OAuth result expired or already delivered');
      if(!attempt.completedUserId)return {ready:false};
      const [user]=await tx.select().from(users).where(eq(users.id,attempt.completedUserId));
      if(!user||user.disabledAt)throw AppError.unauthorized();
      const session=await createSession(tx,{userId:user.id,cohort:user.cohort,ttlSeconds:ctx.env.SESSION_TTL_SECONDS,now:ctx.now()});
      await tx.update(zhihuOAuthAttempts).set({deliveredAt:ctx.now()}).where(eq(zhihuOAuthAttempts.id,attempt.id));
      return {ready:true,session_token:session.token,user:{id:user.id,role:user.role,cohort:user.cohort,display_name:user.displayName,email:user.email,avatar_url:user.avatarUrl}};
    });
    if (data.ready && data.session_token) issueWebCookie(request,reply,ctx.env,data.session_token);
    reply.header('Cache-Control','no-store');return success(request.id,data);
  });
  r.get('/me/zhihu',{preHandler:[app.authenticate],schema:{tags:['zhihu'],response}},async request=>{
    const [row]=await ctx.db.select().from(zhihuAccounts).where(eq(zhihuAccounts.userId,requireAuthContext(request).userId));
    if(row?.syncConsentAt&&!row.revokedAt&&row.expiresAt>ctx.now())await queueOAuthSync(ctx,row.userId);
    return success(request.id,{available:oauthReady(ctx),bound:!!row,uid:row?.uid??null,display_name:row?.displayName??null,processing_consent:!!row?.syncConsentAt,last_sync_at:row?.lastSyncAt?.toISOString()??null,
      authorized:!!row?.tokenCiphertext&&!row.revokedAt&&row.expiresAt>ctx.now(),expires_at:row?.expiresAt.toISOString()??null});
  });
  r.delete('/me/zhihu',{preHandler:[app.authenticate],schema:{tags:['zhihu'],response}},async request=>{
    const auth=requireAuthContext(request);
    await ctx.db.transaction(async tx=>{
      await disconnectOAuthAccount(tx as unknown as Database,auth.sessionId,ctx.now());
      await tx.update(zhihuAccounts).set({syncConsentAt:null}).where(eq(zhihuAccounts.userId,auth.userId));
      await tx.update(authorVerifications).set({status:'rejected'}).where(and(eq(authorVerifications.userId,auth.userId),eq(authorVerifications.method,'oauth')));
      await tx.update(consents).set({status:'revoked',revokedAt:ctx.now()}).where(and(eq(consents.userId,auth.userId),eq(consents.version,'oauth-materials-v1')));
      await invalidateAuthorMemory(ctx,tx,auth.userId);
    });
    return success(request.id,{disconnected:true});
  });
  r.post('/me/zhihu/sync',{preHandler:[app.authenticate],schema:{tags:['zhihu'],body:z.object({accept_material_processing:z.literal(true)}).strict(),response}},async request=>{
    const auth=requireAuthContext(request);
    const data=await ctx.db.transaction(async tx=>{
      const [account]=await tx.select().from(zhihuAccounts).where(eq(zhihuAccounts.userId,auth.userId)).for('update');
      if(!account?.tokenCiphertext||account.revokedAt||account.expiresAt<=ctx.now())throw AppError.unauthorized('Active Zhihu authorization required');
      await tx.update(zhihuAccounts).set({syncConsentAt:account.syncConsentAt??ctx.now()}).where(eq(zhihuAccounts.userId,auth.userId));
      await tx.insert(authorMemories).values({userId:auth.userId,enabled:true,status:'pending'}).onConflictDoNothing();
      await tx.update(authorMemories).set({enabled:true}).where(eq(authorMemories.userId,auth.userId));
      return queueOAuthSync({...ctx,db:tx as unknown as Database},auth.userId,true);
    });
    return success(request.id,data);
  });
}
