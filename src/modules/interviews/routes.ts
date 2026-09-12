import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ModuleRegistrar } from '../../shared/types.js';
import { requireAuthContext } from '../../http/auth.js';
import { envelopeSchema, errorEnvelopeSchema } from '../../http/envelope.js';
import { success } from '../../http/errors.js';
import { getInterview, messageInput, saveMessage, startInterview, transitionInterview } from './service.js';

const params = z.object({ id: z.string().uuid() });
const resultSchema = envelopeSchema(z.record(z.unknown()));
const responses = { 200: resultSchema, 202: resultSchema, 400: errorEnvelopeSchema, 401: errorEnvelopeSchema, 403: errorEnvelopeSchema, 404: errorEnvelopeSchema, 409: errorEnvelopeSchema, 410: errorEnvelopeSchema, 422: errorEnvelopeSchema };
export const registerInterviewRoutes: ModuleRegistrar = (app, ctx) => {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const base = { tags: ['interviews'], security: [{ bearerAuth: [] }], params, response: responses };
  api.post('/cases/:id/interviews', { preHandler: [app.authenticate], schema: { ...base, summary: 'Start an author interview; missing AI permission/configuration yields explicit manual mode', body: z.object({ mode: z.enum(['ai', 'manual']).default('ai'), confirms_own_content: z.literal(true), confirms_old_state: z.literal(true) }).strict() } }, async (req, reply) => {
    const data = await startInterview(ctx, requireAuthContext(req), req.params.id, req.body.mode);
    return reply.code(data.job_id ? 202 : 200).send(success(req.id, data));
  });
  api.get('/interviews/:id', { preHandler: [app.authenticate], schema: { ...base, summary: 'Read own interview and persisted messages' } }, async req => success(req.id, await getInterview(ctx.db, req.params.id, requireAuthContext(req))));
  api.post('/interviews/:id/messages', { preHandler: [app.authenticate], schema: { ...base, summary: 'Persist an answer or skip and enqueue at most one next question', body: messageInput } }, async (req, reply) => {
    const data = await saveMessage(ctx, requireAuthContext(req), req.params.id, req.body);
    return reply.code(data.job_id ? 202 : 200).send(success(req.id, data));
  });
  for (const action of ['pause', 'resume', 'finish'] as const) {
    api.post(`/interviews/:id/${action}`, { preHandler: [app.authenticate], schema: { ...base, summary: `${action} own interview with optimistic concurrency`, body: z.object({ expected_version: z.number().int().positive() }).strict() } }, async (req, reply) => {
      const data = await transitionInterview(ctx, requireAuthContext(req), req.params.id, action, req.body.expected_version);
      return reply.code(data.job_id ? 202 : 200).send(success(req.id, data));
    });
  }
};
