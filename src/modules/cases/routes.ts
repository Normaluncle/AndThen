import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { FollowupCaseRow, InvitationRow } from '../../db/schema.js';
import { requireAuthContext } from '../../http/auth.js';
import { envelopeSchema, errorEnvelopeSchema } from '../../http/envelope.js';
import { success } from '../../http/errors.js';
import type { AppInstance, ModuleContext } from '../../shared/types.js';
import {
  createCase,
  getCaseDetail,
  recordDecision,
  recordInvitation,
} from './service.js';

const caseStatusSchema = z.enum([
  'candidate',
  'hold',
  'eligible',
  'invite_recorded',
  'accepted',
  'declined',
  'expired',
  'interviewing',
  'paused',
  'draft',
  'stopped',
  'confirmed',
  'published',
  'withdrawn',
  'excluded',
]);
const launchTypeSchema = z.enum(['reader_initiated', 'author_initiated', 'pilot_preauthorized']);
const invitationChannelSchema = z.enum(['manual', 'email', 'other']);
const invitationResultSchema = z.enum([
  'pending',
  'no_response_in_window',
  'replied',
  'accepted',
  'declined',
]);
const dateTimeSchema = z.string().datetime({ offset: true });
const idParams = z.object({ id: z.string().uuid() });

const caseSchema = z.object({
  id: z.string().uuid(),
  source_id: z.string().uuid(),
  author_user_id: z.string().uuid().nullable(),
  status: caseStatusSchema,
  launch_type: launchTypeSchema,
  decline_flag: z.boolean(),
  do_not_contact: z.boolean(),
  reviewer_required: z.boolean(),
  published_version_id: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const invitationSchema = z.object({
  id: z.string().uuid(),
  case_id: z.string().uuid(),
  channel: invitationChannelSchema,
  sent_by_user_id: z.string().uuid().nullable(),
  sent_at: z.string(),
  observation_deadline: z.string().nullable(),
  result: invitationResultSchema,
  consent_version: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
});

function serializeCase(followupCase: FollowupCaseRow) {
  return {
    id: followupCase.id,
    source_id: followupCase.sourceId,
    author_user_id: followupCase.authorUserId,
    status: followupCase.status,
    launch_type: followupCase.launchType,
    decline_flag: followupCase.declineFlag,
    do_not_contact: followupCase.doNotContact,
    reviewer_required: followupCase.reviewerRequired,
    published_version_id: followupCase.publishedVersionId,
    created_at: followupCase.createdAt.toISOString(),
    updated_at: followupCase.updatedAt.toISOString(),
  };
}

function serializeInvitation(invitation: InvitationRow) {
  return {
    id: invitation.id,
    case_id: invitation.caseId,
    channel: invitation.channel,
    sent_by_user_id: invitation.sentByUserId,
    sent_at: invitation.sentAt.toISOString(),
    observation_deadline: invitation.observationDeadline?.toISOString() ?? null,
    result: invitation.result,
    consent_version: invitation.consentVersion,
    notes: invitation.notes,
    created_at: invitation.createdAt.toISOString(),
  };
}

/**
 * Cases module routes (PRD §9, §10, §13; FR-07..FR-11).
 *
 * `POST /cases/:id/invitations` records a human send; it never contacts the
 * author. `POST /cases/:id/decision` is only reachable by the bound author.
 */
export async function registerCasesRoutes(app: AppInstance, ctx: ModuleContext): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/cases',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['cases'],
        summary: 'Open (or return) the single case for a source',
        security: [{ bearerAuth: [] }],
        body: z.object({ source_id: z.string().uuid(), launch_type: launchTypeSchema }).strict(),
        response: {
          200: envelopeSchema(z.object({ case: caseSchema, deduped: z.boolean() })),
          403: errorEnvelopeSchema,
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const auth = requireAuthContext(request);
      const result = await createCase(ctx, auth, {
        sourceId: request.body.source_id,
        launchType: request.body.launch_type,
      });
      return success(request.id, {
        case: serializeCase(result.followupCase),
        deduped: result.deduped,
      });
    },
  );

  r.get(
    '/cases/:id',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['cases'],
        summary: 'Read a case (bound author or responsible researcher/admin)',
        security: [{ bearerAuth: [] }],
        params: idParams,
        response: {
          200: envelopeSchema(
            z.object({
              case: caseSchema,
              source: z.object({
                id: z.string().uuid(),
                title: z.string().nullable(),
                source_type: z.enum([
                  'official_search',
                  'author_paste',
                  'researcher_import',
                  'third_party_link',
                ]),
                permission_status: z.enum([
                  'pending',
                  'private_only',
                  'public_approved',
                  'revoked',
                  'rejected',
                ]),
                provenance: z.string(),
              }),
              author_bound: z.boolean(),
              author_verified: z.boolean(),
              invitations: z.array(
                z.object({
                  id: z.string().uuid(),
                  channel: invitationChannelSchema,
                  sent_at: z.string(),
                  observation_deadline: z.string().nullable(),
                  result: invitationResultSchema,
                }),
              ),
            }),
          ),
          404: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const auth = requireAuthContext(request);
      const detail = await getCaseDetail(ctx.db, auth, request.params.id);
      return success(request.id, {
        case: serializeCase(detail.followupCase),
        source: detail.source,
        author_bound: detail.author_bound,
        author_verified: detail.author_verified,
        invitations: detail.invitations,
      });
    },
  );

  r.post(
    '/cases/:id/invitations',
    {
      preHandler: [app.authenticate, app.requireRole('researcher', 'admin')],
      schema: {
        tags: ['cases'],
        summary: 'Record one human invitation (never sends); idempotent, blocked after decline',
        security: [{ bearerAuth: [] }],
        params: idParams,
        body: z
          .object({
            channel: invitationChannelSchema.default('manual'),
            sent_at: dateTimeSchema.nullable().optional(),
            observation_deadline: dateTimeSchema.nullable().optional(),
            consent_version: z.string().max(64).nullable().optional(),
            notes: z.string().max(2000).nullable().optional(),
          })
          .strict(),
        response: {
          200: envelopeSchema(
            z.object({
              invitation: invitationSchema,
              case_status: caseStatusSchema,
              deduped: z.boolean(),
            }),
          ),
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const auth = requireAuthContext(request);
      const result = await recordInvitation(ctx, auth, request.params.id, {
        channel: request.body.channel,
        sentAt: request.body.sent_at ? new Date(request.body.sent_at) : null,
        observationDeadline: request.body.observation_deadline
          ? new Date(request.body.observation_deadline)
          : null,
        consentVersion: request.body.consent_version ?? null,
        notes: request.body.notes ?? null,
      });
      return success(request.id, {
        invitation: serializeInvitation(result.invitation),
        case_status: result.caseStatus,
        deduped: result.deduped,
      });
    },
  );

  r.post(
    '/cases/:id/decision',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['cases'],
        summary: 'Bound author accepts, declines, or requests no further contact',
        security: [{ bearerAuth: [] }],
        params: idParams,
        body: z.object({ decision: z.enum(['accept', 'decline', 'do_not_contact']) }).strict(),
        response: {
          200: envelopeSchema(
            z.object({ case: caseSchema, decision: z.enum(['accept', 'decline', 'do_not_contact']) }),
          ),
          404: errorEnvelopeSchema,
          409: errorEnvelopeSchema,
        },
      },
    },
    async (request) => {
      const auth = requireAuthContext(request);
      const result = await recordDecision(ctx, auth, request.params.id, request.body.decision);
      return success(request.id, {
        case: serializeCase(result.followupCase),
        decision: result.decision,
      });
    },
  );
}
