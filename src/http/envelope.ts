import { z } from 'zod';

/**
 * PRD §16.1: every response carries `request_id` and a `status` discriminator.
 * Wrap a data schema with this so the OpenAPI document and the serializer agree
 * with what handlers actually return via `success(request.id, payload)`.
 */
export function envelopeSchema<T extends z.ZodTypeAny>(data: T) {
  return z.object({
    request_id: z.string(),
    status: z.literal('ok'),
    data,
  });
}

export const errorEnvelopeSchema = z.object({
  request_id: z.string(),
  status: z.literal('error'),
  error_code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
});
