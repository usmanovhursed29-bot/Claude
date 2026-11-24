const C="kwantoww-e5887ad9";
const FILES=["./","index.html","manifest.webmanifest","icon-192.png","icon-512.png","icon-180.png"];
self.addEventListener("install",e=>{
  e.waitUntil(caches.open(C).then(c=>c.addAll(FILES.map(f=>new Request(f,{cache:"reload"})))).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",e=>{
  e.waitUntil((async()=>{
    const ks=await caches.keys();
    await Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)));
    await self.clients.claim();
    const cs=await self.clients.matchAll({type:"window"});
    cs.forEach(c=>{try{c.navigate(c.url)}catch(err){}});
  })());
});
self.addEventListener("fetch",e=>{
  const r=e.request;if(r.method!=="GET")return;
  const u=new URL(r.url);
  const isPage=r.mode==="navigate"||(u.origin===location.origin&&/\/(index\.html)?$/.test(u.pathname));
  if(isPage){
    e.respondWith(fetch(r,{cache:"no-store"}).then(res=>{if(res.ok){const cp=res.clone();caches.open(C).then(c=>c.put("index.html",cp))}return res}).catch(()=>caches.match("index.html")));
    return;
  }
  e.respondWith(caches.match(r).then(hit=>hit||fetch(r).then(res=>{
    if(res.ok&&(u.origin===location.origin||u.host.includes("fonts.g"))){const cp=res.clone();caches.open(C).then(c=>c.put(r,cp))}
    return res;
  }).catch(()=>Response.error())));
});
