(() => {
  'use strict';
  const list=v=>Array.isArray(v)?v:[], finite=v=>typeof v==='number'&&Number.isFinite(v);
  const round=v=>Math.round((v+Number.EPSILON)*100)/100;
  const name=v=>String(v||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/(?:\s+(?:jr|sr|ii|iii|iv|v))+$/,'');
  const palette=[['#2857b8','#dce7fc'],['#237650','#dceee3'],['#94600b','#f4e8cb'],['#a43c62','#f8e1eb'],['#127580','#d9eef0']];
  function color(id,leagues){const i=Math.max(0,list(leagues).findIndex(l=>String(l.id)===String(id)));const [ink,tint]=palette[i%palette.length];return {ink,tint,index:i};}
  function source(record){return list(record?.data?.sources).find(x=>x.status==='snapshot'&&/fantasy|capture/i.test(x.provider||''))||list(record?.data?.sources).find(x=>/matchup|fantasy/i.test(x.provider||''));}
  function freshness(record,now=Date.now()){const x=source(record),time=Date.parse(x?.fetchedAt);return record?.error?'stale':x?.status==='snapshot'?'snapshot':!x||!Number.isFinite(time)?'unknown':['stale','unavailable'].includes(x.status)||now-time>120000?'stale':'current';}
  function linked(p,games){return p?.gameId?list(games).find(g=>String(g.id)===String(p.gameId)):null;}
  function activity(p,games,fresh=true){
    const g=linked(p,games);if(!g)return {key:'unknown',label:'Game not linked on this date',game:null};
    if(g.state==='post')return {key:'final',label:'Final',game:g};
    if(g.state==='pre')return {key:'upcoming',label:g.status||'Upcoming',game:g};
    if(g.state!=='in')return {key:'unknown',label:g.status||'Status unavailable',game:g};
    if(!fresh||g.stale)return {key:'live',label:'In progress · possession unconfirmed',game:g};
    const team=[g.home,g.away].find(t=>t?.abbr===p.team),possession=String(g.possessionTeamId||'');
    if(!team||![String(g.home?.id),String(g.away?.id)].includes(possession))return {key:'live',label:'In progress · possession unconfirmed',game:g};
    const defense=['DEF','DST','D/ST'].includes(p.position),active=defense?String(team.id)!==possession:String(team.id)===possession;
    const redZone=finite(g.fieldPosition?.yardsToEndzone)&&g.fieldPosition.yardsToEndzone<=20&&String(g.fieldPosition.possessionTeamId)===possession;
    return {key:active?'active':'waiting',label:active?(defense?'Defense on the field':p.team+' on offense')+(redZone?' · red zone':''):(defense?'Your defense’s team has the ball':p.team+' awaiting possession'),redZone:active&&redZone,game:g};
  }
  function counts(players,games){const result={live:0,upcoming:0,final:0,unknown:0};for(const p of list(players)){const state=linked(p,games)?.state;result[state==='in'?'live':state==='pre'?'upcoming':state==='post'?'final':'unknown']++;}return result;}
  function boxPlayer(p,detail){
    if(!detail||String(detail.id)!==String(p.gameId))return null;
    const players=list(detail.players);
    if(p.espnId)return players.find(x=>String(x.id)===String(p.espnId)&&x.team===p.team)||null;
    const matches=players.filter(x=>x.team===p.team&&name(x.name)===name(p.name));return matches.length===1?matches[0]:null;
  }
  function compactStats(p,detail){
    const row=boxPlayer(p,detail),stats=list(row?.statistics),result=[];
    const add=(cat,label,title)=>{const x=stats.find(x=>x.category===cat&&x.label===label);if(x)result.push(x.value+' '+title);};
    if(p.position==='QB'){add('passing','C/ATT','CMP/ATT');add('passing','YDS','pass yd');add('passing','TD','pass TD');add('passing','INT','INT');}
    add('rushing','CAR','car');add('rushing','YDS','rush yd');add('rushing','AVG','YPC');add('rushing','TD','rush TD');
    add('receiving','REC','rec');add('receiving','YDS','rec yd');add('receiving','TGTS','tgt');add('receiving','TD','rec TD');
    add('kicking','FG','FG');add('kicking','XP','XP');add('fumbles','LOST','fumbles lost');
    return result.join(' · ')||row?.statLine||p.statLine||'';
  }
  function outlook(records,games){return list(records).map(record=>{const m=record.data?.matchup,l={...record.league,...record.data?.league};const gap=finite(m?.own?.points)&&finite(m?.opponent?.points)?round(m.own.points-m.opponent.points):null;return {record,league:l,gap,freshness:freshness(record),own:counts(m?.own?.starters,games),opponent:counts(m?.opponent?.starters,games)};});}
  const events={
    receiving:{label:'10 receiving yards',stats:{rec_yd:10},positions:['WR','TE','RB'],max:30},
    catch:{label:'A catch for 10 yards',stats:{rec:1,rec_yd:10},positions:['WR','TE','RB'],max:15},
    rushing:{label:'10 rushing yards',stats:{rush_yd:10},positions:['RB','QB','WR'],max:30},
    passing:{label:'25 passing yards',stats:{pass_yd:25},positions:['QB'],max:20},
    rushTD:{label:'A rushing touchdown (yards separate)',stats:{rush_td:1},positions:['RB','QB','WR'],max:4},
    recTD:{label:'A receiving touchdown (catch / yards separate)',stats:{rec_td:1},positions:['WR','TE','RB'],max:4},
    passTD:{label:'A passing touchdown (yards separate)',stats:{pass_td:1},positions:['QB'],max:4},
    sack:{label:'A defensive sack',stats:{sack:1},positions:['DEF','DST','D/ST'],max:10},
    extra:{label:'An extra point made',stats:{xpm:1},positions:['K'],max:10}
  };
  function eventKeys(p){return Object.keys(events).filter(k=>events[k].positions.includes(p?.position));}
  function eventPoints(p,settings,event){
    const e=events[event];if(!e||!settings||!Object.keys(settings).length||!e.positions.includes(p.position))return null;
    if(Object.keys(e.stats).some(k=>!finite(settings[k])))return null;
    let total=Object.entries(e.stats).reduce((n,[k,v])=>n+settings[k]*v,0);
    if(e.stats.rec){const bonus=settings['bonus_rec_'+String(p.position).toLowerCase()];if(finite(bonus))total+=bonus*e.stats.rec;}
    return round(total);
  }
  function coefficient(player,record,event){
    const impacts=list(player?.impacts).filter(e=>e.category==='starters'&&String(e.league.id)===String(record.league.id));
    if(!impacts.length)return 0;
    let value=0;for(const e of impacts){const rate=eventPoints(e.player,record.data?.league?.scoringSettings,event);if(rate===null)return null;value+=(e.side==='own'?1:-1)*rate;}return round(value);
  }
  function scenario(records,variables){
    return list(records).map(record=>{const m=record.data?.matchup;let own=0,opponent=0,available=finite(m?.own?.points)&&finite(m?.opponent?.points);for(const v of variables){if(!v.player||!v.count)continue;for(const e of list(v.player.impacts).filter(e=>e.category==='starters'&&String(e.league.id)===String(record.league.id))){const pts=eventPoints(e.player,record.data?.league?.scoringSettings,v.event);if(pts===null){available=false;continue;}if(e.side==='own')own+=pts*v.count;else opponent+=pts*v.count;}}
      return {league:record.data?.league||record.league,gap:available?round(m.own.points-m.opponent.points+own-opponent):null,ownDelta:round(own),opponentDelta:round(opponent),freshness:freshness(record)};
    });
  }
  function path(records,variables){
    if(!records.length||variables.length!==2||variables.some(v=>!v.player||!events[v.event])||variables[0].player.id===variables[1].player.id)return null;
    // Search only the two named event counts; never claim infeasibility of a full NFL game.
    const coefficients=records.map(r=>({gap:finite(r.data?.matchup?.own?.points)&&finite(r.data?.matchup?.opponent?.points)?r.data.matchup.own.points-r.data.matchup.opponent.points:null,a:coefficient(variables[0].player,r,variables[0].event),b:coefficient(variables[1].player,r,variables[1].event)}));
    if(coefficients.some(r=>r.gap===null||r.a===null||r.b===null)||records.some(r=>freshness(r)!=='current'))return null;
    const maxA=events[variables[0].event].max,maxB=events[variables[1].event].max;
    let best=null;
    for(let a=0;a<=maxA;a++)for(let b=0;b<=maxB;b++)if(coefficients.every(r=>round(r.gap+r.a*a+r.b*b)>0)&&(!best||a+b<best.a+best.b))best={a,b};
    return {best,maxA,maxB};
  }
  function changes(previous,current,aggregate,now=new Date().toISOString()){
    const grouped=new Map();for(const record of list(current)){const old=list(previous).find(r=>String(r.league.id)===String(record.league.id));const a=old?.data?.matchup,b=record.data?.matchup;
      if(!a||!b||a.week!==b.week||String(old.data?.league?.season)!==String(record.data?.league?.season)||a.matchupId!==b.matchupId||freshness(record)!=='current'||freshness(old)==='snapshot')continue;
      const beforeTime=Date.parse(source(old)?.fetchedAt),afterTime=Date.parse(source(record)?.fetchedAt);if(!Number.isFinite(beforeTime)||!(afterTime>beforeTime))continue;
      for(const side of ['own','opponent']){if(!a[side]||!b[side]||a[side].rosterId!==b[side].rosterId)continue;for(const p of list(b[side].starters)){const before=list(a[side].starters).find(x=>String(x.id)===String(p.id));if(!finite(p.points)||!finite(before?.points))continue;const delta=round(p.points-before.points);if(!delta)continue;
        const player=list(aggregate?.[side]).find(x=>list(x.impacts).some(e=>String(e.league.id)===String(record.league.id)&&e.side===side&&String(e.player.id)===String(p.id)));
        const id=player?.id||String(record.league.id)+':'+p.id,item=grouped.get(id)||{id,name:p.name,at:now,impacts:[]};item.impacts.push({league:record.data.league||record.league,side,delta,benefit:side==='own'?delta:-delta,at:source(record)?.fetchedAt});grouped.set(id,item);
      }}
    }return [...grouped.values()];
  }
  window.NFLGameInsights={color,freshness,source,activity,counts,boxPlayer,compactStats,outlook,events,eventKeys,eventPoints,coefficient,scenario,path,changes};
})();
