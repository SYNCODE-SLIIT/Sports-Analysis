/* Standalone Match Details page */
(function(){
  const loc = window.location;
  let apiBase = loc.origin;
  if(loc.port && loc.port !== '8000'){
    apiBase = loc.protocol + '//' + loc.hostname + ':8000';
  }
  // Expose globally so shared utilities (timeline.js) can use it
  try{ window.apiBase = apiBase; }catch(_e){}

  // Elements
  const matchTitle = document.getElementById('matchTitle');
  const pageStatus = document.getElementById('pageStatus');
  const matchInfo = document.getElementById('matchInfo');
  const detailsInfo = document.getElementById('details_info');

  const summaryEl = document.querySelector('#summary .summary-body');
  const highlightsBody = document.querySelector('#highlights .hl-body');

  // Controls
  const augmentBtn = document.getElementById('augmentTagsBtn');
  const playerBtn = document.getElementById('playerAnalyticsBtn');
  const multimodalBtn = document.getElementById('multimodalBtn');

  function setStatus(t){ if(pageStatus) pageStatus.textContent = t; }
  function clear(el){ while(el && el.firstChild) el.removeChild(el.firstChild); }

  // Collect API
  async function callIntent(intent, args){
    const resp = await fetch(apiBase + '/collect', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({intent, args}) });
    if(!resp.ok) throw new Error(`HTTP ${resp.status} for ${intent}`);
    return resp.json();
  }

  function extractEventId(ev){
    return ev.idEvent || ev.event_key || ev.eventId || ev.match_id || ev.id || ev.fixture_id || ev.game_id || ev.tsdb_event_id || '';
  }

  function getQuery(){
    const u = new URL(window.location.href);
    return { eventId: u.searchParams.get('eventId') || u.searchParams.get('matchId') || '', sid: u.searchParams.get('sid') || '' };
  }

  async function load(){
    try{
      setStatus('Loading…');
      const {eventId, sid} = getQuery();
      let ev = null;
      if(sid){ try{ const raw = sessionStorage.getItem('sa_selected_event_' + sid); if(raw) ev = JSON.parse(raw); }catch(_e){} }
      // If we have an id, fetch the full event
      const id = eventId || (ev ? extractEventId(ev) : '');
      if(id){
        try{
          const j = await callIntent('event.get', { eventId: id, augment_tags: true, include_best_player: true });
          const data = j && (j.data || j.result || j.event || j.events || j.fixtures);
          let cand = null;
          if(Array.isArray(data) && data.length) cand = data[0];
          else if(data && typeof data === 'object') cand = data.event || data.result || data;
          if(cand) ev = Object.assign({}, ev||{}, cand);
        }catch(e){ console.warn('event.get failed', e); }
      }
      if(!ev){ throw new Error('No event context available'); }

      // Try to enrich with commentary for better timeline synthesis (cards/subs often live in comments)
      try{
        const idForComments = eventId || (ev ? extractEventId(ev) : '');
        if(idForComments){
          const comm = await callIntent('comments.list', { matchId: String(idForComments) }).catch(()=> null);
          if(comm){
            let arr = [];
            const d = comm.data || comm.result || comm.comments || comm;
            if(Array.isArray(d)) arr = d;
            else if (d && Array.isArray(d.data)) arr = d.data;
            else if (d && d.result && typeof d.result === 'object'){
              const vals = Object.values(d.result).filter(Boolean);
              arr = vals.reduce((acc, cur)=> acc.concat(Array.isArray(cur)?cur:[]), []);
            }
            if(Array.isArray(arr) && arr.length){
              // attach under common keys checked by synthesizeTimelineFromEvent
              ev.commentary = arr;
              ev.comments = arr;
            }
          }
        }
      }catch(_e){ /* non-fatal */ }

      // Prefetch players for both teams to enable player image resolution in timeline
      try{
        const homeName = ev.event_home_team || ev.strHomeTeam || ev.home_team || '';
        const awayName = ev.event_away_team || ev.strAwayTeam || ev.away_team || '';
        if(homeName || awayName){
          const [homeRes, awayRes] = await Promise.allSettled([
            homeName ? callIntent('players.list', { teamName: homeName }) : Promise.resolve(null),
            awayName ? callIntent('players.list', { teamName: awayName }) : Promise.resolve(null),
          ]);
          const extractPlayers = (settled)=>{
            if(!settled || settled.status !== 'fulfilled' || !settled.value) return [];
            const j = settled.value;
            const d = j.data || j.result || j.players || j;
            if(Array.isArray(d)) return d;
            if(d && Array.isArray(d.result)) return d.result;
            if(d && d.data && Array.isArray(d.data)) return d.data;
            if(d && d.result && typeof d.result === 'object'){
              const vals = Object.values(d.result).filter(Boolean);
              return vals.reduce((acc, cur)=> acc.concat(Array.isArray(cur)?cur:[]), []);
            }
            return [];
          };
          const homePlayers = extractPlayers(homeRes);
          const awayPlayers = extractPlayers(awayRes);
          if(homePlayers.length) ev.players_home = homePlayers;
          if(awayPlayers.length) ev.players_away = awayPlayers;
          const combined = [...(homePlayers||[]), ...(awayPlayers||[])];
          if(combined.length) ev.players = combined;
        }
      }catch(_e){ /* non-fatal */ }

      // Render header title
      const home = ev.event_home_team || ev.strHomeTeam || ev.home_team || '';
      const away = ev.event_away_team || ev.strAwayTeam || ev.away_team || '';
      matchTitle.textContent = `${home || 'Home'} vs ${away || 'Away'}`;
  // Render the match header card section
  renderMatchHeader(ev);

      // Details + summary
      try{ ev.timeline = buildMergedTimeline(ev); }catch(_e){ try{ ev.timeline = buildCleanTimeline(ev); }catch(_e2){} }
      renderEventDetails(ev, detailsInfo);
      // Insert best player UI after the timeline card (so it doesn't interfere with summary)
      try{
        // 1) If backend provided it, render immediately
        if (ev.best_player){
          const node = renderBestPlayerCard(ev.best_player);
          if(node) insertBestPlayerAfterTimeline(node);
        } else {
          // 2) Try client-side computation from goalscorers/timeline
          const computed = computeBestPlayerFromEvent(ev);
          if(computed){
            const node = renderBestPlayerCard(computed);
            if(node) insertBestPlayerAfterTimeline(node);
          } else {
            // 3) Fallback: fetch only best_player from backend (avoids re-running heavy augmentation)
            (async ()=>{
              try{
                const { eventId } = getQuery(); if(!eventId) return;
                
                const j = await callIntent('event.get', { eventId, include_best_player: true });
                const data = j && (j.data || j.result || j.event || j.events || j.fixtures);
                let cand = null;
                if (Array.isArray(data) && data.length) cand = data[0];
                else if (data && typeof data === 'object') cand = data.event || data.result || data;
                const best = cand && cand.best_player ? cand.best_player : null;
                if(best){ const node = renderBestPlayerCard(best); if(node) insertBestPlayerAfterTimeline(node); }
              }catch(_e){ }
            })();
          }
        }
      }catch(_e){ console.warn('[best-player] insertion error', _e); }

      // Compute and insert Game Leaders (per team: goals, assists, cards)
      try{
        const leaders = computeTeamLeaders(ev);
        const hasAny = !!(leaders && (
          (leaders.home && (leaders.home.goals || leaders.home.assists || leaders.home.cards)) ||
          (leaders.away && (leaders.away.goals || leaders.away.assists || leaders.away.cards))
        ));
        // Remove existing to avoid duplicates
        const existingGL = document.getElementById('game_leaders_card'); if(existingGL) existingGL.remove();
        if(hasAny){
          const card = renderGameLeadersCard(leaders);
          if(card) insertAfterBestPlayerOrTimeline(card);
        }
      }catch(_e){ /* non-fatal */ }
      fetchMatchSummary(ev).catch(err=>{ if(summaryEl) summaryEl.textContent = 'Summary error: ' + (err && err.message ? err.message : String(err)); });
      fetchHighlights(ev).catch(err=>{ if(highlightsBody) highlightsBody.textContent = 'Highlights error: ' + (err && err.message ? err.message : String(err)); });
      fetchExtras(ev).catch(err=>{ console.warn('Extras error', err); });

      // Wire controls
      if(augmentBtn) augmentBtn.addEventListener('click', ()=> augmentEventTags(ev));
      if(playerBtn) playerBtn.addEventListener('click', ()=> runPlayerAnalytics(ev));
      if(multimodalBtn) multimodalBtn.addEventListener('click', ()=> runMultimodalExtract(ev));

      setStatus('Ready');
    }catch(e){
      console.error(e); setStatus('Error: ' + (e && e.message ? e.message : String(e)));
      matchTitle.textContent = 'Match not found';
    }
  }

  function getStatusColor(status){ const s = String(status).toLowerCase(); if(s.includes('live')||s.includes('1st')||s.includes('2nd')) return 'rgba(34,197,94,0.8)'; if(s.includes('finished')||s.includes('ft')) return 'rgba(107,114,128,0.8)'; if(s.includes('postponed')||s.includes('cancelled')) return 'rgba(239,68,68,0.8)'; return 'rgba(107,114,128,0.8)'; }

  function renderMatchHeader(ev){
    clear(matchInfo);
    const home = ev.event_home_team || ev.strHomeTeam || ev.home_team || '';
    const away = ev.event_away_team || ev.strAwayTeam || ev.away_team || '';
    const _league = ev.league_name || ev.strLeague || '';
    const _country = ev.country_name || ev.strCountry || ev.country || '';
    const league = _country && _league ? (_country + ' — ' + _league) : _league;
    const date = ev.event_date || ev.dateEvent || ev.date || '';
    const time = ev.event_time || ev.strTime || '';
    const status = ev.event_status || ev.status || '';
    const venue = ev.venue || ev.stadium || ev.strVenue || ev.location || ev.event_venue || '';

    let homeScore = '', awayScore = '';
    if (ev.event_final_result && ev.event_final_result.includes('-')) {
      const parts = ev.event_final_result.split('-'); homeScore = parts[0]?.trim()||''; awayScore = parts[1]?.trim()||'';
    } else if (ev.home_score !== undefined && ev.away_score !== undefined){ homeScore = String(ev.home_score); awayScore = String(ev.away_score); }

    const card = document.createElement('div');
    card.style.cssText = 'background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius:16px; padding:20px; color:white;';
    const leagueBar = document.createElement('div'); leagueBar.style.cssText='display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;font-size:14px;opacity:.95';
    leagueBar.innerHTML = `<span style="background: rgba(255,255,255,0.2); padding: 4px 12px; border-radius: 20px;">${league||'—'}</span><span style="background: ${getStatusColor(status)}; padding: 4px 12px; border-radius: 20px;">${status || '—'}</span>`;

    const teams = document.createElement('div'); teams.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px';
    const homeDiv = document.createElement('div'); homeDiv.style.cssText='display:flex;flex-direction:column;align-items:flex-start;flex:1';
    const awayDiv = document.createElement('div'); awayDiv.style.cssText='display:flex;flex-direction:column;align-items:flex-end;flex:1';
    const score = document.createElement('div'); score.style.cssText='font-size:36px;font-weight:800'; score.textContent = `${homeScore||'-'} : ${awayScore||'-'}`;
    homeDiv.innerHTML = `<div style="font-weight:700;font-size:18px">${home}</div>`; awayDiv.innerHTML = `<div style="font-weight:700;font-size:18px">${away}</div>`;
    teams.appendChild(homeDiv); teams.appendChild(score); teams.appendChild(awayDiv);

    const meta = document.createElement('div'); meta.style.cssText='display:flex;gap:12px;flex-wrap:wrap;font-size:14px;opacity:.9;';
    if(date) meta.innerHTML += `<span>📅 ${date}</span>`; if(time) meta.innerHTML += `<span>🕐 ${time}</span>`; if(venue) meta.innerHTML += `<span>🏟️ ${venue}</span>`;
    card.appendChild(leagueBar); card.appendChild(teams); card.appendChild(meta);
    matchInfo.appendChild(card);
  }

  // Render or update the Best Player card
  function renderBestPlayerCard(bestPlayer){
    if(!bestPlayer) return null;
    // remove existing if present
    const existing = document.getElementById('best_player_section');
    if(existing) existing.remove();
    const bestPlayerDiv = document.createElement('div');
    bestPlayerDiv.id = 'best_player_section';
    bestPlayerDiv.style.cssText = 'background:white;border-radius:12px;padding:16px;margin:12px 0;box-shadow:0 4px 12px rgba(0,0,0,0.06)';
    bestPlayerDiv.innerHTML = `
        <h3 style="margin:0 0 8px 0;color:#111827">Best Player</h3>
        <div class="best-player-body" style="color:#374151">
            <p style="margin:0"><strong>${bestPlayer.name}</strong> - Score: ${bestPlayer.score}</p>
            <p style="margin:4px 0 0 0;font-size:13px;color:#6b7280">Reason: ${bestPlayer.reason}</p>
        </div>
    `;
    return bestPlayerDiv;
  }

  // Insert node after the timeline card; if timeline isn't present yet, observe DOM for it
  function insertBestPlayerAfterTimeline(node){
    try{
      let timelineCard = null;
      const findTimeline = ()=>{
        const headings = detailsInfo.querySelectorAll('h3');
        for(const h of headings){ if(h && h.textContent && h.textContent.toLowerCase().includes('match timeline')){ return h.parentElement || h.closest('div'); } }
        return null;
      };
      timelineCard = findTimeline();
      if(timelineCard && timelineCard.parentElement){ timelineCard.parentElement.insertBefore(node, timelineCard.nextSibling); return; }

      // Not found: observe until it appears or timeout
      const observer = new MutationObserver((mutations, obs)=>{
        const found = findTimeline();
        if(found){
          try{ found.parentElement.insertBefore(node, found.nextSibling); }catch(_e){ detailsInfo.appendChild(node); }
          obs.disconnect();
        }
      });
      observer.observe(detailsInfo, { childList: true, subtree: true });
      // Timeout fallback: append after 5s if timeline never appears
      setTimeout(()=>{ try{ observer.disconnect(); if(!document.getElementById('best_player_section')) detailsInfo.appendChild(node); }catch(_e){} }, 5000);
    }catch(_e){ try{ detailsInfo.appendChild(node); }catch(__e){} }
  }

  // Resolve player metadata (image/position/number) from pre-fetched players or lineups
  function resolvePlayerMeta(ev, name, side){
    const norm = (s)=> String(s||'').toLowerCase().trim();
    const eq = (a,b)=> norm(a)===norm(b) || norm(a).includes(norm(b)) || norm(b).includes(norm(a));
    const fromPlayers = (arr)=>{
      if(!Array.isArray(arr)) return null;
      for(const p of arr){
        const pn = p.player_name || p.name || p.strPlayer || p.player || p.full_name || '';
        if(pn && eq(pn,name)){
          return {
            image: p.player_image || p.strThumb || p.image || '',
            position: p.player_type || p.position || p.strPosition || '',
            number: p.player_number || p.shirt_number || p.number || p.jersey || ''
          };
        }
      }
      return null;
    };
    const metaFromPlayers = side==='home' ? fromPlayers(ev.players_home) : fromPlayers(ev.players_away);
    if(metaFromPlayers) return metaFromPlayers;
    // try combined
    const metaCombined = fromPlayers(ev.players);
    if(metaCombined) return metaCombined;
    // try lineups common shapes
    const lu = ev.lineups || ev.lineup || null;
    const scanLineup = (luTeam)=>{
      if(!luTeam) return null;
      const starters = luTeam.starting_lineups || luTeam.startXI || luTeam.starting || [];
      const subs = luTeam.substitutes || luTeam.bench || [];
      const all = [...(starters||[]), ...(subs||[])];
      for(const it of all){
        const pn = it.lineup_player || it.player || it.player_name || it.name || '';
        if(pn && eq(pn, name)){
          return { image: '', position: it.lineup_position || it.position || '', number: it.lineup_number || it.number || '' };
        }
      }
      return null;
    };
    if(lu){
      const homeLu = lu.home || lu.home_team || lu.localteam || null;
      const awayLu = lu.away || lu.away_team || lu.visitorteam || null;
      const m = side==='home' ? scanLineup(homeLu) : scanLineup(awayLu);
      if(m) return m;
    }
    return { image:'', position:'', number:'' };
  }

  // Compute team leaders (goals, assists, cards) from event data
  function computeTeamLeaders(ev){
    const homeName = ev.event_home_team || ev.strHomeTeam || ev.home_team || 'Home';
    const awayName = ev.event_away_team || ev.strAwayTeam || ev.away_team || 'Away';
    const makePlayer = (side)=>({ name:'', side, goals:0, assists:0, yc:0, rc:0 });
    const maps = { home: new Map(), away: new Map() };
    const getOr = (side, name)=>{ const m = maps[side]; if(!m.has(name)) m.set(name, makePlayer(side)); const obj = m.get(name); obj.name = name; return obj; };
    // Goals & assists from goalscorers
    const gs = ev.goalscorers || ev.goals || ev.goalscorer || [];
    if(Array.isArray(gs)){
      for(const g of gs){
        const hs = g.home_scorer || g.home_scorer_name || g.home_scorer_fullname || '';
        const ha = g.home_assist || g.home_assist_name || '';
        const as = g.away_scorer || g.away_scorer_name || g.away_scorer_fullname || '';
        const aa = g.away_assist || g.away_assist_name || g.away_assist_fullname || '';
        if(hs){ getOr('home', hs).goals += 1; }
        if(as){ getOr('away', as).goals += 1; }
        if(ha){ getOr('home', ha).assists += 1; }
        if(aa){ getOr('away', aa).assists += 1; }
      }
    }
    // Cards
    const cards = ev.cards || ev.bookings || ev.events_cards || [];
    if(Array.isArray(cards)){
      for(const c of cards){
        const isHome = !!(c.home_fault || c.home_player || c.home_scorer);
        const isAway = !!(c.away_fault || c.away_player || c.away_scorer);
        const name = c.home_fault || c.away_fault || c.player || c.player_name || '';
        const type = (c.card || c.type || '').toLowerCase();
        if(!name) continue;
        const side = isHome ? 'home' : (isAway ? 'away' : null);
        if(!side) continue;
        const rec = getOr(side, name);
        if(type.includes('red')) rec.rc += 1; else if(type.includes('yellow')) rec.yc += 1;
      }
    }
  const pickLeader = (side, key, prefer) => {
      const arr = Array.from(maps[side].values());
      if(arr.length===0) return null;
      const sorted = arr.sort((a,b)=>{
        if(key==='cards'){ // prioritize RC then YC
          const ar = a.rc, br = b.rc; if(br!==ar) return br-ar; const ay=a.yc, by=b.yc; if(by!==ay) return by-ay; return (b.goals+a.assists) - (a.goals+b.assists);
        }
        return (b[key]||0) - (a[key]||0);
      });
      const top = sorted[0];
      if(key==='goals' && top.goals<=0) return null;
      if(key==='assists' && top.assists<=0) return null;
      if(key==='cards' && top.rc<=0 && top.yc<=0) return null;
      return top;
    };
    const leaders = {
      homeTeamName: homeName,
      awayTeamName: awayName,
      home: { goals: pickLeader('home','goals'), assists: pickLeader('home','assists'), cards: pickLeader('home','cards','cards') },
      away: { goals: pickLeader('away','goals'), assists: pickLeader('away','assists'), cards: pickLeader('away','cards','cards') }
    };
    // enrich metadata
    ['home','away'].forEach(side=>{
      ['goals','assists','cards'].forEach(cat=>{
        const p = leaders[side][cat];
        if(p){
          const meta = resolvePlayerMeta(ev, p.name, side) || {};
          p.image = meta.image || '';
          p.position = meta.position || '';
          p.number = meta.number || '';
        }
      });
    });
    return leaders;
  }

  function avatarHtml(url, name){
    const initials = (name||'').split(' ').map(s=>s[0]).filter(Boolean).join('').slice(0,2).toUpperCase();
    if(url) return `<img src="${url}" onerror="this.remove()" style="width:48px;height:48px;border-radius:9999px;object-fit:cover;" alt="${name||''}">`;
    return `<div style="width:48px;height:48px;border-radius:9999px;display:flex;align-items:center;justify-content:center;background:#374151;color:#e5e7eb;font-weight:700">${initials||'P'}</div>`;
  }

  function renderSideLeader(sideLabel, p, category){
    if(!p) return `<div style="opacity:.6;">—</div>`;
    const minor = [];
    if(category==='goals') minor.push(`${p.goals||0} GLS`);
    if(category==='assists') minor.push(`${p.assists||0} AST`);
    if(category==='cards') minor.push(`${p.rc||0} RC`, `${p.yc||0} YC`);
    // minutes or shots not reliably available; skip for now
    const numLine = p.number ? `#${p.number}` : '';
    const posLine = p.position || '';
    return `
      <div style="display:flex;align-items:center;gap:12px;">
        ${avatarHtml(p.image, p.name)}
        <div style="display:flex;flex-direction:column;gap:2px;">
          <div style="font-weight:700;">${p.name}</div>
          <div style="font-size:12px;color:#9ca3af;">${posLine}</div>
          <div style="font-size:12px;color:#9ca3af;">${numLine}</div>
        </div>
      </div>
      <div style="display:flex;gap:16px;font-size:12px;color:#e5e7eb;">${minor.map(x=>`<span>${x}</span>`).join('')}</div>
    `;
  }

  function renderLeadersRow(title, homeP, awayP){
    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:16px;padding:16px 0;border-top:1px solid rgba(255,255,255,0.08)';
    row.innerHTML = `
      <div style="display:flex;justify-content:flex-start;gap:12px;align-items:center;">${renderSideLeader('home', homeP, title)}</div>
      <div style="font-weight:800;letter-spacing:1px;color:#e5e7eb;">${title.toUpperCase()}</div>
      <div style="display:flex;justify-content:flex-end;gap:12px;align-items:center;text-align:right;">${renderSideLeader('away', awayP, title)}</div>
    `;
    return row;
  }

  function renderGameLeadersCard(leaders){
    if(!leaders) return null;
    const card = document.createElement('div');
    card.id = 'game_leaders_card';
    card.style.cssText = 'background:#111827;color:#e5e7eb;border-radius:16px;padding:20px;margin:12px 0;box-shadow:0 8px 24px rgba(0,0,0,0.25)';
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px';
    const title = document.createElement('div'); title.style.cssText='font-size:18px;font-weight:800'; title.textContent='Game leaders';
    const teams = document.createElement('div'); teams.style.cssText='display:grid;grid-template-columns:1fr auto 1fr;gap:12px;align-items:center;font-weight:700;color:#f3f4f6;';
    teams.innerHTML = `<div style="text-align:left;">${leaders.homeTeamName}</div><div style="opacity:.8">vs</div><div style="text-align:right;">${leaders.awayTeamName}</div>`;
    header.appendChild(title); header.appendChild(teams); card.appendChild(header);

    card.appendChild(renderLeadersRow('goals', leaders.home.goals, leaders.away.goals));
    card.appendChild(renderLeadersRow('assists', leaders.home.assists, leaders.away.assists));
    card.appendChild(renderLeadersRow('cards', leaders.home.cards, leaders.away.cards));
    return card;
  }

  function insertAfterBestPlayerOrTimeline(node){
    try{
      const best = document.getElementById('best_player_section');
      if(best && best.parentElement){ best.parentElement.insertBefore(node, best.nextSibling); return; }
    }catch(_e){}
    // fallback to timeline placement helper
    insertBestPlayerAfterTimeline(node);
  }

  // Compute best player from event object client-side (fallback when backend doesn't provide it)
  function computeBestPlayerFromEvent(ev){
    try{
      const players = {};
      const gs = ev.goalscorers || ev.goals || ev.goalscorer || [];
      if(Array.isArray(gs)){
        gs.forEach(g=>{
          const home = g.home_scorer || g.home_scorer_name || g.home_scorer_fullname || '';
          const away = g.away_scorer || g.away_scorer_name || g.away_scorer_fullname || '';
          const homeAssist = g.home_assist || g.home_assist_name || '';
          const awayAssist = g.away_assist || g.away_assist_name || g.away_assist_fullname || '';
          if(home){ players[home] = players[home] || {goals:0,assists:0}; players[home].goals += 1; }
          if(away){ players[away] = players[away] || {goals:0,assists:0}; players[away].goals += 1; }
          if(homeAssist){ players[homeAssist] = players[homeAssist] || {goals:0,assists:0}; players[homeAssist].assists += 1; }
          if(awayAssist){ players[awayAssist] = players[awayAssist] || {goals:0,assists:0}; players[awayAssist].assists += 1; }
        });
      }
      // consider substitutes or timeline assists if present
      const timeline = ev.timeline || ev.events || ev.timeline_items || [];
      if(Array.isArray(timeline)){
        timeline.forEach(item=>{
          const desc = (item.description||item.text||'').toLowerCase();
          if(desc.includes('assist')){
            // try to extract a name (very heuristic)
            const m = (item.description||item.text||'').match(/([A-Z][a-z]+\.?\s?[A-Z]?[a-z]*)/);
            if(m && m[0]){
              const nm = m[0]; players[nm] = players[nm] || {goals:0,assists:0}; players[nm].assists += 1;
            }
          }
        });
      }
      let best = null; let maxScore = -1;
      Object.entries(players).forEach(([name,stats])=>{
        const score = (stats.goals||0)*3 + (stats.assists||0)*1;
        if(score > maxScore){ maxScore = score; best = { name, score, reason: `${stats.goals||0} goals, ${stats.assists||0} assists` }; }
      });
      return best;
    }catch(_e){ return null; }
  }

  // ---- Details rendering & timeline helpers (ported from matches.js) ----
  function renderEventDetails(ev, container){
    if(!container) return;
    container.innerHTML = '';

    const home = ev.event_home_team || ev.strHomeTeam || ev.home_team || '';
    const away = ev.event_away_team || ev.strAwayTeam || ev.away_team || '';
    const _league = ev.league_name || ev.strLeague || '';
    const _country = ev.country_name || ev.strCountry || ev.country || '';
    const league = _country && _league ? (_country + ' — ' + _league) : _league;
    const date = ev.event_date || ev.dateEvent || ev.date || '';
    const time = ev.event_time || ev.strTime || '';
    const status = ev.event_status || ev.status || '';
    const venue = ev.venue || ev.stadium || ev.strVenue || ev.location || ev.event_venue || '';

    // Score determination
    let homeScore = '', awayScore = '';
    if (ev.event_final_result && ev.event_final_result.includes('-')) {
      const parts = ev.event_final_result.split('-'); homeScore = parts[0]?.trim()||''; awayScore = parts[1]?.trim()||'';
    } else if (ev.home_score !== undefined && ev.away_score !== undefined){ homeScore = String(ev.home_score); awayScore = String(ev.away_score); }

  // Removed the gradient match header card in details to show timeline directly

    renderMatchStats(ev, container);
    renderMatchTimeline(ev, container);
  renderAdditionalInfo(ev, container);
  }

  function createTeamDisplay(teamName, logo, isHome){
    const team = document.createElement('div'); team.style.cssText = `display:flex;flex-direction:column;align-items:${isHome? 'flex-start':'flex-end'};flex:1;`;
    if(logo){ const logoImg = document.createElement('img'); logoImg.src = logo; logoImg.style.cssText='width:48px;height:48px;object-fit:contain;margin-bottom:8px'; logoImg.onerror=()=>logoImg.remove(); team.appendChild(logoImg); }
    const name = document.createElement('div'); name.style.cssText='font-weight:600;font-size:18px;'; name.textContent = teamName; team.appendChild(name);
    return team;
  }

  function createScoreDisplay(homeScore, awayScore){
    const scoreContainer = document.createElement('div'); scoreContainer.style.cssText='display:flex;align-items:center;gap:16px;font-size:36px;font-weight:700;text-shadow:0 2px 4px rgba(0,0,0,0.3)';
    scoreContainer.innerHTML = `<span>${homeScore||'-'}</span><span style="font-size:24px;opacity:.7;">:</span><span>${awayScore||'-'}</span>`; return scoreContainer;
  }

  function renderMatchStats(ev, container){
    const statsData = extractMatchStats(ev); if(Object.keys(statsData).length===0) return;
    const statsCard = document.createElement('div'); statsCard.style.cssText='background:white;border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 4px 20px rgba(0,0,0,0.08)';
    const title = document.createElement('h3'); title.style.cssText='margin:0 0 20px 0;color:#1f2937;font-size:20px'; title.innerHTML='📊 Match Statistics'; statsCard.appendChild(title);
    Object.entries(statsData).forEach(([statName, values])=>{ statsCard.appendChild(createStatRow(statName, values.home, values.away)); }); container.appendChild(statsCard);
  }

  // No-op placeholder to avoid runtime errors; timeline.js handles additional UI elsewhere if needed
  function renderAdditionalInfo(_ev, _container){ /* intentionally empty */ }

  function extractMatchStats(ev){
    const stats = {};
    const statMappings = {
      'Possession':['possession_home','possession_away'],'Shots':['shots_home','shots_away'],'Shots on Target':['shots_on_target_home','shots_on_target_away'],'Corners':['corners_home','corners_away'],'Yellow Cards':['yellow_cards_home','yellow_cards_away'],'Red Cards':['red_cards_home','red_cards_away'],'Fouls':['fouls_home','fouls_away'],'Offsides':['offsides_home','offsides_away']
    };
    Object.entries(statMappings).forEach(([displayName,[homeKey,awayKey]])=>{ if(ev[homeKey]!==undefined||ev[awayKey]!==undefined) stats[displayName]={home:ev[homeKey]||0,away:ev[awayKey]||0}; });
    return stats;
  }

  function createStatRow(statName, homeValue, awayValue){
    const row = document.createElement('div'); row.style.cssText='margin-bottom:16px;';
    const header = document.createElement('div'); header.style.cssText='display:flex;justify-content:space-between;margin-bottom:8px;font-weight:600;color:#374151'; header.innerHTML = `<span>${homeValue}</span><span>${statName}</span><span>${awayValue}</span>`;
    row.appendChild(header); row.appendChild(createProgressBar(homeValue, awayValue, statName.toLowerCase().includes('possession'))); return row;
  }

  function createProgressBar(homeValue, awayValue, isPercentage){
    const container = document.createElement('div'); container.style.cssText='height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden;display:flex;';
    const homeNum = parseFloat(homeValue)||0; const awayNum = parseFloat(awayValue)||0; const total = homeNum+awayNum;
    if(total>0){ const homePercent = isPercentage?homeNum: (homeNum/total)*100; const awayPercent = isPercentage?awayNum: (awayNum/total)*100; const homeBar = document.createElement('div'); homeBar.style.cssText=`width:${homePercent}%;background:linear-gradient(90deg,#3b82f6,#1d4ed8);transition:width 0.3s ease;`; const awayBar=document.createElement('div'); awayBar.style.cssText=`width:${awayPercent}%;background:linear-gradient(90deg,#ef4444,#dc2626);transition:width 0.3s ease;`; container.appendChild(homeBar); container.appendChild(awayBar); }
    return container;
  }

  // Timeline functions are now provided by timeline.js (renderMatchTimeline, synthesizeTimelineFromEvent, buildMergedTimeline)

  // ---- Summary ----
  async function fetchMatchSummary(ev){
    if(!summaryEl) return;
    summaryEl.textContent = 'Loading summary…';
  // Ensure the outer section heading is black
  try{ const headerH3 = document.querySelector('#summary h3'); if(headerH3) headerH3.style.color = '#000'; }catch(_e){}

    // Build best-effort payload (same as matches.js)
    const payload = { provider: 'auto' };
    const eventId = extractEventId(ev);
    if(eventId) payload.eventId = String(eventId);
    const home = ev.event_home_team || ev.strHomeTeam || ev.home_team || '';
    const away = ev.event_away_team || ev.strAwayTeam || ev.away_team || '';
    if(home && away) payload.eventName = `${home} vs ${away}`;
    const date = ev.event_date || ev.dateEvent || ev.date || '';
    if(date) payload.date = date;

    try{
      const resp = await fetch(apiBase + '/summarizer/summarize', {
        method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload)
      });
      if(!resp.ok){
        const txt = await resp.text().catch(()=> '');
        throw new Error('HTTP '+resp.status + (txt? (': '+txt):''));
      }
      let j;
      try { j = await resp.json(); }
      catch(jsonErr){
        // Non-JSON fallback: try raw text as a minimal summary
        try{
          const txt = await resp.text();
          if(txt && txt.trim() && !/^\s*\{/.test(txt)){
            summaryEl.textContent = txt.trim();
            return;
          }
        }catch(_e){}
        throw jsonErr;
      }

      if(!j){ throw new Error('Empty response'); }
      if(j.ok === false){
        // Render minimal fallback if present
        if(j.fallback && (j.fallback.one_paragraph || (Array.isArray(j.fallback.bullets) && j.fallback.bullets.length))){
          renderSummary(j.fallback, summaryEl);
          return;
        }
        throw new Error(j && j.detail ? (j.detail.reason || JSON.stringify(j.detail)) : 'No summary');
      }

      const s = j.summary || j.data || j.result || j;
      renderSummary(s, summaryEl);
    }catch(e){ summaryEl.textContent = 'Summary error: '+(e && e.message ? e.message : String(e)); }
  }

  function renderSummary(s, container){
    try{
      container.innerHTML = '';
      const card = document.createElement('div');
      card.style.cssText = 'background:white;border-radius:16px;padding:20px;margin-bottom:16px;box-shadow:0 4px 20px rgba(0,0,0,0.08)';

      const title = document.createElement('div');
  title.style.cssText = 'font-size:18px;font-weight:700;color:#000;margin-bottom:8px;opacity:1;';
      title.textContent = s.headline || 'Match Summary';
      card.appendChild(title);

      const para = document.createElement('div');
      para.style.cssText = 'color:#374151;line-height:1.6;margin-bottom:12px;white-space:pre-wrap';
      para.textContent = s.one_paragraph || '';
      card.appendChild(para);

      if(Array.isArray(s.bullets) && s.bullets.length){
        const ul = document.createElement('ul'); ul.style.cssText = 'margin:0 0 8px 1rem;color:#374151';
        s.bullets.slice(0,6).forEach(b=>{ const li=document.createElement('li'); li.textContent=b; ul.appendChild(li); });
        card.appendChild(ul);
      }

      const meta = document.createElement('div');
      meta.style.cssText = 'font-size:12px;color:#6b7280;margin-top:8px';
      if(s.source_meta && s.source_meta.bundle){
        const t = s.source_meta.bundle.teams || {}; const sc = s.source_meta.bundle.score || {};
        meta.textContent = `${t.home||''} ${sc.home!=null?sc.home:''}–${sc.away!=null?sc.away:''} ${t.away||''}`;
      }
      if(meta.textContent) card.appendChild(meta);

      container.appendChild(card);
    }catch(_e){
      // Fallback to paragraph only
      container.textContent = s.one_paragraph || 'No summary available.';
    }
  }

  // ---- Highlights ----
  async function fetchHighlights(ev){
    if(!highlightsBody) return; highlightsBody.textContent = 'Loading highlights…';
    try{
      const eventId = extractEventId(ev);
      const j = await callIntent('video.highlights', { eventId });
      const data = j && (j.data || j.result || j.results || j.items || j.highlights || []);
      const arr = Array.isArray(data) ? data : (Array.isArray(data?.videos) ? data.videos : []);
      if(!arr.length){ highlightsBody.textContent = 'No highlights found.'; return; }
      const list = document.createElement('div'); list.className = 'hl-list';
      arr.slice(0,10).forEach(v=>{
        const item = document.createElement('a'); item.className='hl-item'; item.target='_blank'; item.rel='noopener noreferrer'; item.href = v.url || v.link || v.video_url || v.href || '#';
        item.innerHTML = `
          ${v.thumbnail ? `<img class="hl-thumb" alt="thumb" src="${v.thumbnail}" onerror="this.remove()">` : ''}
          <div class="hl-meta">
            <div style="font-weight:700">${v.title || v.name || 'Highlight'}</div>
            <div style="color:#6b7280">${v.source || v.provider || ''}</div>
          </div>`;
        list.appendChild(item);
      });
      clear(highlightsBody); highlightsBody.appendChild(list);
    }catch(e){ highlightsBody.textContent = 'Highlights error: ' + (e && e.message ? e.message : String(e)); }
  }

  // ---- Extras (teams, players, league table, odds, probabilities, comments, seasons, h2h) ----
  function ensureSection(id, title){ const sec=document.getElementById(id); if(!sec) return null; const body=sec.querySelector('.body'); if(!body) return null; body.innerHTML = `<em>Loading ${title}…</em>`; return body; }

  async function fetchExtras(ev){
    const eventId = extractEventId(ev);
    const leagueId = ev.league_id || ev.league_key || ev.idLeague || '';
    const leagueName = ev.league_name || ev.strLeague || '';
    const home = ev.event_home_team || ev.strHomeTeam || ev.home_team || '';
    const away = ev.event_away_team || ev.strAwayTeam || ev.away_team || '';

    // Teams
    const teamsBody = ensureSection('teams_section','teams');
    if(teamsBody){
      try{
        const [homeRes, awayRes] = await Promise.allSettled([
          home ? callIntent('team.get', { teamName: home }) : Promise.resolve(null),
          away ? callIntent('team.get', { teamName: away }) : Promise.resolve(null),
        ]);
        teamsBody.innerHTML = '';
        const pre = document.createElement('pre'); pre.textContent = JSON.stringify({home:homeRes,away:awayRes}, null, 2); pre.style.maxHeight='32vh'; pre.style.overflow='auto';
        teamsBody.appendChild(pre);
      }catch(e){ teamsBody.textContent = 'Teams error: '+(e&&e.message?e.message:String(e)); }
    }

    // Players
    const playersBody = ensureSection('players_section','players');
    if(playersBody){
      try{
        const [homeRes, awayRes] = await Promise.allSettled([
          home ? callIntent('players.list', { teamName: home }) : Promise.resolve(null),
          away ? callIntent('players.list', { teamName: away }) : Promise.resolve(null),
        ]);
        playersBody.innerHTML = '';
        const pre = document.createElement('pre'); pre.textContent = JSON.stringify({home:homeRes,away:awayRes}, null, 2); pre.style.maxHeight='32vh'; pre.style.overflow='auto'; playersBody.appendChild(pre);
      }catch(e){ playersBody.textContent = 'Players error: '+(e&&e.message?e.message:String(e)); }
    }

    // League table
    const tableBody = ensureSection('league_table_section','league table');
    if(tableBody){
      try{
        const args = leagueId ? {leagueId} : (leagueName ? {leagueName} : {});
        const j = Object.keys(args).length ? await callIntent('league.table', args) : null;
        tableBody.innerHTML = '';
        const pre = document.createElement('pre'); pre.textContent = JSON.stringify(j, null, 2); pre.style.maxHeight='32vh'; pre.style.overflow='auto'; tableBody.appendChild(pre);
      }catch(e){ tableBody.textContent = 'League table error: '+(e&&e.message?e.message:String(e)); }
    }

    // Odds
    const oddsBody = ensureSection('odds_section','odds');
    if(oddsBody){
      try{
        const [listJ, liveJ] = await Promise.allSettled([callIntent('odds.list', eventId?{matchId:eventId}:{}) , callIntent('odds.live', eventId?{matchId:eventId}:{})]);
        oddsBody.innerHTML = '';
        const pre = document.createElement('pre'); pre.textContent = JSON.stringify({listJ, liveJ}, null, 2); pre.style.maxHeight='32vh'; pre.style.overflow='auto'; oddsBody.appendChild(pre);
      }catch(e){ oddsBody.textContent = 'Odds error: '+(e&&e.message?e.message:String(e)); }
    }

    // Probabilities
    const probBody = ensureSection('prob_section','probabilities');
    if(probBody){
      try{
        const j = await callIntent('probabilities.list', eventId?{matchId: eventId}:{});
        probBody.innerHTML = '';
        const pre = document.createElement('pre'); pre.textContent = JSON.stringify(j, null, 2); pre.style.maxHeight='32vh'; pre.style.overflow='auto'; probBody.appendChild(pre);
      }catch(e){ probBody.textContent = 'Probabilities error: '+(e&&e.message?e.message:String(e)); }
    }

    // Comments
    const commBody = ensureSection('comments_section','comments');
    if(commBody){
      try{
        const j = await callIntent('comments.list', eventId?{matchId: eventId}:{ eventName: home && away ? `${home} vs ${away}` : undefined });
        commBody.innerHTML = '';
        const pre = document.createElement('pre'); pre.textContent = JSON.stringify(j, null, 2); pre.style.maxHeight='32vh'; pre.style.overflow='auto'; commBody.appendChild(pre);
      }catch(e){ commBody.textContent = 'Comments error: '+(e&&e.message?e.message:String(e)); }
    }

    // Seasons
    const seasBody = ensureSection('seasons_section','seasons');
    if(seasBody){
      try{
        const args = leagueId ? {leagueId} : (leagueName ? {leagueName} : {});
        const j = Object.keys(args).length ? await callIntent('seasons.list', args) : null;
        seasBody.innerHTML = '';
        const pre = document.createElement('pre'); pre.textContent = JSON.stringify(j, null, 2); pre.style.maxHeight='32vh'; pre.style.overflow='auto'; seasBody.appendChild(pre);
      }catch(e){ seasBody.textContent = 'Seasons error: '+(e&&e.message?e.message:String(e)); }
    }

    // H2H
    const h2hBody = ensureSection('h2h_section','h2h');
    if(h2hBody){
      try{
        if(home && away){
          const j = await callIntent('h2h', { firstTeam: home, secondTeam: away });
          h2hBody.innerHTML = '';
          const pre = document.createElement('pre'); pre.textContent = JSON.stringify(j, null, 2); pre.style.maxHeight='32vh'; pre.style.overflow='auto'; h2hBody.appendChild(pre);
        } else { h2hBody.textContent = 'No team names available.'; }
      }catch(e){ h2hBody.textContent = 'H2H error: '+(e&&e.message?e.message:String(e)); }
    }
  }

  // Feature stubs
  async function augmentEventTags(_ev){ console.log('augmentEventTags: not implemented in this build'); }
  async function runPlayerAnalytics(_ev){ alert('Player analytics not implemented yet'); }
  async function runMultimodalExtract(_ev){ alert('Multimodal extract not implemented yet'); }

  // Start
  load();
})();

