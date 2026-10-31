import { describe, expect, it, vi } from "vitest";
import { drawFaceFilter, poseFrom, smoothPose } from "@/features/studio/worker/face-overlay";
import { studioSummary } from "@/features/studio/summary";
import { DEFAULT_STUDIO, EFFECT_INDEX, EFFECTS, isStudioActive, studioConfigSchema, studioNeeds } from "@/shared/studio";

/** 478 landmarks, all at the image centre except the ones the overlay uses. */
function landmarks(points: Record<number, [number, number]>) {
  const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
  for (const [i, [x, y]] of Object.entries(points)) lm[Number(i)] = { x, y };
  return lm;
}

describe("face pose from landmarks", () => {
  it("derives centre, scale and roll from the eye line", () => {
    const lm = landmarks({ 33: [0.4, 0.5], 263: [0.6, 0.5], 1: [0.5, 0.6], 10: [0.5, 0.35] });
    const p = poseFrom(lm, 1000, 500)!;
    expect(p.cx).toBeCloseTo(500);
    expect(p.cy).toBeCloseTo(250);
    expect(p.d).toBeCloseTo(200);
    expect(p.angle).toBeCloseTo(0);
    expect(p.anchors.forehead).toEqual({ x: 500, y: 175 });
  });

  it("measures head roll (tilted 45°)", () => {
    const lm = landmarks({ 33: [0.4, 0.4], 263: [0.5, 0.5], 1: [0.5, 0.6], 10: [0.4, 0.3] });
    expect(poseFrom(lm, 1000, 1000)!.angle).toBeCloseTo(Math.PI / 4);
  });

  it("rejects degenerate detections", () => {
    expect(poseFrom(landmarks({ 33: [0.5, 0.5], 263: [0.5005, 0.5] }), 1000, 1000)).toBeNull();
    expect(poseFrom([], 100, 100)).toBeNull();
  });

  it("smooths jitter and wraps angles the short way round", () => {
    const a = poseFrom(landmarks({ 33: [0.4, 0.5], 263: [0.6, 0.5], 1: [0.5, 0.6], 10: [0.5, 0.35] }), 1000, 1000)!;
    const b = { ...a, cx: a.cx + 100, angle: Math.PI - 0.1 };
    const prev = { ...a, angle: -Math.PI + 0.1 };
    const s = smoothPose(prev, b, 0.5);
    expect(s.cx).toBeCloseTo(a.cx + 50);
    expect(Math.abs(Math.abs(s.angle) - Math.PI)).toBeLessThan(0.11); // stayed near ±π, didn't swing through 0
  });
});

describe("face filters draw their props at the anchors", () => {
  const pose = poseFrom(landmarks({ 33: [0.4, 0.5], 263: [0.6, 0.5], 1: [0.5, 0.6], 10: [0.5, 0.35] }), 1000, 1000)!;
  const sprite = { width: 100, height: 50 } as ImageBitmap;
  const sprites = new Proxy({}, { get: () => sprite }) as Record<string, ImageBitmap>;
  const ctx = () => ({
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    globalAlpha: 1,
    fillStyle: "",
  });

  it.each([
    ["sunglasses", 1],
    ["big-glasses", 1],
    ["dog", 3],
    ["cat", 3],
    ["crown", 1],
  ] as const)("%s draws %i sprite(s), scaled to the face", (filter, n) => {
    const c = ctx();
    drawFaceFilter(c as unknown as OffscreenCanvasRenderingContext2D, filter, pose, sprites, 0);
    expect(c.drawImage).toHaveBeenCalledTimes(n);
    const [, , , w] = c.drawImage.mock.calls[0]!;
    expect(w).toBeGreaterThan(pose.d * 0.8); // proportional to eye distance
  });

  it("sunglasses sit on the eyes", () => {
    const c = ctx();
    drawFaceFilter(c as unknown as OffscreenCanvasRenderingContext2D, "sunglasses", pose, sprites, 0);
    expect(c.translate).toHaveBeenCalledWith(pose.anchors.eyes.x, pose.anchors.eyes.y);
  });

  it("particle filters animate", () => {
    const hearts = ctx();
    drawFaceFilter(hearts as unknown as OffscreenCanvasRenderingContext2D, "hearts", pose, sprites, 1.2);
    expect(hearts.drawImage.mock.calls.length).toBeGreaterThan(5);
    const confetti = ctx();
    drawFaceFilter(confetti as unknown as OffscreenCanvasRenderingContext2D, "confetti", pose, sprites, 1.2);
    expect(confetti.fillRect.mock.calls.length).toBeGreaterThan(30);
  });
});

describe("studio config", () => {
  it("only computes what the look needs", () => {
    expect(studioNeeds(DEFAULT_STUDIO)).toEqual({ segmentation: false, landmarks: false, effect: 0 });
    expect(studioNeeds({ background: { kind: "blur", strength: 0.5 }, effect: "vhs", face: "none" })).toEqual({
      segmentation: true,
      landmarks: false,
      effect: EFFECT_INDEX.vhs,
    });
    expect(isStudioActive(DEFAULT_STUDIO)).toBe(false);
  });

  it("every effect has a distinct shader index", () => {
    const ids = EFFECTS.map((e) => EFFECT_INDEX[e.id]);
    expect(new Set(ids).size).toBe(EFFECTS.length);
    expect(ids).not.toContain(0);
  });

  it("rejects unknown or out-of-range settings from storage", () => {
    expect(studioConfigSchema.safeParse({ ...DEFAULT_STUDIO, effect: "deepfake" }).success).toBe(false);
    expect(studioConfigSchema.safeParse({ ...DEFAULT_STUDIO, background: { kind: "blur", strength: 9 } }).success).toBe(false);
  });

  it("summarizes the current look", () => {
    expect(studioSummary(DEFAULT_STUDIO)).toBe("Off");
    expect(studioSummary({ background: { kind: "image", id: "tropical" }, effect: "bw", face: "crown" })).toBe(
      "Tropical escape · Black & white · Crown",
    );
  });
});
