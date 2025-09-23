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
      try {
        matchTitle.style.maxWidth = '100%';
        matchTitle.style.overflowWrap = 'anywhere';
        matchTitle.style.wordBreak = 'break-word';
      } catch(_e) {}
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
  card.style.cssText = 'background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius:16px; padding:20px; color:white; width:100%; max-width:100%; box-sizing:border-box; overflow:hidden;';
  const leagueBar = document.createElement('div'); leagueBar.style.cssText='display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;font-size:14px;opacity:.95;gap:12px;flex-wrap:wrap;min-width:0;';
  leagueBar.innerHTML = `<span style="background: rgba(255,255,255,0.2); padding: 4px 12px; border-radius: 20px; max-width:100%; white-space:normal; word-break:break-word;">${league||'—'}</span><span style="background: ${getStatusColor(status)}; padding: 4px 12px; border-radius: 20px; max-width:100%; white-space:nowrap;">${status || '—'}</span>`;

  const teams = document.createElement('div'); teams.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px;min-width:0;flex-wrap:wrap;';
  const homeDiv = document.createElement('div'); homeDiv.style.cssText='display:flex;flex-direction:column;align-items:flex-start;flex:1 1 240px;min-width:0;';
  const awayDiv = document.createElement('div'); awayDiv.style.cssText='display:flex;flex-direction:column;align-items:flex-end;flex:1 1 240px;min-width:0;';
  const score = document.createElement('div'); score.style.cssText='font-size:36px;font-weight:800;flex:0 0 auto;'; score.textContent = `${homeScore||'-'} : ${awayScore||'-'}`;
  homeDiv.innerHTML = `<div style="font-weight:700;font-size:18px;max-width:100%;white-space:normal;word-break:break-word;">${home}</div>`; awayDiv.innerHTML = `<div style="font-weight:700;font-size:18px;max-width:100%;white-space:normal;word-break:break-word;">${away}</div>`;
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
    if(url) return `<img src="${url}" onerror="this.remove()" style="width:40px;height:40px;border-radius:9999px;object-fit:cover;" alt="${name||''}">`;
    return `<div style="width:40px;height:40px;border-radius:9999px;display:flex;align-items:center;justify-content:center;background:#e5e7eb;color:#1f2937;font-weight:700">${initials||'P'}</div>`;
  }

  function renderSideLeader(sideLabel, p, category){
    if(!p) return `<div style="opacity:.5;">—</div>`;
    const isAway = sideLabel === 'away';
    const minor = [];
    if(category==='goals') minor.push(`${p.goals||0} GLS`);
    if(category==='assists') minor.push(`${p.assists||0} AST`);
    if(category==='cards') minor.push(`${p.rc||0} RC`, `${p.yc||0} YC`);
    // minutes or shots not reliably available; skip for now
    const numLine = p.number ? `#${p.number}` : '';
    const posLine = p.position || '';
    return `
      <div style="display:flex;align-items:center;gap:10px;${isAway ? 'flex-direction:row-reverse;' : ''}">
        ${avatarHtml(p.image, p.name)}
        <div style="display:flex;flex-direction:column;${isAway ? 'align-items:flex-end;text-align:right;' : ''}">
          <div style="font-weight:600;color:#111827;margin-bottom:2px;">${p.name}</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;font-size:12px;${isAway ? 'justify-content:flex-end;' : ''}">
            ${minor.map(x=>`<span style=\"color:#4b5563;font-weight:500;\">${x}</span>`).join('')}
            ${posLine ? `<span style=\"color:#6b7280;\">${posLine}</span>` : ''}
            ${numLine ? `<span style=\"color:#6b7280;\">${numLine}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  function renderLeadersRow(title, homeP, awayP){
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid #e5e7eb;';
    
    // Create the center label column
    const labelDiv = document.createElement('div');
    labelDiv.style.cssText = 'position:relative;display:flex;justify-content:center;align-items:center;width:100px;flex-shrink:0;';
    
    // Add a styled badge for the category
    const badge = document.createElement('div');
    badge.style.cssText = 'background:#f3f4f6;border-radius:4px;padding:4px 8px;font-weight:700;font-size:14px;letter-spacing:0.5px;color:#111827;text-align:center;box-shadow:0 1px 2px rgba(0,0,0,0.05);';
    badge.textContent = title.toUpperCase();
    labelDiv.appendChild(badge);
    
    // Create the home and away columns
    const homeDiv = document.createElement('div');
    homeDiv.style.cssText = 'flex:1;padding-right:12px;';
    homeDiv.innerHTML = renderSideLeader('home', homeP, title);
    
    const awayDiv = document.createElement('div');
    awayDiv.style.cssText = 'flex:1;padding-left:12px;text-align:right;';
    awayDiv.innerHTML = renderSideLeader('away', awayP, title);
    
    row.appendChild(homeDiv);
    row.appendChild(labelDiv);
    row.appendChild(awayDiv);
    
    return row;
  }

  function renderGameLeadersCard(leaders){
    if(!leaders) return null;
    const card = document.createElement('div');
    card.id = 'game_leaders_card';
    card.style.cssText = 'background:white;border-radius:12px;padding:16px 20px;margin:12px 0;box-shadow:0 4px 12px rgba(0,0,0,0.06);';
    
    // Create header with teams vs teams and Game leaders title
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;';
    
    // Title on left
    const title = document.createElement('h3');
    title.style.cssText = 'margin:0;font-size:18px;font-weight:700;color:#111827;';
    title.textContent = 'Game leaders';
    
    // Teams vs display on right
    const teamsVs = document.createElement('div');
    teamsVs.style.cssText = 'font-weight:600;color:#4b5563;';
    teamsVs.textContent = `${leaders.homeTeamName} vs ${leaders.awayTeamName}`;
    
    header.appendChild(title);
    header.appendChild(teamsVs);
    card.appendChild(header);
    
    // Add team columns header (optional)
    const teamColumns = document.createElement('div');
    teamColumns.style.cssText = 'display:flex;justify-content:space-between;margin-bottom:12px;border-bottom:1px solid #f3f4f6;padding-bottom:8px;';
    
    const homeTeamLabel = document.createElement('div');
    homeTeamLabel.style.cssText = 'font-weight:600;color:#6b7280;font-size:14px;';
    homeTeamLabel.textContent = leaders.homeTeamName;
    
    const divider = document.createElement('div');
    divider.style.cssText = 'width:100px;flex-shrink:0;';
    
    const awayTeamLabel = document.createElement('div');
    awayTeamLabel.style.cssText = 'font-weight:600;color:#6b7280;text-align:right;font-size:14px;';
    awayTeamLabel.textContent = leaders.awayTeamName;
    
    teamColumns.appendChild(homeTeamLabel);
    teamColumns.appendChild(divider);
    teamColumns.appendChild(awayTeamLabel);
    card.appendChild(teamColumns);

    // Add the stat rows
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

    // Local helpers for UI
    const by = (arr, key) => (Array.isArray(arr)?arr:[]).reduce((m, x)=>{ const k = String(x[key]||''); (m[k]=m[k]||[]).push(x); return m; }, {});
    const el = (tag, cls, html) => { const d=document.createElement(tag); if(cls) d.className=cls; if(html!==undefined) d.innerHTML = html; return d; };
    const img = (src, cls) => { const i=new Image(); i.className=cls||''; i.src=src||''; i.loading='lazy'; i.onerror=()=>i.remove(); return i; };
    const fmtPct = v => {
      const n = parseFloat(v); if(Number.isFinite(n)) return (n%1===0? n.toFixed(0): n.toFixed(2)) + '%';
      const s = String(v||''); return s.endsWith('%')? s : (s? (s+'%') : '');
    };

    // We'll capture team ids/logos for reuse across sections
    let homeTeamId='', awayTeamId='';
    const teamLogos = { home:'', away:'' };

    // Teams (nice cards)
    const teamsBody = ensureSection('teams_section','teams');
    let teamsHomeRaw=null, teamsAwayRaw=null;
    if(teamsBody){
      try{
        const [homeRes, awayRes] = await Promise.allSettled([
          home ? callIntent('team.get', { teamName: home }) : Promise.resolve(null),
          away ? callIntent('team.get', { teamName: away }) : Promise.resolve(null),
        ]);
        teamsHomeRaw = homeRes; teamsAwayRaw = awayRes;
        const extractTeam = (settled)=>{
          if(!settled || settled.status!== 'fulfilled' || !settled.value) return null;
          const j = settled.value; const d = j.data || j.result || j.team || j;
          if(d && Array.isArray(d.result) && d.result.length) return d.result[0];
          if(Array.isArray(d)) return d[0]||null; return null;
        };
        const tHome = extractTeam(homeRes);
        const tAway = extractTeam(awayRes);
        teamsBody.innerHTML = '';

        const wrap = el('div', 'team-grid');
        const cardFor = (t, side)=>{
          const c = el('div', 'team-card');
          const head = el('div', 'team-head');
          const row = el('div', 'team-row');
          if(t && t.team_logo) { const i = img(t.team_logo, 'team-logo'); row.appendChild(i); if(side==='home') teamLogos.home = t.team_logo; else teamLogos.away = t.team_logo; }
          const name = el('div', 'team-name', (t && (t.team_name||t.name)) || (side==='home'?home:away) || '—');
          row.appendChild(name);
          head.appendChild(row);
          c.appendChild(head);

          // meta
          const meta = el('div', 'team-meta');
          if(t && Array.isArray(t.coaches) && t.coaches.length){
            meta.appendChild(el('div','coach', `Coach: <strong>${t.coaches[0].coach_name || '—'}</strong>`));
          }
          if(t && Array.isArray(t.players)){
            const counts = by(t.players, 'player_type');
            const chips = el('div','chips');
            Object.entries(counts).forEach(([k,v])=> chips.appendChild(el('span','chip soft', `${k}: ${v.length}`)));
            if(chips.childElementCount) meta.appendChild(chips);
          }
          c.appendChild(meta);
          return c;
        };
        if(tHome) homeTeamId = String(tHome.team_key||'');
        if(tAway) awayTeamId = String(tAway.team_key||'');
        wrap.appendChild(cardFor(tHome,'home'));
        wrap.appendChild(cardFor(tAway,'away'));
        teamsBody.appendChild(wrap);
      }catch(e){ teamsBody.textContent = 'Teams error: '+(e&&e.message?e.message:String(e)); }
    }

    // Players (gallery)
    const playersBody = ensureSection('players_section','players');
    if(playersBody){
      try{
        const [homeRes, awayRes] = await Promise.allSettled([
          home ? callIntent('players.list', { teamName: home }) : Promise.resolve(null),
          away ? callIntent('players.list', { teamName: away }) : Promise.resolve(null),
        ]);
        const extractPlayers = (settled)=>{
          if(!settled || settled.status!=='fulfilled' || !settled.value) return [];
          const j= settled.value; const d=j.data||j.result||j.players||j;
          if(Array.isArray(d)) return d; if(d && Array.isArray(d.result)) return d.result; return [];
        };
        const homePlayers = extractPlayers(homeRes).filter(p=>p && (p.player_name||p.name));
        const awayPlayers = extractPlayers(awayRes).filter(p=>p && (p.player_name||p.name));
        playersBody.innerHTML = '';
        const grid = el('div','players-grid');
        const col = (title, arr, side)=>{
          const box = el('div','players-col');
          box.appendChild(el('h5','players-title', title));
          const list = el('div','player-list');
          const show = 12; const more = arr.slice(show);
          const renderCard = (p)=>{
            const card = el('div','player-card');
            const top = el('div','pc-head');
            const i = (p.player_image||'') ? img(p.player_image,'pc-img') : null;
            if(i) top.appendChild(i);
            const nm = el('div','pc-name', p.player_name || p.name || '—');
            top.appendChild(nm);
            card.appendChild(top);
            const meta = el('div','pc-meta');
            const t = p.player_type || p.position || '';
            const num = (p.player_number!=null && p.player_number!=='')? ('#'+p.player_number): '';
            const age = p.player_age ? (String(p.player_age)+'y') : '';
            meta.appendChild(el('span','pc-chip', [t,num,age].filter(Boolean).join(' • ')));
            card.appendChild(meta);
            return card;
          };
          arr.slice(0,show).forEach(p=> list.appendChild(renderCard(p)));
          if(more.length){
            const btn = el('button','players-more','Show all');
            btn.addEventListener('click', ()=>{ more.forEach(p=> list.appendChild(renderCard(p))); btn.remove(); });
            box.appendChild(btn);
          }
          box.appendChild(list);
          return box;
        };
        grid.appendChild(col('Home', homePlayers, 'home'));
        grid.appendChild(col('Away', awayPlayers, 'away'));
        playersBody.appendChild(grid);
      }catch(e){ playersBody.textContent = 'Players error: '+(e&&e.message?e.message:String(e)); }
    }

    // League table (standings with toggle)
    const tableBody = ensureSection('league_table_section','league table');
    if(tableBody){
      try{
        const args = leagueId ? {leagueId} : (leagueName ? {leagueName} : {});
        const j = Object.keys(args).length ? await callIntent('league.table', args) : null;
        const d = j && (j.data||j.result||j.table||j);
        const res = d && (d.result || d.results || d);
        const sets = { total:[], home:[], away:[] };
        if(res && res.total) sets.total = res.total;
        if(res && res.home) sets.home = res.home;
        if(res && res.away) sets.away = res.away;
        const firstKey = sets.total.length? 'total' : (sets.home.length? 'home' : 'away');
        tableBody.innerHTML = '';

        const header = el('div','standings-head');
        const tabs = el('div','standings-tabs');
        const makeTab = (key, label)=>{ const b=el('button','tab'+(key===firstKey?' active':''),label); b.addEventListener('click',()=>{ [...tabs.children].forEach(x=>x.classList.remove('active')); b.classList.add('active'); renderTable(key); }); return b; };
        tabs.appendChild(makeTab('total','Total'));
        if(sets.home.length) tabs.appendChild(makeTab('home','Home'));
        if(sets.away.length) tabs.appendChild(makeTab('away','Away'));
        header.appendChild(tabs);
        tableBody.appendChild(header);

        const tblWrap = el('div','standings-wrap');
        tableBody.appendChild(tblWrap);

        const renderTable = (key)=>{
          tblWrap.innerHTML = '';
          const list = (sets[key]||[]).slice().sort((a,b)=> (a.standing_place||0) - (b.standing_place||0));
          const table = el('table','standings');
          table.innerHTML = '<thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>PTS</th></tr></thead>';
          const tb = el('tbody');
          list.forEach(r=>{
            const tr = document.createElement('tr');
            const logo = r.team_logo ? `<img class="tlogo" src="${r.team_logo}" onerror="this.remove()">` : '';
            tr.innerHTML = `<td>${r.standing_place||''}</td><td class="tname">${logo}<span>${r.standing_team||''}</span></td><td>${r.standing_P||''}</td><td>${r.standing_W||''}</td><td>${r.standing_D||''}</td><td>${r.standing_L||''}</td><td>${r.standing_GD||''}</td><td><strong>${r.standing_PTS||''}</strong></td>`;
            tb.appendChild(tr);
          });
          table.appendChild(tb); tblWrap.appendChild(table);
        };
        renderTable(firstKey);
      }catch(e){ tableBody.textContent = 'League table error: '+(e&&e.message?e.message:String(e)); }
    }

    // Odds (group by market)
    const oddsBody = ensureSection('odds_section','odds');
    if(oddsBody){
      try{
        const [_listRes, liveRes] = await Promise.allSettled([
          callIntent('odds.list', eventId?{matchId:eventId}:{}),
          callIntent('odds.live', eventId?{matchId:eventId}:{})
        ]);
        oddsBody.innerHTML = '';
        const extractLiveArray = (settled)=>{
          if(!settled || settled.status!=='fulfilled' || !settled.value) return [];
          const j = settled.value; const d = j.data || j.result || j.items || j;
          const res = d && (d.result || d.results || d);
          if(res && typeof res==='object'){ const vals = Object.values(res).filter(Boolean); return vals.reduce((acc,cur)=> acc.concat(Array.isArray(cur)?cur:[]), []); }
          return [];
        };
        const arr = extractLiveArray(liveRes);
        if(!arr.length){ oddsBody.textContent = 'No live odds available.'; }
        else{
          const groups = by(arr, 'odd_name');
          const order = [
            'Fulltime Result','Double Chance','Both Teams To Score','Match Goals','Over/Under Line','Over/Under (1st Half)','Asian Handicap','3-Way Handicap','Half Time/Full Time'
          ];
          const keys = Object.keys(groups);
          keys.sort((a,b)=>{
            const ia = order.indexOf(a); const ib = order.indexOf(b);
            if(ia===-1 && ib===-1) return a.localeCompare(b); if(ia===-1) return 1; if(ib===-1) return -1; return ia-ib;
          });
          const maxGroups = 6;
          const head = el('div','odds-head', `<span>${keys.length} markets</span>`);
          oddsBody.appendChild(head);
          let shown = 0;
          keys.forEach((k, idx)=>{
            const hidden = idx >= maxGroups;
            const block = el('div','odds-group' + (hidden?' hidden':''));
            block.appendChild(el('h5','', k));
            const table = el('table','odds-table');
            table.innerHTML = '<thead><tr><th>Type</th><th>Hcap</th><th>Value</th><th>Updated</th></tr></thead>';
            const tb = el('tbody');
            (groups[k]||[]).slice(0,10).forEach(o=>{
              const tr = document.createElement('tr');
              tr.innerHTML = `<td>${o.odd_type||''}</td><td>${o.odd_participant_handicap||''}</td><td><strong>${o.odd_value||''}</strong></td><td>${(o.odd_last_updated||'').replace(' ','\u00a0')}</td>`;
              tb.appendChild(tr);
            });
            table.appendChild(tb); block.appendChild(table); oddsBody.appendChild(block); shown++;
          });
          if(keys.length > maxGroups){
            const btn = el('button','odds-more','Show all markets');
            btn.addEventListener('click', ()=>{ oddsBody.querySelectorAll('.odds-group.hidden').forEach(x=> x.classList.remove('hidden')); btn.remove(); });
            oddsBody.appendChild(btn);
          }
        }
      }catch(e){ oddsBody.textContent = 'Odds error: '+(e&&e.message?e.message:String(e)); }
    }

    // Probabilities (stacked bar + minis)
    const probBody = ensureSection('prob_section','probabilities');
    if(probBody){
      try{
        const j = await callIntent('probabilities.list', eventId?{matchId: eventId}:{});
        probBody.innerHTML = '';
        const d = j && (j.data||j.result||j);
        const arr = d && (d.result || d.results || []);
        const p = Array.isArray(arr) && arr.length ? arr[0] : null;
        if(!p){ probBody.textContent = 'No probabilities available.'; }
        else{
          const card = el('div','prob-card');
          // headline: logos + names
          const headline = el('div','prob-headline');
          const left = el('div','side');
          if(teamLogos.home) left.appendChild(img(teamLogos.home,'logo'));
          left.appendChild(el('div','name', home||p.event_home_team||'Home'));
          const mid = el('div','middle', 'Win Probabilities');
          const right = el('div','side');
          if(teamLogos.away) right.appendChild(img(teamLogos.away,'logo'));
          right.appendChild(el('div','name', away||p.event_away_team||'Away'));
          headline.appendChild(left); headline.appendChild(mid); headline.appendChild(right);
          card.appendChild(headline);

          const hw = parseFloat(p.event_HW||0)||0;
          const dr = parseFloat(p.event_D||0)||0;
          const aw = parseFloat(p.event_AW||0)||0;
          const sum = (hw+dr+aw)||1;
          const stacked = el('div','prob-stacked');
          const segHome = el('span','seg home'); segHome.style.width = (hw/sum*100)+'%';
          const segDraw = el('span','seg draw'); segDraw.style.width = (dr/sum*100)+'%';
          const segAway = el('span','seg away'); segAway.style.width = (aw/sum*100)+'%';
          stacked.appendChild(segHome); stacked.appendChild(segDraw); stacked.appendChild(segAway);
          card.appendChild(stacked);
          const labels = el('div','prob-labels');
          labels.innerHTML = `<span class="lbl">${home||'Home'} ${fmtPct(hw)}</span><span class="lbl">Draw ${fmtPct(dr)}</span><span class="lbl">${away||'Away'} ${fmtPct(aw)}</span>`;
          card.appendChild(labels);

          // mini bars (Over/Under and BTS if present)
          const minis = [
            { key:'event_O', label:'Over 2.5' },
            { key:'event_U', label:'Under 2.5' },
            { key:'event_bts', label:'Both Teams Score' },
            { key:'event_ots', label:'One Team Scores' }
          ];
          minis.forEach(m=>{
            if(p[m.key]!==undefined){
              const row = el('div','prob-mini');
              row.appendChild(el('div','label', m.label));
              const bar = el('div','bar');
              const fill = el('span','fill home'); fill.style.width = (parseFloat(p[m.key])||0)+'%'; bar.appendChild(fill); row.appendChild(bar);
              row.appendChild(el('div','value', fmtPct(p[m.key])));
              card.appendChild(row);
            }
          });

          const meta = el('div','prob-meta');
          const ts = p.event_time || (j.meta && j.meta.trace && j.meta.trace[0] && j.meta.trace[0]._ts) || '';
          meta.appendChild(el('div','', ts? `Updated: ${p.event_date||''} ${p.event_time||''}`: ''));
          const rawBtn = el('button','raw-toggle','Show raw'); const rawPre = el('pre','', JSON.stringify(j, null, 2));
          rawBtn.addEventListener('click', ()=>{ rawPre.style.display = rawPre.style.display==='block'?'none':'block'; rawBtn.textContent = rawPre.style.display==='block'?'Hide raw':'Show raw'; });
          meta.appendChild(rawBtn);
          card.appendChild(meta);
          card.appendChild(rawPre);
          probBody.appendChild(card);
        }
      }catch(e){ probBody.textContent = 'Probabilities error: '+(e&&e.message?e.message:String(e)); }
    }

    // Comments (timeline list)
    const commBody = ensureSection('comments_section','comments');
    if(commBody){
      try{
        const j = await callIntent('comments.list', eventId?{matchId: eventId}:{ eventName: home && away ? `${home} vs ${away}` : undefined });
        const d = j && (j.data||j.result||j.comments||j);
        let arr = [];
        if(Array.isArray(d)) arr = d; else if(d && d.result && typeof d.result==='object'){ const vals = Object.values(d.result).filter(Boolean); arr = vals.reduce((acc,cur)=> acc.concat(Array.isArray(cur)?cur:[]), []); }
        commBody.innerHTML = '';
        if(!arr.length){ commBody.textContent = 'No comments available.'; }
        else{
          const list = el('div','comments-list');
          arr.forEach(c=>{
            const item = el('div','comment-item');
            item.innerHTML = `<span class="ct">${c.comments_time||''}</span><span class="cx">${c.comments_text||c.text||''}</span>`;
            list.appendChild(item);
          });
          commBody.appendChild(list);
        }
      }catch(e){ commBody.textContent = 'Comments error: '+(e&&e.message?e.message:String(e)); }
    }

    // Seasons (chips, filtered)
    const seasBody = ensureSection('seasons_section','seasons');
    if(seasBody){
      try{
        const args = leagueId ? {leagueId} : (leagueName ? {leagueName} : {});
        const j = Object.keys(args).length ? await callIntent('seasons.list', args) : null;
        const d = j && (j.data||j.result||j.leagues||j);
        const arr = (d && (d.result||d.results)) || [];
        seasBody.innerHTML = '';
        if(!Array.isArray(arr) || !arr.length){ seasBody.textContent = 'No seasons/leagues found.'; }
        else{
          // Prefer same country as current match if available
          const country = ev.country_name || ev.strCountry || '';
          const filtered = country ? arr.filter(x=> (x.country_name||'').toLowerCase() === country.toLowerCase()) : arr;
          const top = filtered.slice(0, 12);
          const grid = el('div','seasons-grid');
          top.forEach(s=>{
            const chip = el('div','season-chip');
            if(s.league_logo) chip.appendChild(img(s.league_logo, 'season-logo'));
            chip.appendChild(el('span','season-name', s.league_name||'League'));
            grid.appendChild(chip);
          });
          seasBody.appendChild(grid);
        }
      }catch(e){ seasBody.textContent = 'Seasons error: '+(e&&e.message?e.message:String(e)); }
    }

    // H2H (use team IDs when available)
    const h2hBody = ensureSection('h2h_section','h2h');
    if(h2hBody){
      try{
        h2hBody.innerHTML = '';
        const params = {};
        if(homeTeamId && awayTeamId){ params.firstTeamId = homeTeamId; params.secondTeamId = awayTeamId; }
        else if(home && away){ params.firstTeam = home; params.secondTeam = away; }
        if(Object.keys(params).length){
          const j = await callIntent('h2h', params);
          // Render a simple status; if error present, show hint
          const err = j && (j.error || (j.data && j.data.error));
          if(err){
            h2hBody.textContent = 'H2H unavailable (needs team IDs)';
          }else{
            const pre = document.createElement('pre'); pre.textContent = JSON.stringify(j, null, 2); pre.style.maxHeight='32vh'; pre.style.overflow='auto'; h2hBody.appendChild(pre);
          }
        } else {
          h2hBody.textContent = 'H2H: missing team identifiers.';
        }
      }catch(e){ h2hBody.textContent = 'H2H error: '+(e&&e.message?e.message:String(e)); }
    }
  }

  // Feature stubs
  async function augmentEventTags(_ev){ console.log('augmentEventTags: not implemented in this build'); }
  async function runPlayerAnalytics(_ev){ alert('Player analytics not implemented yet'); }
  async function runMultimodalExtract(_ev){ alert('Multimodal extract not implemented yet'); }

  // Tab switching functionality for extras section
  function initExtrasNavigation() {
    const navTabs = document.querySelectorAll('.nav-tab');
    const sections = document.querySelectorAll('.extra-section');

    navTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetId = tab.getAttribute('data-target');
        
        // Remove active class from all tabs and sections
        navTabs.forEach(t => t.classList.remove('active'));
        sections.forEach(s => s.classList.remove('active'));
        
        // Add active class to clicked tab and corresponding section
        tab.classList.add('active');
        const targetSection = document.getElementById(targetId);
        if (targetSection) {
          targetSection.classList.add('active');
        }
      });
    });
  }

  // Start
  load().then(() => {
    // Initialize navigation after content is loaded
    initExtrasNavigation();
  });
})();
