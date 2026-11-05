// Production migration runner: `node dist/database/migrate.js`.
//
// The Docker image ships only compiled JS (no ts-node, no src/), so the
// TypeORM CLI scripts in package.json (`migration:run`) can't run there.
// This script applies the compiled migrations in dist/database/migrations
// using connection settings from the environment, then exits. docker
// compose runs it as a one-off `migrate` service before the backend starts.
//
// Deliberately no dotenv import: dotenv is a devDependency and isn't
// installed in the production image; compose injects the env vars.
import { DataSource } from 'typeorm';

async function main() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    // Only the compiled .js files (the glob must not pick up .d.ts files).
    migrations: [__dirname + '/migrations/*.js'],
    synchronize: false,
  });

  await dataSource.initialize();
  try {
    // InitialSchema uses uuid_generate_v4(). When migrations run through
    // the Nest app or the CLI, TypeORM installs uuid-ossp automatically
    // because it sees uuid entities; this runner loads no entities, so
    // install it explicitly (idempotent).
    await dataSource.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

    const applied = await dataSource.runMigrations({ transaction: 'each' });
    if (applied.length === 0) {
      console.log('[migrate] Database schema is up to date.');
    } else {
      for (const m of applied) console.log(`[migrate] Applied ${m.name}`);
    }
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error('[migrate] Migration failed:', err);
  process.exit(1);
});
