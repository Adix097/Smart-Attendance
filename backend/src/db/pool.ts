import { Pool } from 'pg';

import { config } from '../config.js';

export const pool = new Pool({
  connectionString: config.databaseUrl,
  host: config.databaseUrl ? undefined : config.databaseHost,
  port: config.databaseUrl ? undefined : config.databasePort,
  database: config.databaseUrl ? undefined : config.databaseName,
  user: config.databaseUrl ? undefined : config.databaseUser,
  password: config.databaseUrl ? undefined : config.databasePassword,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
});
