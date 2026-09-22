(() => {
  'use strict';
  // The improvement log: notes you write while using Game Day, kept on this device, and handed to
  // Claude or Codex as a numbered brief. Gena and Chess Trainer already work this way; without it,
  // anything noticed mid-game only reaches a session if it is retyped from memory.
  const KEY='nfl-fantasycast-improvements-v1', MAX_ITEMS=200, MAX_TEXT=2000;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const build=()=>window.NFL_DELIVERY?.build||'unknown build';
  const stamp=v=>{const d=new Date(v);return Number.isNaN(d.getTime())?'':d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});};

  function load(){
    try{
      const rows=JSON.parse(localStorage.getItem(KEY));
      if(!Array.isArray(rows))return [];
      return rows.filter(r=>r&&typeof r.text==='string'&&typeof r.id==='string').slice(0,MAX_ITEMS)
        .map(r=>({id:r.id,text:String(r.text).slice(0,MAX_TEXT),at:r.at||null,build:r.build||null,shipped:r.shipped===true}));
    }catch{return [];}
  }
  function save(rows){
    // A full log is not worth losing the app over: fail visibly, keep the session usable.
    try{localStorage.setItem(KEY,JSON.stringify(rows.slice(0,MAX_ITEMS)));return '';}
    catch{return 'This device would not save the note. Copy your open items before reloading.';}
  }
  const open=()=>load().filter(r=>!r.shipped);

  function add(text){
    const clean=String(text||'').trim().slice(0,MAX_TEXT);
    if(!clean)return {error:'Write the note first.'};
    const rows=load();
    rows.unshift({id:'n'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),text:clean,at:new Date().toISOString(),build:build(),shipped:false});
    return {error:save(rows)};
  }
  function setShipped(ids,shipped=true){
    const wanted=new Set(ids.map(String)),rows=load();
    for(const row of rows)if(wanted.has(row.id))row.shipped=shipped;
    return save(rows);
  }
  function remove(id){return save(load().filter(r=>r.id!==String(id)));}

  // Only open items travel, numbered, so a reply can close them by number.
  function brief(){
    const items=open();
    const head=[`NFL FantasyCast — improvement log`,
      `${build()} · ${items.length} open item${items.length===1?'':'s'} · copied ${new Date().toLocaleString()}`,
      ``,
      `Canonical project: 71_Code Space/Football/NFL FantasyCast/`,
      `Read docs/ROADMAP.md first, then docs/ARCHITECTURE.md. Release with ./ship.sh "message".`,
      `Reply with "SHIPPED: 1,3" (ranges like 1-4 work) and I will close those items.`,
      ``];
    const body=items.length?items.map((r,i)=>`${i+1}. ${r.text.replace(/\s+/g,' ').trim()}${r.build?`  [noticed on ${r.build}]`:''}`)
      :['(No open items. Nothing to do.)'];
    return head.concat(body).join('\n');
  }
  // "SHIPPED: 1,3" or "1-4" — positions in the brief, not storage ids.
  function applyShipped(reply){
    const items=open(),text=String(reply||'');
    const numbers=new Set();
    for(const match of text.matchAll(/(\d+)\s*-\s*(\d+)|(\d+)/g)){
      if(match[1]){const a=Number(match[1]),b=Number(match[2]);for(let n=Math.min(a,b);n<=Math.max(a,b);n++)numbers.add(n);}
      else numbers.add(Number(match[3]));
    }
    const ids=[...numbers].filter(n=>n>=1&&n<=items.length).map(n=>items[n-1].id);
    if(!ids.length)return {closed:0,error:'No item numbers in that reply.'};
    const error=setShipped(ids,true);
    return {closed:ids.length,error};
  }

  async function copyBrief(){
    const text=brief();
    try{await navigator.clipboard.writeText(text);return {ok:true};}
    catch{
      // Clipboard permission varies by surface; a selectable field always works.
      const field=document.getElementById('improve-fallback');
      if(field){field.hidden=false;field.value=text;field.focus();field.select();}
      return {ok:false,text};
    }
  }

  function render(){
    const items=open(),all=load(),shipped=all.length-items.length;
    return `<details class="gd-improve-card" data-key="improve"><summary><span><b>Notes</b><span>${items.length?`${items.length} open item${items.length===1?'':'s'}`:'Nothing noted yet'}${shipped?` · ${shipped} closed`:''}</span></span><small>Open the log</small></summary><div class="gd-improve-body">
      <p class="gd-improve-intro">Jot what you notice while you use this — good or bad. It stays on this device until you copy it.</p>
      <div class="gd-improve-entry">
        <label class="sr-only" for="improve-text">A note about NFL FantasyCast</label>
        <textarea id="improve-text" rows="2" maxlength="${MAX_TEXT}" placeholder="e.g. the scorecard is too tall with five leagues"></textarea>
        <button id="improve-add" class="primary" data-key="improve-add">Add note</button>
      </div>
      <p id="improve-status" role="status" aria-live="polite" class="gd-improve-status"></p>
      ${items.length?`<ol class="gd-improve-list">${items.map((r,i)=>`<li data-key="improve-${esc(r.id)}"><span class="gd-improve-n">${i+1}</span><div><p>${esc(r.text)}</p><p class="gd-improve-meta">${esc(stamp(r.at))}${r.build?` · ${esc(r.build)}`:''}</p></div><span class="gd-improve-actions"><button data-improve-ship="${esc(r.id)}" data-key="ship-${esc(r.id)}">Done</button><button data-improve-remove="${esc(r.id)}" data-key="remove-${esc(r.id)}" aria-label="Delete note ${i+1}">Delete</button></span></li>`).join('')}</ol>`:'<p class="gd-muted">No open notes.</p>'}
      <div class="gd-improve-tools">
        <button id="improve-copy" data-key="improve-copy" ${items.length?'':'disabled'}>Copy ${items.length||''} for Claude</button>
        ${shipped?`<button id="improve-clear" data-key="improve-clear">Clear ${shipped} closed</button>`:''}
      </div>
      <label class="gd-improve-reply"><span>Paste the reply (e.g. <code>SHIPPED: 1,3</code>)</span><input id="improve-reply" type="text" placeholder="SHIPPED: 1,3"><button id="improve-apply" data-key="improve-apply">Close those</button></label>
      <textarea id="improve-fallback" rows="6" hidden readonly aria-label="Copy this text manually"></textarea>
      <p class="gd-improve-note">Notes live in this browser or app only — they are never uploaded, never published, and never leave with a release.</p>
    </div></details>`;
  }

  function say(message){const el=document.getElementById('improve-status');if(el)el.textContent=message||'';}
  const changed=()=>document.dispatchEvent(new CustomEvent('nfl:improve-change'));

  // Delegated from the document so the card can be re-rendered freely underneath it.
  document.addEventListener('click',async e=>{
    const node=e.target.closest?.('button');if(!node)return;
    if(node.id==='improve-add'){
      const field=document.getElementById('improve-text');
      const result=add(field?.value);
      if(result.error){say(result.error);return;}
      if(field)field.value='';
      changed();say('Noted. It stays on this device until you copy it.');return;
    }
    if(node.dataset.improveShip){const error=setShipped([node.dataset.improveShip],true);changed();say(error||'Closed.');return;}
    if(node.dataset.improveRemove){const error=remove(node.dataset.improveRemove);changed();say(error||'Deleted.');return;}
    if(node.id==='improve-copy'){
      const count=open().length,result=await copyBrief();
      changed();
      say(result.ok?`Copied ${count} open item${count===1?'':'s'}. Paste it to Claude or Codex.`:'Clipboard unavailable — the text is selected below, copy it manually.');
      return;
    }
    if(node.id==='improve-clear'){const kept=load().filter(r=>!r.shipped);const error=save(kept);changed();say(error||'Closed notes cleared.');return;}
    if(node.id==='improve-apply'){
      const field=document.getElementById('improve-reply');
      const result=applyShipped(field?.value);
      if(field&&result.closed)field.value='';
      changed();say(result.error||`Closed ${result.closed} item${result.closed===1?'':'s'}.`);return;
    }
  });

  window.NFLImprove={render,add,open,load,brief,applyShipped,copyBrief,setShipped,remove,KEY};
})();
