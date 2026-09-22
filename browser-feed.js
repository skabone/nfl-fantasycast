(() => {
  'use strict';
  // ESPN's scoreboard references this browser host. Its server-oriented
  // site.api host returned an Akamai 403 in real browser verification.
  const ESPN='https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/',SLEEPER='https://api.sleeper.app/v1/';
  const cache=new Map(),pending=new Map(),aliases={WSH:'WAS',JAC:'JAX',LA:'LAR'};
  let directory={},directoryAt=0,directoryPending=null;
  const stamp=()=>new Date().toISOString(),clone=o=>JSON.parse(JSON.stringify(o)),profile=()=>window.NFL_PROFILE||null;
  const num=v=>v===null||v===undefined||v===''||typeof v==='boolean'||!Number.isFinite(Number(v))?null:Number(v);
  const abbr=v=>aliases[v]||v||null;
  const today=()=>{const p=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return ['year','month','day'].map(k=>p.find(x=>x.type===k).value).join('-');};
  const source=(provider,url,status='live',fetchedAt=null,error=null)=>({provider,url,status,fetchedAt,error});
  function safeURL(value,media=false){try{const u=new URL(value),hosts=['www.espn.com','espn.com','www.nfl.com','nfl.com','sleeper.com','sleeper.app'];if(media)hosts.push('a.espncdn.com','a2.espncdn.com','espnmedia-cdn.akamaized.net','sleepercdn.com');return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&hosts.includes(u.hostname)?u.href:null;}catch{return null;}}
  function providerURL(url){
    const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash)throw Error('Unsupported provider URL');
    if(u.origin==='https://site.web.api.espn.com'&&u.pathname===new URL(ESPN+'scoreboard').pathname&&[...u.searchParams.keys()].join()==='dates'&&/^\d{8}$/.test(u.searchParams.get('dates')))return;
    // The whole fantasy week, so Thursday and Sunday starters keep their verified game while
    // Monday's slate is on screen. Week and season type are bounded to real values.
    if(u.origin==='https://site.web.api.espn.com'&&u.pathname===new URL(ESPN+'scoreboard').pathname&&[...u.searchParams.keys()].sort().join()==='dates,seasontype,week'&&/^[1-9]\d?$/.test(u.searchParams.get('week'))&&['1','2','3'].includes(u.searchParams.get('seasontype'))&&/^\d{4}$/.test(u.searchParams.get('dates')))return;
    if(u.origin==='https://site.web.api.espn.com'&&u.pathname===new URL(ESPN+'summary').pathname&&[...u.searchParams.keys()].join()==='event'&&/^\d{6,12}$/.test(u.searchParams.get('event')))return;
    if(u.origin==='https://api.sleeper.app'&&!u.search){
      if(['/v1/state/nfl','/v1/players/nfl'].includes(u.pathname))return;
      const m=u.pathname.match(/^\/v1\/league\/(\d+)(?:\/(rosters|users|matchups\/[1-9]\d?))?$/);
      if(m&&(profile()?.sleeperLeagues||[]).some(l=>String(l.id)===m[1]))return;
    }
    throw Error('Unsupported provider URL');
  }
  async function fetchJSON(url){
    providerURL(url);const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    try{const response=await fetch(url,{credentials:'omit',mode:'cors',redirect:'error',signal:controller.signal});if(!response.ok)throw Error('Provider HTTP '+response.status);if(Number(response.headers.get('content-length')||0)>30000000)throw Error('Provider response too large');const text=await response.text();if(text.length>30000000)throw Error('Provider response too large');return JSON.parse(text);}finally{clearTimeout(timer);}
  }
  function readCache(key){if(cache.has(key))return cache.get(key);try{const e=JSON.parse(localStorage.getItem('nfl-fantasycast-feed:'+key)||'null');if(e&&Number.isFinite(e.time)&&e.value&&typeof e.value==='object'){cache.set(key,e);return e;}}catch{}return null;}
  function writeCache(key,entry){
    cache.set(key,entry);
    try{
      localStorage.setItem('nfl-fantasycast-feed:'+key,JSON.stringify(entry));
      const rows=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k.startsWith('nfl-fantasycast-feed:')){try{rows.push([k,JSON.parse(localStorage.getItem(k)).time||0]);}catch{}}}
      rows.sort((a,b)=>b[1]-a[1]);for(const [k]of rows.slice(20))localStorage.removeItem(k);
    }catch{/* Memory still preserves the current session if device storage is full. */}
  }
  async function cached(key,label,url,loader,ttl=10000,refresh=false){
    const e=readCache(key);if(e&&Date.now()-e.time<(refresh?3000:ttl))return [clone(e.value),source(label,url,'cached',e.fetchedAt)];
    if(pending.has(key))return clone(await pending.get(key));
    const task=(async()=>{try{const value=await loader(),entry={value,time:Date.now(),fetchedAt:stamp()};writeCache(key,entry);return [clone(value),source(label,url,'live',entry.fetchedAt)];}catch(error){return [e?clone(e.value):{},source(label,url,e?'stale':'unavailable',e?.fetchedAt||null,'Provider did not refresh. Check your connection and try again.')];}})();
    pending.set(key,task);try{return await task;}finally{pending.delete(key);}
  }
  function team(raw={}){const t=raw.team||{},logos=t.logos||[];return {id:String(t.id||raw.id||''),abbr:abbr(t.abbreviation),name:t.displayName||t.name||'Unknown team',logo:safeURL(t.logo||logos[0]?.href,true),score:num(raw.score),quarters:(raw.linescores||[]).map(x=>num(x.value??x.displayValue))};}
  function field(s,home,away){
    const possession=String(s.possession||s.team?.id||'');if(![home.id,away.id].includes(possession))return null;let yards=num(s.yardsToEndzone);
    if(yards===null){const m=(s.possessionText||'').match(/^([A-Z]{2,3})\s+(\d{1,2})$/),own=possession===home.id?home:away;if(m&&Number(m[2])<=50&&[home.abbr,away.abbr].includes(abbr(m[1])))yards=abbr(m[1])===own.abbr?100-Number(m[2]):Number(m[2]);else if(s.possessionText==='50')yards=50;}
    const rawDown=num(s.down),down=[1,2,3,4].includes(rawDown)?rawDown:null,rawDistance=num(s.distance),distance=down!==null&&rawDistance!==null&&rawDistance>=0?rawDistance:null;
    return yards===null||yards<0||yards>100?null:{yardsToEndzone:yards,possessionTeamId:possession,distance,down,label:s.downDistanceText||s.possessionText||null};
  }
  function game(e){const c=e.competitions?.[0]||{},rows=c.competitors||[],home=team(rows.find(t=>t.homeAway==='home')),away=team(rows.find(t=>t.homeAway==='away')),status=e.status||c.status||{},s=c.situation||{},id=String(e.id||c.id||''),state=['pre','in','post'].includes(status.type?.state)?status.type.state:'unknown';return {id,name:e.name||`${away.name} at ${home.name}`,shortName:e.shortName||`${away.abbr} @ ${home.abbr}`,startTime:e.date||c.date||null,state,status:status.type?.detail||status.type?.description||'Status unavailable',period:num(status.period),clock:status.displayClock||null,home,away,week:typeof e.week==='object'?e.week?.number:e.week||null,season:typeof e.season==='object'?e.season?.year:e.season||null,possessionTeamId:state==='in'&&s.possession!=null?String(s.possession):null,downDistance:state==='in'?s.downDistanceText||null:null,lastPlay:s.lastPlay?.text||null,fieldPosition:state==='in'?field(s,home,away):null,sourceUrl:'https://www.espn.com/nfl/game/_/gameId/'+id,venue:c.venue?.fullName||null};}
  function board(raw){const games=[...new Map((raw.events||[]).map(e=>{const g=game(e);return [g.id,g];})).values()].filter(g=>g.id);return {games,week:raw.week?.number||null,season:games.find(g=>g.season)?.season||null};}
  function detail(raw,id){
    const g=game(raw.header||{id});if(g.id!==id)throw Error('Game identity mismatch');const leaders=[],players=new Map(),plays=new Map(),highlights=new Map();
    for(const group of raw.leaders||[])for(const category of group.leaders||[])for(const row of category.leaders||[]){const a=row.athlete||{};leaders.push({category:category.displayName||category.name,teamId:String(group.team?.id||''),athlete:{id:String(a.id||''),name:a.displayName,photo:safeURL(a.headshot?.href,true),team:abbr(group.team?.abbreviation)},displayValue:row.displayValue,value:num(row.value)});}
    for(const group of raw.boxscore?.players||[])for(const category of group.statistics||[])for(const row of category.athletes||[]){const a=row.athlete||{},pid=String(a.id||'');if(!pid)continue;const p=players.get(pid)||{id:pid,name:a.displayName,team:abbr(group.team?.abbreviation),photo:safeURL(a.headshot?.href,true),statistics:[]};(category.labels||[]).forEach((label,i)=>{if(i<(row.stats||[]).length)p.statistics.push({category:category.name,label,value:String(row.stats[i])});});players.set(pid,p);}
    for(const p of players.values()){const categories={};for(const s of p.statistics)(categories[s.category]||=[]).push(`${s.value} ${s.label}`);p.statLine=Object.entries(categories).filter(([k])=>['passing','rushing','receiving','kicking','fumbles'].includes(k)).map(([k,v])=>k[0].toUpperCase()+k.slice(1)+': '+v.join(', ')).join(' · ');}
    const drives=[...(raw.drives?.previous||[]),...(raw.drives?.current?[raw.drives.current]:[])],rows=drives.flatMap(d=>(d.plays||[]).map(p=>[p,d.team?.id]));rows.push(...(raw.scoringPlays||[]).map(p=>[p,p.team?.id]));
    for(const [p,driveTeam]of rows){const pid=String(p.id||'');if(!pid)continue;const offense=(p.teamParticipants||[]).find(t=>t.type==='offense')?.id||driveTeam;const q={id:pid,text:p.text||'',period:num(p.period?.number),clock:p.clock?.displayValue||null,scoring:!!p.scoringPlay,teamId:offense==null?null:String(offense),homeScore:num(p.homeScore),awayScore:num(p.awayScore),sequence:num(p.sequenceNumber)??num(pid),end:p.end||{},wallclock:p.wallclock||null};if(!plays.has(pid)||Object.keys(q.end).length>Object.keys(plays.get(pid).end).length)plays.set(pid,q);}
    const ordered=[...plays.values()].sort((a,b)=>(b.sequence||0)-(a.sequence||0));if(ordered.length){g.lastPlay=ordered[0].text;if(g.state==='in'){const end=ordered[0].end,hasScrimmageDown=[1,2,3,4].includes(num(end.down));g.fieldPosition=hasScrimmageDown?field(end,g.home,g.away):null;g.possessionTeamId=g.fieldPosition?.possessionTeamId||null;g.downDistance=hasScrimmageDown?end.downDistanceText||null:null;}}
    for(const p of ordered){delete p.sequence;delete p.end;}
    for(const v of raw.videos||[]){const url=safeURL(v.links?.web?.href);if(url)highlights.set(String(v.id||url),{id:String(v.id||url),title:v.headline,description:v.description,thumbnail:safeURL(v.thumbnail,true),url,publishedAt:v.originalPublishDate||null,duration:num(v.duration),expiresAt:v.timeRestrictions?.expirationDate||null,provider:'ESPN'});}
    return {id,game:g,leaders,players:[...players.values()],plays:ordered,highlights:[...highlights.values()],fieldPosition:g.fieldPosition,lastPlay:g.lastPlay,notices:[]};
  }
  async function players(){if(Object.keys(directory).length&&Date.now()-directoryAt<86400000)return directory;if(directoryPending)return directoryPending;directoryPending=fetchJSON(SLEEPER+'players/nfl').then(d=>{if(!d||Array.isArray(d)||typeof d!=='object')throw Error('Player directory unavailable');directory=d;directoryAt=Date.now();return d;}).finally(()=>{directoryPending=null;});return directoryPending;}
  function matchup(league,rosters,users,matches,directory,week,userId){
    const ownRoster=rosters.find(r=>String(r.owner_id)===userId||(r.co_owners||[]).includes(userId));if(!ownRoster)throw Error('Own roster not found');const own=matches.find(m=>m.roster_id===ownRoster.roster_id);if(!own)throw Error('Current matchup unavailable');const opponents=matches.filter(m=>own.matchup_id!=null&&m.matchup_id===own.matchup_id&&m.roster_id!==own.roster_id);if(opponents.length>1)throw Error('Ambiguous matchup');
    const slots=(league.roster_positions||[]).filter(s=>!['BN','IR','TAXI'].includes(s));
    function normalize(m,r){const u=users.find(u=>u.user_id===r.owner_id)||{},starters=m.starters||[],reserves=r.reserve||[],taxi=r.taxi||[];
      function player(pid,slot,i){pid=String(pid);const p=directory[pid]||{},espnId=p.espn_id?String(p.espn_id):null,pos=p.position||(/^[A-Z]{2,3}$/.test(pid)?'DEF':null),value=m.players_points?.[pid]??(i===undefined?null:m.starters_points?.[i]);return {id:pid,name:p.full_name||[p.first_name,p.last_name].filter(Boolean).join(' ')||(pos==='DEF'?pid+' D/ST':pid==='0'?'Empty slot':'Player '+pid),position:pos,team:abbr(p.team)||(pos==='DEF'?pid:null),slot,points:num(value),injuryStatus:p.injury_status||null,espnId,photo:espnId&&/^\d+$/.test(espnId)?'https://a.espncdn.com/i/headshots/nfl/players/full/'+espnId+'.png':null,gameId:null,status:null,statLine:''};}
      return {name:u.metadata?.team_name||u.display_name||'Team '+r.roster_id,rosterId:r.roster_id,points:num(m.custom_points??m.points),commissionerOverride:m.custom_points!=null,starters:starters.map((p,i)=>player(p,slots[i]||'FLEX',i)),bench:[...new Set(m.players||r.players||[])].filter(p=>!starters.includes(p)).map(p=>player(p,reserves.includes(p)?'IR':taxi.includes(p)?'TAXI':'BN')),record:{wins:r.settings?.wins??null,losses:r.settings?.losses??null,ties:r.settings?.ties??null}};
    }
    const opp=opponents[0],oppRoster=opp&&rosters.find(r=>r.roster_id===opp.roster_id);return {available:true,week,matchupId:own.matchup_id,own:normalize(own,ownRoster),opponent:opp&&oppRoster?normalize(opp,oppRoster):null};
  }
  async function liveMatchup(id,week,p){const prefix=SLEEPER+'league/'+id,[l,r,u,m,people]=await Promise.all([fetchJSON(prefix),fetchJSON(prefix+'/rosters'),fetchJSON(prefix+'/users'),fetchJSON(prefix+'/matchups/'+week),players()]);return {league:{id,name:l.name,platform:'Sleeper',season:l.season,slots:(l.roster_positions||[]).filter(s=>s!=='BN'),scoringSettings:l.scoring_settings||{},sourceUrl:'https://sleeper.com/leagues/'+id+'/matchup'},matchup:matchup(l,r,u,m,people,week,String(p.sleeperUserId))};}
  function snapshot(raw){
    const l=raw.league||{},id='espn-'+l.id+'-'+raw.ownTeam?.id;
    function team(r){const entries=(r.players||[]).map((p,i)=>{const labels={passing_yards:'pass yd',passing_touchdowns:'pass TD',interceptions_thrown:'INT',rushing_attempts:'CAR',rushing_yards:'rush yd',rushing_touchdowns:'rush TD',receptions:'REC',receiving_yards:'rec yd',receiving_touchdowns:'rec TD',targets:'TGT'};const matches=Object.values(directory).filter(x=>x.full_name===p.name&&abbr(x.team)===abbr(p.team)),espnId=matches.length===1&&matches[0].espn_id?String(matches[0].espn_id):null;return {id:'espn-'+r.id+'-'+i,name:p.name,position:p.position==='D/ST'?'DEF':p.position,team:abbr(p.team),slot:p.slot==='Bench'?'BN':p.slot,points:num(p.points),injuryStatus:p.injuryStatus||null,espnId,photo:espnId&&/^\d+$/.test(espnId)?'https://a.espncdn.com/i/headshots/nfl/players/full/'+espnId+'.png':null,gameId:null,status:null,statLine:Object.entries(p.stats||{}).filter(([k,v])=>labels[k]&&v!==0).map(([k,v])=>v+' '+labels[k]).join(' · '),statSource:source('ESPN fantasy capture',raw.sourceUrls?.matchup,'snapshot',raw.observedAt)};});return {name:r.name,rosterId:r.id,points:num(r.points),starters:entries.filter(p=>p.slot!=='BN'),bench:entries.filter(p=>p.slot==='BN'),record:Object.fromEntries(String(r.record||'').split('-').map((v,i)=>[['wins','losses','ties'][i],num(v)]))};}
    return {league:{id,name:l.name,platform:'ESPN',season:l.season,slots:l.lineupSlots||[],scoringSettings:l.scoring||{},sourceUrl:raw.sourceUrls?.matchup},matchup:{available:true,week:l.week,matchupId:l.matchupPeriodId,own:team(raw.ownTeam||{}),opponent:raw.opponent?team(raw.opponent):null}};
  }
  function savedOwn(p,id){const l=p?.guide?.leagues?.find(l=>l.id===id);if(!l)return {league:null,matchup:{available:false,week:null,matchupId:null,own:null,opponent:null}};const player=x=>({id:x.playerId,name:x.name,position:x.position,team:x.nflTeam,slot:x.lineupSlot||'BN',points:null,injuryStatus:x.providerInjuryStatus||null,espnId:null,photo:null,gameId:null,status:null,statLine:''}),r=l.roster||{};return {league:{id:l.id,name:l.name,platform:'Sleeper',season:l.season,slots:l.lineupSlots,scoringSettings:l.scoringSettings},matchup:{available:false,week:null,matchupId:null,own:{name:l.teamDisplayName,rosterId:l.rosterId,points:null,starters:(r.starters||[]).map(player),bench:['bench','injuredReserve','taxi'].flatMap(k=>(r[k]||[]).map(player)),record:l.record},opponent:null}};}
  async function getDashboard(date=today(),leagueId=null,refresh=false){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T12:00:00Z'))||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date||Math.abs(Date.parse(date+'T12:00:00Z')-Date.parse(today()+'T12:00:00Z'))>370*86400000)throw Error('Choose a valid game date within one year of today.');
    const p=profile(),configured=p?.sleeperLeagues||[],es=p?.espnSnapshot,espnId=es?'espn-'+es.league?.id+'-'+es.ownTeam?.id:null;leagueId=leagueId||configured[0]?.id||espnId;
    if(leagueId&&leagueId!=='none'&&!configured.some(l=>String(l.id)===String(leagueId))&&leagueId!==espnId)throw Error('Import a profile containing this league first.');
    const url=ESPN+'scoreboard?dates='+date.replace(/-/g,''),[[b,bs],[state,ss]]=await Promise.all([cached('board:'+date,'ESPN NFL scoreboard',url,async()=>board(await fetchJSON(url)),10000,refresh),cached('state:nfl','Sleeper NFL week',SLEEPER+'state/nfl',()=>fetchJSON(SLEEPER+'state/nfl'),3600000)]);
    const week=num(state.week),season=state.season||null,sources=[bs,ss],notices=["Fantasy points are the platform's league-scored totals. Game feeds and fantasy points can update at different times."],games=b.games||[];let fantasy={},fs;
    if(leagueId==='none')return {date,generatedAt:stamp(),week,gameWeek:b.week||null,season,league:null,games,weekGames:games,matchup:{available:false,week:null,matchupId:null,own:null,opponent:null,reason:'No fantasy teams selected.'},sources,notices:['Choose teams to connect fantasy matchups. The NFL scoreboard remains available.']};
    if(leagueId&&leagueId===espnId){try{await players();}catch{}fantasy=snapshot(es);fs=source('ESPN fantasy capture',es.sourceUrls?.matchup,'snapshot',es.observedAt);notices.push('ESPN fantasy scores are a dated imported capture; they do not auto-refresh. NFL games refresh independently.');}
    else if(leagueId&&week&&p?.sleeperUserId){const url=SLEEPER+'league/'+leagueId+'/matchups/'+week;[fantasy,fs]=await cached('matchup:'+p.sleeperUserId+':'+leagueId+':'+season+':'+week,'Sleeper weekly matchup',url,()=>liveMatchup(String(leagueId),week,p),10000,refresh);}
    else{fs=source('Fantasy profile',null,'unavailable',null,p?'Current fantasy week is unavailable.':'Import your private profile to connect your teams.');notices.push(p?'Current fantasy week is unavailable.':'Import your private profile to connect your teams. The NFL scoreboard works without a profile.');}
    sources.push(fs);if(!fantasy.matchup){fantasy=savedOwn(p,leagueId);if(fantasy.matchup.own){sources.push(source('Saved own roster',null,'snapshot',p.guide.rosterCheckedAt||p.guide.rosterAsOf));notices.push('Live fantasy scoring is unavailable. The saved roster is dated; points and opponent are withheld.');}}
    // The fantasy matchup owns a whole NFL week; the date picker owns one day of it. Link against
    // the week so an earlier starter keeps its verified game and final statistics while a later
    // slate is on screen. Week and season still have to match before anything is linked.
    const targetWeek=fantasy.matchup?.week,targetSeason=String(fantasy.league?.season||season||'');let weekGames=games;
    if(/^[1-9]\d?$/.test(String(targetWeek||''))&&/^\d{4}$/.test(targetSeason)){
      const type={pre:'1',regular:'2',post:'3'}[String(state.season_type||'regular')]||'2';
      const wurl=ESPN+'scoreboard?week='+Number(targetWeek)+'&seasontype='+type+'&dates='+targetSeason;
      const [wb,ws2]=await cached('weekboard:'+targetSeason+':'+type+':'+targetWeek,'ESPN NFL week',wurl,async()=>board(await fetchJSON(wurl)),10000,refresh);
      sources.push(ws2);const known=new Set(games.map(g=>String(g.id)));
      weekGames=games.concat((wb.games||[]).filter(g=>!known.has(String(g.id))));
      if(['stale','unavailable'].includes(ws2.status))notices.push('The full-week NFL feed did not refresh. Players outside the selected date may show as unlinked until it succeeds.');
    }
    for(const side of ['own','opponent'])for(const player of [...(fantasy.matchup[side]?.starters||[]),...(fantasy.matchup[side]?.bench||[])]){const g=weekGames.find(g=>[g.home.abbr,g.away.abbr].includes(player.team)&&g.week===fantasy.matchup.week&&String(g.season)===String(fantasy.league?.season||season));if(g){player.gameId=g.id;player.status=g.state;}}
    if(sources.some(s=>['stale','unavailable'].includes(s.status)))notices.push('Check the source times: at least one feed is unavailable or retained from an earlier capture.');
    if(fantasy.matchup.available&&b.week&&(b.week!==fantasy.matchup.week||String(b.season)!==String(fantasy.league?.season||season)))notices.push(`The selected NFL date is week ${b.week}; your fantasy matchup is week ${fantasy.matchup.week}. Your players stay linked to their own week; games from a different week or season are never linked to this lineup.`);
    return {date,generatedAt:stamp(),week,gameWeek:b.week||null,season,league:fantasy.league,games,weekGames,matchup:fantasy.matchup,sources,notices};
  }
  async function getGame(id,refresh=false){id=String(id);if(!/^\d{6,12}$/.test(id))throw Error('Choose a valid NFL game.');const url=ESPN+'summary?event='+id,[d,s]=await cached('game:'+id,'ESPN NFL game details',url,async()=>detail(await fetchJSON(url),id),10000,refresh);if(!d.id)Object.assign(d,{id,game:null,leaders:[],players:[],plays:[],highlights:[],fieldPosition:null,lastPlay:null,notices:['Game details are unavailable. Try Refresh again.']});if(s.status==='stale')d.notices.push('Game details retain the last successful capture; the feed did not refresh.');return {...d,sources:[s],generatedAt:stamp()};}
  window.NFLBrowserFeed={getDashboard,getGame};
})();
