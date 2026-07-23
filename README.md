# MaroMench

Online multiplayer Ludo and Snakes & Ladders , built with
NestJS + Socket.io, Vue 3, and Postgres.

## Project structure

```
backend/    NestJS API + Socket.io game gateway
frontend/   Vue 3 + Vite SPA
```

## Local development (without Docker)

### 1. Postgres

You need a running Postgres instance. Create the database:

```sql
CREATE DATABASE maromench;
```

### 2. Backend

```bash
cd backend
cp .env.example .env   # edit DB credentials, JWT secrets, mail settings
npm install
npm run migration:run  # applies the schema
npm run start:dev
```

Backend runs on `http://localhost:3000` (API under `/api`, WebSocket
namespace at `/game`).

### 3. Frontend

```bash
cd frontend
cp .env.example .env    # points at the backend above by default
npm install
npm run dev
```

Frontend runs on `http://localhost:5173`.

## Running tests (backend)

```bash
cd backend
npm test              # unit tests (game engines, RoomsService)
npm run test:e2e      # e2e tests (HTTP + WebSocket, needs a real Postgres)
```

e2e tests use `.env.test` and expect a separate `maromench_test` database
so they never touch your dev data:

```sql
CREATE DATABASE maromench_test;
```

```bash
# apply migrations to the test DB (bash, from backend/)
set -a; source .env.test; set +a
npx ts-node -r tsconfig-paths/register ./node_modules/typeorm/cli.js \
  -d src/database/data-source.ts migration:run
```

## Running tests (frontend)

```bash
cd frontend
npm test              # runs Vitest once (stores, composables, components)
npm run test:watch    # watch mode
npm run test:coverage # with coverage report
```

Frontend tests use `@vue/test-utils` + Vitest with a jsdom environment,
configured in `vitest.config.ts` (kept separate from `vite.config.ts` so
`vue-tsc`'s type-checking of the build config isn't affected by Vitest's
config extensions).

## Running with Docker

```bash
cp backend/.env.example .env   # docker-compose reads vars from here
docker compose up --build
```

This starts Postgres, the backend, and the frontend (served via nginx).
On first run, apply migrations inside the backend container:

```bash
docker compose exec backend npm run migration:run
```

Migrations are intentionally **not** run automatically on container
start — this avoids multiple instances racing to migrate, or a routine
restart accidentally applying a new, unreviewed migration in production.
Run them explicitly as a deploy step instead.

## Environment variables

See `backend/.env.example` and `frontend/.env.example` for the full list.
Notably:

- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` — must be set to long random
  values in any real deployment; the example values are placeholders only.
- `MATCHMAKING_FILL_WAIT_MS` — how long the matchmaking queue waits to try
  to fill a room to capacity before starting with whatever's queued.
- `MAIL_*` — SMTP settings used for password-reset emails.

## Architecture notes

- **Auth**: JWT access + refresh tokens, refresh token rotation, revocation
  on logout/password-reset.
- **Rooms**: private (invite code), public (listed lobby), or matchmaking
  (system-formed, no admin/kick rights).
- **Game engines**: Ludo and Snakes & Ladders are implemented behind a
  shared `GameEngine` interface (`backend/src/modules/game-engine`), so
  the Socket.io gateway never contains game-specific rules.
- **Real-time**: Socket.io gateway handles room lifecycle, turns, dice
  rolls, moves, disconnect/reconnect, and turn timeouts.
