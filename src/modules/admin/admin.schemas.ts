import { z } from 'zod';

export const manualPaymentSchema = z.object({
  accountId: z.string().min(1),
  planId: z.string().min(1),
  amountCents: z.number().int().nonnegative(),
  reference: z.string().max(160).optional(),
});

export const accountStatusSchema = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'BLOCKED', 'CLOSED']) });
export const ticketStatusSchema = z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_USER', 'RESOLVED', 'CLOSED']) });
export const adminTicketMessageSchema = z.object({ message: z.string().min(1).max(10_000) });
