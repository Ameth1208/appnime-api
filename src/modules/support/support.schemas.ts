import { z } from 'zod';

export const createTicketSchema = z.object({
  subject: z.string().min(3).max(200),
  category: z.string().min(2).max(80),
  deviceId: z.string().optional(),
  message: z.string().min(1).max(10_000),
  attachments: z.array(z.string()).optional(),
});

export const messageSchema = z.object({
  message: z.string().min(1).max(10_000),
  attachments: z.array(z.string()).optional(),
});
export type CreateTicketInput = z.infer<typeof createTicketSchema>;
