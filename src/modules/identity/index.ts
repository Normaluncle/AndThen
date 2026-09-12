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
  ANONYMOUS_READER_COHORT,
  EXCHANGEABLE_LOGIN_TOKEN_PURPOSES,
  createManagedUser,
  createReaderSession,
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

export type {
  AuthenticatedSession,
  CreateManagedUserInput,
  CreateReaderSessionInput,
  CreateUserInput,
  IssuedToken,
  ManagedUserResult,
  ReaderSessionResult,
  UserRole,
} from './service.js';

export {
  generateOpaqueToken,
  hashToken,
  newId,
  sha256,
  tokenHashEquals,
} from './tokens.js';
export type { OpaqueToken } from './tokens.js';
