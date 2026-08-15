import { z } from 'zod';

export const devicePlatformSchema = z.enum([
  'ANDROID_MOBILE', 'ANDROID_TV', 'ANDROID_AUTO', 'WINDOWS', 'LINUX', 'MACOS',
]);

export const registerDeviceSchema = z.object({
  installationId: z.string().min(8).max(128),
  platform: devicePlatformSchema,
  brand: z.string().max(80).optional(),
  model: z.string().max(120).optional(),
  deviceName: z.string().max(120).optional(),
  architecture: z.string().max(40).optional(),
  osVersion: z.string().max(80).optional(),
  appVersion: z.string().max(40).optional(),
  fingerprint: z.string().max(512).optional(),
  mac: z.string().max(64).optional(),
});

export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;
