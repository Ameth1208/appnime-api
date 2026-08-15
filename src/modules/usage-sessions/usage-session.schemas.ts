import { z } from 'zod';

export const acquireUsageSchema = z.object({ deviceId: z.string().min(1) });
export const heartbeatUsageSchema = z.object({ usageSessionId: z.string().min(1) });
export const releaseUsageSchema = heartbeatUsageSchema;
