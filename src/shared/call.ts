import { z } from "zod";

export const callTokenResponseSchema = z.object({
  token: z.string().min(20),
  url: z.string().regex(/^wss?:\/\//),
});
export type CallTokenResponse = z.infer<typeof callTokenResponseSchema>;

/** Participant metadata we put in the token (server-controlled, participants can't change it). */
export const participantMetaSchema = z.object({ hue: z.number().int().min(0).max(359) });

export function parseParticipantHue(metadata: string | undefined): number {
  try {
    const parsed = participantMetaSchema.safeParse(JSON.parse(metadata ?? "{}"));
    return parsed.success ? parsed.data.hue : 20;
  } catch {
    return 20;
  }
}
