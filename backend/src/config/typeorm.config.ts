import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export default registerAs('database', (): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  autoLoadEntities: true,
  // We use explicit migrations instead of synchronize, even in dev, so
  // the schema in every environment is produced by the same reviewable
  // migration files rather than TypeORM's auto-diffing.
  synchronize: false,
  migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],
  migrationsRun: process.env.RUN_MIGRATIONS_ON_BOOT === 'true',
  logging: process.env.NODE_ENV === 'development',
}));
