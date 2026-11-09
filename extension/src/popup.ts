import type { PopupState } from "./background";

const app = document.getElementById("app")!;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

async function send<T>(msg: object): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}

async function render(error?: string) {
  const [state, [tab]] = await Promise.all([
    send<PopupState>({ type: "popup.state" }),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ]);
  document.getElementById("shortcut")!.textContent = state.shortcut;
  app.replaceChildren();

  if (state.control) {
    const left = Math.max(0, Math.round((state.control.expiresAt - Date.now()) / 60000));
    app.append(
      el(
        "div",
        { className: "card live" },
        el("p", {}, el("strong", { textContent: `${state.control.controllerName} is controlling` })),
        el("p", { className: "muted", textContent: `“${state.sharing?.title ?? "your tab"}” · ends in ${left} min` }),
      ),
      el("button", {
        className: "danger",
        textContent: "Revoke control now",
        onclick: async () => {
          await send({ type: "popup.revoke" });
          void render();
        },
      }),
    );
    return;
  }

  if (!state.connected) {
    app.append(
      el("p", { className: "muted", textContent: "Open your DUO call in a tab first. This extension only talks to DUO." }),
    );
    return;
  }

  const syncButton = () =>
    el("button", {
      className: state.syncArmed ? "primary" : "ghost",
      textContent: "Sync this tab's video with DUO",
      onclick: async () => {
        const res = await send<{ ok: boolean; message?: string }>({ type: "popup.sync", tabId: tab!.id });
        if (res.ok) window.close();
        else void render(res.message);
      },
    });

  if (state.sync) {
    app.append(
      el(
        "div",
        { className: "card" },
        el("p", { textContent: "Watching in sync:" }),
        el("p", { className: "muted", textContent: state.sync.title }),
      ),
      el("p", {
        className: "muted",
        textContent: "Play, pause and skip here; your person's tab follows, and theirs leads yours.",
      }),
      el("button", {
        className: "ghost",
        textContent: "Stop syncing",
        onclick: async () => {
          await send({ type: "popup.stopSync" });
          void render();
        },
      }),
    );
  }

  // DUO asked for a show to sync: that comes first.
  if (state.syncArmed && tab?.id !== undefined && tab.id !== state.sync?.tabId) {
    app.append(
      el("p", { textContent: "Open the show in this tab on your own account, then sync it. Your person does the same." }),
      syncButton(),
    );
  }

  if (state.sharing) {
    app.append(
      el(
        "div",
        { className: "card" },
        el("p", { textContent: "Sharing for remote control:" }),
        el("p", { className: "muted", textContent: state.sharing.title || "a tab" }),
      ),
      el("p", { className: "muted", textContent: "Your person can ask for control. Nothing happens until you approve in DUO." }),
      el("button", {
        className: "ghost",
        textContent: "Stop sharing",
        onclick: async () => {
          await send({ type: "popup.stopShare" });
          void render();
        },
      }),
    );
  }

  if (tab?.id !== undefined && tab.id !== state.sharing?.tabId) {
    app.append(
      el("p", {
        textContent: state.sharing
          ? "Share this tab instead?"
          : "Share this tab in your DUO call so your person can see it, and ask to control it.",
      }),
      el("button", {
        className: "primary",
        textContent: "Share this tab with DUO",
        onclick: async () => {
          const res = await send<{ ok: boolean; message?: string }>({ type: "popup.share", tabId: tab.id });
          if (res.ok) window.close();
          else void render(res.message);
        },
      }),
    );
    if (!state.syncArmed && tab.id !== state.sync?.tabId) {
      app.append(
        el("p", { className: "muted", textContent: "Or, to watch a show together on your own accounts:" }),
        syncButton(),
      );
    }
  }
  if (error) app.append(el("p", { className: "error", textContent: error }));
}

void render();
