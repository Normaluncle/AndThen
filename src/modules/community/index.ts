import {and,desc,eq,sql} from 'drizzle-orm';
import {z} from 'zod';
import type {ZodTypeProvider} from 'fastify-type-provider-zod';
import type {ModuleDefinition} from '../../shared/types.js';
import {storyReads,siteFeedback,siteComments,siteReports,storyReactions,sources,users} from '../../db/schema.js';
import {requireAuthContext} from '../../http/auth.js';
import {envelopeSchema,errorEnvelopeSchema} from '../../http/envelope.js';
import {success,AppError} from '../../http/errors.js';
import {requirePublicStory} from '../sources/service.js';

export const communityModule:ModuleDefinition={name:'community',async registerRoutes(app,ctx){
 const r=app.withTypeProvider<ZodTypeProvider>();
 const failures={400:errorEnvelopeSchema,401:errorEnvelopeSchema,403:errorEnvelopeSchema,404:errorEnvelopeSchema,409:errorEnvelopeSchema};
 const params=z.object({id:z.string().uuid()});
 const paging=z.object({offset:z.coerce.number().int().min(0).default(0)});
 const comment=z.object({id:z.string(),body:z.string(),author:z.string(),created_at:z.string(),mine:z.boolean(),reply_to:z.string().nullable(),reply_author:z.string().nullable(),reply_body:z.string().nullable()});
 const response=envelopeSchema(z.object({likes:z.number(),saves:z.number(),comments:z.number(),liked:z.boolean(),saved:z.boolean(),items:z.array(comment),offset:z.number(),limit:z.literal(10)}));
 async function summary(id:string,offset:number,userId?:string){
  await requirePublicStory(ctx.db,id);
  const [counts]=await ctx.db.select({likes:sql<number>`count(*) filter (where liked)::int`,saves:sql<number>`count(*) filter (where saved)::int`}).from(storyReactions).where(eq(storyReactions.sourceId,id));
  const [total]=await ctx.db.select({count:sql<number>`count(*)::int`}).from(siteComments).where(eq(siteComments.sourceId,id));
  const mine=userId?(await ctx.db.select().from(storyReactions).where(and(eq(storyReactions.sourceId,id),eq(storyReactions.userId,userId))))[0]:undefined;
  const rows=await ctx.db.select({id:siteComments.id,replyTo:siteComments.replyTo,body:siteComments.body,name:users.displayName,userId:siteComments.userId,createdAt:siteComments.createdAt}).from(siteComments).innerJoin(users,eq(users.id,siteComments.userId)).where(eq(siteComments.sourceId,id)).orderBy(desc(siteComments.createdAt),desc(siteComments.id)).limit(10).offset(offset);
  const replies=new Map<string,{name:string|null;body:string}>();
  for(const row of rows){if(row.replyTo){const [parent]=await ctx.db.select({name:users.displayName,body:siteComments.body}).from(siteComments).innerJoin(users,eq(users.id,siteComments.userId)).where(and(eq(siteComments.id,row.replyTo),eq(siteComments.sourceId,id)));if(parent)replies.set(row.replyTo,parent);}}
  return {likes:counts?.likes??0,saves:counts?.saves??0,comments:total?.count??0,liked:mine?.liked??false,saved:mine?.saved??false,items:rows.map(row=>({id:row.id,body:row.body,reply_to:row.replyTo,reply_author:row.replyTo?replies.get(row.replyTo)?.name||null:null,reply_body:row.replyTo?replies.get(row.replyTo)?.body||null:null,author:row.name||'本站读者',created_at:row.createdAt.toISOString(),mine:row.userId===userId})),offset,limit:10 as const};
 }
 for(const personal of [false,true])r.get(`${personal?'/me':''}/stories/:id/community`,{...(personal?{preHandler:[app.authenticate]}:{}),schema:{tags:['community'],params,querystring:paging,response:{...failures,200:response}}},async req=>success(req.id,await summary(req.params.id,req.query.offset,personal?requireAuthContext(req).userId:undefined)));
 r.put('/stories/:id/community',{preHandler:[app.authenticate],schema:{tags:['community'],params,body:z.object({liked:z.boolean().optional(),saved:z.boolean().optional()}).strict().refine(v=>v.liked!==undefined||v.saved!==undefined),response:{...failures,200:response}}},async req=>{
  const auth=requireAuthContext(req);
  await ctx.db.transaction(async tx=>{
   await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`reader-delete:${auth.userId}`},0))`);
   await tx.select({id:sources.id}).from(sources).where(eq(sources.id,req.params.id)).for('update');
   const [actor]=await tx.select().from(users).where(eq(users.id,auth.userId)).for('share');
   if(!actor||actor.disabledAt)throw AppError.unauthorized('Account unavailable');
   await requirePublicStory(tx,req.params.id);
   await tx.insert(storyReactions).values({sourceId:req.params.id,userId:auth.userId,...req.body}).onConflictDoUpdate({target:[storyReactions.sourceId,storyReactions.userId],set:{...req.body,updatedAt:ctx.now()}});
  });return success(req.id,await summary(req.params.id,0,auth.userId));
 });
 r.post('/stories/:id/site-comments',{preHandler:[app.authenticate],schema:{tags:['community'],params,body:z.object({body:z.string().trim().min(1).max(2000),client_message_id:z.string().uuid(),confirms_publication:z.literal(true),reply_to:z.string().uuid().optional()}).strict(),response:{...failures,200:envelopeSchema(z.object({id:z.string().uuid()}))}}},async req=>{
  const auth=requireAuthContext(req);
  const id=await ctx.db.transaction(async tx=>{
   await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`reader-delete:${auth.userId}`},0))`);
   await tx.select({id:sources.id}).from(sources).where(eq(sources.id,req.params.id)).for('update');
   const [actor]=await tx.select().from(users).where(eq(users.id,auth.userId)).for('share');
   if(!actor||actor.disabledAt)throw AppError.unauthorized('Account unavailable');
   await requirePublicStory(tx,req.params.id);
   if(req.body.reply_to){const [parent]=await tx.select().from(siteComments).where(and(eq(siteComments.id,req.body.reply_to),eq(siteComments.sourceId,req.params.id)));if(!parent)throw AppError.notFound('Reply target not found in this story');}
   const [row]=await tx.insert(siteComments).values({sourceId:req.params.id,userId:auth.userId,body:req.body.body,replyTo:req.body.reply_to||null,clientMessageId:req.body.client_message_id}).onConflictDoNothing().returning();
   const existing=row??(await tx.select().from(siteComments).where(and(eq(siteComments.userId,auth.userId),eq(siteComments.clientMessageId,req.body.client_message_id))))[0];
   if(!existing||existing.sourceId!==req.params.id||existing.body!==req.body.body||existing.replyTo!==(req.body.reply_to||null))throw AppError.conflict('This comment key was already used for different content');
   return existing.id;
  });return success(req.id,{id});
 });
 r.delete('/site-comments/:id',{preHandler:[app.authenticate],schema:{tags:['community'],params,response:{...failures,200:envelopeSchema(z.object({deleted:z.literal(true)}))}}},async req=>{
  const userId=requireAuthContext(req).userId;
  const [row]=await ctx.db.select().from(siteComments).where(eq(siteComments.id,req.params.id));
  if(row&&row.userId!==userId)throw AppError.forbidden();
  await ctx.db.delete(siteComments).where(and(eq(siteComments.id,req.params.id),eq(siteComments.userId,userId)));
  return success(req.id,{deleted:true as const});
 });
 r.post('/stories/:id/reports',{preHandler:[app.authenticate],schema:{tags:['community'],params,body:z.object({reason:z.string().trim().min(2).max(1000),client_message_id:z.string().uuid()}).strict(),response:{...failures,200:envelopeSchema(z.object({id:z.string(),status:z.literal('received')}))}}},async req=>{
  const auth=requireAuthContext(req);
  const reportId=await ctx.db.transaction(async tx=>{
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`reader-delete:${auth.userId}`},0))`);
  await tx.select({id:sources.id}).from(sources).where(eq(sources.id,req.params.id)).for('update');
  const [actor]=await tx.select().from(users).where(eq(users.id,auth.userId)).for('share');
   if(!actor||actor.disabledAt)throw AppError.unauthorized('Account unavailable');
   await requirePublicStory(tx,req.params.id);
  const [row]=await tx.insert(siteReports).values({sourceId:req.params.id,userId:auth.userId,reason:req.body.reason,clientMessageId:req.body.client_message_id}).onConflictDoNothing().returning();
  const existing=row??(await tx.select().from(siteReports).where(and(eq(siteReports.userId,auth.userId),eq(siteReports.clientMessageId,req.body.client_message_id))))[0];
  if(!existing||existing.sourceId!==req.params.id||existing.reason!==req.body.reason)throw AppError.conflict('This report key was already used');
  return existing.id;});
  return success(req.id,{id:reportId,status:'received' as const});
 });
 r.put('/stories/:id/read',{preHandler:[app.authenticate],schema:{tags:['community'],params,body:z.object({}).strict(),response:{...failures,200:envelopeSchema(z.object({recorded:z.literal(true)}))}}},async req=>{
 const userId=requireAuthContext(req).userId;await ctx.db.transaction(async tx=>{
 await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`reader-delete:${userId}`},0))`);
 const [actor]=await tx.select().from(users).where(eq(users.id,userId)).for('share');if(!actor||actor.disabledAt)throw AppError.unauthorized();
 await requirePublicStory(tx,req.params.id);await tx.insert(storyReads).values({userId,sourceId:req.params.id,readAt:ctx.now()}).onConflictDoUpdate({target:[storyReads.userId,storyReads.sourceId],set:{readAt:ctx.now()}});
 });return success(req.id,{recorded:true as const});
 });
 r.get('/me/history',{preHandler:[app.authenticate],schema:{tags:['community'],querystring:paging,response:{...failures,200:envelopeSchema(z.object({items:z.array(z.object({source_id:z.string(),title:z.string().nullable(),text:z.string().nullable(),read_at:z.string()}))}))}}},async req=>{
 const rows=await ctx.db.select().from(storyReads).where(eq(storyReads.userId,requireAuthContext(req).userId)).orderBy(desc(storyReads.readAt),storyReads.sourceId).limit(100).offset(req.query.offset);
 const items=[];for(const row of rows){try{items.push({...await requirePublicStory(ctx.db,row.sourceId),read_at:row.readAt.toISOString()});}catch(e){if(!(e instanceof AppError)||e.code!=='not_found')throw e;}}return success(req.id,{items});
 });
 r.get('/me/saved-stories',{preHandler:[app.authenticate],schema:{tags:['community'],response:{...failures,200:envelopeSchema(z.object({items:z.array(z.object({source_id:z.string(),title:z.string().nullable(),text:z.string().nullable()}))}))}}},async req=>{
  const rows=await ctx.db.select().from(storyReactions).where(and(eq(storyReactions.userId,requireAuthContext(req).userId),eq(storyReactions.saved,true))).orderBy(desc(storyReactions.updatedAt));
  const items=[];for(const row of rows){try{items.push(await requirePublicStory(ctx.db,row.sourceId));}catch(e){if(!(e instanceof AppError)||e.code!=='not_found')throw e;}}
  return success(req.id,{items});
 });
 r.get('/admin/site-reports',{preHandler:[app.authenticate,app.requireRole('admin')],schema:{tags:['community'],querystring:paging,response:{...failures,200:envelopeSchema(z.object({items:z.array(z.object({id:z.string(),source_id:z.string(),reason:z.string(),created_at:z.string()}))}))}}},async req=>{
  const rows=await ctx.db.select().from(siteReports).orderBy(desc(siteReports.createdAt)).limit(10).offset(req.query.offset);
  return success(req.id,{items:rows.map(row=>({id:row.id,source_id:row.sourceId,reason:row.reason,created_at:row.createdAt.toISOString()}))});
 });
 r.post('/feedback',{schema:{tags:['community'],body:z.object({client_message_id:z.string().uuid(),category:z.enum(['bug','interface','suggestion']),body:z.string().trim().min(2).max(4000),page:z.string().max(300).regex(/^\/\?screen=\d{2}(?:&(?:story|source|tab)=[a-zA-Z0-9_-]+)*$/)}).strict(),response:{...failures,200:envelopeSchema(z.object({id:z.string(),status:z.literal('received')}))}}},async req=>{
  const [inserted]=await ctx.db.insert(siteFeedback).values({clientMessageId:req.body.client_message_id,category:req.body.category,body:req.body.body,page:req.body.page}).onConflictDoNothing().returning();
  const row=inserted||(await ctx.db.select().from(siteFeedback).where(eq(siteFeedback.clientMessageId,req.body.client_message_id)))[0];
  if(!row||row.body!==req.body.body||row.page!==req.body.page||row.category!==req.body.category)throw AppError.conflict('Feedback key was already used');
  return success(req.id,{id:row.id,status:'received' as const});
 });
 r.get('/admin/feedback',{preHandler:[app.authenticate,app.requireRole('admin')],schema:{tags:['community'],querystring:paging,response:{...failures,200:envelopeSchema(z.object({items:z.array(z.object({id:z.string(),category:z.string(),body:z.string(),page:z.string(),created_at:z.string()}))}))}}},async req=>{
  const rows=await ctx.db.select().from(siteFeedback).orderBy(desc(siteFeedback.createdAt)).limit(10).offset(req.query.offset);
  return success(req.id,{items:rows.map(row=>({id:row.id,category:row.category,body:row.body,page:row.page,created_at:row.createdAt.toISOString()}))});
 });
}};
