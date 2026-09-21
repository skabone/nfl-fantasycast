(() => {
  'use strict';
  const PROFILE_KEY='nfl-fantasycast-profile-v1', PACKETS_KEY='nfl-field-guide-packets-v1';
  const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
  const list=(x,max=250)=>Array.isArray(x)&&x.length<=max;
  function assert(ok,message){if(!ok)throw new Error(message);}
  function https(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}}
  function source(s){assert(object(s)&&https(s.url),'A source must be a valid HTTPS address without credentials.');}
  function scan(value,depth=0){
    assert(depth<24,'This file is nested too deeply.');
    if(typeof value==='string')assert(value.length<=200000,'A text field is too large.');
    if(!value||typeof value!=='object')return;
    for(const [key,item] of Object.entries(value)){
      assert(!['__proto__','prototype','constructor'].includes(key),'This file contains unsupported fields.');
      scan(item,depth+1);
    }
  }
  function card(c){
    assert(object(c)&&typeof c.id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(c.id)&&typeof c.title==='string'&&typeof c.lead==='string','A saved lesson is incomplete.');
    assert(list(c.sections,80)&&list(c.sources,80),'A saved lesson is missing its text or sources.');
    for(const s of c.sections)assert(object(s)&&typeof s.title==='string'&&(typeof s.text==='string'||list(s.text,50)&&s.text.every(t=>typeof t==='string')),'A lesson paragraph is invalid.');
    c.sources.forEach(source);
    if(c.question)assert(object(c.question)&&typeof c.question.prompt==='string'&&list(c.question.options,20)&&c.question.options.every(v=>typeof v==='string')&&list(c.question.feedback,20)&&c.question.feedback.every(v=>typeof v==='string')&&c.question.options.length===c.question.feedback.length&&Number.isInteger(c.question.answer)&&c.question.answer>=0&&c.question.answer<c.question.options.length,'A lesson question is invalid.');
    if(c.image)assert(object(c.image)&&typeof c.image.src==='string'&&(/^(assets\/[a-zA-Z0-9_.-]+\.(png|jpg|jpeg|webp))$/.test(c.image.src)||https(c.image.src)),'A lesson image is invalid.');
    if(c.audio)assert(object(c.audio)&&/^audio\/[a-z0-9_-]+\.m4a$/.test(c.audio.src)&&typeof c.audio.text==='string'&&Number.isFinite(c.audio.duration)&&c.audio.duration>0,'A narration file is invalid.');
    if(c.stats)assert(list(c.stats,40)&&c.stats.every(s=>object(s)&&typeof s.label==='string'&&['string','number'].includes(typeof s.value)),'A statistic is invalid.');
    if(c.teams)assert(list(c.teams,40)&&c.teams.every(t=>typeof t==='string'),'A lesson team list is invalid.');
    if(c.players)assert(list(c.players,100)&&c.players.every(t=>typeof t==='string'),'A lesson player list is invalid.');
  }
  function packets(value){
    assert(list(value,150),'This file contains too many packets.');
    for(const p of value){assert(object(p)&&/^[a-zA-Z0-9_-]{1,120}$/.test(p.id)&&typeof p.title==='string'&&list(p.cards,30)&&p.cards.length>0,'A packet is incomplete.');p.cards.forEach(card);assert(!p.notes||object(p.notes)&&Object.values(p.notes).every(n=>typeof n==='string'),'Packet notes are invalid.');}
    scan(value);return value;
  }
  function profile(value){
    assert(object(value)&&value.schema==='nfl-fantasycast-profile'&&value.version===1,'Choose an NFL FantasyCast setup file.');
    const d=value.guide;
    assert(object(d)&&['lessons','stories','leagueCards','leagues','nflTeamExposure','playerExposure','unverifiedLeagues','schedule','scheduleSources','images'].every(k=>list(d[k],500)),'The saved learning edition is incomplete.');
    [...d.lessons,...d.stories,...d.leagueCards].forEach(card);
    for(const l of d.leagues){
      assert(object(l)&&/^\d{10,24}$/.test(l.id)&&typeof l.name==='string'&&object(l.roster)&&object(l.scoring)&&list(l.lineupSlots,40)&&l.lineupSlots.every(s=>typeof s==='string'),'A saved league is incomplete.');
      assert(['reception','tightEndReceptionBonus','receivingYard','receivingTouchdown'].every(k=>Number.isFinite(l.scoring[k]))&&Object.values(l.scoring).every(Number.isFinite),'A league scoring value is invalid.');
      assert(Object.values(l.roster).every(v=>list(v,100)&&v.every(p=>object(p)&&typeof p.name==='string'&&typeof p.position==='string'&&(!p.eligiblePositions||list(p.eligiblePositions,10)))),'A roster is invalid.');
    }
    assert(d.nflTeamExposure.every(t=>object(t)&&typeof t.abbreviation==='string'&&typeof t.name==='string'&&Number.isFinite(t.uniquePlayerCount)&&Number.isFinite(t.leagueCount)),'The NFL team list is invalid.');
    assert(d.playerExposure.every(t=>object(t)&&typeof t.name==='string'),'The player list is invalid.');
    assert(d.images.every(i=>object(i)&&typeof i.path==='string'&&https(i.imageUrl)),'An image source is invalid.');
    assert(d.schedule.every(s=>object(s)&&typeof s.label==='string'&&typeof s.kickoff==='string'&&typeof s.inactiveCheck==='string'),'A viewing window is invalid.');
    d.scheduleSources.forEach(source);
    assert(d.unverifiedLeagues.every(object),'A league status is invalid.');
    assert(typeof value.sleeperUserId==='string'&&/^\d{10,24}$/.test(value.sleeperUserId)&&list(value.sleeperLeagues,12)&&value.sleeperLeagues.every(l=>object(l)&&/^\d{10,24}$/.test(l.id)&&typeof l.name==='string'),'Sleeper settings are invalid.');
    if(value.espnSnapshot)assert(object(value.espnSnapshot)&&object(value.espnSnapshot.league)&&object(value.espnSnapshot.ownTeam)&&object(value.espnSnapshot.opponent),'The ESPN snapshot is invalid.');
    scan(value);return value;
  }
  function portable(guide){
    const copy=JSON.parse(JSON.stringify(guide));
    const urls=new Map((copy.images||[]).map(i=>[i.path,i.imageUrl]));
    for(const c of [...copy.lessons,...copy.stories,...copy.leagueCards])if(c.image&&urls.has(c.image.src))c.image.src=urls.get(c.image.src);
    return copy;
  }
  window.NFLProfile={PROFILE_KEY,PACKETS_KEY,validate:profile,validatePackets:packets,portable};
  let chosen=window.NFL_LOCAL_PROFILE||null;
  try{const stored=localStorage.getItem(PROFILE_KEY);if(stored)chosen=profile(JSON.parse(stored));}catch{window.NFL_PROFILE_ERROR='A saved setup could not be read. Import a fresh FantasyCast setup file from App & backup.';}
  if(chosen){window.NFL_PROFILE=chosen;window.NFL_GUIDE=window.NFL_DELIVERY?.mode==='hosted'?portable(chosen.guide):chosen.guide;}
})();
