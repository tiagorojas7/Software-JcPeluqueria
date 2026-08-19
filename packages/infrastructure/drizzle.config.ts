import './src/config/load-env';
import { defineConfig } from 'drizzle-kit';

// Migrations are generated from packages/infrastructure/src/db/schema and
// applied to the PostgreSQL instance started by the root docker-compose.yml.
export default defineConfig({
  schema: './src/db/schema',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      'postgres://jc_barberia:jc_barberia@localhost:5432/jc_barberia_test',
  },
});
