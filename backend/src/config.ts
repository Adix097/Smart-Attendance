import 'dotenv/config';
import path from 'node:path';

const port = Number.parseInt(process.env.PORT ?? '3001', 10);
const aiServiceTimeoutMs = Number.parseInt(
  process.env.AI_SERVICE_TIMEOUT_MS ?? '120000',
  10,
);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

if (!Number.isInteger(aiServiceTimeoutMs) || aiServiceTimeoutMs < 1) {
  throw new Error('AI_SERVICE_TIMEOUT_MS must be a positive integer');
}

export const config = {
  host: process.env.HOST?.trim() || '0.0.0.0',
  port,
  aiServiceUrl: process.env.AI_SERVICE_URL ?? 'http://127.0.0.1:8000',
  aiServiceTimeoutMs,
  databaseUrl: process.env.DATABASE_URL,
  databaseHost: process.env.DB_HOST ?? '127.0.0.1',
  databasePort: Number.parseInt(process.env.DB_PORT ?? '5432', 10),
  databaseName: process.env.DB_NAME ?? 'smart_attendance',
  databaseUser: process.env.DB_USER ?? 'postgres',
  databasePassword: process.env.DB_PASSWORD ?? '',
  databaseSsl: process.env.DB_SSL === 'true',
  enrollmentRoot: process.env.ENROLLMENT_ROOT?.trim() || path.resolve(process.cwd(), 'data', 'enrollment'),
  timeZone: process.env.APP_TIMEZONE ?? 'Asia/Kolkata',
  allowEndedSessionTest: process.env.ALLOW_ENDED_SESSION_TEST === 'true',
};
