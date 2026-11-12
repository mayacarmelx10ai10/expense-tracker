// הקבצים של האפליקציה נטענים מהמטמון מיד (בלי מסך לבן), ובמקביל מתעדכנים ברקע מהרשת. גרסה חדשה מופיעה בפתיחה הבאה, וההודעה "יש גרסה חדשה" מופיעה בזמן הפתיחה.
const CACHE='expenses-v20';
const SHELL=['./','index.html','app.css','app.js','bridge.js','config.js','icon.svg','apple-touch-icon.png','icon-192.png','icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin)return;
  if(u.search){e.respondWith(fetch(e.request));return}   // בדיקת גרסה (?v=): תמיד מהרשת ולא נשמרת
  e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(hit=>{
    const net=fetch(e.request).then(r=>{if(r&&r.ok){const c=r.clone();caches.open(CACHE).then(x=>x.put(e.request,c))}return r}).catch(()=>hit);
    return hit||net;
  }));
});
