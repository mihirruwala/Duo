"use client";

import {
  Camera,
  Clapperboard,
  Ellipsis,
  MessageCircle,
  MonitorUp,
  MonitorX,
  Mic,
  MicOff,
  MousePointerClick,
  PhoneOff,
  Popcorn,
  SmilePlus,
  Sofa,
  SwitchCamera,
  Sparkles,
  Video,
  VideoOff,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CALL_REACTIONS } from "@/shared/fun";
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
            "grid size-11 place-items-center rounded-2xl transition-[background-color,transform] active:scale-95 sm:size-12 disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:size-5",
            {
              neutral: "bg-ink-3 text-foreground hover:bg-ink-4",
              off: "bg-danger/90 text-ink-0 hover:bg-danger",
              accent: "bg-coral text-ink-0 hover:bg-coral-strong",
              leave: "w-14 bg-danger sm:w-16 text-ink-0 hover:brightness-110",
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
  onShareWatch,
  onOpenStudio,
  effectsOn,
  effectsPaused,
  hangout,
  onToggleHangout,
  onFlipCamera,
  onReact,
  onPhotoBooth,
  onWatch,
  watching,
  watchBlockedBy,
  chat,
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
  /** Share a tab playing a show: smooth video with its sound. */
  onShareWatch?: () => void;
  /** Present when DUO Studio is available. */
  onOpenStudio?: () => void;
  effectsOn?: boolean;
  /** Hang-out mode pauses effects; the button explains why it's off. */
  effectsPaused?: boolean;
  hangout?: boolean;
  /** Toggle hang-out mode: a light, open line for hours. */
  onToggleHangout?: () => void;
  /** Phones: front ↔ back camera (in the More menu). */
  onFlipCamera?: () => void;
  onReact?: (emoji: (typeof CALL_REACTIONS)[number]) => void;
  onPhotoBooth?: () => void;
  /** Start (or, while watching, change) Watch Together. */
  onWatch?: () => void;
  watching?: boolean;
  /** Set while a screen share is on: why Watch Together can't start. */
  watchBlockedBy?: string | null;
  /** The chat lives beside the call; this opens and closes it, and shows what's unread. */
  chat?: { open: boolean; unread: number; onToggle: () => void };
  onLeave: () => void;
}) {
  const watchLabel = watchBlockedBy ?? (watching ? "Change video" : "Watch together");
  return (
    <nav
      aria-label="Call controls"
      className="glass flex max-w-full items-center gap-1.5 rounded-3xl p-1.5 shadow-2xl sm:gap-2 sm:p-2"
    >
      <span className="flex items-center">
        <Control
          label={micOn ? "Mute" : "Unmute"}
          shortcut={`${modKey}+D`}
          tone={micOn ? "neutral" : "off"}
          onClick={onToggleMic}
        >
          {micOn ? <Mic /> : <MicOff />}
        </Control>
        <span className="max-sm:hidden">
          <DeviceMenu kind="audio" />
        </span>
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
        <span className="max-sm:hidden">
          <DeviceMenu kind="video" />
        </span>
      </span>
      {canShare &&
        (sharing || shareBlockedBy || (!onShareControllable && !onShareWatch) ? (
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
              className="grid size-11 place-items-center rounded-2xl bg-ink-3 text-foreground transition-colors hover:bg-ink-4 sm:size-12 [&_svg]:size-5"
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
              {onShareWatch && (
                <DropdownMenuItem onSelect={onShareWatch} className="items-start gap-3 py-2.5">
                  <Popcorn className="mt-0.5 text-coral" />
                  <span>
                    <span className="block font-semibold">Watch mode: share a show</span>
                    <span className="block text-xs text-muted-foreground">
                      Smooth video with sound, for a tab playing a show or film.
                    </span>
                  </span>
                </DropdownMenuItem>
              )}
              {onShareControllable && (
                <DropdownMenuItem onSelect={onShareControllable} className="items-start gap-3 py-2.5">
                  <MousePointerClick className="mt-0.5 text-coral" />
                  <span>
                    <span className="block font-semibold">Share a tab they can control</span>
                    <span className="block text-xs text-muted-foreground">
                      Uses the DUO Control extension. You approve every session.
                    </span>
                  </span>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ))}
      <span className="flex items-center gap-2 max-sm:hidden">
        {onWatch && (
          <Control
            label={watchLabel}
            tone={watching ? "accent" : "neutral"}
            pressed={watching}
            disabled={!!watchBlockedBy}
            onClick={onWatch}
          >
            <Clapperboard />
          </Control>
        )}
        {onOpenStudio && (
          <Control
            label={effectsPaused ? "Effects are paused in hang-out mode" : "Effects"}
            tone={effectsOn ? "accent" : "neutral"}
            pressed={effectsOn}
            disabled={effectsPaused}
            onClick={onOpenStudio}
          >
            <Sparkles />
          </Control>
        )}
        {onToggleHangout && (
          <Control
            label={hangout ? "Turn off hang-out mode" : "Hang-out mode"}
            tone={hangout ? "accent" : "neutral"}
            pressed={hangout}
            onClick={onToggleHangout}
          >
            <Sofa />
          </Control>
        )}
        {onReact && (
          <Popover>
            <PopoverTrigger
              aria-label="Send a reaction"
              className="grid size-11 place-items-center rounded-2xl bg-ink-3 text-foreground transition-colors hover:bg-ink-4 sm:size-12 [&_svg]:size-5"
            >
              <SmilePlus />
            </PopoverTrigger>
            <PopoverContent side="top" className="flex w-auto gap-1 rounded-2xl p-1.5">
              {CALL_REACTIONS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => onReact(e)}
                  aria-label={`React ${e}`}
                  className="grid size-11 place-items-center rounded-xl text-2xl transition-transform hover:scale-125 hover:bg-ink-3"
                >
                  {e}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        )}
        {onPhotoBooth && (
          <Control label="Photo booth" tone="neutral" onClick={onPhotoBooth}>
            <Camera />
          </Control>
        )}
      </span>
      {(onOpenStudio || onReact || onPhotoBooth || onWatch || onToggleHangout) && (
        <span className="sm:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="More"
              className="grid size-11 place-items-center rounded-2xl bg-ink-3 text-foreground transition-colors hover:bg-ink-4 [&_svg]:size-5"
            >
              <Ellipsis />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" className="w-64">
              {onReact && (
                <div className="flex justify-between px-1 py-1" role="group" aria-label="Reactions">
                  {CALL_REACTIONS.map((e) => (
                    <DropdownMenuItem
                      key={e}
                      onSelect={() => onReact(e)}
                      aria-label={`React ${e}`}
                      className="justify-center p-1.5 text-2xl"
                    >
                      {e}
                    </DropdownMenuItem>
                  ))}
                </div>
              )}
              {onWatch && (
                <DropdownMenuItem onSelect={onWatch} disabled={!!watchBlockedBy}>
                  <Clapperboard /> {watchLabel}
                </DropdownMenuItem>
              )}
              {onOpenStudio && (
                <DropdownMenuItem onSelect={onOpenStudio} disabled={effectsPaused}>
                  <Sparkles /> Effects{effectsPaused ? " (paused)" : effectsOn ? " (on)" : ""}
                </DropdownMenuItem>
              )}
              {onFlipCamera && (
                <DropdownMenuItem onSelect={onFlipCamera}>
                  <SwitchCamera /> Switch camera
                </DropdownMenuItem>
              )}
              {onToggleHangout && (
                <DropdownMenuItem onSelect={onToggleHangout}>
                  <Sofa /> {hangout ? "Turn off hang-out mode" : "Hang-out mode"}
                </DropdownMenuItem>
              )}
              {onPhotoBooth && (
                <DropdownMenuItem onSelect={onPhotoBooth}>
                  <Camera /> Photo booth
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      )}
      {chat && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={chat.onToggle}
              aria-pressed={chat.open}
              aria-label={chat.unread && !chat.open ? `Chat, ${chat.unread} unread` : chat.open ? "Close chat" : "Chat"}
              data-testid="chat-launcher"
              className={cn(
                "relative grid size-11 place-items-center rounded-2xl transition-[background-color,transform] active:scale-95 sm:size-12 [&_svg]:size-5",
                chat.open ? "bg-cream text-ink-0" : "bg-ink-3 text-foreground hover:bg-ink-4",
              )}
            >
              <MessageCircle />
              {chat.unread > 0 && !chat.open && (
                <span
                  className="absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-coral px-1 text-[0.7rem] font-bold text-ink-0 ring-2 ring-ink-1"
                  data-testid="unread-badge"
                >
                  {chat.unread > 99 ? "99+" : chat.unread}
                </span>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{chat.open ? "Close chat" : "Chat"}</TooltipContent>
        </Tooltip>
      )}
      <span className="mx-1 h-8 w-px bg-white/10" aria-hidden />
      <Control label="Leave call" tone="leave" onClick={onLeave}>
        <PhoneOff />
      </Control>
    </nav>
  );
}
