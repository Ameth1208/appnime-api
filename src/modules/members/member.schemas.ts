import { z } from 'zod';

export const inviteMemberSchema = z.object({ email: z.email().transform((value) => value.toLowerCase()) });
export const acceptInvitationSchema = z.object({ token: z.string().min(20) });

export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
