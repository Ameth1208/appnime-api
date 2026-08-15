import { z } from 'zod';
import { registerDeviceSchema } from '../devices/device.schemas';

export const requestDeviceLinkSchema = registerDeviceSchema.extend({
  platform: z.literal('ANDROID_TV'),
});
export const approveDeviceLinkSchema = z.object({ code: z.string().min(5).max(16).transform((value) => value.toUpperCase()) });
export const claimDeviceLinkSchema = z.object({ linkId: z.string().min(1), claimSecret: z.string().min(20) });
export type RequestDeviceLinkInput = z.infer<typeof requestDeviceLinkSchema>;
