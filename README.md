# GIMOO

Online multiplayer board games (Ludo, Snakes & Ladders and more), built with
NestJS + Socket.io, Vue 3, and Postgres. Live at **https://gimoo.ir**.

Production runs on the shared server through
[ParsServer](https://github.com/hesamtmg/ParsServer) (`projects/gimoo`); its
server-specific settings live there, not in this repo.

## Games

| Game | Players | What it is |
| --- | --- | --- |
| 🎲 Ludo | 2–4 | Race all four pieces from your yard to home |
| 🐍 Snakes & Ladders | 2–16 | Climb ladders, dodge snakes, first to 100 |
| 🥏 OLO | 2 | Real-time physics disc flicking on an ice rink (also has an offline practice mode) |
| 🏙️ Monopoly | 2–6 | Buy, build, trade, auction and bankrupt your friends |
| 🌍 Conquest | 2–6 | Turn-based world-conquest strategy on a real map |
| ⚡ FLICK (`flick-arena-v3.html`) | 2 | Standalone single-file prototype of OLO; no server needed |

## Quick start: run it on your computer

You need **Node.js 22+** and **PostgreSQL 16** (or Docker, which bundles
Postgres for you).

### Option A: Docker (easiest)

Install [Docker Desktop](https://www.docker.com/products/docker-desktop/), then:

```bash
git clone https://github.com/hesamtmg/Maro-Mench.git
cd Maro-Mench
cp backend/.env.example .env
docker compose up --build -d
docker compose exec backend npm run migration:run   # first run only
```

Open **http://localhost:5173**, register an account and pick a game.

### Option B: Without Docker

1. Start Postgres and create the database: `CREATE DATABASE gimoo;`
2. In one terminal, start the backend:
   ```bash
   cd backend
   cp .env.example .env      # set DB_USERNAME / DB_PASSWORD to match your Postgres
   npm install
   npm run migration:run
   npm run start:dev         # http://localhost:3000
   ```
3. In a second terminal, start the frontend:
   ```bash
   cd frontend
   cp .env.example .env
   npm install
   npm run dev               # http://localhost:5173
   ```

### Playing a multiplayer game on one computer

Each player needs their own account. To try a match alone, open a normal
window and a private/incognito window (they keep separate logins).
Register a different user in each, create a room in one window, and join
it from the other with the room code. Then press **Start game**.

### FLICK (no setup)

Double-click `flick-arena-v3.html` to open it in your browser. It loads
its physics library from a CDN, so you need an internet connection.

## Project structure

```
backend/    NestJS API + Socket.io game gateway
frontend/   Vue 3 + Vite SPA
```

## Local development (without Docker)

### 1. Postgres

You need a running Postgres instance. Create the database:

```sql
CREATE DATABASE gimoo;
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

e2e tests use `.env.test` and expect a separate `gimoo_test` database
so they never touch your dev data:

```sql
CREATE DATABASE gimoo_test;
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
