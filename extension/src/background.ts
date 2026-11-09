/**
 * DUO Control: service worker.
 *
 * Trust chain: only the DUO web origin(s) baked into the manifest can connect (Chrome enforces
 * `externally_connectable`, and we re-check the port's origin). The owner's DUO page forwards input
 * only after the owner approved; this worker validates every message again and injects it, via the
 * Chrome DevTools Protocol, into exactly one tab: the one the owner explicitly shared from this
 * extension's popup. Anything unexpected ends the session.
 */
import {
  EMERGENCY_SHORTCUT,
  extensionToPageSchema,
  isControllableUrl,
  isKeyAllowed,
  macEditingCommand,
  MAX_SESSION_MS,
  pageToExtensionSchema,
  printable,
  PROTOCOL_VERSION,
  TokenBucket,
  toViewport,
  virtualKeyCode,
  type ExtensionToPage,
  type InputEvent,
} from "../../src/shared/control";
import { cleanTitle, seekNeedsPlayerApi, type TabInfo } from "../../src/shared/tab-sync";
import { OVERLAY_SOURCE } from "./overlay";

declare const __DUO_ORIGINS__: string[];
declare const __DUO_E2E__: boolean;

const DUO_ORIGINS: readonly string[] = __DUO_ORIGINS__;
const IS_MAC = /Mac/.test(navigator.userAgent);
const BUTTON_BITS = { left: 1, right: 2, middle: 4 } as const;

type Session = {
  id: string;
  controllerName: string;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
  lastSeq: number;
  bucket: TokenBucket;
  buttons: number;
  viewport: { width: number; height: number; at: number } | null;
  worldId: number | null;
};

const state: {
  port: chrome.runtime.Port | null;
  duoTabId: number | null;
  targetTabId: number | null;
  targetTitle: string;
  session: Session | null;
  /** Sync a show: the one tab whose video is kept in step with the other person's. */
  sync: { tabId: number; tab: TabInfo } | null;
  /** DUO asked for a tab to sync; the popup leads with that button. */
  syncArmed: boolean;
} = { port: null, duoTabId: null, targetTabId: null, targetTitle: "", session: null, sync: null, syncArmed: false };

// ── Messaging with the DUO page ─────────────────────────────────────────────

function post(msg: ExtensionToPage) {
  // Validate our own output too: the page relies on this shape.
  if (state.port && extensionToPageSchema.safeParse(msg).success) state.port.postMessage(msg);
}

function originAllowed(origin: string | undefined) {
  return !!origin && DUO_ORIGINS.includes(origin);
}

chrome.runtime.onConnectExternal.addListener((port) => {
  const origin = port.sender?.origin;
  const tabId = port.sender?.tab?.id;
  if (!originAllowed(origin) || tabId === undefined) {
    port.disconnect();
    return;
  }
  // One DUO tab at a time; a new one takes over and anything in flight is torn down.
  if (state.port && state.port !== port) {
    clearShare("extension_disconnected");
    state.port.disconnect();
  }
  state.port = port;
  state.duoTabId = tabId;
  port.onMessage.addListener((raw: unknown) => void onPageMessage(raw));
  port.onDisconnect.addListener(() => {
    if (state.port !== port) return;
    // Fail safe: if the DUO page goes away (closed, reloaded, crashed) control ends immediately.
    clearShare("extension_disconnected");
    stopSync("extension_disconnected");
    state.port = null;
    state.duoTabId = null;
    void updateBadge();
  });
});

async function onPageMessage(raw: unknown) {
  const parsed = pageToExtensionSchema.safeParse(raw);
  if (!parsed.success) return; // Unknown or malformed: ignore.
  const msg = parsed.data;
  switch (msg.type) {
    case "hello":
      post({ type: "hello.ok", version: PROTOCOL_VERSION, shortcut: await shortcutLabel(), features: ["sync"] });
      // A reloaded DUO page picks up a sync that's still running.
      if (state.sync) post({ type: "sync.linked", tab: state.sync.tab });
      return;
    case "sync.arm":
      state.syncArmed = true;
      return;
    case "sync.remote":
      if (state.sync) await toContent({ type: "content.remote", state: msg.state });
      return;
    case "sync.snapshot": {
      if (!state.sync) return;
      const snap = (await toContent({ type: "content.snapshot" })) as { at: number; playing: boolean } | null | undefined;
      if (snap && Number.isFinite(snap.at))
        post({ type: "sync.local", state: { at: Math.max(0, snap.at), playing: !!snap.playing } });
      return;
    }
    case "sync.stop":
      stopSync("stopped");
      return;
    case "sync.query":
      if (state.sync) post({ type: "sync.linked", tab: state.sync.tab });
      return;
    case "control.start":
      return startSession(msg.sessionId, msg.controllerName, msg.expiresAt);
    case "control.stop":
      if (state.session?.id === msg.sessionId) await endSession(msg.reason || "owner_revoked");
      return;
    case "input":
      return onInput(msg.sessionId, msg.seq, msg.e);
    case "share.stopped":
      return clearShare("share_stopped");
    case "approval.request":
      chrome.notifications.create(`approve:${msg.sessionId}`, {
        type: "basic",
        iconUrl: "icons/128.png",
        title: "Remote control request",
        message: `${msg.controllerName} wants to control your shared tab.`,
        buttons: [{ title: "Approve" }, { title: "Deny" }],
        requireInteraction: true,
        priority: 2,
      });
      return;
    case "approval.dismiss":
      chrome.notifications.clear(`approve:${msg.sessionId}`);
      return;
  }
}

chrome.notifications.onButtonClicked.addListener((id, index) => {
  if (!id.startsWith("approve:")) return;
  chrome.notifications.clear(id);
  post({ type: "approval.response", sessionId: id.slice("approve:".length), approved: index === 0 });
});

// ── Sharing a tab (popup) ───────────────────────────────────────────────────

async function targetUrl(tabId: number): Promise<{ url: string | undefined; title: string }> {
  const targets = await chrome.debugger.getTargets();
  const t = targets.find((x) => x.tabId === tabId && x.type === "page");
  return { url: t?.url, title: t?.title ?? "" };
}

async function shareTab(tabId: number): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!state.port || state.duoTabId === null) return { ok: false, message: "Open your DUO call first, then try again." };
  if (tabId === state.duoTabId) return { ok: false, message: "Pick the tab you want to share, not the DUO tab." };
  const { url, title } = await targetUrl(tabId);
  const policy = isControllableUrl(url, DUO_ORIGINS);
  if (!policy.ok)
    return {
      ok: false,
      message: "This kind of page can't be shared for control (browser, extension and DUO pages are off-limits).",
    };
  if (state.session) await endSession("superseded");
  try {
    // Requires the activeTab grant from this popup click: the user picked exactly this tab.
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId, consumerTabId: state.duoTabId });
    state.targetTabId = tabId;
    state.targetTitle = title;
    post({ type: "share.ready", streamId, tabTitle: title.slice(0, 200) });
    await updateBadge();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: `Chrome refused to capture this tab: ${(err as Error).message}` };
  }
}

function clearShare(reason: string) {
  void endSession(reason);
  if (state.targetTabId !== null) {
    state.targetTabId = null;
    state.targetTitle = "";
    post({ type: "share.cleared", reason });
  }
  void updateBadge();
}

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === state.targetTabId) clearShare("tab_closed");
  if (tabId === state.sync?.tabId) stopSync("tab_closed");
});

// ── Sync a show ─────────────────────────────────────────────────────────────

async function toContent(msg: object): Promise<unknown> {
  if (!state.sync) return undefined;
  try {
    return await chrome.tabs.sendMessage(state.sync.tabId, msg);
  } catch {
    return undefined; // the page reloaded and the script is gone; the onUpdated check notices
  }
}

/** Runs in the page itself (Netflix only): seek through Netflix's own player, which survives it. */
function installNetflixSeek() {
  const w = window as unknown as { __duoNetflixSeek?: boolean; netflix?: unknown };
  if (w.__duoNetflixSeek) return;
  w.__duoNetflixSeek = true;
  window.addEventListener("message", (e: MessageEvent) => {
    if (e.source !== window || (e.data as { __duo?: string })?.__duo !== "seek") return;
    const ms = Number((e.data as { ms?: number }).ms);
    if (!Number.isFinite(ms) || ms < 0) return;
    try {
      type Api = {
        videoPlayer: { getAllPlayerSessionIds(): string[]; getVideoPlayerBySessionId(id: string): { seek(ms: number): void } };
      };
      const app = (w.netflix as { appContext: { state: { playerApp: { getAPI(): Api } } } }).appContext.state.playerApp;
      const vp = app.getAPI().videoPlayer;
      const id = vp.getAllPlayerSessionIds().find((x) => x.startsWith("watch")) ?? vp.getAllPlayerSessionIds()[0];
      if (id) vp.getVideoPlayerBySessionId(id).seek(Math.round(ms));
    } catch {
      // Netflix changed its player; seeking just won't sync.
    }
  });
}

async function syncTab(
  tabId: number,
  url: string | undefined,
  title: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!state.port || state.duoTabId === null) return { ok: false, message: "Open your DUO call first, then try again." };
  if (tabId === state.duoTabId) return { ok: false, message: "Pick the tab playing the show, not the DUO tab." };
  if (!isControllableUrl(url, DUO_ORIGINS).ok)
    return { ok: false, message: "This kind of page can't be synced (browser, extension and DUO pages are off-limits)." };
  const host = new URL(url!).hostname;
  if (state.sync && state.sync.tabId !== tabId) stopSync("superseded");
  try {
    // Needs the activeTab grant from the popup click: the person picked exactly this tab.
    if (seekNeedsPlayerApi(host))
      await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: installNetflixSeek });
    await chrome.scripting.executeScript({ target: { tabId }, files: ["sync-content.js"] });
  } catch (err) {
    return { ok: false, message: `Chrome didn't allow DUO on this tab: ${(err as Error).message}` };
  }
  state.sync = { tabId, tab: { title: cleanTitle(title), host } };
  state.syncArmed = false;
  post({ type: "sync.linked", tab: state.sync.tab });
  await updateBadge();
  return { ok: true };
}

function stopSync(reason: string) {
  if (!state.sync) return;
  void toContent({ type: "content.stop" });
  state.sync = null;
  post({ type: "sync.unlinked", reason });
  void updateBadge();
}

// A full page load wipes the injected script (a single-page app's own navigation doesn't).
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (tabId !== state.sync?.tabId || info.status !== "complete") return;
  void toContent({ type: "content.ping" }).then((r) => {
    if (!r && tabId === state.sync?.tabId) stopSync("tab_reloaded");
  });
});

// ── Control sessions ────────────────────────────────────────────────────────

const debuggee = (): chrome.debugger.Debuggee => ({ tabId: state.targetTabId! });
const cdp = <T = unknown>(method: string, params?: object) =>
  chrome.debugger.sendCommand(debuggee(), method, params) as Promise<T>;

async function startSession(sessionId: string, controllerName: string, requestedExpiry: number) {
  const fail = (message: string) => post({ type: "control.error", sessionId, message });
  if (state.targetTabId === null) return fail("Share a tab from the DUO extension first.");
  if (state.session) {
    if (state.session.id === sessionId) return post({ type: "control.started", sessionId });
    await endSession("superseded");
  }
  const { url } = await targetUrl(state.targetTabId);
  if (!isControllableUrl(url, DUO_ORIGINS).ok) return fail("The shared tab is on a page that can't be controlled.");

  const expiresAt = Math.min(requestedExpiry, Date.now() + MAX_SESSION_MS);
  if (expiresAt <= Date.now()) return fail("That approval has already expired.");

  try {
    await chrome.debugger.attach(debuggee(), "1.3");
  } catch (err) {
    return fail(`Couldn't attach to the tab: ${(err as Error).message}`);
  }
  state.session = {
    id: sessionId,
    controllerName,
    expiresAt,
    timer: setTimeout(() => void endSession("expired"), expiresAt - Date.now()),
    lastSeq: -1,
    bucket: new TokenBucket(),
    buttons: 0,
    viewport: null,
    worldId: null,
  };
  try {
    await cdp("Page.enable");
    await injectOverlay();
  } catch (err) {
    // The overlay is an extra indicator; the badge, Chrome's debugging bar and the DUO page still show control.
    console.warn("DUO Control: overlay injection failed", (err as Error).message);
  }
  await updateBadge();
  post({ type: "control.started", sessionId });
}

async function endSession(reason: string) {
  const s = state.session;
  if (!s) return;
  state.session = null;
  clearTimeout(s.timer);
  if (state.targetTabId !== null) {
    if (s.worldId !== null) {
      await cdp("Runtime.evaluate", { contextId: s.worldId, expression: "window.__duoRemove && window.__duoRemove()" }).catch(
        () => undefined,
      );
    }
    await chrome.debugger.detach(debuggee()).catch(() => undefined);
  }
  chrome.notifications.clear(`approve:${s.id}`);
  post({ type: "control.ended", sessionId: s.id, reason });
  await updateBadge();
}

chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId !== state.targetTabId || !state.session) return;
  // Nothing to detach any more; just end.
  const s = state.session;
  state.session = null;
  clearTimeout(s.timer);
  post({ type: "control.ended", sessionId: s.id, reason: reason === "canceled_by_user" ? "debugger_detached" : "tab_closed" });
  void updateBadge();
});

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (source.tabId !== state.targetTabId || !state.session) return;
  if (method === "Page.frameNavigated") {
    const frame = (params as { frame?: { parentId?: string; url?: string } }).frame;
    if (frame && !frame.parentId) {
      if (!isControllableUrl(frame.url, DUO_ORIGINS).ok) void endSession("blocked_url");
      else {
        state.session.viewport = null;
        state.session.worldId = null;
      }
    }
  } else if (method === "Page.loadEventFired" || method === "Page.domContentEventFired") {
    void injectOverlay().catch(() => undefined);
  }
});

/** Indicator on the controlled tab itself: coral frame, a banner with the stop shortcut, and the controller's cursor. */
async function injectOverlay() {
  const s = state.session;
  if (!s) return;
  const tree = await cdp<{ frameTree: { frame: { id: string } } }>("Page.getFrameTree");
  const { executionContextId } = await cdp<{ executionContextId: number }>("Page.createIsolatedWorld", {
    frameId: tree.frameTree.frame.id,
    worldName: "duo-control",
  });
  s.worldId = executionContextId;
  const shortcut = await shortcutLabel();
  const res = await cdp<{ exceptionDetails?: { text?: string; exception?: { description?: string } } }>("Runtime.evaluate", {
    contextId: executionContextId,
    expression: `(${OVERLAY_SOURCE})(${JSON.stringify({ name: s.controllerName, shortcut })})`,
  });
  if (res.exceptionDetails) {
    throw new Error(`overlay: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text ?? "failed"}`);
  }
}

async function viewport(s: Session) {
  if (s.viewport && Date.now() - s.viewport.at < 1000) return s.viewport;
  if (s.worldId === null) await injectOverlay().catch(() => undefined);
  // Read from the isolated world so a page can't spoof its own size to misdirect clicks.
  const res = await cdp<{ result: { value?: [number, number] } }>("Runtime.evaluate", {
    contextId: s.worldId ?? undefined,
    expression: "[window.innerWidth, window.innerHeight]",
    returnByValue: true,
  });
  const [width, height] = res.result.value ?? [1280, 720];
  s.viewport = { width, height, at: Date.now() };
  return s.viewport;
}

async function onInput(sessionId: string, seq: number, e: InputEvent) {
  const s = state.session;
  if (!s || s.id !== sessionId) return;
  if (Date.now() >= s.expiresAt) return void endSession("expired");
  if (seq <= s.lastSeq) return; // replay / reorder
  s.lastSeq = seq;
  if (!s.bucket.take()) return;

  try {
    switch (e.t) {
      case "move":
      case "button":
      case "wheel": {
        const vp = await viewport(s);
        const { x, y } = toViewport(e, vp);
        if (s.worldId !== null) {
          void cdp("Runtime.evaluate", {
            contextId: s.worldId,
            expression: `window.__duoMove && window.__duoMove(${x},${y})`,
          }).catch(() => undefined);
        }
        if (e.t === "move") {
          await cdp("Input.dispatchMouseEvent", {
            type: "mouseMoved",
            x,
            y,
            buttons: s.buttons,
            button: pressedButton(s.buttons),
          });
        } else if (e.t === "button") {
          const bit = BUTTON_BITS[e.button];
          s.buttons = e.down ? s.buttons | bit : s.buttons & ~bit;
          await cdp("Input.dispatchMouseEvent", {
            type: e.down ? "mousePressed" : "mouseReleased",
            x,
            y,
            button: e.button,
            buttons: s.buttons,
            clickCount: e.clicks,
            modifiers: e.mods,
          });
        } else {
          await cdp("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: e.dx, deltaY: e.dy });
        }
        return;
      }
      case "key": {
        if (!isKeyAllowed(e.key, e.mods).ok) return;
        const vk = virtualKeyCode(e.key, e.code);
        if (e.phase === "up") {
          await cdp("Input.dispatchKeyEvent", {
            type: "keyUp",
            key: e.key,
            code: e.code,
            windowsVirtualKeyCode: vk,
            modifiers: e.mods,
          });
        } else if (printable(e.key, e.mods)) {
          const text = e.key === "Enter" ? "\r" : e.key;
          await cdp("Input.dispatchKeyEvent", {
            type: "keyDown",
            key: e.key,
            code: e.code,
            text,
            unmodifiedText: text,
            windowsVirtualKeyCode: vk,
            modifiers: e.mods,
          });
        } else {
          const command = IS_MAC ? macEditingCommand(e.key, e.mods) : undefined;
          await cdp("Input.dispatchKeyEvent", {
            type: "rawKeyDown",
            key: e.key,
            code: e.code,
            windowsVirtualKeyCode: vk,
            modifiers: e.mods,
            ...(command ? { commands: [command] } : {}),
          });
        }
        return;
      }
      case "nav": {
        if (e.action === "reload") return void (await cdp("Page.reload"));
        const h = await cdp<{ currentIndex: number; entries: { id: number }[] }>("Page.getNavigationHistory");
        const entry = h.entries[h.currentIndex + (e.action === "back" ? -1 : 1)];
        if (entry) await cdp("Page.navigateToHistoryEntry", { entryId: entry.id });
        return;
      }
    }
  } catch {
    // The tab went away or detached mid-command; onDetach / onRemoved will end the session.
  }
}

function pressedButton(bits: number) {
  if (bits & 1) return "left";
  if (bits & 2) return "right";
  if (bits & 4) return "middle";
  return "none";
}

// ── Emergency stop + UI state ───────────────────────────────────────────────

async function emergencyStop() {
  if (state.session) {
    await endSession("emergency_stop");
    post({ type: "emergency.stop" });
  }
}

chrome.commands.onCommand.addListener((command) => {
  if (command === "emergency-stop") void emergencyStop();
});

async function shortcutLabel(): Promise<string> {
  const all = await chrome.commands.getAll();
  const s = all.find((c) => c.name === "emergency-stop")?.shortcut;
  return s || (IS_MAC ? EMERGENCY_SHORTCUT.mac : EMERGENCY_SHORTCUT.other);
}

async function updateBadge() {
  if (state.session) {
    await chrome.action.setBadgeBackgroundColor({ color: "#ff5a5a" });
    await chrome.action.setBadgeText({ text: "CTRL" });
    await chrome.action.setTitle({ title: `DUO: ${state.session.controllerName} is controlling your shared tab` });
  } else if (state.targetTabId !== null) {
    await chrome.action.setBadgeBackgroundColor({ color: "#a593ff" });
    await chrome.action.setBadgeText({ text: "ON" });
    await chrome.action.setTitle({ title: "DUO: sharing a tab" });
  } else if (state.sync) {
    await chrome.action.setBadgeBackgroundColor({ color: "#5fd4b0" });
    await chrome.action.setBadgeText({ text: "SYNC" });
    await chrome.action.setTitle({ title: `DUO: syncing “${state.sync.tab.title || state.sync.tab.host}”` });
  } else {
    await chrome.action.setBadgeText({ text: "" });
    await chrome.action.setTitle({ title: "DUO Control" });
  }
}

// ── Popup (internal messages only) ──────────────────────────────────────────

export type PopupState = {
  connected: boolean;
  sharing: { tabId: number; title: string } | null;
  control: { controllerName: string; expiresAt: number } | null;
  shortcut: string;
  sync: { tabId: number; title: string } | null;
  syncArmed: boolean;
};

chrome.runtime.onMessage.addListener((msg: { type?: string; tabId?: number }, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  // The sync script, from exactly the tab it was injected into.
  if (sender.tab?.id !== undefined && sender.tab.id === state.sync?.tabId) {
    onContentMessage(msg);
    return;
  }
  // Otherwise only our own extension pages may talk to the worker this way.
  if (!sender.url?.startsWith(chrome.runtime.getURL(""))) return;
  void (async () => {
    switch (msg.type) {
      case "popup.state":
        reply({
          connected: !!state.port,
          sharing: state.targetTabId !== null ? { tabId: state.targetTabId, title: state.targetTitle } : null,
          control: state.session ? { controllerName: state.session.controllerName, expiresAt: state.session.expiresAt } : null,
          shortcut: await shortcutLabel(),
          sync: state.sync ? { tabId: state.sync.tabId, title: state.sync.tab.title || state.sync.tab.host } : null,
          syncArmed: state.syncArmed,
        } satisfies PopupState);
        return;
      case "popup.sync": {
        if (typeof msg.tabId !== "number") return reply({ ok: false, message: "No tab." });
        const tab = await chrome.tabs.get(msg.tabId).catch(() => undefined);
        reply(await syncTab(msg.tabId, tab?.url, tab?.title ?? ""));
        return;
      }
      case "popup.stopSync":
        stopSync("stopped");
        reply({ ok: true });
        return;
      case "popup.share":
        reply(typeof msg.tabId === "number" ? await shareTab(msg.tabId) : { ok: false, message: "No tab." });
        return;
      case "popup.stopShare":
        clearShare("share_stopped");
        reply({ ok: true });
        return;
      case "popup.revoke":
        await endSession("owner_revoked");
        reply({ ok: true });
        return;
    }
  })();
  return true;
});

function onContentMessage(raw: unknown) {
  const msg = raw as {
    type?: string;
    state?: { at?: unknown; playing?: unknown; hb?: unknown };
    video?: unknown;
    needsGesture?: unknown;
    title?: unknown;
  };
  if (msg.type === "content.local" && msg.state) {
    const at = Number(msg.state.at);
    if (!Number.isFinite(at)) return;
    post({
      type: "sync.local",
      state: { at: Math.max(0, at), playing: msg.state.playing === true, ...(msg.state.hb === true ? { hb: true } : {}) },
    });
  } else if (msg.type === "content.status") {
    post({ type: "sync.status", video: msg.video === true, needsGesture: msg.needsGesture === true });
  } else if (msg.type === "content.title" && typeof msg.title === "string" && state.sync) {
    const title = cleanTitle(msg.title);
    if (title === state.sync.tab.title) return;
    state.sync.tab = { ...state.sync.tab, title };
    post({ type: "sync.linked", tab: state.sync.tab });
    void updateBadge();
  }
}

// ── E2E-only hooks (compiled out of production builds) ──────────────────────

if (__DUO_E2E__) {
  chrome.runtime.onMessageExternal.addListener((msg, sender, reply) => {
    if (!originAllowed(sender.origin)) return;
    void handleTestHook(msg).then((handled) => reply({ handled }));
    return true;
  });
}

async function handleTestHook(raw: unknown): Promise<boolean> {
  if (!raw || typeof raw !== "object" || !("type" in raw)) return false;
  const m = raw as { type: string; urlPrefix?: string; command?: string };
  if (m.type === "test.bindTab" && m.urlPrefix) {
    // Stand-in for the popup click (tabCapture's activeTab grant can't be automated).
    const targets = await chrome.debugger.getTargets();
    const t = targets.find((x) => x.type === "page" && x.url.startsWith(m.urlPrefix!) && x.tabId !== undefined);
    if (!t?.tabId || !isControllableUrl(t.url, DUO_ORIGINS).ok) return true;
    state.targetTabId = t.tabId;
    state.targetTitle = t.title;
    post({ type: "share.ready", streamId: "e2e-stream", tabTitle: t.title });
    await updateBadge();
    return true;
  }
  if (m.type === "test.bindSyncTab" && m.urlPrefix) {
    // Stand-in for the popup's "Sync this tab" click (the E2E build has host access to the test site instead).
    const targets = await chrome.debugger.getTargets();
    const t = targets.find((x) => x.type === "page" && x.url.startsWith(m.urlPrefix!) && x.tabId !== undefined);
    if (t?.tabId) await syncTab(t.tabId, t.url, t.title);
    return true;
  }
  if (m.type === "test.command" && m.command === "emergency-stop") {
    await emergencyStop();
    return true;
  }
  return false;
}
