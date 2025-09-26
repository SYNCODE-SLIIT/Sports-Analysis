/* Standalone Match Details page */
(function(){
  const loc = window.location;
  let apiBase = loc.origin;
  if(loc.port && loc.port !== '8000'){
    apiBase = loc.protocol + '//' + loc.hostname + ':8000';
  }
  // Expose for other scripts (e.g., tooltip summarizer in timeline utilities)
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

  // Wire extras navigation tabs (show one section at a time)
  function initExtrasNavigation(){
    try{
      const tabs = Array.from(document.querySelectorAll('#extras .nav-tab'));
      const sections = Array.from(document.querySelectorAll('#extras .extra-section'));
      if(!tabs.length || !sections.length) return;
      const activate = (targetId)=>{
        tabs.forEach(t=> t.classList.toggle('active', t.getAttribute('data-target') === targetId));
        sections.forEach(s=> s.classList.toggle('active', s.id === targetId));
      };
      tabs.forEach(btn=>{
        btn.addEventListener('click', ()=> activate(btn.getAttribute('data-target')));
      });
      // Ensure one is active initially
      const activeTab = tabs.find(t=> t.classList.contains('active')) || tabs[0];
      if(activeTab) activate(activeTab.getAttribute('data-target'));
    }catch(_e){}
  }

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

  // Initialize extras navigation tabs after sections are present in DOM
  initExtrasNavigation();

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

    // Teams (visual)
    const teamsBody = ensureSection('teams_section','teams');
    if(teamsBody){
      try{
        const [homeRes, awayRes] = await Promise.allSettled([
          home ? callIntent('team.get', { teamName: home }) : Promise.resolve(null),
          away ? callIntent('team.get', { teamName: away }) : Promise.resolve(null),
        ]);
        teamsBody.innerHTML = '';
        if(home){ teamsBody.appendChild(createTeamCard(home, homeRes || {status:'rejected'})); }
        if(away){ teamsBody.appendChild(createTeamCard(away, awayRes || {status:'rejected'})); }
      }catch(e){ teamsBody.textContent = 'Teams error: '+(e&&e.message?e.message:String(e)); }
    }

    // Players (visual)
    const playersBody = ensureSection('players_section','players');
    if(playersBody){
      try{
        const [homeRes, awayRes] = await Promise.allSettled([
          home ? callIntent('players.list', { teamName: home }) : Promise.resolve(null),
          away ? callIntent('players.list', { teamName: away }) : Promise.resolve(null),
        ]);
        playersBody.innerHTML = '';
        if(home){ const hCard = document.createElement('div'); hCard.appendChild(createPlayersCard(home, homeRes || {status:'rejected'})); playersBody.appendChild(hCard); }
        if(away){ const aCard = document.createElement('div'); aCard.appendChild(createPlayersCard(away, awayRes || {status:'rejected'})); playersBody.appendChild(aCard); }
      }catch(e){ playersBody.textContent = 'Players error: '+(e&&e.message?e.message:String(e)); }
    }

    // League table (visual)
    const tableBody = ensureSection('league_table_section','league table');
    if(tableBody){
      try{
        const args = leagueId ? {leagueId} : (leagueName ? {leagueName} : {});
        const j = Object.keys(args).length ? await callIntent('league.table', args) : null;
        tableBody.innerHTML = '';
        const data = j && (j.data || j.result || j.table || j.standings || j);
        tableBody.appendChild(createLeagueTableCard(data || []));
      }catch(e){ tableBody.textContent = 'League table error: '+(e&&e.message?e.message:String(e)); }
    }

    // Odds (visual)
    const oddsBody = ensureSection('odds_section','odds');
    if(oddsBody){
      try{
        const [listJ, liveJ] = await Promise.allSettled([
          callIntent('odds.list', eventId?{matchId:eventId}:{}) ,
          callIntent('odds.live', eventId?{matchId:eventId}:{})
        ]);
        oddsBody.innerHTML = '';
        oddsBody.appendChild(createOddsCard('Odds — Listed', listJ));
        oddsBody.appendChild(createOddsCard('Odds — Live', liveJ));
      }catch(e){ oddsBody.textContent = 'Odds error: '+(e&&e.message?e.message:String(e)); }
    }

    // Probabilities (Analysis Agent only)
    const probBody = ensureSection('prob_section','probabilities');
    if(probBody){
      try{
        probBody.innerHTML = '';
        const card = await fetchWinprobOverride(ev, { container: probBody });
        if(card) probBody.appendChild(card);
      }catch(e){ probBody.textContent = 'Probabilities error: '+(e&&e.message?e.message:String(e)); }
    }

    // Form (analysis.form) in its own tab
    const formBody = ensureSection('form_section','form');
    if(formBody){
      try{
        formBody.innerHTML = '';
        const formCard = await fetchRecentForm(ev, { container: formBody });
        if(formCard) formBody.appendChild(formCard);
      }catch(e){ formBody.textContent = 'Form error: '+(e&&e.message?e.message:String(e)); }
    }

    // Comments (visual)
    const commBody = ensureSection('comments_section','comments');
    if(commBody){
      try{
        const j = await callIntent('comments.list', eventId?{matchId: eventId}:{ eventName: home && away ? `${home} vs ${away}` : undefined });
        commBody.innerHTML = '';
        const payload = j && (j.data || j.result || j.comments || j);
        commBody.appendChild(createCommentsCard(payload || []));
      }catch(e){ commBody.textContent = 'Comments error: '+(e&&e.message?e.message:String(e)); }
    }

    // Seasons (visual)
    const seasBody = ensureSection('seasons_section','seasons');
    if(seasBody){
      try{
        const args = leagueId ? {leagueId} : (leagueName ? {leagueName} : {});
        const j = Object.keys(args).length ? await callIntent('seasons.list', args) : null;
        seasBody.innerHTML = '';
        const payload = j && (j.data || j.result || j.seasons || j);
        seasBody.appendChild(createSeasonsCard(payload || []));
      }catch(e){ seasBody.textContent = 'Seasons error: '+(e&&e.message?e.message:String(e)); }
    }

    // H2H (visual)
    const h2hBody = ensureSection('h2h_section','h2h');
    if(h2hBody){
      try{
        if(home && away){
          const j = await callIntent('h2h', { firstTeam: home, secondTeam: away });
          h2hBody.innerHTML = '';
          const data = j && (j.data || j.result || j);
          h2hBody.appendChild(createH2HCard(data || {}));
        } else { h2hBody.textContent = 'No team names available.'; }
      }catch(e){ h2hBody.textContent = 'H2H error: '+(e&&e.message?e.message:String(e)); }
    }
  }

  // ---------- Visual card builders for Extras (ported and adapted from matches.js) ----------
  function createTeamCard(teamName, result) {
    const card = document.createElement('div');
    card.style.cssText = `background: white; border-radius: 12px; padding: 16px; margin-bottom: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); border-left: 4px solid #3b82f6;`;

    const header = document.createElement('div');
    header.style.cssText = `display: flex; align-items: center; gap: 12px; margin-bottom: 12px;`;

    const icon = document.createElement('div');
    icon.style.cssText = `width: 40px; height: 40px; background: linear-gradient(135deg, #3b82f6, #1d4ed8); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold;`;
    icon.textContent = '⚽';

    const title = document.createElement('h4');
    title.style.cssText = 'margin: 0; color: #1f2937; font-size: 18px;';
    title.textContent = teamName;

    header.appendChild(icon);
    header.appendChild(title);

    if(result && result.status === 'fulfilled' && result.value && result.value.ok) {
      const data = result.value.data || result.value.result || result.value.teams || result.value;
      const team = Array.isArray(data) ? data[0] : data;
      if(team) {
        const infoGrid = document.createElement('div');
        infoGrid.style.cssText = `display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px;`;
        const teamInfo = [
          ['Founded', team.team_founded || team.intFormedYear || 'N/A'],
          ['Stadium', team.team_venue || team.strStadium || 'N/A'],
          ['Manager', team.team_manager || team.strManager || 'N/A'],
          ['League', team.league_name || team.strLeague || 'N/A'],
          ['Country', team.team_country || team.strCountry || 'N/A']
        ].filter(([label, value]) => value && value !== 'N/A');
        teamInfo.forEach(([label, value]) => {
          const item = document.createElement('div');
          item.style.cssText = `padding: 8px; background: #f8fafc; border-radius: 6px;`;
          item.innerHTML = `<div style="font-size: 11px; color: #6b7280; font-weight: 500; margin-bottom: 2px;">${label}</div><div style="color: #1f2937; font-weight: 600; font-size: 13px;">${value}</div>`;
          infoGrid.appendChild(item);
        });
        card.appendChild(header);
        card.appendChild(infoGrid);
      } else {
        card.appendChild(header);
        const noData = document.createElement('div');
        noData.style.cssText = 'color: #6b7280; font-style: italic;';
        noData.textContent = 'No team details available';
        card.appendChild(noData);
      }
    } else {
      card.appendChild(header);
      const error = document.createElement('div');
      error.style.cssText = 'color: #ef4444; font-style: italic;';
      error.textContent = 'Failed to load team data';
      card.appendChild(error);
    }
    return card;
  }

  function createPlayersCard(teamName, result) {
    const card = document.createElement('div');
    card.style.cssText = `background: white; border-radius: 12px; padding: 16px; margin-bottom: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); border-left: 4px solid #10b981;`;
    const header = document.createElement('div'); header.style.cssText = `display: flex; align-items: center; gap: 12px; margin-bottom: 12px;`;
    const icon = document.createElement('div'); icon.style.cssText = `width: 40px; height: 40px; background: linear-gradient(135deg, #10b981, #059669); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold;`; icon.textContent='👥';
    const title = document.createElement('h4'); title.style.cssText='margin: 0; color: #1f2937; font-size: 18px;'; title.textContent = `${teamName} Squad`;
    header.appendChild(icon); header.appendChild(title); card.appendChild(header);

    let players = []; let errorMsg = null;
    try{
      if (!result) players = [];
      else if (result.status === 'rejected') errorMsg = (result.reason && result.reason.message) ? result.reason.message : 'Request rejected';
      else if (result.status === 'fulfilled' && result.value){
        const v = result.value;
        if (v.data) {
          if (Array.isArray(v.data.result)) players = v.data.result;
          else if (Array.isArray(v.data.results)) players = v.data.results;
          else if (Array.isArray(v.data.players)) players = v.data.players;
          else if (Array.isArray(v.data)) players = v.data;
        }
        if (players.length === 0) {
          if (Array.isArray(v.result)) players = v.result;
          else if (Array.isArray(v.players)) players = v.players;
        }
        if (players.length === 0 && v.result && v.result.result && Array.isArray(v.result.result)) players = v.result.result;
      }
    }catch(e){ errorMsg = e && e.message ? e.message : String(e); }

    if(errorMsg){ const err=document.createElement('div'); err.style.cssText='color: #ef4444; font-style: italic; text-align: center; padding: 12px;'; err.textContent='Players error: ' + errorMsg; card.appendChild(err); return card; }
    if(!Array.isArray(players) || players.length===0){ const noPlayers=document.createElement('div'); noPlayers.style.cssText='color: #6b7280; font-style: italic; text-align: center; padding: 20px;'; noPlayers.textContent='No players found'; card.appendChild(noPlayers); return card; }

    const grid = document.createElement('div'); grid.style.cssText = `display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; max-height: 360px; overflow-y: auto; padding-right: 6px;`;
    players.slice(0,40).forEach(p=>{
      const item = document.createElement('div'); item.style.cssText = `display: flex; align-items: center; gap: 12px; padding: 8px; background: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0;`;
      const imgWrap = document.createElement('div'); imgWrap.style.cssText = `width: 48px; height: 48px; border-radius: 8px; overflow: hidden; flex-shrink: 0; background: linear-gradient(135deg,#e6eefc,#dbeafe); display:flex;align-items:center;justify-content:center;`;
      const imgUrl = p.player_image || p.player_photo || p.photo || p.thumb || p.playerImage || p.image || '';
      if(imgUrl){ const img=document.createElement('img'); img.src=imgUrl; img.alt = p.player_name || p.name || ''; img.style.cssText='width:100%;height:100%;object-fit:cover;'; img.onerror = ()=>{ imgWrap.textContent=(p.player_name||p.name||'P').split(' ').map(s=>s[0]).slice(0,2).join('').toUpperCase(); }; imgWrap.appendChild(img); }
      else { imgWrap.textContent=(p.player_name||p.name||'P').split(' ').map(s=>s[0]).slice(0,2).join('').toUpperCase(); imgWrap.style.fontWeight='700'; imgWrap.style.color='#0f1724'; }
      const info = document.createElement('div'); info.style.cssText='flex:1;min-width:0;';
      const nameRow = document.createElement('div'); nameRow.style.cssText='display:flex;justify-content:space-between;align-items:center;gap:8px;';
      const playerName = document.createElement('div'); playerName.style.cssText='font-weight:600;color:#1f2937;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'; playerName.textContent = p.player_name || p.name || p.strPlayer || 'Unknown';
      const num = document.createElement('div'); num.style.cssText='font-size:12px;color:#6b7280;font-weight:700;min-width:28px;text-align:center;'; num.textContent = (p.player_number || p.number || p.strNumber) ? String(p.player_number || p.number || p.strNumber) : '';
      nameRow.appendChild(playerName); nameRow.appendChild(num);
      const metaRow = document.createElement('div'); metaRow.style.cssText='display:flex;gap:8px;align-items:center;margin-top:4px;flex-wrap:wrap;';
      const position = document.createElement('div'); position.style.cssText='font-size:11px;color:#6b7280;'; position.textContent = p.player_type || p.position || p.strPosition || '';
      const stats = document.createElement('div'); stats.style.cssText='font-size:11px;color:#6b7280;'; const goals = p.player_goals || p.goals || p.scored || ''; const assists = p.player_assists || p.assists || ''; const parts=[]; if(goals!==undefined && goals!==null && String(goals).trim() !== '') parts.push(`G:${goals}`); if(assists!==undefined && assists!==null && String(assists).trim()!=='') parts.push(`A:${assists}`); stats.textContent = parts.join(' • ');
      metaRow.appendChild(position); if(stats.textContent) metaRow.appendChild(stats);
      info.appendChild(nameRow); info.appendChild(metaRow);
      item.appendChild(imgWrap); item.appendChild(info); grid.appendChild(item);
    });
    card.appendChild(grid);
    if(players.length>40){ const more=document.createElement('div'); more.style.cssText='margin-top: 8px; text-align: center; color: #6b7280; font-size: 12px;'; more.textContent = `... and ${players.length - 40} more players`; card.appendChild(more); }
    return card;
  }

  function createLeagueTableCard(data) {
    const card = document.createElement('div'); card.style.cssText = `background: white; border-radius: 12px; padding: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); border-left: 4px solid #f59e0b;`;
    const header = document.createElement('div'); header.style.cssText = `display: flex; align-items: center; gap: 12px; margin-bottom: 16px;`;
    const icon = document.createElement('div'); icon.style.cssText = `width: 40px; height: 40px; background: linear-gradient(135deg, #f59e0b, #d97706); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold;`; icon.textContent='🏆';
    const title = document.createElement('h4'); title.style.cssText='margin: 0; color: #1f2937; font-size: 18px;'; title.textContent='League Table';
    header.appendChild(icon); header.appendChild(title); card.appendChild(header);

    let teams = [];
    if (Array.isArray(data)) teams = data; else if (data){
      if (Array.isArray(data.total)) teams = data.total; else if (Array.isArray(data.teams)) teams = data.teams; else if (Array.isArray(data.result)) teams = data.result; else if (Array.isArray(data.table)) teams = data.table; else if (Array.isArray(data.standings)) teams = data.standings; else if (data.result && Array.isArray(data.result.total)) teams = data.result.total; else if (data.data && Array.isArray(data.data.total)) teams = data.data.total; else teams = [];
    }
    if(Array.isArray(teams) && teams.length>0){
      const table = document.createElement('div'); table.style.cssText='overflow-x: auto;';
      const thead = document.createElement('div'); thead.style.cssText = `display: grid; grid-template-columns: 40px 1fr 60px 60px 60px 60px 60px; gap: 8px; padding: 8px; background: #f8fafc; border-radius: 6px; font-size: 12px; font-weight: 600; color: #6b7280; margin-bottom: 4px;`; thead.innerHTML = '<div>Pos</div><div>Team</div><div>P</div><div>W</div><div>D</div><div>L</div><div>PTS</div>';
      table.appendChild(thead);
      teams.slice(0,10).forEach((team, index)=>{
        const row = document.createElement('div'); row.style.cssText = `display: grid; grid-template-columns: 40px 1fr 60px 60px 60px 60px; gap: 8px; padding: 8px; border-radius: 6px; font-size: 13px; ${index % 2 === 0 ? 'background: #f9fafb;' : ''} border-left: 3px solid ${getPositionColor(index + 1)};`;
        const position = team.standing_place || team.position || team.overall_league_position || (index + 1);
        const teamName = team.standing_team || team.team_name || team.strTeam || team.name || 'Unknown';
        const played = team.standing_P || team.overall_league_payed || team.overall_league_played || team.played || team.matches || team.games || '-';
        const wins = team.standing_W || team.overall_league_W || team.wins || team.W || '-';
        const draws = team.standing_D || team.overall_league_D || team.draws || team.D || '-';
        const losses = team.standing_L || team.overall_league_L || team.losses || team.L || '-';
        const points = team.standing_PTS || team.points || team.pts || team.overall_league_PTS || '-';
        const teamLogo = team.team_logo || team.teamLogo || team.logo || '';
        row.innerHTML = `
          <div style="font-weight: 600; color: #1f2937;">${position}</div>
          <div style="font-weight: 500; color: #1f2937; display:flex; align-items:center; gap:8px;">
            ${teamLogo ? `<img src="${teamLogo}" style="width:24px;height:24px;object-fit:contain;border-radius:4px;" onerror="this.remove()" />` : ''}
            <span>${teamName}</span>
          </div>
          <div style="text-align: center;">${played}</div>
          <div style="text-align: center; color: #10b981;">${wins}</div>
          <div style="text-align: center; color: #f59e0b;">${draws}</div>
          <div style="text-align: center; color: #ef4444;">${losses}</div>
          <div style="text-align: center; font-weight:600;">${points}</div>
        `;
        table.appendChild(row);
      });
      card.appendChild(table);
    } else {
      const noData = document.createElement('div'); noData.style.cssText = 'color: #6b7280; font-style: italic; text-align: center; padding: 20px;'; noData.textContent = 'League table not available'; card.appendChild(noData);
    }
    return card;
  }
  function getPositionColor(position){ if(position <= 4) return '#10b981'; if(position <= 6) return '#3b82f6'; if(position >= 18) return '#ef4444'; return '#6b7280'; }

  function createOddsCard(title, result) {
    const card = document.createElement('div'); card.style.cssText = `background: white; border-radius: 12px; padding: 16px; margin-bottom: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); border-left: 4px solid #8b5cf6;`;
    const header = document.createElement('div'); header.style.cssText = `display: flex; align-items: center; gap: 12px; margin-bottom: 12px;`;
    const icon = document.createElement('div'); icon.style.cssText = `width: 40px; height: 40px; background: linear-gradient(135deg, #8b5cf6, #7c3aed); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold;`; icon.textContent='💰';
    const titleEl = document.createElement('h4'); titleEl.style.cssText='margin: 0; color: #1f2937; font-size: 18px;'; titleEl.textContent = title;
    header.appendChild(icon); header.appendChild(titleEl); card.appendChild(header);
    if(result && result.status === 'fulfilled' && result.value && result.value.ok){
      const v = result.value; let odds = [];
      try{
        if(v.data){ if(Array.isArray(v.data)) odds = v.data; else if(Array.isArray(v.data.result)) odds = v.data.result; else if(v.data.result && typeof v.data.result === 'object'){ const vals = Object.values(v.data.result).filter(Boolean); odds = vals.reduce((acc,cur)=> acc.concat(Array.isArray(cur)?cur:[]), []); } else if(Array.isArray(v.data.results)) odds = v.data.results; else if(Array.isArray(v.data.odds)) odds = v.data.odds; }
        if(odds.length===0 && v.result){ if(Array.isArray(v.result)) odds = v.result; else if(typeof v.result === 'object'){ const vals = Object.values(v.result).filter(Boolean); odds = vals.reduce((acc,cur)=> acc.concat(Array.isArray(cur)?cur:[]), []); } }
      }catch(e){ odds = []; }
      if(Array.isArray(odds) && odds.length>0){
        const grid = document.createElement('div'); grid.style.cssText = `display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px;`;
        const fmt = (n)=> (n===null||n===undefined||n==='')? '-' : (typeof n === 'number' ? n.toFixed(2) : String(n));
        odds.slice(0,12).forEach(odd=>{
          const item = document.createElement('div'); item.style.cssText = `padding: 12px; background: #f8fafc; border-radius: 6px; text-align: left; border: 1px solid #e2e8f0; display:flex;flex-direction:column;gap:6px;`;
          const bookmaker = odd.odd_bookmakers || odd.bookmaker_name || odd.strBookmaker || odd.bookmaker || 'Unknown';
          const headerRow = document.createElement('div'); headerRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;';
          const nameEl = document.createElement('div'); nameEl.style.cssText = 'font-weight:600;color:#1f2937;font-size:13px;'; nameEl.textContent = bookmaker;
          const idEl = document.createElement('div'); idEl.style.cssText = 'font-size:12px;color:#6b7280;'; idEl.textContent = odd.match_id ? `id:${odd.match_id}` : '';
          headerRow.appendChild(nameEl); headerRow.appendChild(idEl);
          const markets = document.createElement('div'); markets.style.cssText = 'display:flex;flex-direction:column;gap:4px;font-size:12px;color:#374151;';
          const h = fmt(odd.odd_1 || odd.home || odd.h); const d = fmt(odd.odd_x || odd.draw || odd.x); const a = fmt(odd.odd_2 || odd.away || odd.a);
          const row132 = document.createElement('div'); row132.style.cssText = 'display:flex;justify-content:space-between;gap:8px;'; row132.innerHTML = `<div style="color:#6b7280;font-weight:600">1X2</div><div style="display:flex;gap:8px"><span style=\"color:#3b82f6;\">H:${h}</span><span style=\"color:#f59e0b;\">D:${d}</span><span style=\"color:#ef4444;\">A:${a}</span></div>`; markets.appendChild(row132);
          const btsYes = odd.bts_yes || odd.btst_yes || odd.btsy || odd.bts_yes; const btsNo = odd.bts_no || odd.btst_no || odd.btsn || odd.bts_no;
          if(btsYes !== undefined || btsNo !== undefined){ const btsRow=document.createElement('div'); btsRow.style.cssText='display:flex;justify-content:space-between;gap:8px;'; btsRow.innerHTML = `<div style=\"color:#6b7280;font-weight:600\">BTTS</div><div style=\"display:flex;gap:8px\"><span style=\"color:#10b981;\">Y:${fmt(btsYes)}</span><span style=\"color:#ef4444;\">N:${fmt(btsNo)}</span></div>`; markets.appendChild(btsRow); }
          const ou25 = (odd['o+2.5'] !== undefined || odd['u+2.5'] !== undefined) ? {o: odd['o+2.5'], u: odd['u+2.5']} : null;
          if(ou25){ const ouRow=document.createElement('div'); ouRow.style.cssText='display:flex;justify-content:space-between;gap:8px;'; ouRow.innerHTML = `<div style=\"color:#6b7280;font-weight:600\">O/U 2.5</div><div style=\"display:flex;gap:8px\"><span style=\"color:#3b82f6;\">O:${fmt(ou25.o)}</span><span style=\"color:#ef4444;\">U:${fmt(ou25.u)}</span></div>`; markets.appendChild(ouRow); }
          const ah0_1 = odd.ah0_1 || odd['ah0_1']; const ah0_2 = odd.ah0_2 || odd['ah0_2'];
          if(ah0_1 !== undefined || ah0_2 !== undefined){ const ahRow=document.createElement('div'); ahRow.style.cssText='display:flex;justify-content:space-between;gap:8px;'; ahRow.innerHTML = `<div style=\"color:#6b7280;font-weight:600\">AH 0</div><div style=\"display:flex;gap:8px\"><span style=\"color:#3b82f6;\">H:${fmt(ah0_1)}</span><span style=\"color:#ef4444;\">A:${fmt(ah0_2)}</span></div>`; markets.appendChild(ahRow); }
          item.appendChild(headerRow); item.appendChild(markets); grid.appendChild(item);
        });
        card.appendChild(grid);
      } else {
        const noOdds=document.createElement('div'); noOdds.style.cssText='color: #6b7280; font-style: italic; text-align: center; padding: 20px;'; noOdds.textContent='No odds available'; card.appendChild(noOdds);
      }
    } else {
      const errMsg = (result && result.status === 'rejected') ? (result.reason && result.reason.message ? result.reason.message : 'Request rejected') : 'Failed to load odds';
      const error = document.createElement('div'); error.style.cssText='color: #ef4444; font-style: italic; text-align: center; padding: 20px;'; error.textContent = errMsg; card.appendChild(error);
    }
    return card;
  }

  function createCommentsCard(data) {
    const card = document.createElement('div'); card.style.cssText = `background: white; border-radius: 12px; padding: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); border-left: 4px solid #ec4899;`;
    const header = document.createElement('div'); header.style.cssText = `display: flex; align-items: center; gap: 12px; margin-bottom: 16px;`;
    const icon = document.createElement('div'); icon.style.cssText = `width: 40px; height: 40px; background: linear-gradient(135deg, #ec4899, #db2777); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold;`; icon.textContent='💬';
    const title = document.createElement('h4'); title.style.cssText='margin: 0; color: #1f2937; font-size: 18px;'; title.textContent='Match Commentary';
    header.appendChild(icon); header.appendChild(title); card.appendChild(header);
    let comments = [];
    try{
      if(!data) comments = [];
      else if(Array.isArray(data)) comments = data;
      else if(Array.isArray(data.comments)) comments = data.comments;
      else if(Array.isArray(data.result)) comments = data.result;
      else if(data.result && typeof data.result === 'object'){ const vals = Object.values(data.result).filter(Boolean); comments = vals.reduce((acc,cur)=> acc.concat(Array.isArray(cur)?cur:[]), []); }
      else if(data.data && Array.isArray(data.data)) comments = data.data;
    }catch(e){ comments = []; }
    if(Array.isArray(comments) && comments.length>0){
      const list = document.createElement('div'); list.style.cssText = 'max-height: 400px; overflow-y: auto; padding-right: 6px;';
      const extractMinute = (c)=> c.comments_time || c.time || c.minute || c.match_minute || c.comment_minute || '';
      const extractText = (c)=> c.comments_text || c.comment_text || c.comment || c.text || '';
      const extractType = (c)=> c.comments_type || c.comment_type || c.type || 'Comment';
      comments.slice(0,100).forEach((c,idx)=>{
        const item = document.createElement('div'); item.style.cssText = `padding: 12px; margin-bottom: 8px; background: ${idx%2===0?'#f8fafc':'white'}; border-radius: 8px; border-left: 3px solid #ec4899;`;
        const head = document.createElement('div'); head.style.cssText='display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;';
        const minute = document.createElement('div'); minute.style.cssText='font-size: 12px; color: #ec4899; font-weight: 600;'; const m = extractMinute(c); minute.textContent = m ? String(m) : '';
        const type = document.createElement('div'); type.style.cssText='font-size: 11px; color: #6b7280; text-transform: uppercase;'; type.textContent = extractType(c) || 'Comment';
        head.appendChild(minute); head.appendChild(type);
        const text = document.createElement('div'); text.style.cssText = 'color: #374151; font-size: 13px; line-height: 1.4;'; text.textContent = extractText(c) || 'No comment available';
        item.appendChild(head); item.appendChild(text); list.appendChild(item);
      });
      card.appendChild(list);
      if(comments.length>100){ const more=document.createElement('div'); more.style.cssText='margin-top: 8px; text-align: center; color: #6b7280; font-size: 12px;'; more.textContent = `... and ${comments.length - 100} more comments`; card.appendChild(more); }
    } else {
      const noData=document.createElement('div'); noData.style.cssText='color: #6b7280; font-style: italic; text-align: center; padding: 20px;'; noData.textContent='No match commentary available'; card.appendChild(noData);
    }
    return card;
  }

  function createSeasonsCard(data){
    const card = document.createElement('div'); card.style.cssText = `background: white; border-radius: 12px; padding: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); border-left: 4px solid #14b8a6;`;
    const header = document.createElement('div'); header.style.cssText = `display: flex; align-items: center; gap: 12px; margin-bottom: 16px;`;
    const icon = document.createElement('div'); icon.style.cssText = `width: 40px; height: 40px; background: linear-gradient(135deg, #14b8a6, #0f766e); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold;`; icon.textContent='📅';
    const title = document.createElement('h4'); title.style.cssText='margin: 0; color: #1f2937; font-size: 18px;'; title.textContent='Seasons';
    header.appendChild(icon); header.appendChild(title); card.appendChild(header);
    let seasons = [];
    try{ if(!data) seasons=[]; else if(Array.isArray(data)) seasons = data; else if(Array.isArray(data.seasons)) seasons = data.seasons; else if(Array.isArray(data.result)) seasons = data.result; else if(data.result && typeof data.result==='object'){ const vals = Object.values(data.result).filter(Boolean); seasons = vals.reduce((acc,cur)=> acc.concat(Array.isArray(cur)?cur:[]), []); } else if(data.data && Array.isArray(data.data)) seasons = data.data; }catch(e){ seasons=[]; }
    if(seasons.length>0){ const grid=document.createElement('div'); grid.style.cssText = `display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; max-height: 240px; overflow-y: auto;`;
      seasons.slice(0,20).forEach(season=>{ const item=document.createElement('div'); item.style.cssText = `padding: 12px; background: #f0fdfa; border-radius: 8px; text-align: center; border: 1px solid #14b8a620; cursor: pointer; transition: all 0.2s;`; item.onmouseover=()=> item.style.background='#ccfbf1'; item.onmouseout=()=> item.style.background='#f0fdfa'; const name=document.createElement('div'); name.style.cssText='font-weight: 600; color: #0f766e; font-size: 14px;'; name.textContent = season.season_name || season.strSeason || season.name || 'Unknown Season'; const year=document.createElement('div'); year.style.cssText='font-size: 12px; color: #6b7280; margin-top: 4px;'; year.textContent = season.season_year || season.year || ''; item.appendChild(name); if(year.textContent) item.appendChild(year); grid.appendChild(item); }); card.appendChild(grid); if(seasons.length>20){ const more=document.createElement('div'); more.style.cssText='margin-top: 8px; text-align: center; color: #6b7280; font-size: 12px;'; more.textContent = `... and ${seasons.length - 20} more seasons`; card.appendChild(more); } }
    else { const noData=document.createElement('div'); noData.style.cssText='color: #6b7280; font-style: italic; text-align: center; padding: 20px;'; noData.textContent='No seasons data available'; card.appendChild(noData); }
    return card;
  }

  function createH2HCard(data){
    const card = document.createElement('div'); card.style.cssText = `background: white; border-radius: 12px; padding: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); border-left: 4px solid #f97316;`;
    const header = document.createElement('div'); header.style.cssText = `display: flex; align-items: center; gap: 12px; margin-bottom: 16px;`;
    const icon = document.createElement('div'); icon.style.cssText = `width: 40px; height: 40px; background: linear-gradient(135deg, #f97316, #ea580c); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold;`; icon.textContent='⚔️';
    const title = document.createElement('h4'); title.style.cssText='margin: 0; color: #1f2937; font-size: 18px;'; title.textContent='Head-to-Head History';
    header.appendChild(icon); header.appendChild(title); card.appendChild(header);
    const sections = [ { title: 'Recent Meetings', data: data.H2H, color: '#3b82f6' }, { title: 'First Team Recent', data: data.firstTeamResults, color: '#10b981' }, { title: 'Second Team Recent', data: data.secondTeamResults, color: '#ef4444' } ];
    sections.forEach(section=>{
      if(Array.isArray(section.data) && section.data.length>0){
        const sectionDiv=document.createElement('div'); sectionDiv.style.cssText='margin-bottom: 20px;';
        const st=document.createElement('h5'); st.style.cssText = `margin: 0 0 8px 0; color: ${section.color}; font-size: 14px; font-weight: 600;`; st.textContent = section.title;
        const list=document.createElement('div');
        section.data.slice(0,5).forEach(match=>{
          const item=document.createElement('div'); item.style.cssText = `display: flex; justify-content: space-between; align-items: center; padding: 8px; background: #f9fafb; border-radius: 6px; margin-bottom: 4px; font-size: 12px; cursor:pointer;`;
          const date = match.event_date || match.date || '';
          const home = match.event_home_team || match.home_team || match.strHomeTeam || '';
          const away = match.event_away_team || match.away_team || match.strAwayTeam || '';
          const score = match.event_final_result || match.event_ft_result || ((match.home_score!=null && match.away_score!=null) ? `${match.home_score} - ${match.away_score}` : '');
          const dateSpan=document.createElement('span'); dateSpan.style.cssText='color: #6b7280;'; dateSpan.textContent = date;
          const teamsWrap=document.createElement('div'); teamsWrap.style.cssText='display:flex;align-items:center;gap:8px;flex:1;justify-content:center;';
          const homeWrap=document.createElement('div'); homeWrap.style.cssText='display:flex;align-items:center;gap:8px;';
          const homeLogo=document.createElement('img'); homeLogo.src = match.home_team_logo || match.homeTeamLogo || match.home_logo || match.home_team_image || ''; homeLogo.style.cssText='width:28px;height:20px;object-fit:contain;border-radius:4px;'; homeLogo.onerror=()=>homeLogo.remove();
          const homeNameEl=document.createElement('div'); homeNameEl.style.cssText='font-weight:600;color:#1f2937;font-size:13px;'; homeNameEl.textContent = home; homeWrap.appendChild(homeLogo); homeWrap.appendChild(homeNameEl);
          const vsEl=document.createElement('div'); vsEl.style.cssText='font-size:12px;color:#6b7280;font-weight:600;'; vsEl.textContent='vs';
          const awayWrap=document.createElement('div'); awayWrap.style.cssText='display:flex;align-items:center;gap:8px;';
          const awayLogo=document.createElement('img'); awayLogo.src = match.away_team_logo || match.awayTeamLogo || match.away_logo || match.away_team_image || ''; awayLogo.style.cssText='width:28px;height:20px;object-fit:contain;border-radius:4px;'; awayLogo.onerror=()=>awayLogo.remove();
          const awayNameEl=document.createElement('div'); awayNameEl.style.cssText='font-weight:600;color:#1f2937;font-size:13px;'; awayNameEl.textContent = away; awayWrap.appendChild(awayLogo); awayWrap.appendChild(awayNameEl);
          teamsWrap.appendChild(homeWrap); teamsWrap.appendChild(vsEl); teamsWrap.appendChild(awayWrap);
          const scoreSpan=document.createElement('span'); scoreSpan.style.cssText='color: #374151; font-weight: 600; min-width:60px; text-align:center;'; scoreSpan.textContent = score || 'vs';
          item.appendChild(dateSpan); item.appendChild(teamsWrap); item.appendChild(scoreSpan);
          item.addEventListener('click', ()=>{ try{ const id = extractEventId(match); if(id){ const url = new URL(window.location.href); url.searchParams.set('eventId', String(id)); window.location.href = url.toString(); } }catch(_e){} });
          list.appendChild(item);
        });
        sectionDiv.appendChild(st); sectionDiv.appendChild(list); card.appendChild(sectionDiv);
      }
    });
    return card;
  }

  // Feature stubs
  async function augmentEventTags(_ev){ console.log('augmentEventTags: not implemented in this build'); }
  async function runPlayerAnalytics(_ev){ alert('Player analytics not implemented yet'); }
  async function runMultimodalExtract(_ev){ alert('Multimodal extract not implemented yet'); }

  // ---- Analysis Agent integrations (win probabilities + recent form) ----
  function inferVenueInfo(hints){
    const country = (hints && (hints.country_name || hints.event_country || hints.country)) || '';
    const home = (hints && (hints.event_home_team || hints.home_team || hints.strHomeTeam)) || '';
    const away = (hints && (hints.event_away_team || hints.away_team || hints.strAwayTeam)) || '';
    const norm = s => String(s || '').toLowerCase();
    const matchCountry = (team, country) => { const t = norm(team); const c = norm(country); if(!t || !c) return false; return t.includes(c) || c.includes(t); };
    const homeMatches = matchCountry(home, country);
    const awayMatches = matchCountry(away, country);
    const neutral = !!country && !homeMatches && !awayMatches;
    return { country, home, away, homeMatches, awayMatches, neutral };
  }

  function createProbabilitiesCardEnhanced(ctx){
    const { res } = ctx || {};
    const data = (res && res.data) || {};
    const probs = data.probs || {};
    let pH = Number(probs.home || 0), pD = Number(probs.draw || 0), pA = Number(probs.away || 0);
    const sum = pH + pD + pA; if(sum>0){ pH/=sum; pD/=sum; pA/=sum; }
    const pct = v => (Number(v*100).toFixed(1));

    const homeName = (data.home_team && (data.home_team.name || data.home_team.short_name)) || ctx.home_team_name || ctx.event_home_team || 'Home';
    const awayName = (data.away_team && (data.away_team.name || data.away_team.short_name)) || ctx.away_team_name || ctx.event_away_team || 'Away';
    const hLogo = (data.home_team && data.home_team.logo) || ctx.home_team_logo || '';
    const aLogo = (data.away_team && data.away_team.logo) || ctx.away_team_logo || '';

    let neutral = !!(data.venue && (data.venue.neutral === true));
    if (data.venue == null || typeof data.venue.neutral === 'undefined'){
      try{ const vinf = inferVenueInfo({ country_name: ctx.country_name, event_home_team: homeName, event_away_team: awayName }); neutral = !!vinf.neutral; }catch(_e){}
    }
    const homeRole = neutral ? 'Neutral' : 'Home';
    const awayRole = neutral ? 'Neutral' : 'Away';

    const card = document.createElement('div'); card.className='prob-card'; card.setAttribute('data-agent-prob','1');
    const head = document.createElement('div'); head.className='prob-headline';
    head.innerHTML = `
      <div class="side side-left">
        ${hLogo? `<img class="logo" src="${hLogo}" alt="${homeName} logo" onerror="this.remove()">` : ''}
        <span class="name">${homeName}</span>
        <span class="role" style="font-size:11px;color:#64748b;">(${homeRole})</span>
      </div>
      <div class="middle">${homeName} (${homeRole}) ${pct(pH)}% | Draw ${pct(pD)}% | ${awayName} (${awayRole}) ${pct(pA)}%</div>
      <div class="side side-right">
        <span class="role" style="font-size:11px;color:#64748b;">(${awayRole})</span>
        <span class="name">${awayName}</span>
        ${aLogo? `<img class="logo" src="${aLogo}" alt="${awayName} logo" onerror="this.remove()">` : ''}
      </div>`;
    card.appendChild(head);

    const stacked = document.createElement('div'); stacked.className='prob-stacked';
    const wH = Math.max(0, Math.min(100, Number(pH*100).toFixed(1)));
    const wD = Math.max(0, Math.min(100, Number(pD*100).toFixed(1)));
    let wA = Math.max(0, Math.min(100, Number(pA*100).toFixed(1)));
    const totalRounded = Number(wH) + Number(wD) + Number(wA); if(totalRounded !== 100){ wA = (100 - Number(wH) - Number(wD)).toFixed(1); }
    stacked.innerHTML = `
      <span class="seg home" style="width:${wH}%;"></span>
      <span class="seg draw" style="width:${wD}%;"></span>
      <span class="seg away" style="width:${wA}%;"></span>`;
    card.appendChild(stacked);

    const labels = document.createElement('div'); labels.className='prob-labels';
    labels.innerHTML = `
      <span class="lbl">${homeName} (${homeRole}) ${Number(wH).toFixed(1)}%</span>
      <span class="lbl">Draw ${Number(wD).toFixed(1)}%</span>
      <span class="lbl">${awayName} (${awayRole}) ${Number(wA).toFixed(1)}%</span>`;
    card.appendChild(labels);

    const mkMini = (key, label, width) => { const row=document.createElement('div'); row.className='prob-mini'; row.innerHTML = `
        <div class="label">${label}</div>
        <div class="bar"><span class="fill ${key}" style="width:${width}%"></span></div>
        <div class="value">${Number(width).toFixed(1)}%</div>`; return row; };
    card.appendChild(mkMini('home', `${homeName} ${neutral? '(Neutral)':'(Home)'}`, wH));
    card.appendChild(mkMini('draw', 'Draw', wD));
    card.appendChild(mkMini('away', `${awayName} ${neutral? '(Neutral)':'(Away)'}`, wA));

    const meta = document.createElement('div'); meta.className='prob-meta';
    const method = data.method || 'unknown'; const sample = (data.inputs && (data.inputs.sample_size || data.inputs.effective_weight)) || undefined;
    const leftMeta = document.createElement('div'); leftMeta.textContent = `Method: ${method}${sample? ` • n=${sample}`:''}`;
    const btnMeta = document.createElement('button'); btnMeta.className='raw-toggle'; btnMeta.textContent='Show raw';
    const pre = document.createElement('pre'); try{ pre.textContent = JSON.stringify(res, null, 2); }catch(_e){ pre.textContent = String(res); }
    btnMeta.addEventListener('click', ()=>{ const shown = pre.style.display==='block'; pre.style.display = shown?'none':'block'; btnMeta.textContent = shown? 'Show raw':'Hide raw'; });
    meta.appendChild(leftMeta); meta.appendChild(btnMeta); card.appendChild(meta); card.appendChild(pre);
    return card;
  }

  async function fetchWinprobOverride(ev, opts){
    const probBody = document.querySelector('#prob_section .body');
    if(!probBody) return null;
    // Clear previous agent card
    const existing = probBody.querySelector('[data-agent-prob="1"]'); if(existing) existing.remove();

    const eventId = extractEventId(ev);
    if(!eventId){
      const err = document.createElement('div'); err.className='prob-error'; err.textContent='Missing eventId'; return err;
    }
    try{
      const url = new URL(apiBase + '/analysis/winprob');
      url.searchParams.set('eventId', String(eventId));
      url.searchParams.set('source', 'auto');
      url.searchParams.set('lookback', '10');
      const resp = await fetch(url.toString());
      const res = await resp.json().catch(()=> ({}));

      const home = ev.event_home_team || ev.strHomeTeam || ev.home_team || '';
      const away = ev.event_away_team || ev.strAwayTeam || ev.away_team || '';
      const country = ev.country_name || ev.strCountry || ev.country || '';
      const hLogo = (ev.home_team_logo || ev.strHomeTeamBadge || ev.homeBadge || ev.home_logo || ev.team_home_badge || '');
      const aLogo = (ev.away_team_logo || ev.strAwayTeamBadge || ev.awayBadge || ev.away_logo || ev.team_away_badge || '');

      const _inferFromLogo = (url)=>{ try{ if(!url) return ''; const last = String(url).split('?')[0].split('#')[0].split('/').pop() || ''; const base = last.replace(/\.[a-zA-Z0-9]+$/, ''); const t = decodeURIComponent(base).replace(/[\-_]+/g, ' ').trim(); return t ? t.split(' ').map(w=> w? (w[0].toUpperCase()+w.slice(1)) : '').join(' ') : ''; }catch(_e){ return ''; } };
      const derivedHomeName = home || _inferFromLogo(hLogo) || 'Home';
      const derivedAwayName = away || _inferFromLogo(aLogo) || 'Away';
      const card = createProbabilitiesCardEnhanced({
        __from: 'override', event_key: eventId,
        event_home_team: home, event_away_team: away,
        home_team_name: derivedHomeName, away_team_name: derivedAwayName,
        country_name: country, home_team_logo: hLogo, away_team_logo: aLogo,
        res
      });
      return card;
    }catch(e){
      const err = document.createElement('div'); err.className='prob-error'; err.textContent='Failed to load probabilities'; return err;
    }
  }

  async function fetchRecentForm(ev, opts){
    const root = (opts && opts.container) || document.querySelector('#prob_section .body');
    if(!root) return null;
    const prev = root.querySelector('[data-agent-form="1"]'); if(prev) prev.remove();
    const eventId = extractEventId(ev); if(!eventId){ const err=document.createElement('div'); err.className='prob-error'; err.textContent='Missing eventId'; return err; }
    try{
      const url = new URL(apiBase + '/analysis/form'); url.searchParams.set('eventId', String(eventId)); url.searchParams.set('lookback','5');
      const resp = await fetch(url.toString()); const res = await resp.json().catch(()=> ({})); if(!resp.ok || !res || res.ok === false) throw new Error('Form error');
      const home = ev.event_home_team || ev.strHomeTeam || ev.home_team || '';
      const away = ev.event_away_team || ev.strAwayTeam || ev.away_team || '';
      const hLogo = ev.home_team_logo || ev.strHomeTeamBadge || ev.homeBadge || ev.home_logo || ev.team_home_badge || '';
      const aLogo = ev.away_team_logo || ev.strAwayTeamBadge || ev.awayBadge || ev.away_logo || ev.team_away_badge || '';
      const card = createFormCard({ res, homeName: home, awayName: away, hLogo, aLogo });
      return card;
    }catch(e){ const err=document.createElement('div'); err.className='prob-error'; err.textContent='Failed to load recent form'; return err; }
  }

  function createFormCard(ctx){
    const { res, homeName, awayName, hLogo, aLogo } = ctx || {};
    const data = (res && res.data) || {};
    const home = data.home_team || {}; const away = data.away_team || {};
    const hm = data.home_metrics || {}; const am = data.away_metrics || {};
    const lookback = (hm.games || am.games || 0);
    const HN = home.name || homeName || 'Home'; const AN = away.name || awayName || 'Away';
    const card = document.createElement('div'); card.className='form-card'; card.setAttribute('data-agent-form','1');
    const grid = document.createElement('div'); grid.className='form-grid'; card.appendChild(grid);
    const mkChips = (arr)=>{ const wrap=document.createElement('div'); wrap.className='chips'; (Array.isArray(arr)?arr:[]).forEach(x=>{ const t=String(x||'').trim().toUpperCase(); const span=document.createElement('span'); span.className='chip '+(t==='W'?'win':(t==='D'?'draw':'loss')); span.textContent=t||'?'; wrap.appendChild(span); }); if(!wrap.children.length){ const empty=document.createElement('div'); empty.style.cssText='font-size:12px;color:#64748b'; empty.textContent='No recent results'; wrap.appendChild(empty);} return wrap; };
    const mkTeam = (side)=>{ const isHome = side==='home'; const team=isHome?home:away; const met=isHome?hm:am; const nm=isHome?HN:AN; const logo=isHome? (home.logo || hLogo) : (away.logo || aLogo); const role=isHome?'Home':'Away'; const box=document.createElement('div'); box.className='form-team'; const hdr=document.createElement('div'); hdr.className='hdr'; hdr.innerHTML = `${logo? `<img class="logo" src="${logo}" alt="${nm} logo" onerror="this.remove()">` : ''}<span class="name">${nm}</span> <span class="role">(${role})</span>`; box.appendChild(hdr); const summary=document.createElement('div'); summary.className='form-summary'; summary.textContent = (team.summary || ''); box.appendChild(summary); box.appendChild(mkChips(met.last_results)); const tbl=document.createElement('table'); tbl.className='metric-table'; const addRow=(k,v)=>{ const tr=document.createElement('tr'); tr.innerHTML = `<td class="k">${k}</td><td class="v">${v}</td>`; tbl.appendChild(tr); }; addRow('Games', met.games ?? '—'); addRow('Wins / Draws / Losses', `${met.wins ?? '—'} / ${met.draws ?? '—'} / ${met.losses ?? '—'}`); addRow('Goals For / Against', `${met.gf ?? '—'} / ${met.ga ?? '—'}`); addRow('Goal Difference', `${met.gd ?? '—'}`); box.appendChild(tbl); return box; };
    grid.appendChild(mkTeam('home')); grid.appendChild(mkTeam('away'));
    const footer=document.createElement('div'); footer.className='form-footer'; const left=document.createElement('div'); left.textContent = `Lookback: ${lookback || 5} games`; const btn=document.createElement('button'); btn.className='raw-toggle'; btn.textContent='Show raw'; const pre=document.createElement('pre'); try{ pre.textContent = JSON.stringify(res, null, 2);}catch(_e){ pre.textContent = String(res);} btn.addEventListener('click', ()=>{ const shown=pre.style.display==='block'; pre.style.display = shown? 'none':'block'; btn.textContent = shown? 'Show raw':'Hide raw'; }); footer.appendChild(left); footer.appendChild(btn); card.appendChild(footer); card.appendChild(pre); return card;
  }

  // Start
  load();
  // Pre-wire extras nav just in case
  initExtrasNavigation();
})();

