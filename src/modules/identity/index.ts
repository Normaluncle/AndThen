import type { ModuleDefinition } from '../../shared/types.js';
import { registerIdentityRoutes } from './routes.js';

/**
 * Identity module — the only fully implemented business module in the
 * foundation. Owns users, sessions, login-token exchange and the auth
 * middleware contract.
 */
export const identityModule: ModuleDefinition = {
  name: 'identity',
  registerRoutes: registerIdentityRoutes,
};

export { registerIdentityRoutes } from './routes.js';
export { registerAuth, parseBearerToken, requireAuthContext } from '../../http/auth.js';

export {
  createSession,
  createUser,
  exchangeLoginToken,
  findUserByEmail,
  findUserById,
  issueLoginToken,
  resolveSession,
  revokeAllSessions,
  revokeSession,
} from './service.js';

export type { AuthenticatedSession, CreateUserInput, IssuedToken, UserRole } from './service.js';

export {
  generateOpaqueToken,
  hashToken,
  newId,
  sha256,
  tokenHashEquals,
} from './tokens.js';
export type { OpaqueToken } from './tokens.js';
