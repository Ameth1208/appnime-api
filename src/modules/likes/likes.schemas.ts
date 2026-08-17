import { z } from 'zod';

export const likeSchema = z.object({
  sourceId: z.string().min(1).max(120),
  contentUrl: z.string().min(1).max(2048),
  title: z.string().max(300).optional(),
  imageUrl: z.string().max(2048).optional(),
  contentKind: z.string().max(40).optional(),
});

export const unlikeQuerySchema = z.object({
  sourceId: z.string().min(1).max(120),
  contentUrl: z.string().min(1).max(2048),
});

export type LikeInput = z.infer<typeof likeSchema>;
