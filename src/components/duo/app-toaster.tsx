"use client";

import { Toaster } from "@/components/ui/sonner";
import { useDock } from "@/features/chat/dock-store";

/**
 * Toasts sit at the top, clear of the "Remote control active" banner. On phones the chat takes the
 * whole screen when open, so toasts drop below its header and tabs instead of covering them.
 */
export function AppToaster() {
  const { open } = useDock();
  return <Toaster position="top-center" offset={{ top: 64 }} mobileOffset={{ top: open ? 116 : 16 }} />;
}
