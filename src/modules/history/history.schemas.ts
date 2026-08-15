import { z } from 'zod';

export const progressSchema = z.object({
  sourceId: z.string().min(1).max(120),
  contentUrl: z.string().min(1).max(2048),
  contentId: z.string().max(256).optional(),
  contentKind: z.string().max(40).optional(),
  title: z.string().max(300).optional(),
  imageUrl: z.string().max(2048).optional(),
  episodeLabel: z.string().max(120).optional(),
  positionMs: z.coerce.bigint().nonnegative(),
  durationMs: z.coerce.bigint().nonnegative().optional(),
  completed: z.boolean().default(false),
});

export type ProgressInput = z.infer<typeof progressSchema>;
