/* FantasyCast owns only its named caches. Scores and account responses are never cached here. */
const BUILD='2026-09-21-app-14', PREFIX='nfl-fantasycast-', SHELL=PREFIX+'shell-'+BUILD, MEDIA=PREFIX+'reading-media-v1';
const CORE=['index.html','style.css','gameday.css','gameday.js','game-insights.js','app.js','present.js','data.js','delivery.js','profile.js','win-chance.js','browser-feed.js','device.js','device.css','league-rail.css','manifest.webmanifest','offline.html','assets/app/icon-192.png','assets/app/icon-512.png','assets/app/icon-180.png','assets/app/icon-maskable-512.png'];
const here=path=>new URL(path,self.registration.scope).href;
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(SHELL);
  await cache.addAll(CORE.map(path=>new Request(here(path),{cache:'reload'})));
  const index=await cache.match(here('index.html'));
  if((await index.text()).includes('src="private-profile.js"'))await cache.add(new Request(here('private-profile.js'),{cache:'reload'}));
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith(PREFIX+'shell-')&&key!==SHELL)await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE_UPDATE')self.skipWaiting();});
async function privateAudio(path){
  return new Promise(resolve=>{
    const r=indexedDB.open('nfl-fantasycast-private-media-v1',1);
    r.onupgradeneeded=()=>r.result.createObjectStore('audio');
    r.onerror=()=>resolve(null);
    r.onsuccess=()=>{const db=r.result,tx=db.transaction('audio'),q=tx.objectStore('audio').get(path);q.onsuccess=()=>{db.close();resolve(q.result||null);};q.onerror=()=>{db.close();resolve(null);};};
  });
}
async function rangeResponse(response,range){
  if(!range)return response;
  const match=/^bytes=(\d+)-(\d*)$/.exec(range);if(!match)return response;
  const blob=await response.blob(),start=Number(match[1]),end=match[2]?Math.min(Number(match[2]),blob.size-1):blob.size-1;
  if(start>=blob.size||end<start)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${blob.size}`}});
  return new Response(blob.slice(start,end+1),{status:206,headers:{'Content-Type':blob.type||'audio/mp4','Content-Length':String(end-start+1),'Content-Range':`bytes ${start}-${end}/${blob.size}`,'Accept-Ranges':'bytes'}});
}
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url),scope=new URL(self.registration.scope);
  if(request.method!=='GET'||url.origin!==scope.origin||!url.pathname.startsWith(scope.pathname)||url.pathname.includes('/api/'))return;
  const path=url.pathname.slice(scope.pathname.length);
  if(path==='sw.js')return;
  if(request.mode==='navigate'){
    event.respondWith((async()=>{const cache=await caches.open(SHELL);return await cache.match(here('index.html'))||fetch(request).catch(()=>cache.match(here('offline.html')));})());return;
  }
  if(CORE.includes(path)||path==='private-profile.js'){
    event.respondWith((async()=>{const cache=await caches.open(SHELL);return await cache.match(here(path))||fetch(request);})());return;
  }
  if(/^audio\/[a-z0-9_-]+\.m4a$/.test(path)){
    event.respondWith((async()=>{
      const privateBlob=await privateAudio(path);
      if(privateBlob)return rangeResponse(new Response(privateBlob,{headers:{'Content-Type':'audio/mp4'}}),request.headers.get('Range'));
      const cache=await caches.open(MEDIA),saved=await cache.match(here(path));
      if(saved)return rangeResponse(saved,request.headers.get('Range'));
      const response=await fetch(request);
      if(response.ok&&response.status===200)await cache.put(here(path),response.clone());
      return response;
    })());
  }
});
