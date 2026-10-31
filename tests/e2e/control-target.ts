import { createServer, type Server } from "node:http";

/**
 * A tiny site standing in for "any website" the owner shares. It records every trusted input it
 * receives into window.__duo, so tests can assert exactly what the remote controller did.
 */
const PAGE = (title: string, extra = "") => `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body{margin:0;font:16px system-ui;background:#fff;color:#111}
  #btn{position:absolute;left:100px;top:100px;width:200px;height:80px}
  #name{position:absolute;left:100px;top:240px;width:400px;height:40px;font-size:18px}
  #scroller{position:absolute;left:700px;top:100px;width:300px;height:300px;overflow:auto;border:1px solid #999}
  #scroller div{height:3000px;background:linear-gradient(#fee,#eef)}
  #drag{position:absolute;left:100px;top:420px;width:500px;height:120px;background:#eef}
  #link{position:absolute;left:100px;top:600px}
</style></head>
<body>
  <button id="btn">Click me</button>
  <input id="name" placeholder="type here">
  <div id="scroller"><div></div></div>
  <div id="drag"></div>
  <a id="link" href="/page2">Go to page 2</a>
  ${extra}
<script>
  window.__duo = { clicks: 0, dbl: 0, ctx: 0, trusted: true, keys: [], drag: null };
  const d = window.__duo;
  const btn = document.getElementById('btn');
  btn.addEventListener('click', e => { d.clicks++; d.trusted = d.trusted && e.isTrusted; });
  btn.addEventListener('dblclick', e => { d.dbl++; });
  btn.addEventListener('contextmenu', e => { e.preventDefault(); d.ctx++; });
  document.getElementById('name').addEventListener('keydown', e => d.keys.push(e.key + (e.isTrusted ? '' : '(untrusted)')));
  const drag = document.getElementById('drag');
  let start = null;
  drag.addEventListener('mousedown', e => { start = { x: e.clientX, y: e.clientY }; });
  window.addEventListener('mouseup', e => { if (start) { d.drag = { dx: e.clientX - start.x, dy: e.clientY - start.y }; start = null; } });
</script></body></html>`;

export function startTargetSite(port = 4555): Promise<Server> {
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(req.url?.startsWith("/page2") ? PAGE("DUO Target page 2", "<p id='p2'>Second page</p>") : PAGE("DUO Target"));
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}
