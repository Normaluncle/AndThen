import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';
import type { AppInstance } from '../shared/types.js';

/**
 * OpenAPI 3.1 document at /openapi.json and a UI at /docs. Route schemas are
 * declared with zod and transformed by fastify-type-provider-zod, so the
 * document is generated from the same schemas that validate requests.
 */
export async function registerOpenApi(app: AppInstance): Promise<void> {
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: '然后呢？ (AndThen) API',
        description:
          'Hackathon prototype backend. All routes under /api are project-defined; ' +
          'Browser clients may use same-origin HttpOnly session cookies with X-AndThen-Web: 1 on writes; ' +
          'Bearer clients remain supported. Zhihu OAuth browser callbacks return 303 to the account page.',
        version: '0.1.0',
      },
      servers: [{ url: '/', description: 'current host' }],
      components: {
        securitySchemes: {
          browserSession: {
            type: 'apiKey', in: 'cookie', name: '__Host-andthen_session',
            description: 'HTTPS browser session. Local HTTP uses andthen_session. Writes require X-AndThen-Web: 1 and same-origin requests.',
          },
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            description: 'Opaque random session token. Only its SHA-256 hash is stored server-side.',
          },
        },
      },
      tags: [
        { name: 'identity', description: 'Sessions, login-token exchange, current identity' },
        { name: 'system', description: 'Health and readiness' },
      ],
    },
    transform: jsonSchemaTransform,
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });

  // Serve the document at the path documented in docs/contracts.md.
  // `app.swagger()` is evaluated per request, so it includes every route
  // registered after this plugin (i.e. all business modules).
  app.get(
    '/openapi.json',
    { schema: { hide: true }, logLevel: 'warn' },
    async () => app.swagger(),
  );
}
