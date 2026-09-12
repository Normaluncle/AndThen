---
name: docker-ops
description: Use when running or changing the AndThen Docker/compose stack — building the image, starting Postgres, running migrations, or debugging container health. Covers the test-database port policy and what must never be reset.
---

# Docker operations

## Services

| Service | Command | Notes |
|---|---|---|
| `db` | `postgres:18-alpine` | named volume `andthen-pgdata`; **no published ports** by default |
| `migrate` | `node dist/db/migrate.js` | one-shot; `api`/`worker` wait for `service_completed_successfully` |
| `api` | `node dist/server.js` | published on `127.0.0.1:${API_PORT:-8080}` only |
| `worker` | `node dist/worker.js` | same image, no ports |

`api` and `worker` build from the same `runtime` stage. Never bake secrets into
the image; everything comes from the environment.

## Common commands

```bash
# test database for integration tests (127.0.0.1:55432)
pnpm docker:testdb:up
pnpm docker:testdb:down

# full stack
docker compose up -d --build
docker compose logs -f migrate api worker
docker compose ps

# health smoke
docker compose exec api node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>r.text()).then(console.log)"
```

## Safety rules

- **Never delete volumes or run `down -v`.** `andthen-pgdata` may hold real pilot
  data. `docker compose down` (no `-v`) is the safe stop.
- **Do not change global network, proxy or firewall settings.** If an image pull
  fails, inspect it and report; fix the build, not the machine's networking.
- **The database must not be reachable from the LAN.** The base compose publishes
  no `db` port. The test overlay publishes `127.0.0.1:55432` only — never
  `0.0.0.0`.
- PGDATA is pinned to `/var/lib/postgresql/data/pgdata` so the layout is stable
  across Postgres image changes.

## Health and troubleshooting

- `pg_isready -U andthen -d andthen` is the db healthcheck; the api healthcheck
  fetches `/healthz` with Node's `fetch`.
- If `migrate` exits non-zero, `api` and `worker` will not start — check
  `docker compose logs migrate` first.
- The image build runs `pnpm install --frozen-lockfile`. If the lockfile and
  `package.json` disagree the build fails by design; run `pnpm install` locally
  and commit the updated lockfile.
- Verify the image contains migrations at `/app/src/db/migrations` — the migrate
  command resolves that path from the working directory.
