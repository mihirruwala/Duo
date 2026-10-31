/**
 * Face-anchored props drawn on a 2D canvas over the composited frame.
 *
 * Head pose from landmarks: roll from the eye line, scale from inter-eye distance, anchors from
 * forehead (10), nose tip (1) and the outer eye corners (33, 263). Offsets are expressed in units
 * of eye distance along the face's own axes, so props stay put as the head tilts and moves.
 */
import type { FaceFilterId } from "@/shared/studio";

export type Landmark = { x: number; y: number; z?: number };

type Part = { sprite: string; anchor: "eyes" | "nose" | "forehead"; width: number; dx: number; dy: number };

const PARTS: Partial<Record<FaceFilterId, Part[]>> = {
  sunglasses: [{ sprite: "sunglasses", anchor: "eyes", width: 2.35, dx: 0, dy: 0.05 }],
  "big-glasses": [{ sprite: "big-glasses", anchor: "eyes", width: 2.7, dx: 0, dy: 0.1 }],
  dog: [
    { sprite: "dog-ear-l", anchor: "forehead", width: 1.15, dx: -1.1, dy: -0.2 },
    { sprite: "dog-ear-r", anchor: "forehead", width: 1.15, dx: 1.1, dy: -0.2 },
    { sprite: "dog-nose", anchor: "nose", width: 0.95, dx: 0, dy: 0.05 },
  ],
  cat: [
    { sprite: "cat-ear-l", anchor: "forehead", width: 0.95, dx: -0.75, dy: -0.75 },
    { sprite: "cat-ear-r", anchor: "forehead", width: 0.95, dx: 0.75, dy: -0.75 },
    { sprite: "cat-whiskers", anchor: "nose", width: 2.5, dx: 0, dy: 0.12 },
  ],
  crown: [{ sprite: "crown", anchor: "forehead", width: 2.1, dx: 0, dy: -0.95 }],
};

export type FacePose = {
  cx: number;
  cy: number;
  angle: number;
  d: number;
  anchors: Record<Part["anchor"], { x: number; y: number }>;
};

export function poseFrom(lm: Landmark[], w: number, h: number): FacePose | null {
  const p = (i: number) => (lm[i] ? { x: lm[i]!.x * w, y: lm[i]!.y * h } : null);
  const l = p(33);
  const r = p(263);
  const nose = p(1);
  const forehead = p(10);
  if (!l || !r || !nose || !forehead) return null;
  const d = Math.hypot(r.x - l.x, r.y - l.y);
  if (d < 4) return null;
  const eyes = { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 };
  return { cx: eyes.x, cy: eyes.y, angle: Math.atan2(r.y - l.y, r.x - l.x), d, anchors: { eyes, nose, forehead } };
}

/** Exponential smoothing so props don't jitter frame to frame. */
export function smoothPose(prev: FacePose | null, next: FacePose, alpha = 0.55): FacePose {
  if (!prev) return next;
  const mix = (a: number, b: number) => a + (b - a) * alpha;
  const mixPt = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: mix(a.x, b.x), y: mix(a.y, b.y) });
  let da = next.angle - prev.angle;
  if (da > Math.PI) da -= 2 * Math.PI;
  if (da < -Math.PI) da += 2 * Math.PI;
  return {
    cx: mix(prev.cx, next.cx),
    cy: mix(prev.cy, next.cy),
    angle: prev.angle + da * alpha,
    d: mix(prev.d, next.d),
    anchors: {
      eyes: mixPt(prev.anchors.eyes, next.anchors.eyes),
      nose: mixPt(prev.anchors.nose, next.anchors.nose),
      forehead: mixPt(prev.anchors.forehead, next.anchors.forehead),
    },
  };
}

export function drawFaceFilter(
  ctx: OffscreenCanvasRenderingContext2D,
  filter: FaceFilterId,
  pose: FacePose,
  sprites: Record<string, ImageBitmap>,
  time: number,
) {
  const parts = PARTS[filter];
  if (parts) {
    for (const part of parts) {
      const img = sprites[part.sprite];
      if (!img) continue;
      const a = pose.anchors[part.anchor];
      const w = part.width * pose.d;
      const h = (w * img.height) / img.width;
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(pose.angle);
      ctx.drawImage(img, part.dx * pose.d - w / 2, part.dy * pose.d - h / 2, w, h);
      ctx.restore();
    }
    return;
  }
  if (filter === "hearts") return drawHearts(ctx, pose, sprites.heart, time);
  if (filter === "confetti") return drawConfetti(ctx, pose, time);
}

function drawHearts(ctx: OffscreenCanvasRenderingContext2D, pose: FacePose, heart: ImageBitmap | undefined, time: number) {
  if (!heart) return;
  const n = 9;
  for (let i = 0; i < n; i++) {
    const phase = (time * 0.35 + i / n) % 1; // 0 → 1 as a heart rises
    const side = i % 2 === 0 ? -1 : 1;
    const spread = (0.9 + (i % 3) * 0.45) * pose.d;
    const x = pose.anchors.forehead.x + side * spread + Math.sin(time * 2 + i) * 0.25 * pose.d;
    const y = pose.anchors.nose.y + pose.d * 0.8 - phase * pose.d * 4.2;
    const s = pose.d * (0.32 + 0.12 * Math.sin(i * 1.7)) * (0.6 + 0.4 * Math.sin(phase * Math.PI));
    ctx.globalAlpha = Math.sin(phase * Math.PI);
    ctx.drawImage(heart, x - s / 2, y - s / 2, s, s);
  }
  ctx.globalAlpha = 1;
}

const CONFETTI_COLORS = ["#ff8a6e", "#a593ff", "#7fe0c0", "#ffd36b", "#ff9ec7", "#8fd0ff"];

function drawConfetti(ctx: OffscreenCanvasRenderingContext2D, pose: FacePose, time: number) {
  const n = 42;
  const width = pose.d * 6;
  for (let i = 0; i < n; i++) {
    const seed = (i * 9301 + 49297) % 233280;
    const r = seed / 233280;
    const fall = (time * (0.25 + r * 0.25) + r) % 1;
    const x = pose.anchors.forehead.x - width / 2 + ((r * 7.3) % 1) * width + Math.sin(time * 3 + i) * pose.d * 0.15;
    const y = pose.anchors.forehead.y - pose.d * 3 + fall * pose.d * 5.5;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(time * (2 + r * 4) + i);
    ctx.fillStyle = CONFETTI_COLORS[i % CONFETTI_COLORS.length]!;
    ctx.globalAlpha = 0.95 * Math.sin(fall * Math.PI);
    ctx.fillRect(-pose.d * 0.09, -pose.d * 0.045, pose.d * 0.18, pose.d * 0.09);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}
