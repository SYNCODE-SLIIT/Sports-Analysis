/* Standalone Match Details page */
(function(){
  const loc = window.location;
  let apiBase = loc.origin;
  if(loc.port && loc.port !== '8000'){
    apiBase = loc.protocol + '//' + loc.hostname + ':8000';
  }

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
          const j = await callIntent('event.get', { eventId: id, augment_tags: true });
          const data = j && (j.data || j.result || j.event || j.events || j.fixtures);
          let cand = null;
          if(Array.isArray(data) && data.length) cand = data[0];
          else if(data && typeof data === 'object') cand = data.event || data.result || data;
          if(cand) ev = Object.assign({}, ev||{}, cand);
        }catch(e){ console.warn('event.get failed', e); }
      }
      if(!ev){ throw new Error('No event context available'); }

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
      try{ ev.timeline = buildCleanTimeline(ev); }catch(_e){}
      renderEventDetails(ev, detailsInfo);

      // Insert best player UI after the timeline card (so it doesn't interfere with summary)
      try{
        // 1) If backend provided it, render immediately
        if (ev.best_player){
          const node = renderBestPlayerCard(ev.best_player, ev);
          if(node) insertBestPlayerAfterTimeline(node);
        } else {
          // 2) Try client-side computation from goalscorers/timeline
          const computed = computeBestPlayerFromEvent(ev);
          if(computed){
            const node = renderBestPlayerCard(computed, ev);
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
                if(best){ const node = renderBestPlayerCard(best, ev); if(node) insertBestPlayerAfterTimeline(node); }
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

  function getStatusColor(status){ const s = String(status||'').toLowerCase(); if(s.includes('live')||s.includes('1st')||s.includes('2nd')) return 'rgba(34,197,94,0.15)'; if(s.includes('finished')||s.includes('ft')) return 'rgba(107,114,128,0.2)'; if(s.includes('postponed')||s.includes('cancelled')) return 'rgba(239,68,68,0.2)'; return 'rgba(107,114,128,0.2)'; }

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

  // Resolve image + team logo for best player
  function resolveBestPlayerAssets(ev, bestPlayer){
    const out = { playerImg:'', teamLogo:'', side:'' };
    if(!ev || !bestPlayer) return out;
    const name = (bestPlayer.name||'').trim();
    if(!name) return out;
    // Detect side via goalscorers listing
    try{
      const goals = Array.isArray(ev.goalscorers)? ev.goalscorers : [];
      for(const g of goals){
        if(g.home_scorer && g.home_scorer === name){ out.side='home'; break; }
        if(g.away_scorer && g.away_scorer === name){ out.side='away'; break; }
      }
    }catch(_e){}
    // Use timeline.js resolver if available for richer matching (player list cached there)
    try{ if(typeof resolvePlayerImageByName === 'function'){ out.playerImg = resolvePlayerImageByName(name, ev) || ''; } }catch(_e){}
    // Fallback manual scan across arrays (players, lineups, etc.)
    if(!out.playerImg){
      try{
        const norm = s => (s||'').toString().replace(/[\.]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
        const target = norm(name);
        for(const k of Object.keys(ev)){
          const v = ev[k];
            if(Array.isArray(v) && v.length && typeof v[0] === 'object'){
              for(const p of v){
                const pn = (p.player_name || p.name || p.strPlayer || p.player || p.player_fullname || '').trim();
                if(pn && norm(pn) === target){
                  out.playerImg = p.player_image || p.player_photo || p.playerImage || p.photo || p.thumb || p.photo_url || p.strThumb || p.strThumbBig || p.player_cutout || p.player_pic || p.img || p.avatar || p.headshot || p.image || '';
                  break;
                }
              }
              if(out.playerImg) break;
            }
        }
      }catch(_e){}
    }
    const homeLogo = ev.home_team_logo || ev.strHomeTeamBadge || ev.homeLogo || ev.event_home_team_logo || ev.home_team_badge;
    const awayLogo = ev.away_team_logo || ev.strAwayTeamBadge || ev.awayLogo || ev.event_away_team_logo || ev.away_team_badge;
    if(out.side==='home') out.teamLogo = homeLogo || '';
    else if(out.side==='away') out.teamLogo = awayLogo || '';
    else out.teamLogo = homeLogo || awayLogo || '';
    return out;
  }

  // Render or update the Best Player card (now with image + logo)
  function renderBestPlayerCard(bestPlayer, ev){
    if(!bestPlayer) return null;
    const existing = document.getElementById('best_player_section'); if(existing) existing.remove();
    const assets = resolveBestPlayerAssets(ev, bestPlayer);
    const div = document.createElement('div');
    div.id='best_player_section';
    div.style.cssText='background:linear-gradient(135deg,#ffffff,#f8fafc);border-radius:16px;padding:18px;margin:14px 0;box-shadow:0 4px 14px rgba(0,0,0,0.06),0 2px 4px rgba(0,0,0,0.04);position:relative;overflow:hidden';
    const imgHtml = assets.playerImg ? `<div class="bp-avatar"><img src="${assets.playerImg}" alt="${bestPlayer.name}" onerror="this.remove()"/></div>` : `<div class="bp-avatar placeholder">👤</div>`;
    const teamHtml = assets.teamLogo ? `<div class="bp-teamlogo" title="Team"><img src="${assets.teamLogo}" alt="team logo" onerror="this.remove()"/></div>` : '';
    div.innerHTML = `
      <style>
        #best_player_section .bp-header{display:flex;align-items:center;gap:16px;margin-bottom:10px;}
        #best_player_section .bp-avatar{width:78px;height:78px;border-radius:20px;overflow:hidden;background:#1f2937;display:flex;align-items:center;justify-content:center;font-size:30px;color:#e5e7eb;flex-shrink:0;box-shadow:0 4px 12px rgba(0,0,0,0.18);border:3px solid #fff;}
        #best_player_section .bp-avatar img{width:100%;height:100%;object-fit:cover;display:block;}
        #best_player_section .bp-teamlogo{width:50px;height:50px;border-radius:14px;overflow:hidden;background:#0f1419;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 2px 6px rgba(0,0,0,0.15);border:2px solid #fff;}
        #best_player_section .bp-teamlogo img{width:100%;height:100%;object-fit:contain;display:block;filter:drop-shadow(0 0 2px rgba(0,0,0,.4));}
        #best_player_section h3{margin:0;font-size:18px;color:#0f172a;}
        #best_player_section .bp-meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
        #best_player_section .bp-score{background:#10b981;color:#fff;padding:4px 12px;border-radius:999px;font-size:12px;font-weight:600;box-shadow:0 2px 4px rgba(16,185,129,0.45);} 
        #best_player_section .bp-reason{background:#f1f5f9;padding:10px 12px;border-radius:12px;border-left:3px solid #10b981;font-size:13px;color:#334155;margin-top:8px;line-height:1.5;}
      </style>
      <div class="bp-header">
        ${imgHtml}
        <div style="flex:1;display:flex;flex-direction:column;gap:4px;">
          <div class="bp-meta">
            <h3 style="flex:1;">Best Player</h3>
            <span class="bp-score" title="Composite performance score">Score: ${bestPlayer.score}</span>
            ${teamHtml}
          </div>
          <div style="font-size:16px;font-weight:700;color:#111827;">${bestPlayer.name}</div>
        </div>
      </div>
      <div class="bp-reason">${bestPlayer.reason}</div>
    `;
    return div;
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
    if(!container) return; container.innerHTML = '';
    renderMatchStats(ev, container);
    renderMatchTimeline(ev, container);
    // Additional info card can be added here if needed.
  }

  function renderMatchStats(ev, container){
    const stats = extractMatchStats(ev); if(!Object.keys(stats).length) return;
    const card = document.createElement('div'); card.className='timeline-card';
    const h = document.createElement('h3'); h.textContent='Match Statistics'; card.appendChild(h);
    Object.entries(stats).forEach(([name, v])=> card.appendChild(createStatRow(name, v.home, v.away)) );
    container.appendChild(card);
  }
  function extractMatchStats(ev){
    const stats = {};
    const map = {'Possession':['possession_home','possession_away'],'Shots':['shots_home','shots_away'],'Shots on Target':['shots_on_target_home','shots_on_target_away'],'Corners':['corners_home','corners_away'],'Yellow Cards':['yellow_cards_home','yellow_cards_away'],'Red Cards':['red_cards_home','red_cards_away'],'Fouls':['fouls_home','fouls_away'],'Offsides':['offsides_home','offsides_away']};
    Object.entries(map).forEach(([label,[hk,ak]])=>{ if(ev[hk]!==undefined||ev[ak]!==undefined) stats[label]={home:ev[hk]||0,away:ev[ak]||0}; }); return stats;
  }
  function createStatRow(name, homeVal, awayVal){
    const row = document.createElement('div'); row.style.margin='8px 0 12px';
    const head = document.createElement('div'); head.style.cssText='display:flex;justify-content:space-between;margin-bottom:6px;font-weight:600;color:#374151'; head.innerHTML=`<span>${homeVal}</span><span>${name}</span><span>${awayVal}</span>`; row.appendChild(head);
    row.appendChild(createProgressBar(homeVal, awayVal, name.toLowerCase().includes('possession')));
    return row;
  }
  function createProgressBar(hv, av, pct){ const c=document.createElement('div'); c.style.cssText='height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden;display:flex;'; const hn=parseFloat(hv)||0; const an=parseFloat(av)||0; const tot=hn+an; if(tot>0){ const hp=pct?hn:(hn/tot*100); const ap=pct?an:(an/tot*100); const hb=document.createElement('div'); hb.style.cssText=`width:${hp}%;background:linear-gradient(90deg,#3b82f6,#1d4ed8)`; const ab=document.createElement('div'); ab.style.cssText=`width:${ap}%;background:linear-gradient(90deg,#ef4444,#dc2626)`; c.appendChild(hb); c.appendChild(ab);} return c; }

  function renderMatchTimeline(ev, container){
    let tl = ev.timeline || ev.timeline_items || ev.events || ev.event_timeline || ev.eventTimeline || [];
    if(tl && !Array.isArray(tl) && typeof tl==='object') tl = Object.values(tl).flat();
    if(!Array.isArray(tl) || tl.length===0) tl = synthesizeTimelineFromEvent(ev);
    if(!Array.isArray(tl) || !tl.length) return;
    const card = document.createElement('div'); card.className='timeline-card';
    const h = document.createElement('h3'); h.textContent='Match Timeline'; card.appendChild(h);
    tl.forEach(e => card.appendChild(createTimelineEvent(e)));
    container.appendChild(card);
  }
  function synthesizeTimelineFromEvent(ev){
    const out=[]; const scorers=ev.scorers||ev.goals||ev.goal_scorers||[]; if(Array.isArray(scorers)) scorers.forEach(s=> out.push({minute:s.minute||s.time||'', description: s.description || `Goal by ${s.name||s.player||s.player_name||''}`, player: s.name||s.player||s.player_name||'', team: s.team||''})); return out;
  }
  function createTimelineEvent(e){ const d=document.createElement('div'); d.className='timeline-event'; const m=document.createElement('div'); m.className='minute'; m.textContent = e.minute||e.time||''; const desc=document.createElement('div'); desc.className='desc'; desc.textContent = e.description || e.text || ''; d.appendChild(m); d.appendChild(desc); return d; }

  function buildCleanTimeline(ev){
    // Reuse timeline if present; otherwise synthesize from event
    let tl = ev.timeline || ev.timeline_items || ev.event_timeline || ev.events; if(Array.isArray(tl)) return tl; return synthesizeTimelineFromEvent(ev) || [];
  }

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

