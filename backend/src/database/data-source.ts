import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';

dotenv.config();

// This DataSource is used exclusively by the TypeORM CLI to generate and
// run migrations. It mirrors src/config/typeorm.config.ts but is a plain
// DataSource (no Nest DI) since the CLI runs outside the Nest context.
export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/database/migrations/*.ts'],
  synchronize: false,
  logging: true,
});
