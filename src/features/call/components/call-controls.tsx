"use client";

import { MonitorUp, MonitorX, Mic, MicOff, MousePointerClick, PhoneOff, Video, VideoOff } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { DeviceMenu } from "./device-menu";

type Tone = "neutral" | "off" | "accent" | "leave";

type ControlProps = {
  label: string;
  shortcut?: string;
  tone: Tone;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
};

function Control({ label, shortcut, tone, pressed, disabled, onClick, children }: ControlProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={pressed}
          aria-keyshortcuts={shortcut}
          disabled={disabled}
          onClick={onClick}
          className={cn(
            "grid size-12 place-items-center rounded-2xl transition-[background-color,transform] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:size-5",
            {
              neutral: "bg-ink-3 text-foreground hover:bg-ink-4",
              off: "bg-danger/90 text-ink-0 hover:bg-danger",
              accent: "bg-coral text-ink-0 hover:bg-coral-strong",
              leave: "w-16 bg-danger text-ink-0 hover:brightness-110",
            }[tone],
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {label}
        {shortcut && (
          <kbd className="ml-2 font-mono text-xs opacity-70">{shortcut.replace("Meta", "⌘").replace("Control", "Ctrl")}</kbd>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

export function CallControls({
  micOn,
  camOn,
  sharing,
  shareBlockedBy,
  canShare,
  modKey,
  onToggleMic,
  onToggleCam,
  onToggleShare,
  onShareControllable,
  onLeave,
}: {
  micOn: boolean;
  camOn: boolean;
  sharing: boolean;
  shareBlockedBy: string | null;
  canShare: boolean;
  modKey: "Meta" | "Control";
  onToggleMic: () => void;
  onToggleCam: () => void;
  onToggleShare: () => void;
  /** Present when remote control is available: share a tab through the DUO extension. */
  onShareControllable?: () => void;
  onLeave: () => void;
}) {
  return (
    <nav aria-label="Call controls" className="glass flex items-center gap-2 rounded-3xl p-2 shadow-2xl">
      <span className="flex items-center">
        <Control
          label={micOn ? "Mute" : "Unmute"}
          shortcut={`${modKey}+D`}
          tone={micOn ? "neutral" : "off"}
          onClick={onToggleMic}
        >
          {micOn ? <Mic /> : <MicOff />}
        </Control>
        <DeviceMenu kind="audio" />
      </span>
      <span className="flex items-center">
        <Control
          label={camOn ? "Turn camera off" : "Turn camera on"}
          shortcut={`${modKey}+E`}
          tone={camOn ? "neutral" : "off"}
          onClick={onToggleCam}
        >
          {camOn ? <Video /> : <VideoOff />}
        </Control>
        <DeviceMenu kind="video" />
      </span>
      {canShare &&
        (sharing || shareBlockedBy || !onShareControllable ? (
          <Control
            label={shareBlockedBy ? `${shareBlockedBy} is sharing` : sharing ? "Stop sharing" : "Share screen"}
            tone={sharing ? "accent" : "neutral"}
            pressed={sharing}
            disabled={!!shareBlockedBy}
            onClick={onToggleShare}
          >
            {sharing ? <MonitorX /> : <MonitorUp />}
          </Control>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Share screen"
              className="grid size-12 place-items-center rounded-2xl bg-ink-3 text-foreground transition-colors hover:bg-ink-4 [&_svg]:size-5"
            >
              <MonitorUp />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="center" className="w-80">
              <DropdownMenuItem onSelect={onToggleShare} className="items-start gap-3 py-2.5">
                <MonitorUp className="mt-0.5" />
                <span>
                  <span className="block font-semibold">Share screen, window or tab</span>
                  <span className="block text-xs text-muted-foreground">They can watch, not control.</span>
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onShareControllable} className="items-start gap-3 py-2.5">
                <MousePointerClick className="mt-0.5 text-coral" />
                <span>
                  <span className="block font-semibold">Share a tab they can control</span>
                  <span className="block text-xs text-muted-foreground">
                    Uses the DUO Control extension. You approve every session.
                  </span>
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ))}
      <span className="mx-1 h-8 w-px bg-white/10" aria-hidden />
      <Control label="Leave call" tone="leave" onClick={onLeave}>
        <PhoneOff />
      </Control>
    </nav>
  );
}
