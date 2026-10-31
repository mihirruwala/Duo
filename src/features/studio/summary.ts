import { BACKGROUNDS, EFFECTS, FACE_FILTERS, type StudioConfig } from "@/shared/studio";

/** "Blur · VHS · Crown", or "Off". */
export function studioSummary(c: StudioConfig): string {
  const parts: string[] = [];
  const bg = c.background;
  if (bg.kind === "blur") parts.push("Blur");
  if (bg.kind === "image") {
    parts.push(bg.id === "custom" ? "Your image" : (BACKGROUNDS.find((b) => b.id === bg.id)?.label ?? "Background"));
  }
  if (c.effect !== "none") parts.push(EFFECTS.find((e) => e.id === c.effect)!.label);
  if (c.face !== "none") parts.push(FACE_FILTERS.find((f) => f.id === c.face)!.label);
  return parts.length ? parts.join(" · ") : "Off";
}
