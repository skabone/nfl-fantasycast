(() => {
  'use strict';
  const $=id=>document.getElementById(id), P=window.NFLProfile, MAX_FILE=24*1024*1024;
  let pending=null, installPrompt=null, registration=null, updateRequested=false;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const hosted=()=>window.NFL_DELIVERY?.mode==='hosted';
  const native=()=>Boolean(window.webkit?.messageHandlers?.fantasycastDownload);
  const standalone=()=>native()||matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  function feedback(text){if($('device-status'))$('device-status').textContent=text;}
  function mediaDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open('nfl-fantasycast-private-media-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('audio');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(new Error('Private narration storage is unavailable.'));});}
  async function storedMedia(path){const db=await mediaDB();try{return await new Promise((resolve,reject)=>{const r=db.transaction('audio').objectStore('audio').get(path);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}finally{db.close();}}
  function base64(buffer){let text='';const bytes=new Uint8Array(buffer);for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);}
  const sha=async buffer=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(n=>n.toString(16).padStart(2,'0')).join('');
  async function exportData(includeAudio=true){
    const profile=window.NFL_PROFILE?JSON.parse(JSON.stringify(window.NFL_PROFILE)):null;
    if(profile&&window.NFLWinChance)profile.winChanceSnapshots=window.NFLWinChance.snapshots();
    if(profile)profile.guide=P.portable(profile.guide);
    const packets=JSON.parse(JSON.stringify(window.NFL_APP.packets));
    const urls=new Map((profile?.guide.images||[]).map(i=>[i.path,i.imageUrl]));
    for(const p of packets)for(const c of p.cards)if(c.image&&urls.has(c.image.src))c.image.src=urls.get(c.image.src);
    const result={schema:'nfl-fantasycast-backup',version:1,exportedAt:new Date().toISOString(),profile,packets,selectedLeague:window.NFL_APP.getLeague(),selectedLeagues:window.NFL_APP.getLeagues(),media:[]};
    if(includeAudio){
      const cards=[...(profile?.guide.leagueCards||[]),...packets.flatMap(p=>p.cards)];
      const paths=[...new Set(cards.map(c=>c.audio?.src).filter(s=>/^audio\/league-[a-z0-9_-]+\.m4a$/.test(s||'')))];
      for(const path of paths){
        feedback(`Copying private narration ${result.media.length+1} of ${paths.length}…`);
        let buffer;const stored=await storedMedia(path).catch(()=>null);
        if(stored)buffer=await stored.arrayBuffer();
        else {const response=await fetch(path,{cache:'no-cache',credentials:'same-origin'});if(!response.ok)throw new Error('A private recording could not be copied. Try again, or turn off “Include league narration” to transfer the written lessons.');buffer=await response.arrayBuffer();}
        result.media.push({path,sha256:await sha(buffer),data:base64(buffer)});
      }
    }
    const text=JSON.stringify(result);if(new Blob([text]).size>MAX_FILE)throw new Error('This backup is too large. Turn off league narration and export again.');return text;
  }
  function download(name,text,mime='application/json'){
    if(native()){window.webkit.messageHandlers.fantasycastDownload.postMessage({name,text,mime});return;}
    const url=URL.createObjectURL(new Blob([text],{type:mime})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  async function inspect(text){
    if(new Blob([text]).size>MAX_FILE)throw new Error('Choose a FantasyCast file smaller than 24 MB.');
    const b=JSON.parse(text);
    if(b.schema!=='nfl-fantasycast-backup'||b.version!==1)throw new Error('Choose a JSON backup exported by NFL FantasyCast.');
    if(b.profile)P.validate(b.profile);P.validatePackets(b.packets);
    if(b.selectedLeagues!==undefined&&(!Array.isArray(b.selectedLeagues)||b.selectedLeagues.length>20||b.selectedLeagues.some(id=>typeof id!=='string'||id.length>80)))throw new Error('The saved league selection is invalid.');
    if(!Array.isArray(b.media)||b.media.length>30)throw new Error('The narration list is invalid.');
    for(const m of b.media){
      if(!m||!/^audio\/league-[a-z0-9_-]+\.m4a$/.test(m.path)||!/^([a-f0-9]{64})$/.test(m.sha256)||typeof m.data!=='string'||m.data.length>5*1024*1024)throw new Error('A private narration entry is invalid.');
      const data=Uint8Array.from(atob(m.data),c=>c.charCodeAt(0));if(await sha(data)!==m.sha256)throw new Error('A private recording failed its integrity check.');m.blob=new Blob([data],{type:'audio/mp4'});
    }
    return b;
  }
  function mergePackets(existing,incoming){
    const result=JSON.parse(JSON.stringify(existing)),ids=new Set(result.map(p=>p.id));let added=0,duplicates=0;
    for(const packet of incoming){const copy=JSON.parse(JSON.stringify(packet));const old=result.find(p=>p.id===copy.id);if(old&&JSON.stringify(old)===JSON.stringify(copy)){duplicates++;continue;}if(old){const base=copy.id.slice(0,80);let n=1;while(ids.has(`${base}-import-${n}`))n++;copy.id=`${base}-import-${n}`;}ids.add(copy.id);result.push(copy);added++;}
    if(result.length>150)throw new Error('This would exceed 150 saved packets. Your existing packets are unchanged.');return {packets:result,added,duplicates};
  }
  async function applyImport(b){
    const combined=mergePackets(window.NFL_APP.packets,b.packets);
    // Recordings are immutable: a failed import must never replace a saved one.
    for(const m of b.media){const old=await storedMedia(m.path);if(old&&await sha(await old.arrayBuffer())!==m.sha256)throw new Error('A different recording already uses that name. Your saved recording and packets were kept.');}
    if(b.media.length){const db=await mediaDB();try{await new Promise((resolve,reject)=>{const tx=db.transaction('audio','readwrite');for(const m of b.media)tx.objectStore('audio').put(m.blob,m.path);tx.oncomplete=resolve;tx.onerror=()=>reject(new Error('Private narration could not be saved.'));tx.onabort=tx.onerror;});}finally{db.close();}}
    const before=[P.PROFILE_KEY,P.PACKETS_KEY,'nfl-fantasycast-league-v1','nfl-fantasycast-leagues-v1'].map(k=>[k,localStorage.getItem(k)]);
    try{
      localStorage.setItem(P.PACKETS_KEY,JSON.stringify(combined.packets));
      if(b.profile)localStorage.setItem(P.PROFILE_KEY,JSON.stringify(b.profile));
      const active=b.profile||window.NFL_PROFILE,valid=[...(active?.sleeperLeagues||[]).map(l=>l.id)];
      if(active?.espnSnapshot){const s=active.espnSnapshot;valid.push(`espn-${s.league.id}-${s.ownTeam.id}`);}
      const selected=Array.isArray(b.selectedLeagues)?valid.filter(id=>b.selectedLeagues.includes(id)):valid.includes(b.selectedLeague)?[b.selectedLeague]:valid;
      localStorage.setItem('nfl-fantasycast-leagues-v1',JSON.stringify(selected));
      localStorage.setItem('nfl-fantasycast-league-v1',selected.length===1?selected[0]:'all');
    }catch(error){
      // Free the partial import before restoring older values that may need more room.
      for(const [k] of before){try{localStorage.removeItem(k);}catch{}}
      for(const [k,v] of before){if(v!==null){try{localStorage.setItem(k,v);}catch{}}}
      throw new Error('This device could not save the import. Its existing packets were kept.');
    }
    return combined;
  }
  function render(){
    const p=window.NFL_PROFILE,count=window.NFL_APP?.packets?.length||0,installed=standalone();
    const phone=hosted()?`<ol><li>Open this address in Safari on your iPhone.</li><li>Tap Share, then <b>Add to Home Screen</b>. Keep <b>Open as Web App</b> on if shown.</li><li>Open FantasyCast from its new icon, then import your setup file below.</li></ol><p>On Android, use Chrome’s menu and choose <b>Install app</b> or <b>Add to Home screen</b>.</p>`:`<p>This address belongs to this Mac. Phone installation uses the hosted version; a localhost link will not open your Mac’s app from a phone.</p>${window.NFL_DELIVERY.publicUrl?`<a class="button" href="${esc(window.NFL_DELIVERY.publicUrl)}" target="_blank" rel="noopener">Open the phone version</a>`:'<p class="meta">The phone release is being prepared. Your Mac app and saved learning are ready here.</p>'}`;
    return `<header class="page-head"><div><h1>Your app. Your devices.</h1><p class="lead">Open FantasyCast in one tap. Bring your teams and saved thinking with you.</p></div><img class="device-icon" src="assets/app/icon-192.png" alt="NFL FantasyCast icon"></header><div class="device-grid"><section class="device-card"><h2>${installed?'You’re in the app':'Open it like an app'}</h2><p>${native()?'NFL FantasyCast opens in its own Mac window. Its local server starts automatically.':installed?'FantasyCast is running in its own app window.':'The installed view gives FantasyCast its own icon and window.'}</p><button id="device-install" ${installPrompt?'':'hidden'}>Install FantasyCast</button><h3>Phone</h3>${phone}<h3>Mac</h3><p>${hosted()?'In Safari, choose File → Add to Dock. Chrome also offers an install icon in its address bar.':'Open NFL FantasyCast from Applications or Spotlight. You can keep its icon in the Dock.'}</p><a href="https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios" target="_blank" rel="noopener">Apple’s iPhone installation steps</a></section><section class="device-card"><h2>Bring your teams with you</h2><p>${p?'Your personal setup is loaded. Export it here, send the file to your own device using AirDrop or Files, and import it in the installed app.':'Import a setup file exported from FantasyCast on your Mac to load your teams, league rules and saved ESPN snapshot.'}</p><p><b>${count} saved ${count===1?'packet':'packets'}</b> on this browser or app.</p><label class="device-check"><input id="device-audio" type="checkbox" checked> Include league narration</label><div class="actions"><button id="device-export" class="primary">Export my app data</button><label class="button device-file">Choose a setup file<input id="device-import" type="file" accept=".json,application/json"></label></div><p class="meta">The file contains your fantasy setup and any saved notes. Import reads it on this device; it is not uploaded. Your existing packets are kept, with different copies saved separately.</p><div id="device-preview" hidden></div><p id="device-status" role="status" aria-live="polite">${esc(window.NFL_PROFILE_ERROR||'A Mac app, browser and phone each keep their own storage. Export and import deliberately; changes do not automatically sync.')}</p></section><section class="device-card device-wide"><h2>Ready when you are</h2><div class="device-health"><p><b>Connection</b><br><span id="device-connection">${navigator.onLine?'Online':'Offline — scores need a connection'}</span></p><p><b>Saved reading</b><br><span id="device-offline">Checking offline availability…</span></p><p><b>App version</b><br>${esc(window.NFL_DELIVERY?.build||'Local edition')}</p></div><p>Live NFL and Sleeper feeds refresh only while Game Day is open and visible. ESPN fantasy points keep their capture date. Reading and saved packets remain available offline after this edition is prepared; uncached recordings and photos need a connection.</p><button id="device-update" hidden>Restart with the update</button></section></div>`;
  }
  function updateStatus(){if($('device-connection'))$('device-connection').textContent=navigator.onLine?'Online':'Offline — scores need a connection';if($('device-offline'))$('device-offline').textContent=registration?.active?'This edition is saved on this device.':window.isSecureContext?'Preparing this edition…':'Open the HTTPS app or use the Mac launcher.';if($('device-update'))$('device-update').hidden=!registration?.waiting;}
  function bind(){
    updateStatus();
    $('device-install')?.addEventListener('click',async()=>{if(!installPrompt)return;await installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$('device-install').hidden=true;});
    $('device-export')?.addEventListener('click',async e=>{e.currentTarget.disabled=true;try{feedback('Preparing your setup and saved packets…');const text=await exportData($('device-audio').checked);download('NFL-FantasyCast-Setup.json',text);feedback(native()?'Choose where to save your file in the Mac dialog.':'Your download is ready. Import it on your own device; nothing was uploaded.');}catch(error){feedback(error.message);}finally{if($('device-export'))$('device-export').disabled=false;}});
    $('device-import')?.addEventListener('change',async e=>{pending=null;const file=e.target.files?.[0];if(!file)return;const box=$('device-preview');box.hidden=true;try{if(file.size>MAX_FILE)throw new Error('Choose a FantasyCast file smaller than 24 MB.');feedback('Checking this file…');pending=await inspect(await file.text());const merged=mergePackets(window.NFL_APP.packets,pending.packets);box.innerHTML=`<h3>Ready to import</h3><p>${pending.profile?`${pending.profile.sleeperLeagues.length} Sleeper leagues${pending.profile.espnSnapshot?' and an ESPN snapshot':''}. The file’s team setup will become active on this device.`:'Your team setup stays as it is.'} ${merged.added} packets will be added; ${merged.duplicates} identical copies will be skipped. ${pending.media.length} private recordings.</p><button id="device-confirm" class="primary">Import this setup</button>`;box.hidden=false;feedback('Review the import above. Your existing packets will be kept.');$('device-confirm').onclick=async event=>{event.currentTarget.disabled=true;try{await applyImport(pending);feedback('Import saved. Opening your teams…');location.hash='#gameday';location.reload();}catch(error){feedback(error.message);event.currentTarget.disabled=false;}};}catch(error){feedback(error instanceof SyntaxError?'This is not a valid JSON backup. Choose the file exported by FantasyCast.':error.message);}});
    $('device-update')?.addEventListener('click',()=>{updateRequested=true;registration?.waiting?.postMessage({type:'ACTIVATE_UPDATE'});});
  }
  window.NFLDevice={render,bind,download,inspect,mergePackets,applyImport,exportData};
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;if($('device-install'))$('device-install').hidden=false;});
  window.addEventListener('fantasycast:native-download',e=>feedback(e.detail?.status==='saved'?'File saved on your Mac. Nothing was uploaded.':e.detail?.status==='cancelled'?'Save cancelled. Your app data is unchanged.':'The file could not be saved. Try exporting again.'));
  window.addEventListener('online',updateStatus);window.addEventListener('offline',updateStatus);
  if('serviceWorker' in navigator&&window.isSecureContext&&location.protocol!=='file:'){
    let refreshing=false;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(refreshing)return;if(updateRequested){refreshing=true;location.reload();}updateStatus();});
    navigator.serviceWorker.register('sw.js',{scope:'./',updateViaCache:'none'}).then(r=>{registration=r;updateStatus();r.addEventListener('updatefound',()=>r.installing?.addEventListener('statechange',updateStatus));}).catch(()=>{if($('device-offline'))$('device-offline').textContent='Offline setup is unavailable here. Saved notes still use this device’s storage.';});
  }
})();
