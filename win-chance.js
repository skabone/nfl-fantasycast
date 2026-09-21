(() => {
  'use strict';
  const latest=new Map(),FRESH_MS=60*60*1000;
  function snapshots(){
    const p=window.NFL_PROFILE;if(!p)return [];
    const local=window.NFL_DELIVERY?.mode!=='hosted'&&window.NFL_LOCAL_PROFILE?.sleeperUserId===p.sleeperUserId?window.NFL_LOCAL_PROFILE:null;
    const rows=[...(p.winChanceSnapshots||[]),...(local?.winChanceSnapshots||[])];
    const allowed=new Set((p.sleeperLeagues||[]).map(l=>l.id));
    if(p.espnSnapshot)allowed.add(`espn-${p.espnSnapshot.league.id}-${p.espnSnapshot.ownTeam.id}`);
    const chosen=new Map();
    for(const row of rows){
      if(!allowed.has(row?.leagueId))continue;
      try{window.NFLProfile.validateWinChances([row],p);}catch{continue;}
      const roster=row.provider==='ESPN'?p.espnSnapshot?.ownTeam?.id:p.guide?.leagues?.find(l=>l.id===row.leagueId)?.rosterId;
      if(roster!=null&&String(roster)!==String(row.ownRosterId))continue;
      if(!chosen.has(row.leagueId)||Date.parse(row.observedAt)>Date.parse(chosen.get(row.leagueId).observedAt))chosen.set(row.leagueId,row);
    }
    return [...chosen.values()].map(row=>({...row}));
  }
  function observeMatchups(records){
    let changed=false;
    for(const record of records||[]){const d=record.data;if(!d?.matchup?.week)continue;const id=String(d.league?.id||record.league?.id||'');if(!id)continue;const value={week:d.matchup.week,season:d.league?.season||d.season,rosterId:d.matchup.own?.rosterId};if(JSON.stringify(latest.get(id))!==JSON.stringify(value)){latest.set(id,value);changed=true;}}
    if(changed||records?.length)document.dispatchEvent(new CustomEvent('nfl:win-chance-update'));
  }
  function summaries(leagues,{now=Date.now()}={}){
    const byId=new Map(snapshots().map(row=>[row.leagueId,row]));
    const rows=leagues.map(league=>{
      const base={leagueId:league.id,percent:null,kind:'unavailable',label:'Chance not captured',meta:'Platform percentage needed',detail:'No verified platform win percentage is saved for this team.',attentionRank:null,sourceUrl:null,stale:false};
      const row=byId.get(league.id);if(!row)return base;
      const checked=Date.parse(row.observedAt),age=now-checked,current=latest.get(league.id),prior=current&&(Number(current.week)!==row.week||current.season&&Number(current.season)!==row.season),wrongTeam=current?.rosterId!=null&&String(current.rosterId)!==String(row.ownRosterId);
      const full=new Date(checked).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}),short=age<86400000?new Date(checked).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}):full;
      if(prior||wrongTeam)return {...base,label:prior?'Prior-week chance':'Different team capture',meta:`Saved ${full}`,detail:`The saved percentage is for ${row.season}, week ${row.week}. A matching current capture is needed.`,sourceUrl:row.sourceUrl,stale:true};
      if(!Number.isFinite(row.ownPercent))return {...base,meta:`Checked ${short} · ${row.provider}`,detail:'The platform did not display a verified win percentage at this check.',sourceUrl:row.sourceUrl};
      const stale=age>FRESH_MS||age< -300000;
      return {...base,percent:row.ownPercent,kind:'snapshot',label:`${row.ownPercent}% to win`,meta:`${stale?'Older capture':'Saved'} ${short} · ${row.provider}`,detail:`${row.provider} showed ${row.ownPercent}% to win on ${full}, ${row.season} week ${row.week}. This is a captured platform prediction. Live scores do not update it; request a fresh capture or import a newer setup to refresh it.${stale?' This capture is excluded from closest-matchup focus.':''}`,sourceUrl:row.sourceUrl,stale};
    });
    rows.filter(row=>row.percent>=10&&row.percent<=90&&!row.stale&&latest.has(row.leagueId)&&Number(latest.get(row.leagueId).season)===byId.get(row.leagueId).season).sort((a,b)=>Math.abs(a.percent-50)-Math.abs(b.percent-50)||leagues.findIndex(l=>l.id===a.leagueId)-leagues.findIndex(l=>l.id===b.leagueId)).slice(0,2).forEach((row,i)=>{row.attentionRank=i+1;});
    return rows;
  }
  window.NFLWinChance={snapshots,summaries,observeMatchups};
})();
