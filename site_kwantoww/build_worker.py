"""Собирает весь сайт (HTML-страницы и картинки из shots/) в один _worker.js для Cloudflare Pages.
Запуск: python3 build_worker.py > _worker.js"""
import base64, json, os
root = os.path.dirname(os.path.abspath(__file__))
pages, assets = {}, {}
for d, _, fs in os.walk(root):
    if 'index.html' in fs:
        rel = os.path.relpath(d, root)
        pages['/' if rel == '.' else '/' + rel + '/'] = open(os.path.join(d, 'index.html'), encoding='utf-8').read()
for f in sorted(os.listdir(os.path.join(root, 'shots'))):
    assets['/shots/' + f] = base64.b64encode(open(os.path.join(root, 'shots', f), 'rb').read()).decode()
print(f'''const PAGES = {json.dumps(pages, ensure_ascii=False)};
const ASSETS = {json.dumps(assets)};
const TYPES = {{ webp: "image/webp", png: "image/png", jpg: "image/jpeg", svg: "image/svg+xml" }};
export default {{
  async fetch(request) {{
    const url = new URL(request.url);
    if (ASSETS[url.pathname]) {{
      const bin = Uint8Array.from(atob(ASSETS[url.pathname]), c => c.charCodeAt(0));
      return new Response(bin, {{ headers: {{ "content-type": TYPES[url.pathname.split(".").pop()] || "application/octet-stream",
        "cache-control": "public, max-age=604800" }} }});
    }}
    let p = url.pathname.replace(/index\\.html$/, "");
    if (!p.endsWith("/") && PAGES[p + "/"]) return Response.redirect(url.origin + p + "/" + url.search, 301);
    return new Response(PAGES[p] ?? PAGES["/"], {{ headers: {{ "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=0, must-revalidate" }} }});
  }},
}};''')
