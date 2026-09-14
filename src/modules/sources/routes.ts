import {queueEligibleAnalysis} from './analysis.js';
import {coverCatalog} from '../../db/schema.js';
import {presentationShape} from './presentation-schema.js';
import {sourcePresentation} from './presentation.js';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { SourceRow, SourceSnapshotRow } from '../../db/schema.js';
import { requireAuthContext } from '../../http/auth.js';
import { envelopeSchema, errorEnvelopeSchema } from '../../http/envelope.js';
import { success } from '../../http/errors.js';
import type { AppInstance, ModuleContext } from '../../shared/types.js';
import {
  grantConsent,
  importSource,
  listAuthorVerifications,
  listConsents,
  listFollowing,
  listPublicStories,
  listSourceSnapshots,
  recordAuthorVerification,
  requirePublicStory,
  requireReadableSource,
  revokeConsent,
  setInterest,
} from './service.js';

const sourceTypeSchema = z.enum([
  'official_search',
  'author_paste',
  'researcher_import',
  'third_party_link',
]);
const materialLevelSchema = z.enum([
  'exact_excerpt',
  'api_summary',
  'author_recollection',
  'ai_summary',
]);
const permissionStatusSchema = z.enum([
  'pending',
  'private_only',
  'public_approved',
  'revoked',
  'rejected',
]);
const consentPurposeSchema = z.enum([
  'private_interview',
  'external_model_processing',
  'demo_public_display',
  'video_display',
  'experience_index',
  'model_training',
]);
const provenanceSchema = z.enum(['test_fixture', 'team_material', 'real_authorized']);
const dateTimeSchema = z.string().datetime({ offset: true });
const nullableDateTime = dateTimeSchema.nullable();

const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const idParams = z.object({ id: z.string().uuid() });

/* -------------------------------------------------------------------------- */
/* Response schemas                                                            */
/* -------------------------------------------------------------------------- */

const sourceSchema = z.object({
  id: z.string().uuid(),
  source_type: sourceTypeSchema,
  original_url: z.string().nullable(),
  original_account_ref: z.string().nullable(),
  title: z.string().nullable(),
  permission_status: permissionStatusSchema,
  provenance: z.string(),
  notes: z.string().nullable(),
  created_by_user_id: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const snapshotSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int(),
  material_level: materialLevelSchema,
  body: z.string().nullable(),
  excerpt: z.string().nullable(),
  excerpt_location: z.string().nullable(),
  content_hash: z.string(),
  published_at: nullableDateTime,
  upstream_updated_at: nullableDateTime,
  acquired_at: z.string(),
  created_at: z.string(),
});

const publicStatementSchema = z.object({
  id: z.string(),
  text: z.string(),
  kind: z.string(),
  section: z.enum(['then', 'later', 'reflection']).optional(),
  question: z.string().optional(),
});

const publicFollowupSchema = z.object({
  version_id: z.string().uuid(),
  statements: z.array(publicStatementSchema),
  confirmed_at: nullableDateTime,
  published_at: nullableDateTime,
  ai_assisted: z.boolean(),
  attribution: z.literal('author_reported'),
});

const publicStorySchema = z.object({
  author_name:z.string().nullable(),
  site_counts:z.array(z.number()),
  ...presentationShape,
  source_id: z.string().uuid(),
  title: z.string().nullable(),
  source_type: sourceTypeSchema,
  original_url: z.string().nullable(),
  material_level: materialLevelSchema,
  text: z.string().nullable(),
  excerpt_location: z.string().nullable(),
  published_at: nullableDateTime,
  upstream_updated_at: nullableDateTime,
  acquired_at: nullableDateTime,
  provenance: z.string(),
  published_followup: publicFollowupSchema.nullable(),
  withdrawn: z.boolean(),
});

const consentSchema = z.object({
  id: z.string().uuid(),
  purpose: z.union([consentPurposeSchema, z.literal('reader_session')]),
  status: z.enum(['granted', 'revoked', 'expired']),
  version: z.string(),
  granted_at: z.string(),
  expires_at: nullableDateTime,
  revoked_at: nullableDateTime,
});

const verificationSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  method: z.enum(['oauth', 'manual']),
  status: z.enum(['pending', 'verified', 'rejected']),
  evidence_ref: z.string().nullable(),
  verifier_user_id: z.string().uuid().nullable(),
  scope: z.string().nullable(),
  notes: z.string().nullable(),
  verified_at: nullableDateTime,
  created_at: z.string(),
});

const followingUpdateSchema = z.object({
  version_id: z.string().uuid().nullable(),
  status: z.enum(['published', 'withdrawn']),
  published_at: nullableDateTime,
  has_unread: z.boolean(),
});

const followingItemSchema = z.object({
  site_counts:z.array(z.number()).optional(),
  ...z.object(presentationShape).partial().shape,
  text:z.string().nullable(),
  source_id: z.string().uuid(),
  available: z.boolean(),
  followed_at: z.string(),
  title: z.string().nullable(),
  source_type: sourceTypeSchema.nullable(),
  original_url: z.string().nullable(),
  material_level: materialLevelSchema.nullable(),
  published_at: nullableDateTime,
  update: followingUpdateSchema.nullable(),
});

function serializeSource(source: SourceRow) {
  return {
    id: source.id,
    source_type: source.sourceType,
    original_url: source.originalUrl,
    original_account_ref: source.originalAccountRef,
    title: source.title,
    permission_status: source.permissionStatus,
    provenance: source.provenance,
    notes: source.notes,
    created_by_user_id: source.createdByUserId,
    created_at: source.createdAt.toISOString(),
    updated_at: source.updatedAt.toISOString(),
  };
}

function serializeSnapshot(snapshot: SourceSnapshotRow) {
  return {
    id: snapshot.id,
    version: snapshot.version,
    material_level: snapshot.materialLevel,
    body: snapshot.body,
    excerpt: snapshot.excerpt,
    excerpt_location: snapshot.excerptLocation,
    content_hash: snapshot.contentHash,
    published_at: snapshot.publishedAt?.toISOString() ?? null,
    upstream_updated_at: snapshot.upstreamUpdatedAt?.toISOString() ?? null,
    acquired_at: snapshot.acquiredAt.toISOString(),
    created_at: snapshot.createdAt.toISOString(),
  };
}

/**
 * Sources module routes.
 *
 * Public reads are unauthenticated by design (a guest may browse a licensed
 * story). Every write re-derives identity and ownership server-side.
 */
export async function registerSourcesRoutes(app: AppInstance, ctx: ModuleContext): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  /* ----------------------------- import ----------------------------- */

  r.post(
    '/sources',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['sources'],
        summary: 'Register a source and an immutable snapshot (idempotent)',
        security: [{ bearerAuth: [] }],
        body: z
          .object({
            source_type: sourceTypeSchema,
            original_url: z.string().url().nullable().optional(),
            original_account_ref: z.string().max(512).nullable().optional(),
            title: z.string().max(1024).nullable().optional(),
            material_level: materialLevelSchema,
            body: z.string().max(200_000).nullable().optional(),
            excerpt: z.string().max(20_000).nullable().optional(),
            excerpt_location: z.string().max(512).nullable().optional(),
            published_at: dateTimeSchema.nullable().optional(),
            upstream_updated_at: dateTimeSchema.nullable().optional(),
            notes: z.string().max(4000).nullable().optional(),
            provenance: provenanceSchema.default('test_fixture'),
          })
          .strict(),
        response: {
          200: envelopeSchema(
            z.object({
              analysis_status:z.string(),
              source_id: z.string().uuid(),
              snapshot_id: z.string().uuid(),
              version: z.number().int(),
              permission_status: permissionStatusSchema,
              provenance: z.string(),
              material_level: materialLevelSchema,
              content_hash: z.string(),
              deduped: z.boolean(),
            }),
          ),
          400: errorEnvelopeSchema,
          403: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const auth = requireAuthContext(request);
      const body = request.body;
      const result = await importSource(ctx, auth, {
        sourceType: body.source_type,
        originalUrl: body.original_url ?? null,
        originalAccountRef: body.original_account_ref ?? null,
        title: body.title ?? null,
        materialLevel: body.material_level,
        body: body.body ?? null,
        excerpt: body.excerpt ?? null,
        excerptLocation: body.excerpt_location ?? null,
        publishedAt: body.published_at ? new Date(body.published_at) : null,
        upstreamUpdatedAt: body.upstream_updated_at ? new Date(body.upstream_updated_at) : null,
        notes: body.notes ?? null,
        provenance: body.provenance,
      });
      return success(request.id, {
        analysis_status:await queueEligibleAnalysis(ctx,result.source.id,auth.userId,request.id),
        source_id: result.source.id,
        snapshot_id: result.snapshot.id,
        version: result.snapshot.version,
        permission_status: result.source.permissionStatus,
        provenance: result.source.provenance,
        material_level: result.snapshot.materialLevel,
        content_hash: result.snapshot.contentHash,
        deduped: result.deduped,
      });
    },
  );

  r.get('/covers',{schema:{tags:['sources'],response:{200:envelopeSchema(z.object({items:z.array(z.object({id:z.string(),category:z.string(),tags:z.array(z.string()),alt:z.string(),sourceUrl:z.string().nullable(),imageUrl:z.string().nullable(),status:z.string()}))}))}}},async request=>success(request.id,{items:await ctx.db.select().from(coverCatalog)}));

  /* ------------------------------ read ------------------------------ */

  r.get(
    '/sources/:id',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['sources'],
        summary: 'Read a private source and its snapshots',
        security: [{ bearerAuth: [] }],
        params: idParams,
        response: {
          200: envelopeSchema(z.object({ source: sourceSchema, presentation:z.object(presentationShape), snapshots: z.array(snapshotSchema) })),
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const auth = requireAuthContext(request);
      const source = await requireReadableSource(ctx.db, auth, request.params.id);
      const snapshots = await listSourceSnapshots(ctx.db, source.id);
      return success(request.id, {
        source: serializeSource(source),
        presentation:await sourcePresentation(ctx.db,source.id,source.title,snapshots[0]),
        snapshots: snapshots.map(serializeSnapshot),
      });
    },
  );

  r.get(
    '/sources/:id/snapshots',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['sources'],
        summary: 'List snapshots of a private source',
        security: [{ bearerAuth: [] }],
        params: idParams,
        response: {
          200: envelopeSchema(z.object({ items: z.array(snapshotSchema) })),
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const auth = requireAuthContext(request);
      const source = await requireReadableSource(ctx.db, auth, request.params.id);
      const snapshots = await listSourceSnapshots(ctx.db, source.id);
      return success(request.id, { items: snapshots.map(serializeSnapshot) });
    },
  );

  /* ---------------------------- consents ---------------------------- */

  r.get(
    '/sources/:id/consents',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['sources'],
        summary: 'List per-purpose consents for a source',
        security: [{ bearerAuth: [] }],
        params: idParams,
        response: {
          200: envelopeSchema(z.object({ items: z.array(consentSchema) })),
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const auth = requireAuthContext(request);
      const source = await requireReadableSource(ctx.db, auth, request.params.id);
      const rows = await listConsents(ctx.db, source.id);
      return success(request.id, {
        items: rows.map((c) => ({
          id: c.id,
          purpose: c.purpose,
          status: c.status,
          version: c.version,
          granted_at: c.grantedAt.toISOString(),
          expires_at: c.expiresAt?.toISOString() ?? null,
          revoked_at: c.revokedAt?.toISOString() ?? null,
        })),
      });
    },
  );

  r.post(
    '/sources/:id/consents',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['sources'],
        summary: 'Grant a per-purpose consent (author only)',
        security: [{ bearerAuth: [] }],
        params: idParams,
        body: z.object({ purpose: consentPurposeSchema, version: z.string().min(1).max(64).default('v1'), expires_at: z.string().datetime({ offset: true }).optional() }).strict(),
        response: {
          200: envelopeSchema(
            z.object({ analysis_status:z.string(), consent: consentSchema, source_permission_status: permissionStatusSchema }),
          ),
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const auth = requireAuthContext(request);
      const { consent, sourcePermissionStatus } = await grantConsent(
        ctx,
        auth,
        request.params.id,
        request.body.purpose,
        request.body.version,
        request.body.expires_at ? new Date(request.body.expires_at) : undefined,
      );
      return success(request.id, {
        analysis_status:await queueEligibleAnalysis(ctx,request.params.id,auth.userId,request.id),
        consent: {
          id: consent.id,
          purpose: consent.purpose,
          status: consent.status,
          version: consent.version,
          granted_at: consent.grantedAt.toISOString(),
          expires_at: consent.expiresAt?.toISOString() ?? null,
          revoked_at: consent.revokedAt?.toISOString() ?? null,
        },
        source_permission_status: sourcePermissionStatus,
      });
    },
  );

  r.delete(
    '/sources/:id/consents/:purpose',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['sources'],
        summary: 'Revoke a per-purpose consent (author or admin); blocks public display immediately',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid(), purpose: consentPurposeSchema }),
        response: {
          200: envelopeSchema(
            z.object({
              consent: consentSchema,
              source_permission_status: permissionStatusSchema,
              cancelled_jobs: z.number().int(),
            }),
          ),
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const auth = requireAuthContext(request);
      const { consent, sourcePermissionStatus, cancelledJobs } = await revokeConsent(
        ctx,
        auth,
        request.params.id,
        request.params.purpose,
      );
      return success(request.id, {
        consent: {
          id: consent.id,
          purpose: consent.purpose,
          status: consent.status,
          version: consent.version,
          granted_at: consent.grantedAt.toISOString(),
          expires_at: consent.expiresAt?.toISOString() ?? null,
          revoked_at: consent.revokedAt?.toISOString() ?? null,
        },
        source_permission_status: sourcePermissionStatus,
        cancelled_jobs: cancelledJobs,
      });
    },
  );

  /* ------------------------ author verification ---------------------- */

  r.get(
    '/sources/:id/author-verifications',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['sources'],
        summary: 'List author verification records for a source',
        security: [{ bearerAuth: [] }],
        params: idParams,
        response: {
          200: envelopeSchema(z.object({ items: z.array(verificationSchema) })),
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const auth = requireAuthContext(request);
      const source = await requireReadableSource(ctx.db, auth, request.params.id);
      const rows = await listAuthorVerifications(ctx.db, source.id);
      return success(request.id, {
        items: rows.map((v) => ({
          id: v.id,
          user_id: v.userId,
          method: v.method,
          status: v.status,
          evidence_ref: v.evidenceRef,
          verifier_user_id: v.verifierUserId,
          scope: v.scope,
          notes: v.notes,
          verified_at: v.verifiedAt?.toISOString() ?? null,
          created_at: v.createdAt.toISOString(),
        })),
      });
    },
  );

  r.post(
    '/sources/:id/author-verifications',
    {
      preHandler: [app.authenticate, app.requireRole('researcher', 'admin')],
      schema: {
        tags: ['sources'],
        summary: 'Record an author verification; weak manual evidence never auto-passes',
        security: [{ bearerAuth: [] }],
        params: idParams,
        body: z
          .object({
            subject_user_id: z.string().uuid(),
            method: z.enum(['oauth', 'manual']),
            evidence_ref: z.string().max(512).nullable().optional(),
            scope: z.string().max(512).nullable().optional(),
            notes: z.string().max(2000).nullable().optional(),
            approve: z.boolean().default(false),
          })
          .strict(),
        response: {
          200: envelopeSchema(z.object({ verification: verificationSchema })),
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
          422: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const auth = requireAuthContext(request);
      const verification = await recordAuthorVerification(ctx, auth, request.params.id, {
        subjectUserId: request.body.subject_user_id,
        method: request.body.method,
        evidenceRef: request.body.evidence_ref ?? null,
        scope: request.body.scope ?? null,
        notes: request.body.notes ?? null,
        approve: request.body.approve,
      });
      return success(request.id, {
        verification: {
          id: verification.id,
          user_id: verification.userId,
          method: verification.method,
          status: verification.status,
          evidence_ref: verification.evidenceRef,
          verifier_user_id: verification.verifierUserId,
          scope: verification.scope,
          notes: verification.notes,
          verified_at: verification.verifiedAt?.toISOString() ?? null,
          created_at: verification.createdAt.toISOString(),
        },
      });
    },
  );

  /* --------------------------- public stories ------------------------ */

  r.get(
    '/stories',
    {
      schema: {
        tags: ['sources'],
        summary: 'List publicly licensed stories',
        querystring: paginationQuery.extend({q:z.string().trim().max(300).optional(),from:z.string().date().optional(),to:z.string().date().optional(),sort:z.enum(['relevance','newest','oldest']).optional()}),
        response: {
          200: envelopeSchema(
            z.object({
              items: z.array(publicStorySchema),
              total: z.number().int(),
              limit: z.number().int(),
              offset: z.number().int(),
            }),
          ),
        },
      },
    },
    async (request) => {
      const { limit, offset } = request.query;
      const page = await listPublicStories(ctx.db, limit, offset,request.query);
      return success(request.id, {
        items: page.items,
        total: page.total,
        limit,
        offset,
      });
    },
  );

  r.get(
    '/stories/:id',
    {
      schema: {
        tags: ['sources'],
        summary: 'Public projection of one licensed story',
        params: idParams,
        response: { 200: envelopeSchema(z.object({ story: publicStorySchema })), 404: errorEnvelopeSchema },
      },
    },
    async (request) => {
      const story = await requirePublicStory(ctx.db, request.params.id);
      return success(request.id, { story });
    },
  );

  r.put(
    '/stories/:id/interest',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['sources'],
        summary: 'Follow or unfollow a story (idempotent, deduped by reader x source)',
        security: [{ bearerAuth: [] }],
        params: idParams,
        body: z.object({ active: z.boolean() }).strict(),
        response: {
          200: envelopeSchema(
            z.object({
              source_id: z.string().uuid(),
              active: z.boolean(),
              updated_at: z.string(),
            }),
          ),
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const auth = requireAuthContext(request);
      const result = await setInterest(ctx, auth, request.params.id, request.body.active);
      return success(request.id, {
        source_id: result.sourceId,
        active: result.active,
        updated_at: result.updatedAt.toISOString(),
      });
    },
  );

  /* ---------------------------- following ---------------------------- */

  r.get(
    '/me/following',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['sources'],
        summary: 'The caller own following list (public information only)',
        security: [{ bearerAuth: [] }],
        querystring: paginationQuery,
        response: {
          200: envelopeSchema(
            z.object({
              items: z.array(followingItemSchema),
              total: z.number().int(),
              limit: z.number().int(),
              offset: z.number().int(),
            }),
          ),
        },
      },
    },
    async (request) => {
      const auth = requireAuthContext(request);
      const { limit, offset } = request.query;
      const page = await listFollowing(ctx.db, auth, limit, offset);
      return success(request.id, {
        items: page.items,
        total: page.total,
        limit,
        offset,
      });
    },
  );
}
