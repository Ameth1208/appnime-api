import { z } from 'zod';

export const generateCodesSchema = z.object({
  name: z.string().min(2).max(120),
  campaign: z.string().max(120).optional(),
  reseller: z.string().max(120).optional(),
  notes: z.string().max(1000).optional(),
  planId: z.string().min(1),
  kind: z.enum(['TRIAL', 'PREPAID', 'COMPLIMENTARY', 'LIFETIME']),
  durationUnit: z.enum(['DAY', 'MONTH', 'YEAR', 'LIFETIME']),
  durationValue: z.number().int().positive().max(120).default(1),
  quantity: z.number().int().positive().max(1000),
  redemptionExpiresAt: z.coerce.date().optional(),
});

export const redeemCodeSchema = z.object({ code: z.string().min(8).max(64).transform((value) => value.toUpperCase()) });
export type GenerateCodesInput = z.infer<typeof generateCodesSchema>;
