"use client";

import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** Native <select> (best keyboard + screen-reader support), styled to match DUO. */
export function DeviceSelect({
  id,
  label,
  devices,
  value,
  onChange,
  disabled,
  className,
}: {
  id: string;
  label: string;
  devices: MediaDeviceInfo[];
  value: string | undefined;
  onChange: (deviceId: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const selected = value && devices.some((d) => d.deviceId === value) ? value : (devices[0]?.deviceId ?? "");
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          value={selected}
          disabled={disabled || devices.length === 0}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 w-full appearance-none truncate rounded-xl border border-input bg-ink-1/70 pr-9 pl-3.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
        >
          {devices.length === 0 && <option value="">No devices found</option>}
          {devices.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `${label} ${i + 1}`}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
      </div>
    </div>
  );
}
