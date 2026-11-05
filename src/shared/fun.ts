import { z } from "zod";

export const FUN_TOPIC = "duo.fun";
export const CALL_REACTIONS = ["❤️", "😂", "😮", "👏", "🔥", "🎉"] as const;

export const funMessageSchema = z.discriminatedUnion("t", [
  z.object({ v: z.literal(1), t: z.literal("react"), emoji: z.enum(CALL_REACTIONS) }),
  // Booth countdown: both people see it; `inMs` is a duration, so clock differences between devices don't matter.
  z.object({ v: z.literal(1), t: z.literal("booth"), id: z.uuid(), inMs: z.number().int().min(1000).max(5000) }),
  z.object({ v: z.literal(1), t: z.literal("booth-cancel"), id: z.uuid() }),
  // Watch mode: the viewer can't pause the sharer's tab, so they ask.
  z.object({ v: z.literal(1), t: z.literal("ask-pause") }),
]);
export type FunMessage = z.infer<typeof funMessageSchema>;

export function parseFun(bytes: Uint8Array): FunMessage | null {
  if (bytes.byteLength > 512) return null;
  try {
    const r = funMessageSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export function encodeFun(m: FunMessage): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(m));
}
