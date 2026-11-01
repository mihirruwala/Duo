import { z } from "zod";

export const callTokenResponseSchema = z.object({
  token: z.string().min(20),
  url: z.string().regex(/^wss?:\/\//),
  /** Room media key (base64, 32 bytes) when end-to-end encryption is on; never sent to LiveKit. */
  e2eeKey: z
    .string()
    .regex(/^[A-Za-z0-9+/]{43}=$/)
    .nullable(),
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
