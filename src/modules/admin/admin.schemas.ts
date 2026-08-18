import { z } from 'zod';

export const manualPaymentSchema = z.object({
  accountId: z.string().min(1),
  planId: z.string().min(1),
  amountCents: z.number().int().nonnegative(),
  reference: z.string().max(160).optional(),
});

export const accountStatusSchema = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'BLOCKED', 'CLOSED']) });
export const paymentStatusSchema = z.object({ status: z.enum(['PENDING', 'PAID', 'FAILED', 'REFUNDED', 'CANCELLED']) });
export const adminInviteSchema = z.object({ email: z.email().transform((value) => value.toLowerCase()) });
export const adminNotifySchema = z.object({ message: z.string().min(1).max(500) });
export const adminDeviceLinkSchema = z.object({
  deviceName: z.string().max(120).optional(),
  brand: z.string().max(80).optional(),
  model: z.string().max(120).optional(),
});
export const termsCreateSchema = z.object({ title: z.string().min(1).max(160).optional(), body: z.string().min(1).max(100_000) });
export const promotionCreateSchema = z.object({
  code: z.string().min(2).max(40).transform((value) => value.trim().toUpperCase()),
  title: z.string().min(1).max(160),
  description: z.string().max(500).optional(),
  discountPercent: z.number().int().min(0).max(100),
  maxRedemptions: z.number().int().positive().optional(),
  startsAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
});
export const promotionUpdateSchema = promotionCreateSchema.partial().extend({
  active: z.boolean().optional(),
  usedCount: z.number().int().nonnegative().optional(),
});
export const announcementSchema = z.object({ message: z.string().min(1).max(1000) });
export const subscriptionUpdateSchema = z.object({
  status: z.enum(['TRIALING', 'ACTIVE', 'PAST_DUE', 'EXPIRED', 'SUSPENDED', 'BLOCKED', 'CANCELLED']).optional(),
  extendDays: z.number().int().min(1).max(3650).optional(),
  planId: z.string().min(1).optional(),
});
export const ticketStatusSchema = z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_USER', 'RESOLVED', 'CLOSED']) });
export const adminTicketMessageSchema = z.object({
  message: z.string().min(1).max(10_000),
  attachments: z.array(z.string()).optional(),
});
export const adminCreateUserSchema = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(120).optional(),
  isAdmin: z.boolean().default(false),
});
export const adminSetRoleSchema = z.object({ isAdmin: z.boolean() });
export const adminChangePasswordSchema = z.object({ password: z.string().min(8).max(128) });
