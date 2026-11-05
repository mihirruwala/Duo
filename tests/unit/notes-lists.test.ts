import { describe, expect, it } from "vitest";
import { pickMimeType, toWaveform } from "@/features/chat/use-note-recorder";
import { sortItems } from "@/features/lists/lists";
import { formatDuration } from "@/shared/chat";
import type { ListItemRow } from "@/shared/database";

describe("voice notes", () => {
  it("formats durations", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(7400)).toBe("0:07");
    expect(formatDuration(65_000)).toBe("1:05");
  });

  it("builds a fixed-size waveform scaled to the loudest bar", () => {
    const w = toWaveform(
      Array.from({ length: 200 }, (_, i) => (i % 50) / 50),
      48,
    );
    expect(w).toHaveLength(48);
    expect(Math.max(...w)).toBe(100);
    expect(w.every((v) => Number.isInteger(v) && v >= 0 && v <= 100)).toBe(true);
    expect(toWaveform([])).toEqual([]);
    expect(toWaveform([0.2, 0.4], 48)).toHaveLength(48);
  });

  it("picks a recording format DUO accepts", () => {
    expect(pickMimeType("voice", (t) => t === "audio/webm;codecs=opus")).toBe("audio/webm;codecs=opus");
    expect(pickMimeType("voice", (t) => t === "audio/mp4")).toBe("audio/mp4"); // Safari
    expect(pickMimeType("video", (t) => t.startsWith("video/webm"))).toBe("video/webm;codecs=vp9,opus");
    expect(pickMimeType("voice", () => false)).toBeNull();
  });
});

describe("shared list order", () => {
  const item = (id: string, created: string, done = false, doneAt: string | null = null): ListItemRow => ({
    id,
    list_id: "l",
    room_id: "r",
    body: id,
    done,
    done_by: null,
    done_at: doneAt,
    created_by: null,
    created_at: created,
    updated_at: created,
  });

  it("open items oldest first, then done items most recently done first", () => {
    const sorted = sortItems([
      item("d-old", "2026-01-01", true, "2026-02-01"),
      item("b", "2026-01-03"),
      item("d-new", "2026-01-02", true, "2026-03-01"),
      item("a", "2026-01-02"),
    ]);
    expect(sorted.map((i) => i.id)).toEqual(["a", "b", "d-new", "d-old"]);
  });
});
