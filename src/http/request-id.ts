import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { AppInstance } from '../shared/types.js';

const MAX_REQUEST_ID_LENGTH = 128;

/**
 * `genReqId` implementation: honor a sane inbound x-request-id, otherwise mint
 * one. Fastify exposes the result as `request.id`, which every error envelope
 * echoes back as `request_id`.
 */
export function generateRequestId(request: IncomingMessage): string {
  const header = request.headers['x-request-id'];
  if (typeof header === 'string' && header.length > 0 && header.length <= MAX_REQUEST_ID_LENGTH) {
    return header;
  }
  return randomUUID();
}

export function registerRequestId(app: AppInstance): void {
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id);
    return payload;
  });
}
