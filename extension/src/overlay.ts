/**
 * Runs inside an isolated world in the controlled tab (page scripts can't reach its globals).
 * Draws a closed-shadow-DOM overlay: a coral frame, a banner naming the controller with the stop
 * shortcut, and the controller's cursor. pointer-events: none, so it never blocks the page.
 */
function overlay(opts: { name: string; shortcut: string }) {
  const w = window as unknown as {
    __duoMove?: (x: number, y: number) => void;
    __duoRemove?: () => void;
    __duoHost?: HTMLElement;
  };
  w.__duoHost?.remove();
  const host = document.createElement("div");
  host.setAttribute("data-duo-control", "");
  host.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      .frame{position:fixed;inset:0;border:4px solid #ff8a6e;border-radius:6px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.25)}
      .banner{position:fixed;top:10px;left:50%;transform:translateX(-50%);background:#1a1420;color:#fff4e6;
        font:600 13px/1.2 system-ui,sans-serif;padding:8px 14px;border-radius:999px;box-shadow:0 6px 24px rgba(0,0,0,.35);
        display:flex;gap:8px;align-items:center;white-space:nowrap}
      .dot{width:8px;height:8px;border-radius:50%;background:#ff5a5a;animation:p 1.2s infinite}
      kbd{font:inherit;background:#3a2f44;border-radius:5px;padding:1px 6px}
      .cursor{position:fixed;left:0;top:0;transform:translate(-100px,-100px);transition:transform 40ms linear}
      .cursor span{position:absolute;left:18px;top:16px;background:#ff8a6e;color:#1a1420;font:700 11px system-ui,sans-serif;
        padding:2px 7px;border-radius:999px;white-space:nowrap}
      @keyframes p{50%{opacity:.35}}
    </style>
    <div class="frame"></div>
    <div class="banner"><span class="dot"></span><span class="who"></span><span>· stop with <kbd class="key"></kbd></span></div>
    <div class="cursor"><svg width="20" height="20" viewBox="0 0 24 24"><path d="M3 2l7 19 2.5-7.5L20 11z" fill="#ff8a6e" stroke="#1a1420" stroke-width="1.5"/></svg><span class="label"></span></div>`;
  // textContent, never innerHTML, for anything user-provided.
  (root.querySelector(".who") as HTMLElement).textContent = `${opts.name} is controlling this tab`;
  (root.querySelector(".label") as HTMLElement).textContent = opts.name;
  (root.querySelector(".key") as HTMLElement).textContent = opts.shortcut;
  const cursor = root.querySelector(".cursor") as HTMLElement;
  (document.documentElement || document.body).appendChild(host);
  w.__duoHost = host;
  w.__duoMove = (x: number, y: number) => {
    cursor.style.transform = `translate(${x}px, ${y}px)`;
  };
  w.__duoRemove = () => {
    host.remove();
    delete w.__duoHost;
    delete w.__duoMove;
  };
}

export const OVERLAY_SOURCE = overlay.toString();
