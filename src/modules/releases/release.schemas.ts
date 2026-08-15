import { z } from 'zod';
import { devicePlatformSchema } from '../devices/device.schemas';

export const releaseMetaSchema = z.object({
  platform: devicePlatformSchema,
  channel: z.enum(['STABLE', 'BETA']).default('STABLE'),
  policy: z.enum(['OPTIONAL', 'RECOMMENDED', 'REQUIRED']).default('OPTIONAL'),
  version: z.string().min(1).max(40),
  tag: z.string().min(1).max(40),
  notes: z.string().max(20_000).default(''),
  architecture: z.string().max(40).optional(),
  minimumVersion: z.string().max(40).optional(),
  published: z.coerce.boolean().default(true),
});

export type ReleaseMetaInput = z.infer<typeof releaseMetaSchema>;
