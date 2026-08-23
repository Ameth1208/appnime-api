import { z } from 'zod';

const optionalUrl = z.string().url().or(z.literal('')).default('');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(2592000),
  PAYMENT_GRACE_HOURS: z.coerce.number().int().nonnegative().default(48),
  OFFLINE_GRACE_HOURS: z.coerce.number().int().nonnegative().default(72),
  LEASE_REFRESH_AFTER_HOURS: z.coerce.number().int().positive().default(6),
  USAGE_SESSION_STALE_SECONDS: z.coerce.number().int().positive().default(180),
  DEVICE_LINK_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  INVITATION_TTL_HOURS: z.coerce.number().int().positive().default(168),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_ROOT: z.string().default('./storage'),
  S3_ENDPOINT: optionalUrl,
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().default(''),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  S3_PUBLIC_BASE_URL: optionalUrl,
  PUBLIC_BASE_URL: z.string().url(),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  TMDB_API_KEY: z.string().default(''),
  CATALOG_EMBED_SOURCES: z.string().default(''),
  ADULT_SECRET_CODE: z.string().default('appnime-adult'),
  MEILI_HOST: optionalUrl,
  MEILI_MASTER_KEY: z.string().default(''),
  FLARESOLVERR_URL: optionalUrl,
  
});

export type AppEnv = z.infer<typeof envSchema>;
export function validateEnv(input: Record<string, unknown>) {
  const parsed = envSchema.parse(input);
  if (parsed.STORAGE_DRIVER === 's3') {
    if (!parsed.S3_BUCKET || !parsed.S3_ACCESS_KEY_ID || !parsed.S3_SECRET_ACCESS_KEY) {
      throw new Error('S3 storage requires bucket and credentials');
    }
  }
  return parsed;
}





