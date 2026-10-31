"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { useRoomContext } from "@livekit/components-react";
import { RoomEvent, type RemoteParticipant } from "livekit-client";
import { toast } from "sonner";
import { useMaybeChat } from "@/features/chat/chat-provider";
import { CALL_REACTIONS, encodeFun, FUN_TOPIC, parseFun, type FunMessage } from "@/shared/fun";

type Floating = { id: number; emoji: string; x: number; name: string };
const MAX_FLOATING = 30;
const COUNTDOWN_MS = 3000;

/**
 * In-call delight, both over LiveKit data messages (validated, allowlisted):
 *  - floating emoji reactions that drift up over the video for both people
 *  - a photo booth: shared 3-2-1 countdown (either can cancel), then both cameras are composed
 *    into one framed photo that's sent to chat and saved to Moments
 */
export function useCallFun() {
  const room = useRoomContext();
  const chat = useMaybeChat();
  const [floating, setFloating] = useState<Floating[]>([]);
  const [booth, setBooth] = useState<{ id: string; endsAt: number; mine: boolean } | null>(null);
  const nextId = useRef(0);
  const lastSent = useRef(0);

  const show = useCallback((emoji: string, name: string) => {
    const id = nextId.current++;
    setFloating((f) => [...f.slice(-(MAX_FLOATING - 1)), { id, emoji, name, x: 10 + Math.random() * 80 }]);
    setTimeout(() => setFloating((f) => f.filter((x) => x.id !== id)), 3200);
  }, []);

  const publish = useCallback(
    (m: FunMessage) =>
      room.localParticipant.publishData(encodeFun(m), { reliable: true, topic: FUN_TOPIC }).catch(() => undefined),
    [room],
  );

  const react = useCallback(
    (emoji: (typeof CALL_REACTIONS)[number]) => {
      const now = Date.now();
      if (now - lastSent.current < 250) return; // a little throttle
      lastSent.current = now;
      show(emoji, "You");
      void publish({ v: 1, t: "react", emoji });
    },
    [publish, show],
  );

  const startBooth = useCallback(() => {
    if (booth) return;
    const id = crypto.randomUUID();
    setBooth({ id, endsAt: Date.now() + COUNTDOWN_MS, mine: true });
    void publish({ v: 1, t: "booth", id, inMs: COUNTDOWN_MS });
  }, [booth, publish]);

  const cancelBooth = useCallback(() => {
    if (!booth) return;
    void publish({ v: 1, t: "booth-cancel", id: booth.id });
    setBooth(null);
  }, [booth, publish]);

  const onData = useEffectEvent((payload: Uint8Array, from: RemoteParticipant) => {
    const m = parseFun(payload);
    if (!m) return;
    if (m.t === "react") show(m.emoji, from.name || "Them");
    else if (m.t === "booth") {
      setBooth({ id: m.id, endsAt: Date.now() + m.inMs, mine: false });
      toast(`${from.name || "Your person"} started the photo booth 📸`, { description: "Smile!" });
    } else if (m.t === "booth-cancel") setBooth((b) => (b?.id === m.id ? null : b));
  });

  useEffect(() => {
    const handler = (payload: Uint8Array, participant?: RemoteParticipant, _k?: unknown, topic?: string) => {
      if (topic === FUN_TOPIC && participant) onData(payload, participant);
    };
    room.on(RoomEvent.DataReceived, handler);
    return () => {
      room.off(RoomEvent.DataReceived, handler);
    };
  }, [room]);

  // When the countdown ends: the person who started it takes the photo; both see the flash.
  const capture = useEffectEvent(async (mine: boolean) => {
    setBooth(null);
    flash();
    if (!mine) return;
    const file = await composeBoothPhoto();
    if (!file) return void toast.error("Couldn't take the photo.");
    if (!chat) return;
    const id = await chat.sendPhoto(file, { saveToMoments: true });
    if (id) toast.success("Saved to Moments ✨");
    else toast.error("The photo couldn't be sent.");
  });
  useEffect(() => {
    if (!booth) return;
    const t = setTimeout(() => void capture(booth.mine), Math.max(0, booth.endsAt - Date.now()));
    return () => clearTimeout(t);
  }, [booth]);

  return { floating, react, booth, startBooth, cancelBooth, canBooth: !!chat };
}

function flash() {
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.style.cssText =
    "position:fixed;inset:0;background:#fff;z-index:80;pointer-events:none;opacity:.85;transition:opacity 450ms ease-out";
  document.body.appendChild(el);
  requestAnimationFrame(() => (el.style.opacity = "0"));
  setTimeout(() => el.remove(), 500);
}

/** Both camera tiles side by side on a DUO card, as a JPEG File. */
async function composeBoothPhoto(): Promise<File | null> {
  const local = document.querySelector<HTMLVideoElement>('[data-testid="tile-local"] video');
  const remote = document.querySelector<HTMLVideoElement>('[data-testid="tile-remote"] video');
  const names = [
    document.querySelector('[data-testid="tile-local"]')?.textContent?.replace(" (you)", "") ?? "You",
    document.querySelector('[data-testid="tile-remote"]')?.textContent ?? "",
  ];
  const W = 1600;
  const H = 1000;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#ff8a6e");
  g.addColorStop(0.5, "#ff9ec7");
  g.addColorStop(1, "#a593ff");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const pw = 720;
  const ph = 760;
  const slots = [
    { video: local, x: 60, mirror: true, name: names[0] },
    { video: remote, x: W - 60 - pw, mirror: false, name: names[1] },
  ];
  for (const s of slots) {
    ctx.save();
    roundRect(ctx, s.x, 60, pw, ph, 48);
    ctx.clip();
    ctx.fillStyle = "#1a1420";
    ctx.fillRect(s.x, 60, pw, ph);
    const v = s.video;
    if (v && v.videoWidth) {
      // cover-fit the frame into the slot
      const scale = Math.max(pw / v.videoWidth, ph / v.videoHeight);
      const dw = v.videoWidth * scale;
      const dh = v.videoHeight * scale;
      ctx.translate(s.x + pw / 2, 60 + ph / 2);
      if (s.mirror) ctx.scale(-1, 1);
      ctx.drawImage(v, -dw / 2, -dh / 2, dw, dh);
    } else {
      ctx.fillStyle = "#fff4e6";
      ctx.font = "700 220px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText((s.name || "?").trim().charAt(0).toUpperCase(), s.x + pw / 2, 60 + ph / 2);
    }
    ctx.restore();
  }
  ctx.fillStyle = "#1a1420";
  ctx.font = "800 64px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("duo", 60, H - 70);
  ctx.font = "600 34px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }), W - 60, H - 78);

  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.9));
  return blob ? new File([blob], `duo-photo-booth-${Date.now()}.jpg`, { type: "image/jpeg" }) : null;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Overlay: floating reactions + the booth countdown. */
export function CallFunOverlay({ fun }: { fun: ReturnType<typeof useCallFun> }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!fun.booth) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [fun.booth]);
  const secs = fun.booth ? Math.max(1, Math.ceil((fun.booth.endsAt - now) / 1000)) : 0;

  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-[45] overflow-hidden" aria-live="polite">
        {fun.floating.map((f) => (
          <span
            key={f.id}
            className="absolute bottom-24 flex animate-[duo-rise_3s_ease-out_forwards] flex-col items-center"
            style={{ left: `${f.x}%` }}
            data-testid="floating-reaction"
          >
            <span className="text-5xl drop-shadow-lg">{f.emoji}</span>
            <span className="rounded-full bg-black/50 px-2 text-xs font-semibold text-white">{f.name}</span>
          </span>
        ))}
      </div>
      {fun.booth && (
        <div className="fixed inset-0 z-[55] grid place-items-center bg-black/30" role="alert" data-testid="booth-countdown">
          <div className="flex flex-col items-center gap-4">
            <span className="font-display text-[9rem] leading-none font-extrabold text-cream drop-shadow-2xl tabular-nums">
              {secs}
            </span>
            <span className="rounded-full bg-black/60 px-4 py-1.5 text-sm font-semibold text-white">Photo booth: smile! 📸</span>
            <button
              type="button"
              onClick={fun.cancelBooth}
              className="rounded-full bg-ink-2 px-4 py-2 text-sm font-semibold hover:bg-ink-3"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
