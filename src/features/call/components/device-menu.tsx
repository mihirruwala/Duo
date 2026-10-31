"use client";

import { useEffect, useState } from "react";
import { useRoomContext } from "@livekit/components-react";
import { Check, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { loadDevicePrefs, saveDevicePrefs } from "../device-prefs";

type Kind = "audioinput" | "videoinput" | "audiooutput";
const PREF_KEY = { audioinput: "micId", videoinput: "cameraId", audiooutput: "speakerId" } as const;

function useDevices(open: boolean) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const load = () =>
      void navigator.mediaDevices.enumerateDevices().then((list) => alive && setDevices(list.filter((d) => d.deviceId)));
    load();
    navigator.mediaDevices.addEventListener("devicechange", load);
    return () => {
      alive = false;
      navigator.mediaDevices.removeEventListener("devicechange", load);
    };
  }, [open]);
  return devices;
}

function DeviceGroup({ kind, title, devices }: { kind: Kind; title: string; devices: MediaDeviceInfo[] }) {
  const room = useRoomContext();
  const list = devices.filter((d) => d.kind === kind);
  if (list.length === 0) return null;
  const activeId = room.getActiveDevice(kind) ?? "default";

  return (
    <>
      <DropdownMenuLabel className="text-xs tracking-wide text-muted-foreground uppercase">{title}</DropdownMenuLabel>
      {list.map((d, i) => (
        <DropdownMenuItem
          key={d.deviceId}
          onSelect={async () => {
            try {
              await room.switchActiveDevice(kind, d.deviceId);
              saveDevicePrefs({ ...loadDevicePrefs(), [PREF_KEY[kind]]: d.deviceId });
            } catch {
              toast.error(`Couldn't switch ${title.toLowerCase()}.`);
            }
          }}
        >
          <Check className={d.deviceId === activeId ? "opacity-100" : "opacity-0"} aria-hidden />
          <span className="truncate">{d.label || `${title} ${i + 1}`}</span>
        </DropdownMenuItem>
      ))}
    </>
  );
}

/** Live device switching mid-call: LiveKit restarts the published track in place, no renegotiation. */
export function DeviceMenu({ kind }: { kind: "audio" | "video" }) {
  const [open, setOpen] = useState(false);
  const devices = useDevices(open);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        aria-label={kind === "audio" ? "Choose microphone and speaker" : "Choose camera"}
        className="-ml-1 grid h-12 w-6 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-ink-3 hover:text-foreground"
      >
        <ChevronUp className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="center" className="w-72">
        {kind === "audio" ? (
          <>
            <DeviceGroup kind="audioinput" title="Microphone" devices={devices} />
            <DropdownMenuSeparator />
            <DeviceGroup kind="audiooutput" title="Speaker" devices={devices} />
          </>
        ) : (
          <DeviceGroup kind="videoinput" title="Camera" devices={devices} />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
