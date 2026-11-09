"use client";

import { useEffect, useSyncExternalStore } from "react";
import { extensionId } from "@/shared/extension-id";
import { extensionToPageSchema, PROTOCOL_VERSION, type ExtensionToPage, type PageToExtension } from "@/shared/control";

/**
 * One shared connection from this DUO tab to the DUO Control extension.
 * Chrome only exposes `chrome.runtime.connect` here because the extension lists DUO's
 * origin in `externally_connectable`; the extension re-checks the origin on its side.
 */
export type BridgeStatus = "checking" | "missing" | "connected";

type Listener = (msg: ExtensionToPage) => void;

let port: chrome.runtime.Port | null = null;
let status: BridgeStatus = "checking";
let shortcut = "";
let features: readonly string[] = [];
const statusListeners = new Set<() => void>();
const messageListeners = new Set<Listener>();
let helloTimer: ReturnType<typeof setTimeout> | undefined;

function setStatus(next: BridgeStatus) {
  if (status === next) return;
  status = next;
  statusListeners.forEach((l) => l());
}

type ChromeLike = { runtime?: { connect?: (id: string, info?: { name?: string }) => chrome.runtime.Port } };

function connect() {
  if (port) return;
  const runtime = (globalThis as { chrome?: ChromeLike }).chrome?.runtime;
  if (!runtime?.connect) return setStatus("missing");
  try {
    port = runtime.connect(extensionId(), { name: "duo" });
  } catch {
    port = null;
    return setStatus("missing");
  }
  port.onMessage.addListener((raw: unknown) => {
    const parsed = extensionToPageSchema.safeParse(raw);
    if (!parsed.success) return;
    const msg = parsed.data;
    if (msg.type === "hello.ok") {
      clearTimeout(helloTimer);
      shortcut = msg.shortcut;
      features = msg.features ?? [];
      setStatus("connected");
    }
    messageListeners.forEach((l) => l(msg));
  });
  port.onDisconnect.addListener(() => {
    port = null;
    clearTimeout(helloTimer);
    setStatus("missing");
  });
  port.postMessage({ type: "hello", version: PROTOCOL_VERSION } satisfies PageToExtension);
  helloTimer = setTimeout(() => status !== "connected" && setStatus("missing"), 1500);
}

export function sendToExtension(msg: PageToExtension): boolean {
  if (!port || status !== "connected") return false;
  port.postMessage(msg);
  return true;
}

/** Re-check (e.g. after the person installs the extension). */
export function retryExtension() {
  port?.disconnect();
  port = null;
  setStatus("checking");
  connect();
}

/** Whether the installed extension supports something newer than 1.0 (e.g. "sync"). */
export function extensionHas(feature: string): boolean {
  return status === "connected" && features.includes(feature);
}

export function emergencyShortcut(): string {
  return shortcut;
}

export function useExtensionStatus(): BridgeStatus {
  useEffect(() => connect(), []);
  return useSyncExternalStore(
    (cb) => {
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
    () => status,
    () => "checking" as const,
  );
}

export function onExtensionMessage(listener: Listener): () => void {
  messageListeners.add(listener);
  return () => messageListeners.delete(listener);
}
