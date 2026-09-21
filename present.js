(() => {
  'use strict';
  const $=id=>document.getElementById(id),app=window.NFL_APP,audio=$('narration'),panel=$('speech');
  let queue=[],index=0,packetId='',state='idle',generation=0,loaded='';
  const current=()=>queue[index];
  function invalidate(){generation++;audio.pause();audio.onended=null;audio.onerror=null;}
  function status(message){panel.dataset.state=state;$('speech-status').textContent=message;$('speech-play').textContent=['playing','loading'].includes(state)?'Pause':['paused','error'].includes(state)?'Resume':'Play';$('speech-play').disabled=state==='boundary'||state==='complete';$('speech-continue').hidden=state!=='boundary';$('speech-replay').disabled=!current();}
  function progress(){const duration=current()?.audio?.duration||1;$('speech-progress').max=duration;$('speech-progress').value=Math.min(duration,audio.currentTime||0);}
  function stop(close=false){invalidate();loaded='';audio.removeAttribute('src');audio.load();state='idle';progress();status('Stopped. The complete written lesson stays on the page.');if(close)panel.hidden=true;}
  function pause(message='Paused. Resume when you are ready.'){if(!['playing','loading'].includes(state))return;invalidate();state='paused';status(message);}
  function error(message){invalidate();loaded='';state='error';status(message+' Resume to retry; the complete lesson remains readable.');}
  async function play(restart=false){const c=current();if(!c)return;if(!c.audio){error('This saved lesson has no local audio file.');return;}invalidate();const token=generation;if(restart||loaded!==c.audio.src){audio.src=c.audio.src;loaded=c.audio.src;}audio.playbackRate=Number($('speech-speed').value);$('speech-title').textContent=`${index+1} of ${queue.length} · ${c.title}`;$('speech-caption').textContent=c.audio.text;state='loading';status('Starting the spoken walkthrough.');progress();audio.onerror=()=>{if(token===generation)error('The local narration could not be loaded.');};audio.onended=()=>{if(token!==generation)return;invalidate();if(index<queue.length-1){state='boundary';status('Take a beat: make your read or save a note. Continue when you want the next lesson.');}else{state='complete';status('Packet complete. Keep reading, replay this lesson, or return to your packets.');}};try{await audio.play();if(token!==generation)return;state='playing';status(`Presenting lesson ${index+1} of ${queue.length}. Samantha synthetic narration.`);}catch{if(token===generation)error('Playback needs another click or the local audio is unavailable.');}}
  function move(to){if(to<0||to>=queue.length)return;invalidate();index=to;loaded='';if(packetId)app.showPacket(packetId,index);else app.showCard(current().id);play(true);}
  function start(cards,id=''){stop();queue=cards;packetId=id;index=0;panel.hidden=false;move(0);panel.scrollIntoView({block:'start',behavior:'instant'});}
  $('speech-play').addEventListener('click',()=>['playing','loading'].includes(state)?pause():play());
  $('speech-replay').addEventListener('click',()=>play(true));
  $('speech-stop').addEventListener('click',()=>stop());
  $('speech-close').addEventListener('click',()=>stop(true));
  $('speech-continue').addEventListener('click',()=>{if(state==='boundary')move(index+1);});
  $('speech-speed').addEventListener('change',()=>{audio.playbackRate=Number($('speech-speed').value);});
  audio.addEventListener('timeupdate',progress);
  document.addEventListener('nfl:route',e=>{if(e.detail.cause!=='narration')stop(true);});
  document.addEventListener('click',e=>{const card=e.target.closest('[data-present-card]'),packet=e.target.closest('[data-present-packet]');if(card){const c=app.cards.get(card.dataset.presentCard);if(c)start([c]);}else if(packet){const p=app.packets.find(p=>p.id===packet.dataset.presentPacket);if(p)start(p.cards,p.id);}else if(e.target.closest('.quiz button,.interactive button,a[target="_blank"]'))pause('Paused while you explore. Resume when you are ready.');});
  document.addEventListener('input',e=>{if(e.target.closest('.interactive,.notes-box'))pause('Paused while you work through the lesson. Resume when ready.');});
  document.addEventListener('nfl:gameday-interaction',()=>pause('Paused while you explore Game Day.'));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pause('Paused while this tab is hidden. Resume when ready.');});
})();
