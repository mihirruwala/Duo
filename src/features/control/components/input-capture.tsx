"use client";

import { useEffect, useRef, useState } from "react";
import { containedContentBox, modsFrom, normalizePoint, type Box, type InputEvent } from "@/shared/control";

const MOVE_INTERVAL_MS = 33; // ~30 Hz, coalesced
const BUTTONS = ["left", "middle", "right"] as const;

/**
 * Transparent layer over the shared video while you're in control. Pointer events are mapped to
 * 0..1 coordinates inside the video *content* (letterbox bars excluded, so the mapping holds at any
 * aspect ratio or window size). Keys go to the remote tab while this layer has focus.
 */
export function InputCapture({
  videoContainer,
  onInput,
  name,
}: {
  videoContainer: HTMLElement | null;
  onInput: (e: InputEvent) => void;
  name: string;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [focused, setFocused] = useState(false);
  const pendingMove = useRef<{ x: number; y: number } | null>(null);
  const lastMoveSent = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(new Set<string>());

  // Track where the video content actually sits.
  useEffect(() => {
    const video = videoContainer?.querySelector("video");
    const layer = layerRef.current;
    if (!video || !layer) return;
    const measure = () => {
      const parent = layer.getBoundingClientRect();
      const r = video.getBoundingClientRect();
      const content = containedContentBox(
        { left: r.left - parent.left, top: r.top - parent.top, width: r.width, height: r.height },
        video.videoWidth,
        video.videoHeight,
      );
      setBox(content);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(video);
    video.addEventListener("loadedmetadata", measure);
    video.addEventListener("resize", measure);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      video.removeEventListener("loadedmetadata", measure);
      video.removeEventListener("resize", measure);
      window.removeEventListener("resize", measure);
    };
  }, [videoContainer]);

  const point = (e: { clientX: number; clientY: number }) => {
    const layer = layerRef.current;
    if (!layer || !box) return null;
    const r = layer.getBoundingClientRect();
    return normalizePoint(box, e.clientX - r.left, e.clientY - r.top);
  };

  const flushMove = () => {
    timer.current = null;
    if (!pendingMove.current) return;
    onInput({ t: "move", ...pendingMove.current });
    pendingMove.current = null;
    lastMoveSent.current = performance.now();
  };

  // Wheel needs a non-passive listener to stop the DUO page itself from scrolling.
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const onWheel = (e: WheelEvent) => {
      const p = point(e);
      if (!p) return;
      e.preventDefault();
      const scale = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 400 : 1;
      onInput({ t: "wheel", ...p, dx: clamp(e.deltaX * scale), dy: clamp(e.deltaY * scale) });
    };
    layer.addEventListener("wheel", onWheel, { passive: false });
    return () => layer.removeEventListener("wheel", onWheel);
  });

  // Release anything still held if we lose focus or unmount (no stuck keys/buttons on the remote side).
  const releaseAll = () => {
    for (const k of held.current) {
      const [key, code] = k.split("\u0000") as [string, string];
      onInput({ t: "key", phase: "up", key, code, mods: 0 });
    }
    held.current.clear();
  };
  useEffect(() => () => releaseAll(), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={layerRef}
      tabIndex={0}
      role="application"
      aria-label={`Remote control surface. You're controlling ${name}'s tab. Click to focus, then type.`}
      data-testid="control-surface"
      className="absolute inset-0 z-20 cursor-none outline-none"
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        releaseAll();
      }}
      onMouseMove={(e) => {
        const p = point(e);
        setCursor(p);
        if (!p) return;
        pendingMove.current = p;
        const since = performance.now() - lastMoveSent.current;
        if (since >= MOVE_INTERVAL_MS) flushMove();
        else timer.current ??= setTimeout(flushMove, MOVE_INTERVAL_MS - since);
      }}
      onMouseLeave={() => setCursor(null)}
      onMouseDown={(e) => {
        layerRef.current?.focus();
        const p = point(e);
        if (!p) return;
        e.preventDefault();
        flushMove();
        onInput({
          t: "button",
          ...p,
          button: BUTTONS[e.button] ?? "left",
          down: true,
          clicks: Math.min(3, Math.max(1, e.detail)),
          mods: modsFrom(e),
        });
      }}
      onMouseUp={(e) => {
        const p = point(e);
        if (!p) return;
        e.preventDefault();
        flushMove();
        onInput({
          t: "button",
          ...p,
          button: BUTTONS[e.button] ?? "left",
          down: false,
          clicks: Math.min(3, Math.max(1, e.detail)),
          mods: modsFrom(e),
        });
      }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.key === "Process" || e.key === "Dead" || e.key === "Unidentified") return;
        e.preventDefault();
        e.stopPropagation();
        held.current.add(`${e.key}\u0000${e.code}`);
        onInput({ t: "key", phase: "down", key: e.key.slice(0, 24), code: e.code.slice(0, 24), mods: modsFrom(e) });
      }}
      onKeyUp={(e) => {
        if (e.key === "Process" || e.key === "Dead" || e.key === "Unidentified") return;
        e.preventDefault();
        e.stopPropagation();
        held.current.delete(`${e.key}\u0000${e.code}`);
        onInput({ t: "key", phase: "up", key: e.key.slice(0, 24), code: e.code.slice(0, 24), mods: modsFrom(e) });
      }}
    >
      {box && (
        <div
          className="pointer-events-none absolute rounded-sm ring-2 ring-coral/70"
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
          aria-hidden
        />
      )}
      {cursor && box && (
        <div
          className="pointer-events-none absolute"
          style={{ left: box.left + cursor.x * box.width, top: box.top + cursor.y * box.height }}
          aria-hidden
        >
          <svg width="20" height="20" viewBox="0 0 24 24" className="drop-shadow">
            <path d="M3 2l7 19 2.5-7.5L20 11z" fill="var(--duo-coral)" stroke="var(--duo-ink-0)" strokeWidth="1.5" />
          </svg>
          <span className="absolute top-4 left-4 rounded-full bg-coral px-2 py-0.5 text-[0.7rem] font-bold whitespace-nowrap text-ink-0">
            You
          </span>
        </div>
      )}
      {!focused && (
        <span className="pointer-events-none absolute bottom-16 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur">
          Click the screen to start controlling
        </span>
      )}
    </div>
  );
}

function clamp(n: number) {
  return Math.max(-2000, Math.min(2000, Math.round(n)));
}
