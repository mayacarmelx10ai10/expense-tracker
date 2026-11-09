// רשת קודם, ואז מטמון: כך שבזמן הפיתוח תמיד רואים את הגרסה העדכנית, ובלי אינטרנט האפליקציה עדיין נפתחת.
const CACHE='expenses-v11';
const SHELL=['./','index.html','app.css','app.js','bridge.js','config.js','icon.svg','apple-touch-icon.png','icon-192.png','icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin)return;
  e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(CACHE).then(x=>x.put(e.request,c));return r}).catch(()=>caches.match(e.request)));
});
