import { writeFileSync } from 'node:fs';
import { getEnv } from '../config/env.js';
import { createDatabase, createPool } from '../db/client.js';
import {
  createUser,
  findUserByEmail,
  issueLoginToken,
  type UserRole,
} from '../modules/identity/service.js';
import { createCliLogger } from '../shared/logger.js';

/**
 * Admin bootstrap CLI.
 *
 *   pnpm bootstrap:admin -- --email admin@example.org --name "Ops"
 *   pnpm bootstrap:admin -- --issue-for reader@example.org --role reader
 *   pnpm bootstrap:admin -- --out .secrets/admin.token
 *
 * The one-time login token is emitted on stdout (or to --out) and is NEVER
 * written to the structured log. It is exchanged for a session via
 * POST /api/auth/sessions. Nothing here is hardcoded or committed.
 */

interface CliArgs {
  email: string;
  name: string | null;
  role: UserRole;
  issueFor: string | null;
  out: string | null;
  json: boolean;
  ttlSeconds: number | null;
}

const ROLES: UserRole[] = ['reader', 'author', 'researcher', 'admin'];

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    email: 'admin@andthen.local',
    name: null,
    role: 'admin',
    issueFor: null,
    out: null,
    json: false,
    ttlSeconds: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
      i += 1;
      return value;
    };
    switch (arg) {
      case '--email':
        args.email = next();
        break;
      case '--name':
        args.name = next();
        break;
      case '--role': {
        const role = next() as UserRole;
        if (!ROLES.includes(role)) throw new Error(`Unknown role "${role}"`);
        args.role = role;
        break;
      }
      case '--issue-for':
        args.issueFor = next();
        break;
      case '--out':
        args.out = next();
        break;
      case '--ttl-seconds':
        args.ttlSeconds = Number.parseInt(next(), 10);
        break;
      case '--json':
        args.json = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument "${arg}"`);
    }
  }
  return args;
}

function printHelp(): void {
  process.stdout.write(
    [
      'Usage: pnpm bootstrap:admin -- [options]',
      '',
      '  --email <addr>       Account email (default admin@andthen.local)',
      '  --name <name>        Display name for a newly created account',
      '  --role <role>        reader | author | researcher | admin (default admin)',
      '  --issue-for <addr>   Issue a login token for an existing account instead',
      '  --ttl-seconds <n>    Login-token lifetime (default LOGIN_TOKEN_TTL_SECONDS)',
      '  --out <path>         Also write the raw token to this file (mode 0600)',
      '  --json               Emit a machine-readable object on stdout',
      '',
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const env = getEnv();
  const logger = createCliLogger(env, { base: { service: 'andthen-bootstrap', env: env.NODE_ENV } });

  const pool = createPool({
    connectionString: env.DATABASE_URL,
    max: 1,
    applicationName: 'andthen-bootstrap',
  });
  const db = createDatabase(pool);

  try {
    const targetEmail = args.issueFor ?? args.email;
    let user = await findUserByEmail(db, targetEmail);
    let created = false;

    if (!user) {
      if (args.issueFor) {
        throw new Error(`No account found for ${targetEmail}; run without --issue-for to create one`);
      }
      user = await createUser(db, {
        email: targetEmail,
        displayName: args.name,
        role: args.role,
        cohort: 'team',
      });
      created = true;
    }

    const ttlSeconds = args.ttlSeconds ?? env.LOGIN_TOKEN_TTL_SECONDS;
    const token = await issueLoginToken(db, {
      userId: user.id,
      purpose: 'bootstrap',
      ttlSeconds,
      metadata: { created_by: 'bootstrap-cli' },
    });

    // Non-secret facts go through the structured logger.
    logger.info(
      { userId: user.id, email: user.email, role: user.role, created, tokenPrefix: token.tokenPrefix },
      'bootstrap login token issued',
    );

    if (args.out) {
      writeFileSync(args.out, `${token.token}\n`, { mode: 0o600 });
      logger.info({ out: args.out }, 'token written to file');
    }

    if (args.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            user_id: user.id,
            email: user.email,
            role: user.role,
            created,
            login_token: token.token,
            token_prefix: token.tokenPrefix,
            expires_at: token.expiresAt.toISOString(),
          },
          null,
          2,
        )}\n`,
      );
    } else {
      // The raw token is the CLI's deliverable to the operator. It is printed
      // here and nowhere else; structured logs only ever carry the prefix.
      process.stdout.write(
        [
          '',
          `  account      : ${user.email ?? user.id} (${user.role})`,
          `  created      : ${created ? 'yes' : 'no (existing account)'}`,
          `  expires at   : ${token.expiresAt.toISOString()}`,
          '',
          '  ONE-TIME LOGIN TOKEN (shown once, not stored in logs):',
          `  ${token.token}`,
          '',
          '  Exchange it with:',
          '    curl -sX POST "$BASE/api/auth/sessions" -H "content-type: application/json" \\',
          `      -d '{"login_token":"${token.tokenPrefix}..."}'`,
          '',
        ].join('\n'),
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error('[bootstrap:admin] failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
