/* Matches dashboard logic */
(function(){
  // Determine backend base: if served from a static server (e.g. 5500) assume FastAPI on 8000 same host.
  const loc = window.location;
  let apiBase = loc.origin;
  if(loc.port && loc.port !== '8000'){
    apiBase = loc.protocol + '//' + loc.hostname + ':8000';
  }
  const liveListEl = document.getElementById('liveList');
  const finishedListEl = document.getElementById('finishedList');
  const liveCountEl = document.getElementById('liveCount');
  const finishedCountEl = document.getElementById('finishedCount');
  const datePicker = document.getElementById('datePicker');
  const refreshBtn = document.getElementById('refreshBtn');
  const statusEl = document.getElementById('status');

  // Resolve eventId from various shapes (event object or provider payload)
  function getEventId(obj){
    if(!obj) return '';
    const pick = (o, k) => (o && o[k] != null && o[k] !== '') ? o[k] : undefined;
    const flatId =
      pick(obj,'idEvent') || pick(obj,'event_key') || pick(obj,'event_id') ||
      pick(obj,'match_id') || pick(obj,'fixture_id') || pick(obj,'id');
    if(flatId) return String(flatId);

    // Nested provider responses: { data:{result:[{event_key:...}] } } or { result: { "<id>":[{event_key:...}] } }
    try{
      if(obj.data && Array.isArray(obj.data.result) && obj.data.result[0] && obj.data.result[0].event_key) return String(obj.data.result[0].event_key);
      if(obj.result){
        if(Array.isArray(obj.result) && obj.result[0] && obj.result[0].event_key) return String(obj.result[0].event_key);
        if(typeof obj.result === 'object'){
          const vals = Object.values(obj.result).filter(Boolean);
          for(const v of vals){ if(Array.isArray(v) && v[0] && v[0].event_key) return String(v[0].event_key); }
        }
      }
    }catch(_e){ /* ignore */ }
    return '';
  }

  // Heuristic to infer if the venue is neutral relative to team names
  function inferVenueInfo(hints){
    const country = (hints && (hints.country_name || hints.event_country || hints.country)) || '';
    const home = (hints && (hints.event_home_team || hints.home_team || hints.strHomeTeam)) || '';
    const away = (hints && (hints.event_away_team || hints.away_team || hints.strAwayTeam)) || '';

    const norm = s => String(s || '').toLowerCase();
    const matchCountry = (team, country) => {
      const t = norm(team);
      const c = norm(country);
      if(!t || !c) return false;
      // loose contains: 'sri lanka' matches 'sri lanka', 'united' matches 'united arab emirates' (acceptable heuristic)
      return t.includes(c) || c.includes(t);
    };

    const homeMatches = matchCountry(home, country);
    const awayMatches = matchCountry(away, country);
    const neutral = !!country && !homeMatches && !awayMatches;
    return { country, home, away, homeMatches, awayMatches, neutral };
  }

  const modal = document.getElementById('matchModal');
  const modalBody = document.getElementById('modalBody');
  const closeModal = document.getElementById('closeModal');
  closeModal.addEventListener('click', ()=> modal.classList.add('hidden'));
  modal.addEventListener('click', e=>{ if(e.target === modal) modal.classList.add('hidden'); });
  document.addEventListener('keydown', e=>{ if(e.key==='Escape') modal.classList.add('hidden'); });

  function showDetails(ev){
    // richer details modal (copied from history view)
    modalBody.innerHTML = `
      <div class="details-pane">
        <div class="details-controls" style="margin-bottom:.5rem;display:flex;gap:.5rem;flex-wrap:wrap;">
          <button id="augmentTagsBtn">Augment Timeline Tags</button>
          <button id="playerAnalyticsBtn">Player Analytics</button>
          <button id="multimodalBtn">Multimodal Extract</button>
        </div>

        <div id="summary" class="summary">
          <h3>Match Summary</h3>
          <div class="summary-body">Loading summary…</div>
        </div>

        <div id="details_info" class="details-info" style="margin-bottom:0.75rem"></div>
        <div id="highlights" class="highlights">
          <h3>Highlights</h3>
          <div class="hl-body">Loading highlights</div>
        </div>
        <div id="extras" class="extras">
          <h3>Extras</h3>
          <div class="extras-body">
            <div id="teams_section" class="extra-section"><h4>Teams</h4><div class="body">Loading…</div></div>
            <div id="players_section" class="extra-section"><h4>Players</h4><div class="body">Loading…</div></div>
            <div id="league_table_section" class="extra-section"><h4>League Table</h4><div class="body">Loading…</div></div>
            <div id="odds_section" class="extra-section"><h4>Odds</h4><div class="body">Loading…</div></div>
            <div id="prob_section" class="extra-section"><h4>Probabilities</h4><div class="body">Loading…</div></div>
            <div id="form_section" class="extra-section"><h4>Recent Form</h4><div class="body">Loading…</div></div>
            <div id="comments_section" class="extra-section"><h4>Comments</h4><div class="body">Loading…</div></div>
            <div id="seasons_section" class="extra-section"><h4>Seasons</h4><div class="body">Loading…</div></div>
          </div>
        </div>
      </div>`;

    const detailsInfo = modalBody.querySelector('#details_info');
    try{ ev.timeline = buildCleanTimeline(ev); }catch(e){ console.warn('buildCleanTimeline failed', e); }
    renderEventDetails(ev, detailsInfo);

    // Fetch AI summary (backend summarizer mounted under /summarizer)
    fetchMatchSummary(ev).catch(err => {
      console.error('Summary error:', err);
      const sBody = modalBody.querySelector('#summary .summary-body');
      if(sBody) sBody.textContent = 'Summary error: ' + (err && err.message ? err.message : String(err));
    });

    // Auto-augment in background
    setTimeout(()=> { try{ augmentEventTags(ev); }catch(e){ console.warn('auto augment failed', e); } }, 300);

    // wire feature buttons
    const augmentBtn = modalBody.querySelector('#augmentTagsBtn');
    const playerBtn = modalBody.querySelector('#playerAnalyticsBtn');
    const multimodalBtn = modalBody.querySelector('#multimodalBtn');
    if(augmentBtn) augmentBtn.addEventListener('click', ()=> augmentEventTags(ev));
    if(playerBtn) playerBtn.addEventListener('click', ()=> runPlayerAnalytics(ev));
    if(multimodalBtn) multimodalBtn.addEventListener('click', ()=> runMultimodalExtract(ev));

    modal.classList.remove('hidden');
    fetchHighlights(ev).catch(err => {
      console.error('Highlights error:', err);
      const body = modalBody.querySelector('#highlights .hl-body'); if(body) body.textContent = 'Highlights error: ' + (err && err.message ? err.message : String(err));
    });
    fetchExtras(ev).catch(err => {
      console.error('Extras error:', err);
      const sec = modalBody.querySelector('#extras .extras-body'); if(sec) sec.textContent = 'Extras error: ' + (err && err.message ? err.message : String(err));
    });
    // Ensure probabilities come from our Analysis Agent (not provider probabilities.list)
    fetchWinprobOverride(ev).catch(err => console.error('Winprob override error:', err));
    fetchRecentForm(ev).catch(err => console.error('Recent form error:', err));
  }

  // Override renderer for Probabilities section using Analysis Agent
  async function fetchWinprobOverride(ev){
    const probBody = modalBody.querySelector('#prob_section .body');
    if(!probBody) return;

    // If a previous analysis card exists, clear and replace it with the override result
    const existing = probBody.querySelector('[data-agent-prob="1"]');
    if (existing) { probBody.innerHTML = ''; }

    probBody.innerHTML = '<div class="prob-loading">Loading probabilities…</div>';

    const eventId = getEventId(ev);
    if(!eventId){
      probBody.innerHTML = '<div class="prob-error">Missing eventId</div>';
      return;
    }

    try{
      const url = new URL(apiBase + '/analysis/winprob');
      url.searchParams.set('eventId', String(eventId));
      url.searchParams.set('source', 'auto');
      url.searchParams.set('lookback', '10');
      const resp = await fetch(url.toString());
      console.debug('[prob][override] GET', url.toString(), 'status=', resp.status);
      const res = await resp.json().catch(()=> ({}));
      console.debug('[prob][override] payload=', res);

      probBody.innerHTML = '';
      const home = ev.event_home_team || ev.strHomeTeam || ev.home_team || '';
      const away = ev.event_away_team || ev.strAwayTeam || ev.away_team || '';
      const country = ev.country_name || ev.strCountry || ev.country || '';
      const hLogo = (ev.home_team_logo || ev.strHomeTeamBadge || ev.homeBadge || ev.home_logo || ev.team_home_badge || '');
      const aLogo = (ev.away_team_logo || ev.strAwayTeamBadge || ev.awayBadge || ev.away_logo || ev.team_away_badge || '');
      const _inferFromLogo = (url)=>{
        try{
          if(!url) return '';
          const last = String(url).split('?')[0].split('#')[0].split('/').pop() || '';
          const base = last.replace(/\.[a-zA-Z0-9]+$/, '');
          const t = decodeURIComponent(base).replace(/[\-_]+/g, ' ').trim();
          return t ? t.split(' ').map(w=> w? (w[0].toUpperCase()+w.slice(1)) : '').join(' ') : '';
        }catch(_e){ return ''; }
      };
      const derivedHomeName = home || _inferFromLogo(hLogo) || 'Home';
      const derivedAwayName = away || _inferFromLogo(aLogo) || 'Away';
      const card = createProbabilitiesCardEnhanced({
        __from: 'override',
        event_key: eventId,
        event_home_team: home,
        event_away_team: away,
        home_team_name: derivedHomeName,
        away_team_name: derivedAwayName,
        country_name: country,
        home_team_logo: hLogo,
        away_team_logo: aLogo,
        res
      });
      probBody.appendChild(card);
    } catch(e){
      console.error('fetchWinprobOverride error', e);
      probBody.innerHTML = '<div class="prob-error">Failed to load probabilities</div>';
    }
  }

  // Build the Analysis-Agent-driven probabilities card with logos and explicit labels
  function createProbabilitiesCardEnhanced(ctx){
    const { res } = ctx || {};
    const ok = !!(res && (res.ok === true || typeof res.ok === 'undefined'));
    const data = (res && res.data) || {};

    // Pull probs
    const probs = data.probs || {};
    let pH = Number(probs.home || 0), pD = Number(probs.draw || 0), pA = Number(probs.away || 0);
    // Guard and normalize (sum may deviate a bit due to rounding)
    const sum = pH + pD + pA;
    if(sum > 0){ pH/=sum; pD/=sum; pA/=sum; }
    const pct = v => (Number(v*100).toFixed(1));

    // Names + logos from agent (preferred) or event context (fallbacks passed via ctx)
    const homeName = (data.home_team && (data.home_team.name || data.home_team.short_name)) || ctx.home_team_name || ctx.event_home_team || 'Home';
    const awayName = (data.away_team && (data.away_team.name || data.away_team.short_name)) || ctx.away_team_name || ctx.event_away_team || 'Away';
    const hLogo = (data.home_team && data.home_team.logo) || ctx.home_team_logo || '';
    const aLogo = (data.away_team && data.away_team.logo) || ctx.away_team_logo || '';

    // Improved venue role detection fallback
    let neutral = !!(data.venue && (data.venue.neutral === true));
    if (data.venue == null || typeof data.venue.neutral === 'undefined'){
      try{
        const vinf = inferVenueInfo({
          country_name: ctx.country_name,
          event_home_team: homeName,
          event_away_team: awayName
        });
        neutral = !!vinf.neutral;
      }catch(_e){}
    }
    const homeRole = neutral ? 'Neutral' : 'Home';
    const awayRole = neutral ? 'Neutral' : 'Away';

    // Root card
    const card = document.createElement('div');
    card.className = 'prob-card';
    card.setAttribute('data-agent-prob','1');

    // Headline with logos
    const head = document.createElement('div');
    head.className = 'prob-headline';
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

    // Stacked bar
    const stacked = document.createElement('div');
    stacked.className = 'prob-stacked';
    const wH = Math.max(0, Math.min(100, Number(pH*100).toFixed(1)));
    const wD = Math.max(0, Math.min(100, Number(pD*100).toFixed(1)));
    let wA = Math.max(0, Math.min(100, Number(pA*100).toFixed(1)));
    // ensure total exactly 100.0 by adjusting away
    const totalRounded = Number(wH) + Number(wD) + Number(wA);
    if(totalRounded !== 100){ wA = (100 - Number(wH) - Number(wD)).toFixed(1); }
    stacked.innerHTML = `
      <span class="seg home" style="width:${wH}%;"></span>
      <span class="seg draw" style="width:${wD}%;"></span>
      <span class="seg away" style="width:${wA}%;"></span>`;
    card.appendChild(stacked);

    // Inline labels under the bar (one-line legend)
    const labels = document.createElement('div');
    labels.className = 'prob-labels';
    labels.innerHTML = `
      <span class="lbl">${homeName} (${homeRole}) ${Number(wH).toFixed(1)}%</span>
      <span class="lbl">Draw ${Number(wD).toFixed(1)}%</span>
      <span class="lbl">${awayName} (${awayRole}) ${Number(wA).toFixed(1)}%</span>`;
    card.appendChild(labels);

    // Mini rows (Home / Draw / Away)
    const mkMini = (key, label, width) => {
      const row = document.createElement('div'); row.className='prob-mini';
      row.innerHTML = `
        <div class="label">${label}</div>
        <div class="bar"><span class="fill ${key}" style="width:${width}%"></span></div>
        <div class="value">${Number(width).toFixed(1)}%</div>`;
      return row;
    };
    card.appendChild(mkMini('home', `${homeName} ${neutral? '(Neutral)':'(Home)'}`, wH));
    card.appendChild(mkMini('draw', 'Draw', wD));
    card.appendChild(mkMini('away', `${awayName} ${neutral? '(Neutral)':'(Away)'}`, wA));

    // Meta + Show Raw toggle
    const meta = document.createElement('div'); meta.className='prob-meta';
    const method = data.method || 'unknown';
    const sample = (data.inputs && (data.inputs.sample_size || data.inputs.effective_weight)) || undefined;
    const leftMeta = document.createElement('div');
    leftMeta.textContent = `Method: ${method}${sample? ` • n=${sample}`:''}`;
    const btnMeta = document.createElement('button'); btnMeta.className='raw-toggle'; btnMeta.textContent='Show raw';
    const pre = document.createElement('pre');
    try{ pre.textContent = JSON.stringify(res, null, 2); }catch(_e){ pre.textContent = String(res); }
    btnMeta.addEventListener('click', ()=>{ const shown = pre.style.display==='block'; pre.style.display = shown?'none':'block'; btnMeta.textContent = shown? 'Show raw':'Hide raw'; });
    meta.appendChild(leftMeta); meta.appendChild(btnMeta);
    card.appendChild(meta); card.appendChild(pre);

    return card;
  }

  // ---- Recent Form (analysis.form) ----
  async function fetchRecentForm(ev){
    const formBody = modalBody.querySelector('#form_section .body');
    if(!formBody) return;

    // Clear any previous form card
    const prev = formBody.querySelector('[data-agent-form="1"]');
    if(prev) formBody.innerHTML = '';

    formBody.textContent = 'Loading recent form…';

    const eventId = getEventId(ev);
    if(!eventId){ formBody.innerHTML = '<div class="prob-error">Missing eventId</div>'; return; }

    try{
      const url = new URL(apiBase + '/analysis/form');
      url.searchParams.set('eventId', String(eventId));
      url.searchParams.set('lookback', '5');
      const resp = await fetch(url.toString());
      const res = await resp.json().catch(()=> ({}));
      if(!resp.ok || !res || res.ok === false){
        throw new Error(res && res.error && (res.error.message || res.error.code) || ('HTTP '+resp.status));
      }
      const home = ev.event_home_team || ev.strHomeTeam || ev.home_team || '';
      const away = ev.event_away_team || ev.strAwayTeam || ev.away_team || '';
      const hLogo = ev.home_team_logo || ev.strHomeTeamBadge || ev.homeBadge || ev.home_logo || ev.team_home_badge || '';
      const aLogo = ev.away_team_logo || ev.strAwayTeamBadge || ev.awayBadge || ev.away_logo || ev.team_away_badge || '';

      formBody.innerHTML = '';
      const card = createFormCard({ res, homeName: home, awayName: away, hLogo, aLogo });
      formBody.appendChild(card);
    }catch(e){
      console.error('fetchRecentForm error', e);
      formBody.innerHTML = '<div class="prob-error">Failed to load recent form</div>';
    }
  }

  function createFormCard(ctx){
    const { res, homeName, awayName, hLogo, aLogo } = ctx || {};
    const data = (res && res.data) || {};

    const home = data.home_team || {}; const away = data.away_team || {};
    const hm = data.home_metrics || {}; const am = data.away_metrics || {};
    const lookback = (hm.games || am.games || 0);

    const HN = home.name || homeName || 'Home';
    const AN = away.name || awayName || 'Away';

    // Root
    const card = document.createElement('div'); card.className='form-card'; card.setAttribute('data-agent-form','1');

    // Grid with per-team panels
    const grid = document.createElement('div'); grid.className='form-grid'; card.appendChild(grid);

    const mkChips = (arr)=>{
      const wrap = document.createElement('div'); wrap.className='chips';
      (Array.isArray(arr)?arr:[]).forEach(x=>{
        const t = String(x||'').trim().toUpperCase();
        const span = document.createElement('span'); span.className='chip ' + (t==='W'?'win':(t==='D'?'draw':'loss')); span.textContent = t || '?';
        wrap.appendChild(span);
      });
      if(!wrap.children.length){ const empty=document.createElement('div'); empty.style.cssText='font-size:12px;color:#64748b'; empty.textContent='No recent results'; wrap.appendChild(empty); }
      return wrap;
    };

    const mkTeam = (side)=>{
      const isHome = side==='home';
      const team = isHome? home : away; const met = isHome? hm : am;
      const nm = isHome? HN : AN; const logo = isHome? (home.logo || hLogo) : (away.logo || aLogo);
      const role = isHome? 'Home' : 'Away';

      const box = document.createElement('div'); box.className='form-team';
      const hdr = document.createElement('div'); hdr.className='hdr';
      hdr.innerHTML = `${logo? `<img class="logo" src="${logo}" alt="${nm} logo" onerror="this.remove()">` : ''}<span class="name">${nm}</span> <span class="role">(${role})</span>`; box.appendChild(hdr);

      const summary = document.createElement('div'); summary.className='form-summary'; summary.textContent = (team.summary || ''); box.appendChild(summary);
      box.appendChild(mkChips(met.last_results));

      const tbl = document.createElement('table'); tbl.className='metric-table';
      const addRow = (k, v)=>{ const tr=document.createElement('tr'); tr.innerHTML = `<td class="k">${k}</td><td class="v">${v}</td>`; tbl.appendChild(tr); };
      addRow('Games', met.games ?? '—');
      addRow('Wins / Draws / Losses', `${met.wins ?? '—'} / ${met.draws ?? '—'} / ${met.losses ?? '—'}`);
      addRow('Goals For / Against', `${met.gf ?? '—'} / ${met.ga ?? '—'}`);
      addRow('Goal Difference', `${met.gd ?? '—'}`);
      box.appendChild(tbl);
      return box;
    };

    grid.appendChild(mkTeam('home'));
    grid.appendChild(mkTeam('away'));

    const footer = document.createElement('div'); footer.className='form-footer';
    const left = document.createElement('div'); left.textContent = `Lookback: ${lookback || 5} games`;
    const btn = document.createElement('button'); btn.className='raw-toggle'; btn.textContent='Show raw';
    const pre = document.createElement('pre'); try{ pre.textContent = JSON.stringify(res, null, 2);}catch(_e){ pre.textContent = String(res);} btn.addEventListener('click', ()=>{ const shown = pre.style.display==='block'; pre.style.display = shown? 'none':'block'; btn.textContent = shown? 'Show raw':'Hide raw'; });
    footer.appendChild(left); footer.appendChild(btn); card.appendChild(footer); card.appendChild(pre);

    return card;
  }

  // make accessible just in case of scope issues
  window.fetchRecentForm = fetchRecentForm;
  window.createFormCard  = createFormCard;

  // ----- Match Summary via backend summarizer -----
  async function fetchMatchSummary(ev){
    const sBody = modalBody.querySelector('#summary .summary-body');
    if(!sBody) return;
    sBody.textContent = 'Loading summary…';

    // Build best-effort payload
    const payload = { provider: 'auto' };
    const eventId = ev.idEvent || ev.event_key || ev.id || ev.match_id;
    if(eventId) payload.eventId = String(eventId);
    // Event name as "Home vs Away"
    const home = ev.event_home_team || ev.strHomeTeam || ev.home_team || '';
    const away = ev.event_away_team || ev.strAwayTeam || ev.away_team || '';
    if(home && away) payload.eventName = `${home} vs ${away}`;
    // Date if present
    const date = ev.event_date || ev.dateEvent || ev.date || '';
    if(date) payload.date = date;

    const url = apiBase + '/summarizer/summarize';
    const resp = await fetch(url, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload)});
    if(!resp.ok){
      // Try fallback: if summarizer mounted path differs (rare), surface HTTP error
      const txt = await resp.text().catch(()=> '');
      throw new Error('HTTP '+resp.status + (txt? (': '+txt):''));
    }
    const j = await resp.json();
    if(!j || j.ok === false) throw new Error(j && j.detail ? (j.detail.reason || JSON.stringify(j.detail)) : 'No summary');
    renderSummary(j, sBody);
  }

  function renderSummary(s, container){
    container.innerHTML = '';
    const card = document.createElement('div');
    card.style.cssText = 'background:white;border-radius:16px;padding:20px;margin-bottom:16px;box-shadow:0 4px 20px rgba(0,0,0,0.08)';

    const title = document.createElement('div');
    title.style.cssText = 'font-size:18px;font-weight:700;color:#111827;margin-bottom:8px';
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

    // Small meta footer
    const meta = document.createElement('div');
    meta.style.cssText = 'font-size:12px;color:#6b7280;margin-top:8px';
    if(s.source_meta && s.source_meta.bundle){
      const t = s.source_meta.bundle.teams || {}; const sc = s.source_meta.bundle.score || {};
      meta.textContent = `${t.home||''} ${sc.home!=null?sc.home:''}–${sc.away!=null?sc.away:''} ${t.away||''}`;
    }
    card.appendChild(meta);

    container.appendChild(card);
  }

  // --- Details rendering & timeline helpers (from history.js) ---
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

    // Main match card
    const matchCard = document.createElement('div');
    matchCard.style.cssText = 'background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius:16px; padding:24px; color:white; margin-bottom:20px;';

    const leagueBar = document.createElement('div'); leagueBar.style.cssText='display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;font-size:14px;opacity:.9';
    leagueBar.innerHTML = `<span style="background: rgba(255,255,255,0.2); padding: 4px 12px; border-radius: 20px;">${league}</span><span style="background: ${getStatusColor(status)}; padding: 4px 12px; border-radius: 20px;">${status || 'Finished'}</span>`;

    const teamsSection = document.createElement('div'); teamsSection.style.cssText='display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;';
    const homeTeam = createTeamDisplay(home, ev.home_team_logo || ev.strHomeTeamBadge, true);
    const scoreDisplay = createScoreDisplay(homeScore, awayScore);
    const awayTeam = createTeamDisplay(away, ev.away_team_logo || ev.strAwayTeamBadge, false);
    teamsSection.appendChild(homeTeam); teamsSection.appendChild(scoreDisplay); teamsSection.appendChild(awayTeam);

    const matchInfo = document.createElement('div'); matchInfo.style.cssText='display:flex;gap:12px;flex-wrap:wrap;font-size:14px;opacity:.9;';
    if(date) matchInfo.innerHTML += `<span>📅 ${date}</span>`; if(time) matchInfo.innerHTML += `<span>🕐 ${time}</span>`; if(venue) matchInfo.innerHTML += `<span>🏟️ ${venue}</span>`;

    matchCard.appendChild(leagueBar); matchCard.appendChild(teamsSection); matchCard.appendChild(matchInfo);
    container.appendChild(matchCard);

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

  function getStatusColor(status){ const s = String(status).toLowerCase(); if(s.includes('live')||s.includes('1st')||s.includes('2nd')) return 'rgba(34,197,94,0.8)'; if(s.includes('finished')||s.includes('ft')) return 'rgba(107,114,128,0.8)'; if(s.includes('postponed')||s.includes('cancelled')) return 'rgba(239,68,68,0.8)'; return 'rgba(107,114,128,0.8)'; }

  function renderMatchStats(ev, container){
    const statsData = extractMatchStats(ev); if(Object.keys(statsData).length===0) return;
    const statsCard = document.createElement('div'); statsCard.style.cssText='background:white;border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 4px 20px rgba(0,0,0,0.08)';
    const title = document.createElement('h3'); title.style.cssText='margin:0 0 20px 0;color:#1f2937;font-size:20px'; title.innerHTML='📊 Match Statistics'; statsCard.appendChild(title);
    Object.entries(statsData).forEach(([statName, values])=>{ statsCard.appendChild(createStatRow(statName, values.home, values.away)); }); container.appendChild(statsCard);
  }

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

  function renderMatchTimeline(ev, container){
    let timeline = ev.timeline || ev.timeline_items || ev.events || ev.event_timeline || ev.eventTimeline || ev.event_entries || [];
    if(timeline && !Array.isArray(timeline) && typeof timeline === 'object'){ const vals = Object.values(timeline).filter(Boolean); const arr = vals.reduce((acc, cur)=> acc.concat(Array.isArray(cur)?cur:[]), []); if(arr.length>0) timeline = arr; }
    if(!Array.isArray(timeline) || timeline.length===0) timeline = synthesizeTimelineFromEvent(ev);
    if(!Array.isArray(timeline) || timeline.length===0) return;

  const timelineCard = document.createElement('div'); timelineCard.style.cssText='background:white;border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 4px 20px rgba(0,0,0,0.08)'; const title = document.createElement('h3'); title.style.cssText='margin:0 0 20px 0;color:#1f2937;font-size:20px'; title.innerHTML='⚽ Match Timeline'; timelineCard.appendChild(title);
  const timelineContainer = document.createElement('div'); timelineContainer.style.cssText='position:relative;'; timeline.forEach((event, index)=>{ timelineContainer.appendChild(createTimelineEvent(event, index===timeline.length-1, ev)); }); timelineCard.appendChild(timelineContainer); container.appendChild(timelineCard);

  }

  function synthesizeTimelineFromEvent(ev){
    try{ const out=[]; const scorers = ev.scorers||ev.goals||ev.goal_scorers||ev.scorers_list||ev.goals_list||[]; if(Array.isArray(scorers)&&scorers.length>0){ scorers.forEach(s=>{ const minute = s.minute||s.time||s.minute_display||s.m||s.match_minute||''; const name = s.name||s.player||s.scorer||s.player_name||s.player_fullname||''; const team = s.team||s.side||s.club||''; const desc = s.description||s.text||(name?`Goal by ${name}`:'Goal'); const tags = s.tags||s.predicted_tags||s.predictedTags||s.labels|| (s.type?[s.type]:[]); out.push({ minute, description: desc, player: name, team, type: s.type||'goal', predicted_tags: tags, raw: s }); }); }
      const comments = ev.comments||ev.comments_list||ev.match_comments||ev.play_by_play||ev.commentary||[]; if(Array.isArray(comments)&&comments.length>0){ comments.slice(0,8).forEach(c=>{ const minute = c.time||c.minute||c.comments_time||c.match_minute||''; const desc = c.text||c.comment||c.comments_text||c.body||''; const tags = c.tags||c.predicted_tags||c.predictedTags||c.labels||[]; if(desc) out.push({ minute, description: desc, predicted_tags: tags, raw: c }); }); }
      if(out.length===0){ const home = ev.event_home_team||ev.strHomeTeam||ev.home_team||ev.homeName||''; const away = ev.event_away_team||ev.strAwayTeam||ev.away_team||ev.awayName||''; const score = ev.event_final_result||ev.event_ft_result||(ev.home_score!=null&&ev.away_score!=null?`${ev.home_score} - ${ev.away_score}`:''); if(home||away||score) out.push({ minute:'', description: `${home} vs ${away} ${score}`, predicted_tags: [], raw: ev }); }
      const enriched = out.map(entry=>{ const hasTags = entry.predicted_tags && Array.isArray(entry.predicted_tags) && entry.predicted_tags.length>0; if(!hasTags){ const inferred = detectTagsFromText(entry.description||''); entry.predicted_tags = inferred; } return entry; }); return enriched; }catch(e){ return []; }
  }

  function detectTagsFromText(text){ if(!text) return []; const t=String(text).toLowerCase(); const tags=new Set(); if(t.includes('goal')||/scores?|scored|goal by|assist/.test(t)) tags.add('goal'); if(t.includes('penalty')) tags.add('penalty'); if(t.includes('yellow card')||t.includes('yellow')) tags.add('yellow card'); if(t.includes('red card')||t.includes('sent off')||t.includes('red')) tags.add('red card'); if(t.includes('substitution')||t.includes('sub')||t.includes('replaced')) tags.add('substitution'); if(t.includes('corner')) tags.add('corner'); if(t.includes('offside')) tags.add('offside'); if(t.includes('penalty shootout')||t.includes('shootout')) tags.add('shootout'); const playerMatch = text.match(/by\s+([A-Z][a-z]+\s?[A-Z]?[a-z]*)/); if(playerMatch) tags.add('player'); return Array.from(tags).map(s=>({ text: s, source: 'heuristic', confidence: undefined, isModel: false })); }

  function buildCleanTimeline(ev){
    const out=[]; const goalsSrc = ev.goalscorers||ev.goals||ev.goalscorer||[]; (goalsSrc||[]).forEach(g=>{ const minute = g.time||g.minute||''; const player = g.home_scorer||g.away_scorer||g.scorer||g.player||''; const assist = g.home_assist||g.away_assist||g.assist||''; const team = (g.away_scorer? ev.event_away_team : (g.home_scorer? ev.event_home_team : '')); const score = g.score||''; out.push({ minute, type:'goal', player, assist, team, description: `${minute} — ${player} (${team}) scores — assist: ${assist} — score: ${score}`, tags: ['goal'] }); });
    const subs = ev.substitutes||ev.subs||ev.substitutions||[]; (subs||[]).forEach(s=>{ const minute = s.time||''; if(s.home_scorer && typeof s.home_scorer === 'object' && Object.keys(s.home_scorer).length>0){ out.push({ minute, type:'substitution', player_in: s.home_scorer.in, player_out: s.home_scorer.out, team: ev.event_home_team || 'home', description: `${minute} — ${s.home_scorer.in} ON for ${s.home_scorer.out} (${ev.event_home_team})`, tags: ['substitution'] }); } if(s.away_scorer && typeof s.away_scorer === 'object' && Object.keys(s.away_scorer).length>0){ out.push({ minute, type:'substitution', player_in: s.away_scorer.in, player_out: s.away_scorer.out, team: ev.event_away_team || 'away', description: `${minute} — ${s.away_scorer.in} ON for ${s.away_scorer.out} (${ev.event_away_team})`, tags: ['substitution'] }); } });
    const cards = ev.cards||[]; (cards||[]).forEach(c=>{ const minute = c.time||''; const player = c.home_fault||c.away_fault||''; const cardType = (c.card||'').toLowerCase(); const team = c.home_fault? ev.event_home_team : (c.away_fault? ev.event_away_team : ''); out.push({ minute, type:'card', player, card: cardType, team, description: `${minute} — ${cardType} for ${player} (${team})`, tags: [cardType] }); });
    function minuteSortKey(m){ if(!m) return 0; const plus = String(m).includes('+'); if(plus){ const parts = String(m).split('+'); return Number(parts[0]) + Number(parts[1]) / 100; } return Number(m)||0; }
    out.sort((a,b)=> minuteSortKey(a.minute) - minuteSortKey(b.minute)); return out;
  }


  function createTimelineEvent(event, isLast, matchCtx){

    const eventDiv = document.createElement('div'); eventDiv.style.cssText = `display:flex;align-items:flex-start;margin-bottom:${isLast?'0':'16px'};position:relative;`;
    const normTags = normalizeEventTags(event); const tags = Array.isArray(normTags)?normTags.map(t=>t.text):[];
    const minute = event.minute || event.time || ''; const description = event.description || event.text || event.event || '';
    const timeline = document.createElement('div'); timeline.style.cssText='display:flex;flex-direction:column;align-items:center;margin-right:16px;flex-shrink:0;'; const dot = document.createElement('div'); dot.style.cssText = `width:12px;height:12px;border-radius:50%;background:${getEventColor(description,tags)};border:3px solid white;box-shadow:0 0 0 2px ${getEventColor(description,tags)};`; const line = document.createElement('div'); line.style.cssText = `width:2px;height:24px;background:#e5e7eb;${isLast? 'display:none;':''}`; timeline.appendChild(dot); timeline.appendChild(line);
    const content = document.createElement('div'); content.style.cssText='flex:1;'; const eventHeader = document.createElement('div'); eventHeader.style.cssText='display:flex;align-items:center;gap:8px;margin-bottom:4px;'; const minuteSpan = document.createElement('span'); minuteSpan.style.cssText='background:#f3f4f6;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600;color:#6b7280;'; minuteSpan.textContent = minute? `${minute}'` : '';
    const icon = document.createElement('span'); icon.style.fontSize='16px'; icon.textContent = getEventIcon(description, tags); eventHeader.appendChild(minuteSpan); eventHeader.appendChild(icon);
    const eventText = document.createElement('div'); eventText.style.cssText='color:#374151;margin-bottom:8px;'; eventText.textContent = description;
    content.appendChild(eventHeader); content.appendChild(eventText);
    if(Array.isArray(normTags) && normTags.length>0){ const tagsContainer = document.createElement('div'); tagsContainer.style.cssText='display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;align-items:center;'; const hasModel = normTags.some(t=>t.isModel); if(hasModel){ const mlBadge = document.createElement('span'); mlBadge.textContent='ML'; mlBadge.title='Model-predicted tag present'; mlBadge.style.cssText='background:#7c3aed;color:white;padding:2px 6px;border-radius:10px;font-size:11px;font-weight:700;'; tagsContainer.appendChild(mlBadge); }
      normTags.forEach(t=>{ const tagSpan = document.createElement('span'); const color = t.isModel? '#6d28d9' : getTagColor(t.text||''); tagSpan.style.cssText = `background:${color};color:white;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:500;display:inline-flex;align-items:center;gap:8px;`; const label = document.createElement('span'); label.textContent = t.text; tagSpan.appendChild(label); if(t.confidence!==undefined && t.confidence!==null){ const conf = document.createElement('small'); conf.textContent = ` ${Number(t.confidence).toFixed(2)}`; conf.style.opacity='0.9'; conf.style.marginLeft='6px'; conf.style.fontSize='10px'; tagSpan.appendChild(conf); } tagsContainer.appendChild(tagSpan); }); content.appendChild(tagsContainer); }
    const rawToggle = document.createElement('button'); rawToggle.textContent='Show raw'; rawToggle.style.cssText='margin-left:8px;background:transparent;border:1px dashed #d1d5db;color:#374151;padding:4px 8px;border-radius:6px;cursor:pointer;font-size:12px;'; const rawPre = document.createElement('pre'); rawPre.style.cssText='display:none;margin-top:8px;background:#111827;color:#e5e7eb;padding:8px;border-radius:8px;overflow:auto;max-height:240px;'; try{ rawPre.textContent = JSON.stringify(event.raw || event, null, 2); }catch(e){ rawPre.textContent = String(event.raw || event); } rawToggle.addEventListener('click', ()=>{ if(rawPre.style.display==='none'){ rawPre.style.display='block'; rawToggle.textContent='Hide raw'; } else { rawPre.style.display='none'; rawToggle.textContent='Show raw'; } }); content.appendChild(rawToggle); content.appendChild(rawPre);


    // Hover brief on the movement dot for special events
    try{
      const etype = deriveEventType(description, tags, event);
      if(etype){
        dot.style.cursor = 'help';
        const onEnter = async (e)=>{
          // Build a small rich tooltip showing player image and team logo (if available), then a brief summary.
          try{
            const d = ensureTooltip();
            let playerImg = event.player_image || event.player_photo || event.playerImage || event.photo || event.thumb || event.strThumb || event.strThumbBig || event.thumbnail || event.photo_url || event.player_cutout || event.player_pic || event.img || event.avatar || event.headshot || event.cutout || event.image || (event.player && (event.player.photo || event.player.player_image || event.player.image || event.player.playerImage || event.player.photo_url)) || (event.raw && (event.raw.player_image || event.raw.player_photo || event.raw.photo || event.raw.thumb || event.raw.image || event.raw.playerImage || event.raw.photo_url || event.raw.player_cutout || event.raw.strThumb || event.raw.strCutout || event.raw.thumbnail || event.raw.img || event.raw.avatar || event.raw.headshot || event.raw.player_pic));
            let teamLogo = event.team_logo || event.teamLogo || event.team_logo_url || event.team_image || (event.raw && (event.raw.team_logo || event.raw.teamLogo));
            if(!teamLogo && matchCtx){
              const home = matchCtx.event_home_team || matchCtx.strHomeTeam || matchCtx.home_team || '';
              const away = matchCtx.event_away_team || matchCtx.strAwayTeam || matchCtx.away_team || '';
              if(event.team && home && String(event.team).trim() === String(home).trim()){
                teamLogo = matchCtx.home_team_logo || matchCtx.strHomeTeamBadge || matchCtx.homeLogo || '';
              } else if(event.team && away && String(event.team).trim() === String(away).trim()){
                teamLogo = matchCtx.away_team_logo || matchCtx.strAwayTeamBadge || matchCtx.awayLogo || '';
              }
            }

            // If no direct player image on the event, try to build/find a players map from matchCtx (so we can find images without waiting for fetchExtras)
            try{
              if(matchCtx && !matchCtx._playersMap){
                try{
                  const allPlayers = [];
                  for(const k of Object.keys(matchCtx||{})){
                    const v = matchCtx[k];
                    if(Array.isArray(v) && v.length>0 && typeof v[0] === 'object'){
                      const s = v[0];
                      if(s.player_name || s.name || s.strPlayer || s.player || s.player_fullname || s.playerId || s.idPlayer) allPlayers.push(...v);
                    }
                  }
                  if(allPlayers.length>0){ const map = {}; const normalize = s => (s||'').toString().replace(/[\.]/g,'').replace(/\s+/g,' ').trim().toLowerCase(); allPlayers.forEach(p=>{ const name = (p.player_name || p.name || p.strPlayer || p.player || p.player_fullname || '').trim(); if(!name) return; const nm = name; const low = nm.toLowerCase(); const norm = normalize(nm); map[nm] = p; map[low] = p; map[norm] = p; try{ const parts = norm.split(' ').filter(Boolean); if(parts.length){ const last = parts[parts.length-1]; if(last) map[last] = map[last] || p; if(parts.length>=2){ const initLast = parts[0].charAt(0) + ' ' + last; const initLastNoSpace = parts[0].charAt(0) + last; map[initLast] = map[initLast] || p; map[initLastNoSpace] = map[initLastNoSpace] || p; } } }catch(_e){} }); matchCtx._playersMap = map; }
                }catch(_e){ /* ignore build errors */ }
              }
              if(!playerImg && matchCtx && matchCtx._playersMap){
                const lookupNameRaw = (event.player || event.player_name || event.playerName || event.player_fullname || '').trim();
                if(lookupNameRaw){
                  const norm = s => (s || '').toString().replace(/[\.]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
                  const lookupNorm = norm(lookupNameRaw);
                  let p = matchCtx._playersMap[lookupNameRaw] || matchCtx._playersMap[lookupNameRaw.toLowerCase()] || matchCtx._playersMap[lookupNorm];
                  if(!p){
                    const vals = Object.values(matchCtx._playersMap || {});
                    const lookupParts = lookupNorm.split(' ').filter(Boolean);
                    const lookupLast = lookupParts.length ? lookupParts[lookupParts.length-1] : '';
                    const lookupFirst = lookupParts.length ? lookupParts[0] : '';
                    for(const cand of vals){
                      try{
                        const candName = (cand.player_name || cand.name || cand.strPlayer || cand.player || cand.player_fullname || '').toString();
                        const candNorm = norm(candName);
                        if(!candNorm) continue;
                        if(candNorm === lookupNorm || candNorm.includes(lookupNorm) || lookupNorm.includes(candNorm)) { p = cand; break; }
                        const candParts = candNorm.split(' ').filter(Boolean);
                        const candLast = candParts.length ? candParts[candParts.length-1] : '';
                        if(lookupLast && candLast && lookupLast === candLast){ p = cand; break; }
                        if(lookupParts.length >= 2 && lookupFirst.length === 1){ const candFirst = candParts.length ? candParts[0].charAt(0) : ''; if(candFirst === lookupFirst && candLast === lookupLast){ p = cand; break; } }
                        const lookupId = event.player_id || event.playerId || event.player_key || (event.raw && (event.raw.player_id || event.raw.idPlayer || event.raw.player_key));
                        const candId = cand.idPlayer || cand.player_id || cand.playerKey || cand.player_key || cand.id || cand.playerId;
                        if(lookupId && candId && String(lookupId) === String(candId)){ p = cand; break; }
                      }catch(_e){ }
                    }
                  }
                  if(p){
                    playerImg = p.player_image || p.player_photo || p.playerImage || p.photo || p.thumb || p.photo_url || p.strThumb || p.strThumbBig || p.player_cutout || p.player_pic || p.img || p.avatar || p.headshot || p.image || '';
                  }
                }
              }
            }catch(_e){ /* ignore */ }

            // If we still don't have a player image, attempt a lightweight fetch of the team's players
            // using the existing callIntent helper (if available) and populate matchCtx._playersMap,
            // then retry the same fuzzy lookup. This helps resolve abbreviated names like "I. Sarr".
            try{
              if(!playerImg && matchCtx && event.team && typeof callIntent === 'function'){
                try{
                  if(!matchCtx._playersPromise){ matchCtx._playersPromise = callIntent('players.list', { teamName: String(event.team) }); }
                  const playersRes = await matchCtx._playersPromise;
                  let arr = [];
                  if(playersRes){ arr = playersRes.data?.result || playersRes.data?.results || playersRes.data?.players || playersRes.data || playersRes.result || playersRes.players || playersRes; }
                  if(!Array.isArray(arr) && playersRes && Array.isArray(playersRes.data)) arr = playersRes.data;
                  if(Array.isArray(arr) && arr.length>0){
                    matchCtx._playersMap = matchCtx._playersMap || {};
                    const normalize = s => (s||'').toString().replace(/[\.]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
                    arr.forEach(p=>{
                      try{
                        const name = (p.player_name || p.name || p.strPlayer || p.player || p.player_fullname || '').trim(); if(!name) return;
                        const nm = name; const low = nm.toLowerCase(); const norm = normalize(nm);
                        matchCtx._playersMap[nm] = p; matchCtx._playersMap[low] = p; matchCtx._playersMap[norm] = p;
                        const parts = norm.split(' ').filter(Boolean);
                        if(parts.length){ const last = parts[parts.length-1]; if(last) matchCtx._playersMap[last] = matchCtx._playersMap[last] || p; if(parts.length>=2){ const initLast = parts[0].charAt(0) + ' ' + last; const initLastNoSpace = parts[0].charAt(0) + last; matchCtx._playersMap[initLast] = matchCtx._playersMap[initLast] || p; matchCtx._playersMap[initLastNoSpace] = matchCtx._playersMap[initLastNoSpace] || p; } }
                      }catch(_e){}
                    });

                    // retry lookup with the newly populated map
                    try{
                      const lookupNameRaw = (event.player || event.player_name || event.playerName || event.player_fullname || '').trim();
                      if(lookupNameRaw){
                        const norm = s => (s || '').toString().replace(/[\.]?/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
                        const lookupNorm = norm(lookupNameRaw);
                        let p = matchCtx._playersMap[lookupNameRaw] || matchCtx._playersMap[lookupNameRaw.toLowerCase()] || matchCtx._playersMap[lookupNorm];
                        if(!p){
                          const vals = Object.values(matchCtx._playersMap || {});
                          const lookupParts = lookupNorm.split(' ').filter(Boolean);
                          const lookupLast = lookupParts.length ? lookupParts[lookupParts.length-1] : '';
                          const lookupFirst = lookupParts.length ? lookupParts[0] : '';
                          for(const cand of vals){
                            try{
                              const candName = (cand.player_name || cand.name || cand.strPlayer || cand.player || cand.player_fullname || '').toString();
                              const candNorm = normalize(candName);
                              if(!candNorm) continue;
                              if(candNorm === lookupNorm || candNorm.includes(lookupNorm) || lookupNorm.includes(candNorm)) { p = cand; break; }
                              const candParts = candNorm.split(' ').filter(Boolean);
                              const candLast = candParts.length ? candParts[candParts.length-1] : '';
                              if(lookupLast && candLast && lookupLast === candLast){ p = cand; break; }
                              if(lookupParts.length >= 2 && lookupFirst.length === 1){ const candFirst = candParts.length ? candParts[0].charAt(0) : ''; if(candFirst === lookupFirst && candLast === lookupLast){ p = cand; break; } }
                              const lookupId = event.player_id || event.playerId || event.player_key || (event.raw && (event.raw.player_id || event.raw.idPlayer || event.raw.player_key));
                              const candId = cand.idPlayer || cand.player_id || cand.playerKey || cand.player_key || cand.id || cand.playerId;
                              if(lookupId && candId && String(lookupId) === String(candId)){ p = cand; break; }
                            }catch(_e){ }
                          }
                        }
                        if(p){ playerImg = p.player_image || p.player_photo || p.playerImage || p.photo || p.thumb || p.photo_url || p.strThumb || p.strThumbBig || p.player_cutout || p.player_pic || p.img || p.avatar || p.headshot || p.image || ''; }
                      }
                    }catch(_e){}
                  }
                }catch(_e){ /* ignore network errors */ }
              }
            }catch(_e){}

            // DOM-scrape fallback: if we still don't have a player image, try to find an <img>
            // for the player inside the rendered Players section on the page. This re-uses
            // already-fetched UI content (seen in the Players panel) when API lookups fail.
            try{
              if(!playerImg && typeof document !== 'undefined'){
                const norm = s => (s||'').toString().replace(/[\.]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
                const target = norm(event.player || event.player_name || '');
                const teamName = (event.team || '').toString().trim();
                if(target){
                  const imgs = Array.from(document.querySelectorAll('img'));
                  for(const img of imgs){
                    try{
                      const alt = (img.getAttribute('alt') || img.getAttribute('data-player-name') || '').toString();
                      if(alt && norm(alt).includes(target)){ playerImg = img.src; break; }
                      const p = img.closest && img.closest('div') || img.parentElement;
                      const txt = p ? (p.textContent||'') : '';
                      if(txt && norm(txt).includes(target)){ playerImg = img.src; break; }
                    }catch(_e){}
                  }

                  if(!playerImg && teamName){
                    const blocks = Array.from(document.querySelectorAll('div,section'));
                    for(const b of blocks){
                      try{
                        if(!(b.textContent||'').toLowerCase().includes(teamName.toLowerCase())) continue;
                        const imgs2 = Array.from(b.querySelectorAll('img'));
                        for(const img of imgs2){
                          try{
                            const alt = (img.getAttribute('alt') || img.getAttribute('data-player-name') || '').toString();
                            if(alt && norm(alt).includes(target)){ playerImg = img.src; break; }
                            const p = img.closest && img.closest('div') || img.parentElement;
                            const txt = p ? (p.textContent||'') : '';
                            if(txt && norm(txt).includes(target)){ playerImg = img.src; break; }
                          }catch(_e){}
                        }
                        if(playerImg) break;
                      }catch(_e){}
                    }
                  }
                }
              }
            }catch(_e){}

            // build substitution header if applicable
            const buildSubHeader = (() => {
              try{
                if(etype !== 'substitution') return null;
                const text = String(description || event.description || event.raw && event.raw.description || '').replace(/\s+/g,' ').trim();
                const tryMatch = (re) => { const m = text.match(re); if(m && m[1] && m[2]) return [m[2].trim(), m[1].trim()]; return null; };
                let res = tryMatch(/(.*?)\s*(?:off|out)\s*[,\-]?\s*(.*?)\s*(?:on|in)/i) || tryMatch(/(.*?)\s*replaced\s*by\s*(.*?)/i) || tryMatch(/(.*?)\s*->\s*(.*?)/i);
                if(!res) return null;
                const [inName, outName] = res;
                const resolveImg = (nm) => {
                  if(!nm) return '';
                  const n = (nm||'').toString().replace(/[\.]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
                  try{ if(matchCtx && matchCtx._playersMap){ const p = matchCtx._playersMap[nm] || matchCtx._playersMap[nm.toLowerCase()] || matchCtx._playersMap[n]; if(p) return p.player_image || p.player_photo || p.photo || p.strThumb || p.strThumbBig || p.player_pic || p.img || p.avatar || p.headshot || ''; } }catch(_e){}
                  try{ if(typeof document !== 'undefined'){ const imgs = Array.from(document.querySelectorAll('img')); for(const im of imgs){ try{ const alt = (im.getAttribute('alt')||im.getAttribute('data-player-name')||'').toString(); if(alt && alt.toLowerCase().includes(n)) return im.src; const p = im.closest && im.closest('div') || im.parentElement; const txt = p ? (p.textContent||'') : ''; if(txt && txt.toLowerCase().includes(n)) return im.src; }catch(_e){} } } }catch(_e){}
                  return '';
                };
                const inImg = resolveImg(inName); const outImg = resolveImg(outName);
                if(!inImg && !outImg) return null;
                const inBlock = inImg? `<div style="display:flex;flex-direction:column;align-items:center;margin-right:8px"><div style="width:48px;height:48px;overflow:hidden;border-radius:8px;background:#f3f4f6"><img src="${inImg}" style="width:48px;height:48px;object-fit:cover;display:block" onerror="this.onerror=null;this.remove();"/></div><div style="margin-top:6px;font-size:11px;color:#e5e7eb">In<br/><span style="color:#9ca3af;font-size:11px">${escapeHtml(inName||'')}</span></div></div>` : '';
                const outBlock = outImg? `<div style="display:flex;flex-direction:column;align-items:center;margin-right:8px"><div style="width:48px;height:48px;overflow:hidden;border-radius:8px;background:#f3f4f6"><img src="${outImg}" style="width:48px;height:48px;object-fit:cover;display:block" onerror="this.onerror=null;this.remove();"/></div><div style="margin-top:6px;font-size:11px;color:#e5e7eb">Out<br/><span style="color:#9ca3af;font-size:11px">${escapeHtml(outName||'')}</span></div></div>` : '';
                return `<div style="display:flex;align-items:center;gap:8px">${inBlock}${outBlock}</div>`;
              }catch(_e){ return null; }
            })();

            const titleParts = [];
            if(playerImg){
              // try player image, on error fall back to teamLogo if available
              titleParts.push(`<div style="width:56px;height:56px;overflow:hidden;border-radius:8px;flex-shrink:0;background:#f3f4f6"><img src=\"${playerImg}\" style=\"width:56px;height:56px;object-fit:cover;display:block\" onerror=\"this.onerror=null;${teamLogo ? `this.src='${teamLogo}';` : `this.remove();`}\"/></div>`);
            } else if(teamLogo){
              titleParts.push(`<div style="width:56px;height:56px;overflow:hidden;border-radius:8px;flex-shrink:0;background:#f3f4f6"><img src=\"${teamLogo}\" style=\"width:56px;height:56px;object-fit:contain;display:block\" onerror=\"this.remove()\"/></div>`);
            }
            const nameLabel = (event.player || event.player_name || event.playerName || event.player_fullname) ? `<div style=\"margin-left:8px;font-weight:700;color:#e5e7eb\">${escapeHtml(String(event.player || event.player_name || event.playerName || ''))}</div>` : '';
            const headerHtml = `<div style=\"display:flex;align-items:center;gap:8px;\">${titleParts.join('')}${nameLabel}</div>`;
            // small image debug link (click to open the resolved image URL)
            const imgLinkHtml = playerImg ? `<div style=\"margin-top:6px\"><a href=\"${playerImg}\" target=\"_blank\" rel=\"noopener noreferrer\" style=\"color:#9ca3af;font-size:11px\">Open player image</a></div>` : (teamLogo ? `<div style=\"margin-top:6px\"><a href=\"${teamLogo}\" target=\"_blank\" rel=\"noopener noreferrer\" style=\"color:#9ca3af;font-size:11px\">Open team logo</a></div>` : '');
            try{ console.log('tooltip image lookup', {playerImg, teamLogo, event}); }catch(_e){}
            d.innerHTML = `${headerHtml}${imgLinkHtml}<div style=\"margin-top:6px;color:#e5e7eb;font-size:12px\">Summarizing…</div>`;
            d.style.display = 'block';
            positionEventTooltip(dot);

            try{
              const brief = await getEventBrief(etype, { minute, description, event, tags }, matchCtx);
              d.innerHTML = `${headerHtml}${imgLinkHtml}<div style=\"margin-top:6px;color:#e5e7eb;font-size:12px;white-space:normal\">${escapeHtml(String(brief || description || etype))}</div>`;
              positionEventTooltip(dot);
            }catch(_e){
              d.innerHTML = `${headerHtml}${imgLinkHtml}<div style=\"margin-top:6px;color:#e5e7eb;font-size:12px\">${escapeHtml(String(description || etype))}</div>`;
              positionEventTooltip(dot);
            }
          }catch(_err){
            try{ showEventTooltip(dot, 'Summarizing…'); }catch(_e){}
          }
        };
        const onLeave = ()=> hideEventTooltip();
        const onMove = ()=> positionEventTooltip(dot);
        dot.addEventListener('mouseenter', onEnter);
        dot.addEventListener('mouseleave', onLeave);
        dot.addEventListener('mousemove', onMove);
      }
    }catch(_e){ /* ignore hover errors */ }
    eventDiv.appendChild(timeline); eventDiv.appendChild(content); return eventDiv;
  }

  // ---- Event brief tooltip helpers ----
  const _eventBriefCache = new Map();
  function _briefKey(etype, payload){
    const p = payload||{}; return [etype, p.minute||'', (p.description||'').slice(0,80), (p.event&& (p.event.player||p.event.home_scorer||p.event.away_scorer||''))||'', p.tags && p.tags.join('|')].join('::');
  }
  function deriveEventType(description, tags, ev){
    const t = (Array.isArray(tags)?tags.join(' ').toLowerCase():String(tags||'').toLowerCase());
    const d = String(description||'').toLowerCase();
    if(t.includes('goal')||/\bgoal\b|scored|scores/.test(d)) return 'goal';
    if(t.includes('red')) return 'red card';
    if(t.includes('yellow')) return 'yellow card';
    if(t.includes('substitution')||/\bsub\b|replaced/.test(d)) return 'substitution';
    return null;
  }
  async function getEventBrief(etype, payload, matchCtx){
    const key = _briefKey(etype, payload);
    if(_eventBriefCache.has(key)) return _eventBriefCache.get(key);
    const ev = (payload && payload.event) || {};
    const tags = payload && payload.tags || [];
    // Build context
    const home = matchCtx?.event_home_team || matchCtx?.strHomeTeam || matchCtx?.home_team || '';
    const away = matchCtx?.event_away_team || matchCtx?.strAwayTeam || matchCtx?.away_team || '';
    const payloadBody = {
      provider: 'auto',
      eventId: String(matchCtx?.idEvent || matchCtx?.event_key || matchCtx?.id || matchCtx?.match_id || '' ) || undefined,
      eventName: (home && away) ? `${home} vs ${away}` : undefined,
      date: matchCtx?.event_date || matchCtx?.dateEvent || matchCtx?.date || undefined,
      events: [{
        minute: payload.minute || ev.minute || ev.time || '',
        type: etype,
        description: payload.description || ev.description || ev.text || ev.event || '',
        player: ev.player || ev.home_scorer || ev.away_scorer || ev.player_name || '',
        team: ev.team || '',
        tags: Array.isArray(tags)? tags.slice(0,6) : undefined,
      }]
    };
    let brief = '';
    try{
      const r = await fetch(apiBase + '/summarizer/summarize/events', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payloadBody)});
      if(r.ok){ const j = await r.json(); brief = (j && j.items && j.items[0] && j.items[0].brief) || ''; }
    }catch(_e){ /* ignore */ }
    if(!brief){
      const minute = payload.minute || ev.minute || ev.time || '';
      const player = ev.player || ev.home_scorer || ev.away_scorer || ev.player_name || '';
      if(etype==='goal') brief = `${player||'Unknown'} scores at ${minute||'?'}.'`;
      else if(etype==='yellow card') brief = `Yellow card for ${player||'unknown'} at ${minute||'?'}.`;
      else if(etype==='red card') brief = `Red card for ${player||'unknown'} at ${minute||'?'}.`;
      else if(etype==='substitution') brief = payload.description || 'Substitution.';
      else brief = payload.description || etype;
    }
    _eventBriefCache.set(key, brief);
    return brief;
  }
  let _evtTooltip; 
  function ensureTooltip(){
    if(_evtTooltip) return _evtTooltip;
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;z-index:9999;max-width:320px;background:#111827;color:#e5e7eb;padding:8px 10px;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,0.25);font-size:12px;line-height:1.4;pointer-events:none;display:none;';
    document.body.appendChild(d); _evtTooltip = d; return d;
  }
  function showEventTooltip(anchor, text){ const d=ensureTooltip(); d.textContent = String(text||''); d.style.display='block'; positionEventTooltip(anchor); }
  function hideEventTooltip(){ if(_evtTooltip) _evtTooltip.style.display='none'; }
  function positionEventTooltip(anchor){ if(!_evtTooltip) return; const r = anchor.getBoundingClientRect(); const pad=8; let x = r.right + pad; let y = r.top - 4; const vw = window.innerWidth; const vh = window.innerHeight; const dw = _evtTooltip.offsetWidth; const dh = _evtTooltip.offsetHeight; if(x+dw+12>vw) x = r.left - dw - pad; if(x<4) x=4; if(y+dh+12>vh) y = vh - dh - 8; if(y<4) y=4; _evtTooltip.style.left = `${Math.round(x)}px`; _evtTooltip.style.top = `${Math.round(y)}px`; }

  function getEventIcon(description, tags){ const desc=String(description).toLowerCase(); const tagStr = Array.isArray(tags)?tags.join(' ').toLowerCase():String(tags).toLowerCase(); if(desc.includes('goal')||tagStr.includes('goal')) return '⚽'; if(desc.includes('yellow')||tagStr.includes('yellow')) return '🟨'; if(desc.includes('red')||tagStr.includes('red')) return '🟥'; if(desc.includes('substitution')||tagStr.includes('substitution')) return '🔄'; if(desc.includes('corner')||tagStr.includes('corner')) return '📐'; if(desc.includes('penalty')||tagStr.includes('penalty')) return '⚽'; if(desc.includes('offside')||tagStr.includes('offside')) return '🚩'; return '⚪'; }

  function getEventColor(description, tags){ const desc=String(description).toLowerCase(); const tagStr = Array.isArray(tags)?tags.join(' ').toLowerCase():String(tags).toLowerCase(); if(desc.includes('goal')||tagStr.includes('goal')) return '#10b981'; if(desc.includes('yellow')||tagStr.includes('yellow')) return '#f59e0b'; if(desc.includes('red')||tagStr.includes('red')) return '#ef4444'; if(desc.includes('substitution')||tagStr.includes('substitution')) return '#8b5cf6'; return '#6b7280'; }

  function getTagColor(tag){ const t = String(tag).toLowerCase(); if(t.includes('goal')) return '#10b981'; if(t.includes('card')) return '#f59e0b'; if(t.includes('substitution')) return '#8b5cf6'; if(t.includes('penalty')) return '#ef4444'; return '#6b7280'; }

  function normalizeEventTags(evt){
    // Prefer provider `tags` first for display (don't show model `predicted_tags` when provider tags exist).
    const candidates = [];
    if(evt){
      if(evt.tags !== undefined) candidates.push(evt.tags);
      if(evt.predicted_tags !== undefined) candidates.push(evt.predicted_tags);
      if(evt.predictedTags !== undefined) candidates.push(evt.predictedTags);
      if(evt.labels !== undefined) candidates.push(evt.labels);
      if(evt.labels_list !== undefined) candidates.push(evt.labels_list);
    }
    let raw = [];
    for(const c of candidates){ if(c === undefined || c === null) continue; if(Array.isArray(c) && c.length>0){ raw = c; break; } if(typeof c === 'string' && c.trim()){ raw = [c]; break; } if(typeof c === 'object' && !Array.isArray(c)){ raw = [c]; break; } }
    const out = []; if(!raw) return out; try{ if(!Array.isArray(raw)){ if(typeof raw === 'string') raw = [raw]; else if(typeof raw === 'object') raw = [raw]; else raw = []; } }catch(e){ return out; }
    raw.forEach(r=>{ if(r===undefined||r===null) return; if(typeof r === 'string'){ const isModel = /^model[:\-\s]/i.test(r) || /\bmodel\b|\bml\b/i.test(r); const text = r.replace(/^model[:\-\s]+/i,'').trim(); out.push({ text: text||r, source: isModel? 'model':'rule', confidence: undefined, isModel }); return; } if(typeof r === 'object'){ const text = r.label||r.text||r.name||r.tag||JSON.stringify(r); const src = r.source||r.origin||r.by||r.src||r.provider||''; const conf = r.confidence||r.score||r.probability||r.p||r.conf||undefined; const isModel = String(src).toLowerCase().includes('model')||String(src).toLowerCase().includes('ml')||/^model[:\-\s]/i.test(text)||!!r.isModel; out.push({ text, source: src || (isModel ? 'model':'rule'), confidence: conf, isModel }); return; } }); return out; }

  function renderAdditionalInfo(ev, container){
    const infoCard = document.createElement('div'); infoCard.style.cssText='background:white;border-radius:16px;padding:24px;box-shadow:0 4px 20px rgba(0,0,0,0.08)'; const title = document.createElement('h3'); title.style.cssText='margin:0 0 16px 0;color:#1f2937;font-size:20px'; title.innerHTML='ℹ️ Additional Information'; infoCard.appendChild(title);
    const infoGrid = document.createElement('div'); infoGrid.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;';
    const infoItems = [['Event ID', ev.idEvent || ev.event_key || 'N/A'], ['League ID', ev.league_key || ev.idLeague || 'N/A'], ['Season', ev.season || ev.strSeason || 'N/A'], ['Round', ev.round || ev.intRound || 'N/A'], ['Weather', ev.weather || 'N/A'], ['Temperature', ev.temperature || 'N/A']].filter(([l,v])=> v && v !== 'N/A');
    infoItems.forEach(([label,value])=>{ const item = document.createElement('div'); item.style.cssText='padding:12px;background:#f9fafb;border-radius:8px;border-left:4px solid #3b82f6;'; item.innerHTML = `<div style="font-size:12px;color:#6b7280;font-weight:500;margin-bottom:4px;">${label}</div><div style="color:#1f2937;font-weight:600;">${value}</div>`; infoGrid.appendChild(item); });
    if(infoGrid.children.length>0){ infoCard.appendChild(infoGrid); container.appendChild(infoCard); }
    const videoUrl = ev.strYoutube || ev.video_url || ev.video; if(videoUrl){ const videoCard=document.createElement('div'); videoCard.style.cssText='background:linear-gradient(135deg,#f093fb 0%,#f5576c 100%);border-radius:16px;padding:20px;margin-top:16px;text-align:center;'; const videoLink=document.createElement('a'); videoLink.href=videoUrl; videoLink.target='_blank'; videoLink.rel='noopener noreferrer'; videoLink.style.cssText='color:white;text-decoration:none;font-weight:600;font-size:16px;display:inline-flex;align-items:center;gap:8px;'; videoLink.innerHTML='🎥 Watch Match Highlights'; videoCard.appendChild(videoLink); container.appendChild(videoCard); }
  }

  function escapeHtml(unsafe){
    return String(unsafe).replace(/[&<>"'`=\/]/g, function (s) {
      return ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
        '/': '&#x2F;',
        '`': '&#x60;',
        '=': '&#x3D;'
      })[s];
    });
  }

  // Helper to attach a "Show raw" toggle and pre element to any extras body
  function attachRawToggle(container, data, label){
    try{
      const rawToggle = document.createElement('button');
      rawToggle.textContent = (label && label.length>0) ? ('Show raw — ' + label) : 'Show raw';
      rawToggle.style.cssText = 'margin-top:12px; display:inline-block; background:transparent; border:1px dashed #d1d5db; color:#374151; padding:6px 10px; border-radius:6px; cursor:pointer; font-size:12px;';
      const rawPre = document.createElement('pre');
      rawPre.style.cssText = 'display:none; margin-top:8px; background:#0f1724; color:#e5e7eb; padding:8px; border-radius:8px; overflow:auto; max-height:360px; white-space:pre-wrap; word-break:break-word;';

      // Prepare a safe serializable copy
      let payload = data;
      try{
        // If it's Promise.allSettled results, map to simpler form
        if(Array.isArray(data) && data.length>0 && data[0] && (data[0].status === 'fulfilled' || data[0].status === 'rejected')){
          payload = data.map(r => {
            if(r && r.status === 'fulfilled') return {status:'fulfilled', value: r.value};
            if(r && r.status === 'rejected') return {status:'rejected', reason: String(r.reason)};
            return r;
          });
        } else if(data && typeof data === 'object' && (data.status === 'fulfilled' || data.status === 'rejected')){
          // single settled
          payload = (data.status === 'fulfilled') ? {status:'fulfilled', value: data.value} : {status:'rejected', reason: String(data.reason)};
        }
      }catch(e){ payload = data; }

      try{ rawPre.textContent = JSON.stringify(payload, null, 2); }catch(e){ rawPre.textContent = String(payload); }

      rawToggle.addEventListener('click', ()=>{
        if(rawPre.style.display === 'none'){
          rawPre.style.display = 'block'; rawToggle.textContent = rawToggle.textContent.replace(/^Show/,'Hide');
        } else {
          rawPre.style.display = 'none'; rawToggle.textContent = rawToggle.textContent.replace(/^Hide/,'Show');
        }
      });

      container.appendChild(rawToggle);
      container.appendChild(rawPre);
    }catch(e){ console.warn('attachRawToggle error', e); }
  }

  // Beautiful card creators for extras sections (from history.js)
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

    if(result.status === 'fulfilled' && result.value && result.value.ok) {
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

    const header = document.createElement('div');
    header.style.cssText = `display: flex; align-items: center; gap: 12px; margin-bottom: 12px;`;

    const icon = document.createElement('div');
    icon.style.cssText = `width: 40px; height: 40px; background: linear-gradient(135deg, #10b981, #059669); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold;`;
    icon.textContent = '👥';

    const title = document.createElement('h4');
    title.style.cssText = 'margin: 0; color: #1f2937; font-size: 18px;';
    title.textContent = `${teamName} Squad`;

    header.appendChild(icon);
    header.appendChild(title);
    card.appendChild(header);

    let players = [];
    let errorMsg = null;
    try {
      if (!result) {
        players = [];
      } else if (result.status === 'rejected') {
        errorMsg = (result.reason && result.reason.message) ? result.reason.message : 'Request rejected';
      } else if (result.status === 'fulfilled' && result.value) {
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
    } catch (e) {
      errorMsg = e && e.message ? e.message : String(e);
    }

    if (errorMsg) {
      const err = document.createElement('div');
      err.style.cssText = 'color: #ef4444; font-style: italic; text-align: center; padding: 12px;';
      err.textContent = 'Players error: ' + errorMsg;
      card.appendChild(err);
      return card;
    }

    if (!Array.isArray(players) || players.length === 0) {
      const noPlayers = document.createElement('div');
      noPlayers.style.cssText = 'color: #6b7280; font-style: italic; text-align: center; padding: 20px;';
      noPlayers.textContent = 'No players found';
      card.appendChild(noPlayers);
      return card;
    }

    const playersGrid = document.createElement('div');
    playersGrid.style.cssText = `display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; max-height: 360px; overflow-y: auto; padding-right: 6px;`;

    players.slice(0, 40).forEach(player => {
      const playerItem = document.createElement('div');
      playerItem.style.cssText = `display: flex; align-items: center; gap: 12px; padding: 8px; background: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0;`;

      const imgWrap = document.createElement('div');
      imgWrap.style.cssText = `width: 48px; height: 48px; border-radius: 8px; overflow: hidden; flex-shrink: 0; background: linear-gradient(135deg,#e6eefc,#dbeafe); display:flex;align-items:center;justify-content:center;`;

      const imgUrl = player.player_image || player.player_photo || player.photo || player.thumb || player.playerImage || player.image || '';
      if (imgUrl) {
        const img = document.createElement('img');
        img.src = imgUrl;
        img.alt = player.player_name || player.name || '';
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        img.onerror = () => imgWrap.textContent = (player.player_name || player.name || 'P').split(' ').map(s=>s[0]).slice(0,2).join('').toUpperCase();
        imgWrap.appendChild(img);
      } else {
        imgWrap.textContent = (player.player_name || player.name || 'P').split(' ').map(s=>s[0]).slice(0,2).join('').toUpperCase();
        imgWrap.style.fontWeight = '700';
        imgWrap.style.color = '#0f1724';
      }

      const info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0;';

      const nameRow = document.createElement('div');
      nameRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;';
      const playerName = document.createElement('div');
      playerName.style.cssText = 'font-weight:600;color:#1f2937;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      playerName.textContent = player.player_name || player.name || player.strPlayer || 'Unknown';

      const num = document.createElement('div');
      num.style.cssText = 'font-size:12px;color:#6b7280;font-weight:700;min-width:28px;text-align:center;';
      num.textContent = (player.player_number || player.number || player.strNumber) ? String(player.player_number || player.number || player.strNumber) : '';

      nameRow.appendChild(playerName);
      nameRow.appendChild(num);

      const metaRow = document.createElement('div');
      metaRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin-top:4px;flex-wrap:wrap;';

      const position = document.createElement('div');
      position.style.cssText = 'font-size:11px;color:#6b7280;';
      position.textContent = player.player_type || player.position || player.strPosition || '';

      const stats = document.createElement('div');
      stats.style.cssText = 'font-size:11px;color:#6b7280;';
      const goals = player.player_goals || player.goals || player.scored || '';
      const assists = player.player_assists || player.assists || '';
      const parts = [];
      if (goals !== undefined && goals !== null && String(goals).trim() !== '') parts.push(`G:${goals}`);
      if (assists !== undefined && assists !== null && String(assists).trim() !== '') parts.push(`A:${assists}`);
      stats.textContent = parts.join(' • ');

      metaRow.appendChild(position);
      if (stats.textContent) metaRow.appendChild(stats);

      info.appendChild(nameRow);
      info.appendChild(metaRow);

      playerItem.appendChild(imgWrap);
      playerItem.appendChild(info);
      playersGrid.appendChild(playerItem);
    });

    card.appendChild(playersGrid);

    if (players.length > 40) {
      const moreInfo = document.createElement('div');
      moreInfo.style.cssText = 'margin-top: 8px; text-align: center; color: #6b7280; font-size: 12px;';
      moreInfo.textContent = `... and ${players.length - 40} more players`;
      card.appendChild(moreInfo);
    }

    return card;
  }

  function createLeagueTableCard(data) {
    const card = document.createElement('div');
    card.style.cssText = `background: white; border-radius: 12px; padding: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); border-left: 4px solid #f59e0b;`;

    const header = document.createElement('div');
    header.style.cssText = `display: flex; align-items: center; gap: 12px; margin-bottom: 16px;`;

    const icon = document.createElement('div');
    icon.style.cssText = `width: 40px; height: 40px; background: linear-gradient(135deg, #f59e0b, #d97706); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold;`;
    icon.textContent = '🏆';

    const title = document.createElement('h4');
    title.style.cssText = 'margin: 0; color: #1f2937; font-size: 18px;';
    title.textContent = 'League Table';

    header.appendChild(icon);
    header.appendChild(title);
    card.appendChild(header);

    let teams = [];
    if (Array.isArray(data)) {
      teams = data;
    } else if (data) {
      if (Array.isArray(data.total)) teams = data.total;
      else if (Array.isArray(data.teams)) teams = data.teams;
      else if (Array.isArray(data.result)) teams = data.result;
      else if (Array.isArray(data.table)) teams = data.table;
      else if (Array.isArray(data.standings)) teams = data.standings;
      else if (data.result && Array.isArray(data.result.total)) teams = data.result.total;
      else if (data.data && Array.isArray(data.data.total)) teams = data.data.total;
      else teams = [];
    }

    if(Array.isArray(teams) && teams.length > 0) {
      const table = document.createElement('div');
      table.style.cssText = 'overflow-x: auto;';

      const tableHeader = document.createElement('div');
      tableHeader.style.cssText = `display: grid; grid-template-columns: 40px 1fr 60px 60px 60px 60px 60px; gap: 8px; padding: 8px; background: #f8fafc; border-radius: 6px; font-size: 12px; font-weight: 600; color: #6b7280; margin-bottom: 4px;`;
      tableHeader.innerHTML = '<div>Pos</div><div>Team</div><div>P</div><div>W</div><div>D</div><div>L</div><div>PTS</div>';

      table.appendChild(tableHeader);

      teams.slice(0, 10).forEach((team, index) => {
        const row = document.createElement('div');
        row.style.cssText = `display: grid; grid-template-columns: 40px 1fr 60px 60px 60px 60px; gap: 8px; padding: 8px; border-radius: 6px; font-size: 13px; ${index % 2 === 0 ? 'background: #f9fafb;' : ''} border-left: 3px solid ${getPositionColor(index + 1)};`;

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
      const noData = document.createElement('div');
      noData.style.cssText = 'color: #6b7280; font-style: italic; text-align: center; padding: 20px;';
      noData.textContent = 'League table not available';
      card.appendChild(noData);
    }

    return card;
  }

  function getPositionColor(position) {
    if(position <= 4) return '#10b981'; // Champions League
    if(position <= 6) return '#3b82f6'; // Europa League
    if(position >= 18) return '#ef4444'; // Relegation
    return '#6b7280'; // Mid-table
  }

  // Use history.js style odds card (title + settled result) for consistent display
  function createOddsCard(title, result) {
    const card = document.createElement('div');
    card.style.cssText = `
      background: white;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      border-left: 4px solid #8b5cf6;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
    `;

    const icon = document.createElement('div');
    icon.style.cssText = `
      width: 40px;
      height: 40px;
      background: linear-gradient(135deg, #8b5cf6, #7c3aed);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: bold;
    `;
    icon.textContent = '💰';

    const titleEl = document.createElement('h4');
    titleEl.style.cssText = 'margin: 0; color: #1f2937; font-size: 18px;';
    titleEl.textContent = title;

    header.appendChild(icon);
    header.appendChild(titleEl);
    card.appendChild(header);

    if(result && result.status === 'fulfilled' && result.value && result.value.ok) {
      const v = result.value;
      let odds = [];
      try {
        // Normalize shapes: arrays, nested result arrays, or objects keyed by match id -> array
        if (v.data) {
          if (Array.isArray(v.data)) odds = v.data;
          else if (Array.isArray(v.data.result)) odds = v.data.result;
          else if (v.data.result && typeof v.data.result === 'object') {
            // AllSports often returns { result: { "<matchId>": [ ... ] } }
            const vals = Object.values(v.data.result).filter(Boolean);
            odds = vals.reduce((acc, cur) => acc.concat(Array.isArray(cur) ? cur : []), []);
          } else if (Array.isArray(v.data.results)) odds = v.data.results;
          else if (Array.isArray(v.data.odds)) odds = v.data.odds;
        }
        if (odds.length === 0 && v.result) {
          if (Array.isArray(v.result)) odds = v.result;
          else if (typeof v.result === 'object') {
            const vals = Object.values(v.result).filter(Boolean);
            odds = vals.reduce((acc, cur) => acc.concat(Array.isArray(cur) ? cur : []), []);
          }
        }
      } catch (e) {
        odds = [];
      }

      if(Array.isArray(odds) && odds.length > 0) {
        const oddsGrid = document.createElement('div');
        oddsGrid.style.cssText = `
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 8px;
        `;

        // Helper to format numeric odds
        const fmt = (n) => (n === null || n === undefined || n === '') ? '-' : (typeof n === 'number' ? n.toFixed(2) : String(n));

        // Prefer showing best/most relevant markets: 1X2, BTTS, O/U 2.5, AH0
        odds.slice(0, 12).forEach(odd => {
          const oddItem = document.createElement('div');
          oddItem.style.cssText = `
            padding: 12px;
            background: #f8fafc;
            border-radius: 6px;
            text-align: left;
            border: 1px solid #e2e8f0;
            display:flex;flex-direction:column;gap:6px;
          `;

          const bookmaker = odd.odd_bookmakers || odd.bookmaker_name || odd.strBookmaker || odd.bookmaker || 'Unknown';
          const headerRow = document.createElement('div');
          headerRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;';
          const nameEl = document.createElement('div'); nameEl.style.cssText = 'font-weight:600;color:#1f2937;font-size:13px;'; nameEl.textContent = bookmaker;
          const idEl = document.createElement('div'); idEl.style.cssText = 'font-size:12px;color:#6b7280;'; idEl.textContent = odd.match_id ? `id:${odd.match_id}` : '';
          headerRow.appendChild(nameEl); headerRow.appendChild(idEl);

          const markets = document.createElement('div'); markets.style.cssText = 'display:flex;flex-direction:column;gap:4px;font-size:12px;color:#374151;';

          // 1X2
          const h = fmt(odd.odd_1 || odd.home || odd.h);
          const d = fmt(odd.odd_x || odd.draw || odd.x);
          const a = fmt(odd.odd_2 || odd.away || odd.a);
          const row132 = document.createElement('div'); row132.style.cssText = 'display:flex;justify-content:space-between;gap:8px;';
          row132.innerHTML = `<div style="color:#6b7280;font-weight:600">1X2</div><div style="display:flex;gap:8px"><span style="color:#3b82f6;">H:${h}</span><span style="color:#f59e0b;">D:${d}</span><span style="color:#ef4444;">A:${a}</span></div>`;
          markets.appendChild(row132);

          // BTTS
          const btsYes = odd.bts_yes || odd.btst_yes || odd.btsy || odd.bts_yes;
          const btsNo = odd.bts_no || odd.btst_no || odd.btsn || odd.bts_no;
          if (btsYes !== undefined || btsNo !== undefined) {
            const btsRow = document.createElement('div');
            btsRow.style.cssText = 'display:flex;justify-content:space-between;gap:8px;';
            btsRow.innerHTML = `<div style="color:#6b7280;font-weight:600">BTTS</div><div style="display:flex;gap:8px"><span style=\"color:#10b981;\">Y:${fmt(btsYes)}</span><span style=\"color:#ef4444;\">N:${fmt(btsNo)}</span></div>`;
            markets.appendChild(btsRow);
          }

          // O/U 2.5 (common)
          const ou25 = (odd['o+2.5'] !== undefined || odd['u+2.5'] !== undefined) ? {o: odd['o+2.5'], u: odd['u+2.5']} : null;
          if (ou25) {
            const ouRow = document.createElement('div');
            ouRow.style.cssText = 'display:flex;justify-content:space-between;gap:8px;';
            ouRow.innerHTML = `<div style="color:#6b7280;font-weight:600">O/U 2.5</div><div style="display:flex;gap:8px"><span style=\"color:#3b82f6;\">O:${fmt(ou25.o)}</span><span style=\"color:#ef4444;\">U:${fmt(ou25.u)}</span></div>`;
            markets.appendChild(ouRow);
          }

          // Asian handicap 0 (AH0)
          const ah0_1 = odd.ah0_1 || odd['ah0_1'];
          const ah0_2 = odd.ah0_2 || odd['ah0_2'];
          if (ah0_1 !== undefined || ah0_2 !== undefined) {
            const ahRow = document.createElement('div');
            ahRow.style.cssText = 'display:flex;justify-content:space-between;gap:8px;';
            ahRow.innerHTML = `<div style="color:#6b7280;font-weight:600">AH 0</div><div style="display:flex;gap:8px"><span style=\"color:#3b82f6;\">H:${fmt(ah0_1)}</span><span style=\"color:#ef4444;\">A:${fmt(ah0_2)}</span></div>`;
            markets.appendChild(ahRow);
          }

          oddItem.appendChild(headerRow);
          oddItem.appendChild(markets);
          oddsGrid.appendChild(oddItem);
        });

        card.appendChild(oddsGrid);
      } else {
        const noOdds = document.createElement('div');
        noOdds.style.cssText = 'color: #6b7280; font-style: italic; text-align: center; padding: 20px;';
        noOdds.textContent = 'No odds available';
        card.appendChild(noOdds);
      }
    } else {
      const errMsg = (result && result.status === 'rejected') ? (result.reason && result.reason.message ? result.reason.message : 'Request rejected') : 'Failed to load odds';
      const error = document.createElement('div');
      error.style.cssText = 'color: #ef4444; font-style: italic; text-align: center; padding: 20px;';
      error.textContent = errMsg;
      card.appendChild(error);
    }

    return card;
  }

  function createProbabilitiesCard(data) {
    const card = document.createElement('div');
    card.style.cssText = `background: white; border-radius: 12px; padding: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); border-left: 4px solid #06b6d4;`;

    const header = document.createElement('div');
    header.style.cssText = `display: flex; align-items: center; gap: 12px; margin-bottom: 16px;`;

    const icon = document.createElement('div');
    icon.style.cssText = `width: 40px; height: 40px; background: linear-gradient(135deg, #06b6d4, #0891b2); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold;`;
    icon.textContent = '📊';

    const title = document.createElement('h4');
    title.style.cssText = 'margin: 0; color: #1f2937; font-size: 18px;';
    title.textContent = 'Match Probabilities (Analysis Agent)';

    header.appendChild(icon);
    header.appendChild(title);
    card.appendChild(header);

    const body = document.createElement('div');
    body.className = 'prob-body';
    body.innerHTML = '<div class="prob-loading">Loading probabilities…</div>';
    card.appendChild(body);

    function probRow(label, p){
      const row = document.createElement('div');
      row.className = 'prob-row';

      const lab = document.createElement('span');
      lab.className = 'label';
      lab.textContent = label;
      row.appendChild(lab);

      const bar = document.createElement('div');
      bar.className = 'bar';
      const fill = document.createElement('span');
      fill.className = 'fill';
      fill.style.width = (Number(p || 0) * 100).toFixed(0) + '%';
      bar.appendChild(fill);
      row.appendChild(bar);

      const val = document.createElement('span');
      val.className = 'value';
      val.textContent = (Number(p || 0) * 100).toFixed(1) + '%';
      row.appendChild(val);

      return row;
    }

    // Resolve team names and logos from varied hint keys with graceful fallback.
    // Also infer a readable name from the logo filename when explicit names are missing.
    function resolveTeams(hints){
      const h = hints || {};

      const pick = (obj, keys) => {
        for(const k of keys){ if(obj && obj[k]) return String(obj[k]); }
        return '';
      };

      const inferFromLogo = (url) => {
        try{
          if(!url) return '';
          const last = String(url).split('?')[0].split('#')[0].split('/').pop() || '';
          if(!last) return '';
          const base = last.replace(/\.[a-zA-Z0-9]+$/, '');
          const t = decodeURIComponent(base).replace(/[\-_]+/g, ' ').replace(/\s+/g, ' ').trim();
          if(!t) return '';
          return t.split(' ').map(w => w ? (w[0].toUpperCase() + w.slice(1)) : '').join(' ').trim();
        }catch(_e){ return ''; }
      };

      const homeLogo = pick(h, ['home_team_logo','event_home_team_logo','home_logo','strHomeTeamBadge','homeBadge','team_home_badge']);
      const awayLogo = pick(h, ['away_team_logo','event_away_team_logo','away_logo','strAwayTeamBadge','awayBadge','team_away_badge']);

      let homeName = pick(h, ['home_team_name','event_home_team','home_team','strHomeTeam','home']);
      let awayName = pick(h, ['away_team_name','event_away_team','away_team','strAwayTeam','away']);

      if(!homeName){ homeName = inferFromLogo(homeLogo) || 'Home'; }
      if(!awayName){ awayName = inferFromLogo(awayLogo) || 'Away'; }

      return { homeName, awayName, homeLogo, awayLogo };
    }

    function stackedLine(pHome, pDraw, pAway, labels, logos, roles){
      const container = document.createElement('div');
      container.style.cssText = 'margin: 12px 0 8px 0; display:flex; align-items:center; gap:10px;';

      // Left logo (home)
      const left = document.createElement('img');
      left.src = (logos && logos.home) ? logos.home : '';
      left.alt = (labels && labels.home) ? labels.home : 'Home';
      left.style.cssText = 'width:24px;height:24px;object-fit:contain;border-radius:4px;';
      left.onerror = () => left.remove();
      if(left.src) container.appendChild(left);

      // Stacked bar with overlay text
      const wrap = document.createElement('div');
      wrap.style.cssText = 'flex:1; position:relative; height:22px; background:#f3f4f6; border-radius:11px; overflow:hidden; display:flex;';

      const seg = (w, bg) => {
        const s = document.createElement('div');
        s.style.cssText = `height:100%; width:${(w*100).toFixed(1)}%; background:${bg}; display:flex; align-items:center; justify-content:center; position:relative;`;
        return s;
      };

      const txt = (t) => {
        const el = document.createElement('span');
        el.style.cssText = 'font-size:12px; font-weight:700; color:white; text-shadow:0 1px 2px rgba(0,0,0,0.25); white-space:nowrap;';
        el.textContent = t;
        return el;
      };

      const homeSeg = seg(pHome, '#3b82f6');
      const drawSeg = seg(pDraw, '#9ca3af');
      const awaySeg = seg(pAway, '#ef4444');

      const homeRole = roles && roles.homeTxt ? ` ${roles.homeTxt}` : '';
      const awayRole = roles && roles.awayTxt ? ` ${roles.awayTxt}` : '';

      const homeTxt = `${labels.home}${homeRole} ${(pHome*100).toFixed(1)}%`;
      const drawTxt = `Draw ${(pDraw*100).toFixed(1)}%`;
      const awayTxt = `${labels.away}${awayRole} ${(pAway*100).toFixed(1)}%`;

      homeSeg.title = homeTxt;
      drawSeg.title = drawTxt;
      awaySeg.title = awayTxt;

      homeSeg.appendChild(txt(homeTxt));
      drawSeg.appendChild(txt(drawTxt));
      awaySeg.appendChild(txt(awayTxt));

      wrap.appendChild(homeSeg); wrap.appendChild(drawSeg); wrap.appendChild(awaySeg);
      container.appendChild(wrap);

      // Right logo (away)
      const right = document.createElement('img');
      right.src = (logos && logos.away) ? logos.away : '';
      right.alt = (labels && labels.away) ? labels.away : 'Away';
      right.style.cssText = 'width:24px;height:24px;object-fit:contain;border-radius:4px;';
      right.onerror = () => right.remove();
      if(right.src) container.appendChild(right);

      return container;
    }

    function teamWDLRow({logo, name, roleTxt, win, draw, loss}){
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; align-items:center; gap:10px; margin:6px 0;';

      const img = document.createElement('img');
      img.src = logo || '';
      img.alt = name || '';
      img.style.cssText = 'width:20px;height:20px;object-fit:contain;border-radius:4px;';
      img.onerror = () => img.remove();
      if (img.src) row.appendChild(img);

      const label = document.createElement('div');
      label.style.cssText = 'font-weight:600; color:#1f2937;';
      label.textContent = `${name} ${roleTxt}`;
      row.appendChild(label);

      const stats = document.createElement('div');
      stats.style.cssText = 'margin-left:auto; color:#374151; font-size:13px;';
      const fmt = (x)=> (Number(x)*100).toFixed(1) + '%';
      stats.textContent = `W ${fmt(win)} • D ${fmt(draw)} • L ${fmt(loss)}`;
      row.appendChild(stats);

      return row;
    }

    function renderFromAgentRes(res, hints, note){
      if(!(res && res.ok && res.data && res.data.probs)){
        body.innerHTML = '<div class="prob-error">Match probabilities not available</div>';
        return;
      }
      const { method, probs, inputs } = res.data;
      let pHome = Number(probs.home || 0), pDraw = Number(probs.draw || 0), pAway = Number(probs.away || 0);

      const total = pHome + pDraw + pAway;
      if (total > 0 && Math.abs(total - 1.0) > 1e-9) {
        pHome /= total; pDraw /= total; pAway /= total;
      }

      const { homeName, awayName, homeLogo, awayLogo } = resolveTeams(hints || {});

      const venue = inferVenueInfo(hints || {});
      const roles = {
        homeTxt: venue.neutral ? '(Neutral)' : '(Home)',
        awayTxt: venue.neutral ? '(Neutral)' : '(Away)'
      };

      body.innerHTML = '';
      // Big stacked bar with role-aware labels
      body.appendChild(stackedLine(
        pHome, pDraw, pAway,
        { home: homeName, away: awayName },
        { home: homeLogo, away: awayLogo },
        roles
      ));

      // Keep compact distribution rows (Home/Draw/Away)
      body.appendChild(probRow(`${homeName}`, pHome));
      body.appendChild(probRow('Draw', pDraw));
      body.appendChild(probRow(`${awayName}`, pAway));

      // Per-team W/D/L panel (mapped from the same match distribution)
      const homeWDL = { win: pHome, draw: pDraw, loss: pAway };
      const awayWDL = { win: pAway, draw: pDraw, loss: pHome };
      body.appendChild(teamWDLRow({ logo: homeLogo, name: homeName, roleTxt: roles.homeTxt, ...homeWDL }));
      body.appendChild(teamWDLRow({ logo: awayLogo, name: awayName, roleTxt: roles.awayTxt, ...awayWDL }));

      const meta = document.createElement('div');
      meta.className = 'prob-meta';
      const sample = (inputs && inputs.sample_size != null) ? ` • H2H n=${inputs.sample_size}` : '';
      meta.innerHTML = `Method: <strong>${String(method || '').replace('_',' ')}</strong>${sample}${note ? ` • ${note}` : ''}`;
      body.appendChild(meta);

      const btn = document.createElement('button');
      btn.textContent = 'Show raw';
      btn.style.cssText = 'margin-top:6px;background:#334155;color:#fff;border:1px solid #475569;padding:4px 8px;border-radius:6px;cursor:pointer;font-size:12px;';
      const pre = document.createElement('pre');
      pre.style.cssText = 'display:none;margin-top:8px;background:#111827;color:#e5e7eb;padding:8px;border-radius:8px;overflow:auto;max-height:240px;';
      try{ pre.textContent = JSON.stringify(res, null, 2); }catch(_e){ pre.textContent = String(res); }
      btn.addEventListener('click', ()=>{ const show = pre.style.display === 'none'; pre.style.display = show ? 'block' : 'none'; btn.textContent = show ? 'Hide raw' : 'Show raw'; });
      body.appendChild(btn);
      body.appendChild(pre);

      card.setAttribute('data-agent-prob', '1');
    }

    async function renderWithVenueLogic(passed, hints){
      const venue = inferVenueInfo(hints || {});
      if (venue.neutral) {
        try {
          const eventId = getEventId(hints || data);
          if (eventId) {
            const url = new URL(apiBase + '/analysis/winprob');
            url.searchParams.set('eventId', String(eventId));
            url.searchParams.set('source', 'auto');
            url.searchParams.set('lookback', '10');
            url.searchParams.set('venue_weight', '1.0'); // neutralize home advantage
            const resp = await fetch(url.toString());
            const neutralRes = await resp.json().catch(()=> ({}));
            console.debug('[prob][neutral] payload=', neutralRes);
            if (neutralRes && neutralRes.ok) {
              renderFromAgentRes(neutralRes, hints, `Neutral venue detected — venue_weight=1.0`);
              return;
            }
          }
        } catch (e) {
          console.warn('Neutral recompute failed, falling back to original.', e);
        }
      }
      renderFromAgentRes(passed, hints, venue.neutral ? 'Neutral venue suspected (using original weights)' : '');
    }

    if(data && data.res){
      renderWithVenueLogic(data.res, data);
      return card;
    }

    const eventId = getEventId(data);
    if(!eventId){
      body.innerHTML = '<div class="prob-error">Missing eventId</div>';
      return card;
    }

    (async ()=>{
      try{
        const url = new URL(apiBase + '/analysis/winprob');
        url.searchParams.set('eventId', String(eventId));
        url.searchParams.set('source', 'auto');
        url.searchParams.set('lookback', '10');
        const resp = await fetch(url.toString());
        console.debug('[prob][card] GET', url.toString(), 'status=', resp.status);
        const res = await resp.json().catch(()=> ({}));
        console.debug('[prob][card] payload=', res);

        const hints = {
          event_home_team: data.event_home_team || data.home_team || data.strHomeTeam,
          event_away_team: data.event_away_team || data.strAwayTeam || data.away_team,
          home_team_name: data.home_team_name || data.event_home_team || data.home_team || data.strHomeTeam,
          away_team_name: data.away_team_name || data.event_away_team || data.away_team || data.strAwayTeam,
          country_name: data.country_name || data.country || data.event_country,
          home_team_logo: data.home_team_logo || data.strHomeTeamBadge || '',
          away_team_logo: data.away_team_logo || data.strAwayTeamBadge || '',
        };
        await renderWithVenueLogic(res, hints);
      } catch(e){
        console.error('createProbabilitiesCard fetch error', e);
        body.innerHTML = '<div class="prob-error">Failed to load probabilities</div>';
      }
    })();

    return card;
  }

  function createCommentsCard(data) {
    const card = document.createElement('div');
    card.style.cssText = `background: white; border-radius: 12px; padding: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); border-left: 4px solid #ec4899;`;

    const header = document.createElement('div');
    header.style.cssText = `display: flex; align-items: center; gap: 12px; margin-bottom: 16px;`;

    const icon = document.createElement('div');
    icon.style.cssText = `width: 40px; height: 40px; background: linear-gradient(135deg, #ec4899, #db2777); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold;`;
    icon.textContent = '💬';

    const title = document.createElement('h4');
    title.style.cssText = 'margin: 0; color: #1f2937; font-size: 18px;';
    title.textContent = 'Match Commentary';

    header.appendChild(icon);
    header.appendChild(title);
    card.appendChild(header);

    // Normalize comments payloads: accept arrays, { result: [...] }, or { result: { matchId: [...] } }
    let comments = [];
    try {
      if (!data) comments = [];
      else if (Array.isArray(data)) comments = data;
      else if (Array.isArray(data.comments)) comments = data.comments;
      else if (Array.isArray(data.result)) comments = data.result;
      else if (data.result && typeof data.result === 'object') {
        // flatten values (handles shapes like { result: { "1668168": [ ... ] } })
        const vals = Object.values(data.result).filter(Boolean);
        comments = vals.reduce((acc, cur) => acc.concat(Array.isArray(cur) ? cur : []), []);
      } else if (data.data && Array.isArray(data.data)) comments = data.data;
    } catch (e) {
      comments = [];
    }

    if (Array.isArray(comments) && comments.length > 0) {
      const commentsContainer = document.createElement('div');
      commentsContainer.style.cssText = 'max-height: 400px; overflow-y: auto; padding-right: 6px;';

      // Helper to extract a friendly minute and text from various provider fields
      const extractMinute = (c) => c.comments_time || c.time || c.minute || c.match_minute || c.comment_minute || '';
      const extractText = (c) => c.comments_text || c.comment_text || c.comment || c.text || '';
      const extractType = (c) => c.comments_type || c.comment_type || c.type || 'Comment';

      // Render top N
      comments.slice(0, 100).forEach((comment, index) => {
        const commentItem = document.createElement('div');
        commentItem.style.cssText = `padding: 12px; margin-bottom: 8px; background: ${index % 2 === 0 ? '#f8fafc' : 'white'}; border-radius: 8px; border-left: 3px solid #ec4899;`;

        const commentHeader = document.createElement('div');
        commentHeader.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;';

        const minute = document.createElement('div');
        minute.style.cssText = 'font-size: 12px; color: #ec4899; font-weight: 600;';
        const m = extractMinute(comment);
        minute.textContent = m ? String(m) : '';

        const type = document.createElement('div');
        type.style.cssText = 'font-size: 11px; color: #6b7280; text-transform: uppercase;';
        type.textContent = extractType(comment) || 'Comment';

        commentHeader.appendChild(minute);
        commentHeader.appendChild(type);

        const commentText = document.createElement('div');
        commentText.style.cssText = 'color: #374151; font-size: 13px; line-height: 1.4;';
        commentText.textContent = extractText(comment) || 'No comment available';

        commentItem.appendChild(commentHeader);
        commentItem.appendChild(commentText);
        commentsContainer.appendChild(commentItem);
      });

      card.appendChild(commentsContainer);

      if (comments.length > 100) {
        const moreInfo = document.createElement('div');
        moreInfo.style.cssText = 'margin-top: 8px; text-align: center; color: #6b7280; font-size: 12px;';
        moreInfo.textContent = `... and ${comments.length - 100} more comments`;
        card.appendChild(moreInfo);
      }
    } else {
      const noData = document.createElement('div');
      noData.style.cssText = 'color: #6b7280; font-style: italic; text-align: center; padding: 20px;';
      noData.textContent = 'No match commentary available';
      card.appendChild(noData);
    }

    return card;
  }

  function createSeasonsCard(data) {
    const card = document.createElement('div');
    card.style.cssText = `background: white; border-radius: 12px; padding: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); border-left: 4px solid #14b8a6;`;

    const header = document.createElement('div');
    header.style.cssText = `display: flex; align-items: center; gap: 12px; margin-bottom: 16px;`;

    const icon = document.createElement('div');
    icon.style.cssText = `width: 40px; height: 40px; background: linear-gradient(135deg, #14b8a6, #0f766e); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold;`;
    icon.textContent = '📅';

    const title = document.createElement('h4');
    title.style.cssText = 'margin: 0; color: #1f2937; font-size: 18px;';
    title.textContent = 'Seasons';

    header.appendChild(icon);
    header.appendChild(title);
    card.appendChild(header);

    let seasons = [];
    try {
      if (!data) seasons = [];
      else if (Array.isArray(data)) seasons = data;
      else if (Array.isArray(data.seasons)) seasons = data.seasons;
      else if (Array.isArray(data.result)) seasons = data.result;
      else if (data.result && typeof data.result === 'object') {
        const vals = Object.values(data.result).filter(Boolean);
        seasons = vals.reduce((acc, cur) => acc.concat(Array.isArray(cur) ? cur : []), []);
      } else if (data.data && Array.isArray(data.data)) seasons = data.data;
    } catch (e) { seasons = []; }

    if (seasons.length > 0) {
      const seasonsGrid = document.createElement('div');
      seasonsGrid.style.cssText = `display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; max-height: 240px; overflow-y: auto;`;

      seasons.slice(0, 20).forEach(season => {
        const seasonItem = document.createElement('div');
        seasonItem.style.cssText = `padding: 12px; background: #f0fdfa; border-radius: 8px; text-align: center; border: 1px solid #14b8a620; cursor: pointer; transition: all 0.2s;`;
        seasonItem.onmouseover = () => seasonItem.style.background = '#ccfbf1';
        seasonItem.onmouseout = () => seasonItem.style.background = '#f0fdfa';

        const seasonName = document.createElement('div');
        seasonName.style.cssText = 'font-weight: 600; color: #0f766e; font-size: 14px;';
        seasonName.textContent = season.season_name || season.strSeason || season.name || 'Unknown Season';

        const seasonYear = document.createElement('div');
        seasonYear.style.cssText = 'font-size: 12px; color: #6b7280; margin-top: 4px;';
        seasonYear.textContent = season.season_year || season.year || '';

        seasonItem.appendChild(seasonName);
        if (seasonYear.textContent) seasonItem.appendChild(seasonYear);
        seasonsGrid.appendChild(seasonItem);
      });

      card.appendChild(seasonsGrid);

      if (seasons.length > 20) {
        const moreInfo = document.createElement('div');
        moreInfo.style.cssText = 'margin-top: 8px; text-align: center; color: #6b7280; font-size: 12px;';
        moreInfo.textContent = `... and ${seasons.length - 20} more seasons`;
        card.appendChild(moreInfo);
      }
    } else {
      const noData = document.createElement('div');
      noData.style.cssText = 'color: #6b7280; font-style: italic; text-align: center; padding: 20px;';
      noData.textContent = 'No seasons data available';
      card.appendChild(noData);
    }

    return card;
  }

  function createH2HCard(data) {
    const card = document.createElement('div');
    card.style.cssText = `
      background: white;
      border-radius: 12px;
      padding: 16px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      border-left: 4px solid #f97316;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
    `;

    const icon = document.createElement('div');
    icon.style.cssText = `
      width: 40px;
      height: 40px;
      background: linear-gradient(135deg, #f97316, #ea580c);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: bold;
    `;
    icon.textContent = '⚔️';

    const title = document.createElement('h4');
    title.style.cssText = 'margin: 0; color: #1f2937; font-size: 18px;';
    title.textContent = 'Head-to-Head History';

    header.appendChild(icon);
    header.appendChild(title);
    card.appendChild(header);

    const sections = [
      { title: 'Recent Meetings', data: data.H2H, color: '#3b82f6' },
      { title: 'First Team Recent', data: data.firstTeamResults, color: '#10b981' },
      { title: 'Second Team Recent', data: data.secondTeamResults, color: '#ef4444' }
    ];

    sections.forEach(section => {
      if(Array.isArray(section.data) && section.data.length > 0) {
        const sectionDiv = document.createElement('div');
        sectionDiv.style.cssText = 'margin-bottom: 20px;';

        const sectionTitle = document.createElement('h5');
        sectionTitle.style.cssText = `
          margin: 0 0 8px 0;
          color: ${section.color};
          font-size: 14px;
          font-weight: 600;
        `;
        sectionTitle.textContent = section.title;

        const matchesList = document.createElement('div');
        matchesList.style.cssText = 'space-y: 4px;';

        section.data.slice(0, 5).forEach(match => {
          const matchItem = document.createElement('div');
          matchItem.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px;
            background: #f9fafb;
            border-radius: 6px;
            margin-bottom: 4px;
            font-size: 12px;
          `;

          const date = match.event_date || match.date || '';
          const home = match.event_home_team || match.home_team || match.strHomeTeam || '';
          const away = match.event_away_team || match.away_team || match.strAwayTeam || '';
          const score = match.event_final_result || match.event_ft_result || 
                       (match.home_score != null && match.away_score != null ? 
                        `${match.home_score} - ${match.away_score}` : '');

          // Build row with logos and names
          const dateSpan = document.createElement('span'); dateSpan.style.cssText = 'color: #6b7280;'; dateSpan.textContent = date;

          const teamsWrap = document.createElement('div'); teamsWrap.style.cssText = 'display:flex;align-items:center;gap:8px;flex:1;justify-content:center;';

          const homeWrap = document.createElement('div'); homeWrap.style.cssText = 'display:flex;align-items:center;gap:8px;';
          const homeLogo = document.createElement('img'); homeLogo.src = match.home_team_logo || match.homeTeamLogo || match.home_logo || match.home_team_image || '';
          homeLogo.style.cssText = 'width:28px;height:20px;object-fit:contain;border-radius:4px;'; homeLogo.onerror = () => homeLogo.remove();
          const homeNameEl = document.createElement('div'); homeNameEl.style.cssText = 'font-weight:600;color:#1f2937;font-size:13px;'; homeNameEl.textContent = home;
          homeWrap.appendChild(homeLogo); homeWrap.appendChild(homeNameEl);

          const vsEl = document.createElement('div'); vsEl.style.cssText = 'font-size:12px;color:#6b7280;font-weight:600;'; vsEl.textContent = 'vs';

          const awayWrap = document.createElement('div'); awayWrap.style.cssText = 'display:flex;align-items:center;gap:8px;';
          const awayLogo = document.createElement('img'); awayLogo.src = match.away_team_logo || match.awayTeamLogo || match.away_logo || match.away_team_image || '';
          awayLogo.style.cssText = 'width:28px;height:20px;object-fit:contain;border-radius:4px;'; awayLogo.onerror = () => awayLogo.remove();
          const awayNameEl = document.createElement('div'); awayNameEl.style.cssText = 'font-weight:600;color:#1f2937;font-size:13px;'; awayNameEl.textContent = away;
          awayWrap.appendChild(awayLogo); awayWrap.appendChild(awayNameEl);

          teamsWrap.appendChild(homeWrap); teamsWrap.appendChild(vsEl); teamsWrap.appendChild(awayWrap);

          const scoreSpan = document.createElement('span'); scoreSpan.style.cssText = 'color: #374151; font-weight: 600; min-width:60px; text-align:center;'; scoreSpan.textContent = score || 'vs';

          matchItem.appendChild(dateSpan);
          matchItem.appendChild(teamsWrap);
          matchItem.appendChild(scoreSpan);

          // Make row clickable to open match details if possible
          matchItem.style.cursor = 'pointer';
          matchItem.addEventListener('click', ()=>{
            try{ showDetails(match); }catch(e){ console.warn('showDetails error', e); }
          });

          matchesList.appendChild(matchItem);
        });

        sectionDiv.appendChild(sectionTitle);
        sectionDiv.appendChild(matchesList);
        card.appendChild(sectionDiv);
      }
    });

    return card;
  }

  // lightweight stubs for advanced features
  async function augmentEventTags(ev){ try{ /* no-op safe stub: in full app this calls ML service */ console.log('augmentEventTags', ev); }catch(e){ console.warn(e); } }
  async function runPlayerAnalytics(ev){ try{ console.log('runPlayerAnalytics', ev); alert('Player analytics not implemented in this build'); }catch(e){console.warn(e);} }
  async function runMultimodalExtract(ev){ try{ console.log('runMultimodalExtract', ev); alert('Multimodal extract not implemented'); }catch(e){console.warn(e);} }


  async function fetchHighlights(ev){
    const container = modalBody.querySelector('#highlights .hl-body');
    if(!container) return;
    container.textContent = 'Loading highlights...';

    // Build best-effort args for video.highlights (provide id and name when possible)
    const args = {};
    if(ev.idEvent) args.eventId = ev.idEvent;
    else if(ev.event_key) args.eventId = ev.event_key;
    // Use canonical event name when available
    const evtName = ev.strEvent || (ev.event_home_team && ev.event_away_team ? `${ev.event_home_team} vs ${ev.event_away_team}` : '');
    if(evtName) args.eventName = evtName;

    try{
      const resp = await fetch(apiBase + '/collect', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({intent: 'video.highlights', args}),
      });
      if(!resp.ok){ container.textContent = 'Highlights request failed: HTTP ' + resp.status; return; }
      const j = await resp.json();
      if(!j || !j.ok){
        // Router-level error or provider-level error
        const msg = (j && j.error && j.error.message) ? j.error.message : 'No highlights available';
        container.textContent = 'No highlights: ' + msg;
        return;
      }

      // Provider body lives in j.data
      const body = j.data || {};
      // Common shapes: { videos: [...] } (TSDB), or AllSports raw { result: [...] } or {events: [...]}
      let vids = body.videos || body.result || body.results || body.event || body.events || [];
      if(!Array.isArray(vids)) vids = [];
      if(vids.length === 0){ container.textContent = 'No highlights found.'; return; }

      renderHighlights(vids, container);
  // Append event-specific search UI beneath provider videos
  addEventHighlightSearchUI(container, ev);
    }catch(e){
      container.textContent = 'Highlights fetch error: ' + (e && e.message ? e.message : String(e));
    }
  }

  function renderHighlights(vids, container){
    container.innerHTML = '';
    const list = document.createElement('div');
    list.className = 'hl-list';
    vids.forEach(v => {
      const item = document.createElement('div');
      item.className = 'hl-item';
      const title = v.title || v.strTitle || v.strVideo || v.name || v.video_title || v.title_short || '';
      const url = v.strVideo || v.url || v.link || v.video_url || v.strYoutube || v.strYoutubeUrl || v.video || v.source || '';
      const thumb = v.strThumb || v.thumbnail || v.thumb || v.strThumbBig || v.cover || '';

      if(thumb){
        const img = document.createElement('img'); img.className = 'hl-thumb'; img.src = thumb; img.alt = title || 'highlight';
        img.onerror = () => img.remove();
        item.appendChild(img);
      }

      const meta = document.createElement('div'); meta.className = 'hl-meta';
      const t = document.createElement('div'); t.className = 'hl-title'; t.textContent = title || (url ? url : 'Video');
      meta.appendChild(t);

      if(url){
        const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'Open'; a.className = 'hl-link';
        meta.appendChild(a);
      }

      // provider info / duration
      const info = document.createElement('div'); info.className = 'hl-info';
      if(v.source) info.textContent = v.source; else if(v._source) info.textContent = v._source; else if(v._sources) info.textContent = String(v._sources.join(','));
      if(v.duration) info.textContent += (info.textContent ? ' • ' : '') + String(v.duration);
      if(info.textContent) meta.appendChild(info);

      item.appendChild(meta);
      list.appendChild(item);
    });
    container.appendChild(list);
    // Add event-specific search UI after list
    addEventHighlightSearchUI(container, currentEventContext);
  }

  // Hold current event for highlight search injection
  let currentEventContext = null;

  function addEventHighlightSearchUI(container, ev){
    currentEventContext = ev; // keep reference for later
    // Avoid duplicating UI if already added
    if(container.querySelector('.event-highlight-search')) return;
    const wrap = document.createElement('div');
    wrap.className = 'event-highlight-search';
    wrap.innerHTML = `
      <hr />
      <h4 style="margin-top:1em">Search Specific Event Highlight</h4>
      <form class="ehs-form" style="display:flex;flex-wrap:wrap;gap:.5rem;align-items:flex-end">
        <div style="display:flex;flex-direction:column">
          <label style="font-size:.75rem">Minute
            <input name="minute" type="number" min="1" max="130" style="width:5rem" placeholder="67" />
          </label>
        </div>
        <div style="display:flex;flex-direction:column">
          <label style="font-size:.75rem">Player
            <input name="player" type="text" placeholder="Player name" />
          </label>
        </div>
        <div style="display:flex;flex-direction:column">
          <label style="font-size:.75rem">Event Type
            <select name="event_type">
              <option value="">(auto)</option>
              <option value="goal">Goal</option>
              <option value="penalty goal">Penalty Goal</option>
              <option value="own goal">Own Goal</option>
              <option value="red card">Red Card</option>
              <option value="yellow card">Yellow Card</option>
              <option value="substitution">Substitution</option>
              <option value="VAR">VAR</option>
            </select>
          </label>
        </div>
        <button type="submit">Search</button>
        <button type="button" data-action="openYt">Open YouTube Search</button>
      </form>
      <div class="ehs-status" style="font-size:.8rem;color:#555;margin-top:.25rem">Enter details & press Search.</div>
      <div class="ehs-results" style="margin-top:.5rem"></div>
    `;
    container.appendChild(wrap);

    const form = wrap.querySelector('form');
    const status = wrap.querySelector('.ehs-status');
    const resultsDiv = wrap.querySelector('.ehs-results');
    const ytBtn = form.querySelector('button[data-action="openYt"]');
    ytBtn.addEventListener('click', ()=>{
      const baseQuery = buildBaseQuery(ev, form.minute.value, form.player.value, form.event_type.value);
      window.open('https://www.youtube.com/results?search_query=' + encodeURIComponent(baseQuery), '_blank');
    });

    form.addEventListener('submit', async (e)=>{
      e.preventDefault();
      resultsDiv.innerHTML = '';
      status.textContent = 'Searching...';
      try{
        const params = new URLSearchParams();
        params.set('home', ev.event_home_team || ev.strHomeTeam || '');
        params.set('away', ev.event_away_team || ev.strAwayTeam || '');
        if(ev.event_date) params.set('date', ev.event_date);
        const minute = form.minute.value.trim(); if(minute) params.set('minute', minute);
        const player = form.player.value.trim(); if(player) params.set('player', player);
        const eventType = form.event_type.value.trim(); if(eventType) params.set('event_type', eventType);
        const url = apiBase + '/highlight/event?' + params.toString();
        const r = await fetch(url);
        if(!r.ok) throw new Error('HTTP '+r.status);
        const j = await r.json();
        if(!j || j.ok === false) throw new Error(j && j.error && j.error.message ? j.error.message : 'Search failed');
        status.textContent = 'Query: ' + (j.query || '(unknown)') + ' — Variants: ' + (j.variants ? j.variants.length : 0);
        renderEventHighlightResults(j, resultsDiv);
      }catch(err){
        status.textContent = 'Error: ' + (err && err.message ? err.message : String(err));
      }
    });
  }

  function buildBaseQuery(ev, minute, player, eventType){
    const home = ev.event_home_team || ev.strHomeTeam || '';
    const away = ev.event_away_team || ev.strAwayTeam || '';
    const date = ev.event_date || '';
    const year = date.slice(0,4);
    const parts = [home + ' vs ' + away];
    if(minute) parts.push(minute + "'");
    if(player) parts.push(player);
    if(eventType) parts.push(eventType);
    if(year) parts.push(year);
    return parts.filter(Boolean).join(' ');
  }

  function renderEventHighlightResults(j, root){
    root.innerHTML = '';
    const scraped = (j.results && j.results.duckduckgo_scraped) || [];
    // Quick filter: if minute specified, prefer titles containing that minute
    // (basic heuristic, can be improved)
    // Display scraped results
    if(scraped.length){
      const list = document.createElement('div'); list.className='ehs-list';
      scraped.forEach(r=>{
        const row = document.createElement('div'); row.className='ehs-item';
        const a = document.createElement('a'); a.href = r.url; a.textContent = r.title || r.url; a.target='_blank'; a.rel='noopener noreferrer';
        row.appendChild(a);
        if(r.videoId){
          const small = document.createElement('span'); small.style.fontSize='.7rem'; small.style.marginLeft='.5rem'; small.textContent='('+r.videoId+')';
          row.appendChild(small);
        }
        list.appendChild(row);
      });
      root.appendChild(list);
    } else {
      const none = document.createElement('div'); none.textContent='No direct video links scraped. Use search links below.'; root.appendChild(none);
    }
    // Always append fallback search links
    const links = document.createElement('div'); links.className='ehs-links'; links.style.marginTop='.5rem';
    const yt = document.createElement('a'); yt.href = j.results.youtube_search_url; yt.target='_blank'; yt.rel='noopener'; yt.textContent='Open YouTube Search'; links.appendChild(yt);
    const web = document.createElement('a'); web.href = j.results.duckduckgo_search_url; web.target='_blank'; web.rel='noopener'; web.style.marginLeft='1rem'; web.textContent='Open Web Search'; links.appendChild(web);
    root.appendChild(links);
  }

  // ---------- Extras: teams, players, league table, odds, probabilities, comments, seasons ----------
  function _pick(obj, keys){ for(const k of keys) if(obj && obj[k]) return obj[k]; return undefined; }

  async function fetchExtras(ev){
    const extrasRoot = modalBody.querySelector('#extras');
    if(!extrasRoot) return;

    // helper: create a titled section with .extra-section and inner .body
    function createSection(title){
      const sec = document.createElement('div'); sec.className='extra-section';
      const h = document.createElement('h4'); h.textContent = title; sec.appendChild(h);
      const body = document.createElement('div'); body.className='body'; body.textContent = 'Loading...'; sec.appendChild(body);
      return {sec, body};
    }

    const get = (klist) => _pick(ev, klist) || '';
    const eventId = get(['idEvent','event_key','id']);
    const leagueId = get(['league_key','idLeague']);
    const leagueName = get(['league_name','strLeague']);
    const homeName = get(['event_home_team','strHomeTeam']);
    const awayName = get(['event_away_team','strAwayTeam']);

    // Helper to call /collect
    async function callIntent(intent, args){
      const resp = await fetch(apiBase + '/collect', {
        method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({intent, args})
      });
      if(!resp.ok) throw new Error('HTTP '+resp.status+' for '+intent);
      return resp.json();
    }

    // Ensure extras container has expected sections (teams, players, league_table, odds, prob, comments, seasons)
    const extrasBody = modalBody.querySelector('#extras .extras-body');
    if(!extrasBody) return;
  // Force a single-column vertical layout for extras to match timeline style
  extrasBody.style.cssText = 'display:flex;flex-direction:column;gap:12px;';

    function ensureSection(id, title){
      let sec = modalBody.querySelector('#'+id);
      if(!sec){ const s = createSection(title); sec = s.sec; sec.id = id; extrasBody.appendChild(sec); return s.body; }
      const body = sec.querySelector('.body'); if(!body){ const b = document.createElement('div'); b.className='body'; sec.appendChild(b); return b; } return body;
    }

    // Teams: try to fetch team.get / teams.list for home and away
    const teamsBody = ensureSection('teams_section','Teams');
    teamsBody.textContent = 'Loading teams...';
    try{
      const p = [];
      if(homeName) p.push(callIntent('team.get', {teamName: homeName}));
      if(awayName) p.push(callIntent('team.get', {teamName: awayName}));
      const res = await Promise.allSettled(p);
      teamsBody.innerHTML = '';
      res.forEach((r, idx)=>{
        const title = idx===0 ? (homeName||'Home') : (awayName||'Away');
        const teamCard = createTeamCard(title, r);
        teamsBody.appendChild(teamCard);
      });
  // Attach raw toggle showing the underlying responses
  attachRawToggle(teamsBody, res, 'teams');
    }catch(e){ teamsBody.textContent = 'Teams error: '+e.message; }

    // Players: try players.list for each teamName if available
  const playersBody = ensureSection('players_section','Players');
  playersBody.textContent = 'Loading players...';
    try{
      const tasks = [];
      if(homeName) tasks.push(callIntent('players.list',{teamName: homeName}));
      if(awayName) tasks.push(callIntent('players.list',{teamName: awayName}));
      const rr = await Promise.allSettled(tasks);
      playersBody.innerHTML = '';
      rr.forEach((r, idx)=>{
        const lbl = idx===0 ? (homeName||'Home') : (awayName||'Away');
        const playerCard = createPlayersCard(lbl, r);
        playersBody.appendChild(playerCard);
      });
  // Raw view for players
  attachRawToggle(playersBody, rr, 'players');
        // Build a normalized players map on the event object so tooltips can find images by player name
        try{
          const allPlayers = [];
          rr.forEach(r => {
            if(r && r.status === 'fulfilled' && r.value){ const v = r.value; const arr = v.data?.result || v.data?.results || v.data?.players || v.data || v.result || v.players || []; if(Array.isArray(arr)) allPlayers.push(...arr); }
          });
          if(allPlayers.length>0){
            // attach to ev for local lookup
            const map = {};
            allPlayers.forEach(p=>{
              const name = (p.player_name || p.name || p.strPlayer || p.player || '').trim();
              if(!name) return;
              map[name] = p;
              map[name.toLowerCase()] = p;
            });
            ev._playersMap = map;
          }
        }catch(_e){ /* ignore */ }
    }catch(e){ playersBody.textContent = 'Players error: '+e.message; }

    // League table
  const tableBody = ensureSection('league_table_section','League Table');
  tableBody.textContent = 'Loading league table...';
    try{
      const args = {};
      if(leagueId) args.leagueId = leagueId; else if(leagueName) args.leagueName = leagueName;
      const j = await callIntent('league.table', args);
      tableBody.innerHTML = '';
      if(j && j.ok){ 
        const tableCard = createLeagueTableCard(j.data || j.result || {});
        tableBody.appendChild(tableCard);
      } else {
        const noData = document.createElement('div');
        noData.style.cssText = 'color: #6b7280; font-style: italic; text-align: center; padding: 20px;';
        noData.textContent = 'No table available';
        tableBody.appendChild(noData);
      }
  // Raw league table
  attachRawToggle(tableBody, j, 'league_table');
    }catch(e){ tableBody.textContent = 'League table error: '+e.message; }

    // Odds (list + live)
  const oddsBody = ensureSection('odds_section','Odds');
  oddsBody.textContent = 'Loading odds...';
    try{
      const args = {};
      if(eventId) args.matchId = eventId; else if(ev.event_date) args.date = ev.event_date;
      const [listJ, liveJ] = await Promise.allSettled([callIntent('odds.list', args), callIntent('odds.live', args)]);
      oddsBody.innerHTML = '';
      
      // Try to get odds data from either response
      let oddsData = null;
      [listJ, liveJ].forEach((r) => {
        if(r.status === 'fulfilled' && r.value && r.value.ok && !oddsData) {
          oddsData = r.value.data || r.value.result || {};
        }
      });
      
  // Pre-match odds card (odds.list)
  const preCard = createOddsCard('Pre-Match Odds', listJ);
  oddsBody.appendChild(preCard);
  // Live odds card (odds.live)
  const liveCard = createOddsCard('Live Odds', liveJ);
  oddsBody.appendChild(liveCard);
  // Raw odds responses
  attachRawToggle(oddsBody, [listJ, liveJ], 'odds');
    }catch(e){ oddsBody.textContent = 'Odds error: '+e.message; }

    // Probabilities
  const probBody = ensureSection('prob_section','Probabilities');
  probBody.textContent = 'Loading probabilities...';
    try{
      const args = eventId ? {matchId: eventId} : (leagueId ? {leagueId} : {});
      const j = await callIntent('probabilities.list', args);
      probBody.innerHTML = '';
      if(j && j.ok) {
        const baseHints = {
          event_key:        ev.idEvent || ev.event_key || ev.id || ev.match_id || '',
          event_home_team:  ev.event_home_team || ev.strHomeTeam || ev.home_team || '',
          event_away_team:  ev.event_away_team || ev.strAwayTeam || ev.away_team || '',
          home_team_logo:   ev.home_team_logo || ev.strHomeTeamBadge || ev.homeBadge || ev.home_logo || ev.team_home_badge || '',
          away_team_logo:   ev.away_team_logo || ev.strAwayTeamBadge || ev.awayBadge || ev.away_logo || ev.team_away_badge || '',
          country_name:     ev.country_name || ev.strCountry || ev.country || ev.event_country || ''
        };
        const probCard = createProbabilitiesCard(Object.assign({}, baseHints, j.data || j.result || {}));
        probBody.appendChild(probCard);
      } else {
        const noData = document.createElement('div');
        noData.style.cssText = 'color: #6b7280; font-style: italic; text-align: center; padding: 20px;';
        noData.textContent = 'No probabilities available';
        probBody.appendChild(noData);
      }
  // Raw probabilities
  attachRawToggle(probBody, j, 'probabilities');
    }catch(e){ probBody.textContent = 'Probabilities error: '+e.message; }

    // Comments
  const commBody = ensureSection('comments_section','Comments');
  commBody.textContent = 'Loading comments...';
    try{
      const args = {};
      if(eventId) args.matchId = eventId; else if(ev.event_home_team) args.eventName = ev.event_home_team + ' vs ' + (ev.event_away_team || '');
      const j = await callIntent('comments.list', args);
      commBody.innerHTML = '';
      if(j && j.ok) {
        const commentsCard = createCommentsCard(j.data || j.result || {});
        commBody.appendChild(commentsCard);
      } else {
        const noData = document.createElement('div');
        noData.style.cssText = 'color: #6b7280; font-style: italic; text-align: center; padding: 20px;';
        noData.textContent = 'No comments available';
        commBody.appendChild(noData);
      }
  // Raw comments
  attachRawToggle(commBody, j, 'comments');
    }catch(e){ commBody.textContent = 'Comments error: '+e.message; }

    // Seasons (leagues.list raw)
  const seasBody = ensureSection('seasons_section','Seasons');
  seasBody.textContent = 'Loading seasons...';
    try{
      const args = {};
      if(leagueId) args.leagueId = leagueId; else if(leagueName) args.leagueName = leagueName;
      const j = await callIntent('seasons.list', args);
      seasBody.innerHTML = '';
      if(j && j.ok) {
        const seasonsCard = createSeasonsCard(j.data || j.result || {});
        seasBody.appendChild(seasonsCard);
      } else {
        const noData = document.createElement('div');
        noData.style.cssText = 'color: #6b7280; font-style: italic; text-align: center; padding: 20px;';
        noData.textContent = 'No seasons info available';
        seasBody.appendChild(noData);
      }
  // Raw seasons
  attachRawToggle(seasBody, j, 'seasons');
    }catch(e){ seasBody.textContent = 'Seasons error: '+e.message; }

    // H2H (Head-to-Head) — use AllSports via intent 'h2h'
  const h2hContainer = document.createElement('div'); h2hContainer.className='extra-section';
    const h2hTitle = document.createElement('h4'); h2hTitle.textContent = 'H2H (Head-to-Head)'; h2hContainer.appendChild(h2hTitle);
    const h2hBody = document.createElement('div'); h2hBody.className='body'; h2hBody.textContent = 'Loading H2H...'; h2hContainer.appendChild(h2hBody);
  extrasBody.appendChild(h2hContainer);
    try{
      // Resolve team ids: provider fields use home_team_key / away_team_key or home_team_id / away_team_id
      const firstTeamId = ev.home_team_key || ev.home_team_id || ev.homeId || ev.homeTeamId || ev.home_team || ev.strHomeTeam || '';
      const secondTeamId = ev.away_team_key || ev.away_team_id || ev.awayId || ev.awayTeamId || ev.away_team || ev.strAwayTeam || '';
      const args = {};
      // If numeric keys exist use them, otherwise try to pass teamName (agent will attempt resolution)
      if(firstTeamId && String(firstTeamId).match(/^\d+$/)) args.firstTeamId = String(firstTeamId);
      else if(ev.event_home_team) args.firstTeamId = ev.event_home_team;
      else if(ev.strHomeTeam) args.firstTeamId = ev.strHomeTeam;
      if(secondTeamId && String(secondTeamId).match(/^\d+$/)) args.secondTeamId = String(secondTeamId);
      else if(ev.event_away_team) args.secondTeamId = ev.event_away_team;
      else if(ev.strAwayTeam) args.secondTeamId = ev.strAwayTeam;

      // callIntent defined above in fetchExtras scope
      const j = await callIntent('h2h', args);
      h2hBody.innerHTML = '';
      if(j && j.ok && j.data){
        // Provider raw body in j.data — try to render H2H/result fields
        const d = j.data || {};
        const res = d.result || d.data || d || {};
        
    // Create H2H card with the provider result object (history.js expects data.H2H / firstTeamResults / secondTeamResults)
    const h2hCard = createH2HCard(res);
        h2hBody.appendChild(h2hCard);
      } else {
        const noData = document.createElement('div');
        noData.style.cssText = 'color: #6b7280; font-style: italic; text-align: center; padding: 20px;';
        noData.textContent = 'No H2H: ' + (j && j.error && j.error.message ? j.error.message : 'no data');
        h2hBody.appendChild(noData);
      }
  // Raw H2H
  attachRawToggle(h2hBody, j, 'h2h');
    }catch(e){ h2hBody.textContent = 'H2H error: '+(e && e.message?e.message:String(e)); }
  }

  async function fetchSummary(){
    const date = datePicker.value || '';
  const endpoints = ['/matches/details','/matches/details/','/matches/summary','/matches/summary/','/matches/detail','/matches','/matches/'];
    statusEl.textContent = 'Loading...';
    let lastErr = null;
    for(const ep of endpoints){
      try{
        const url = new URL(apiBase + ep);
        if(date) url.searchParams.set('date', date);
        const r = await fetch(url.toString());
        if(!r.ok) { lastErr = new Error('HTTP '+r.status+' '+ep); continue; }
        const data = await r.json();
  console.log('[matches] success via', ep);
  render(data);
        statusEl.textContent = 'Updated '+ new Date().toLocaleTimeString();
        return;
      }catch(e){ lastErr = e; }
    }
    console.error(lastErr); statusEl.textContent = 'Error: '+ (lastErr? lastErr.message : 'unknown');
  }

  function clear(el){ while(el.firstChild) el.removeChild(el.firstChild); }

  // Create a match card by cloning the template in matches.html
  function createCard(ev){
    const tpl = document.getElementById('cardTemplate');
    if(!tpl) return document.createElement('div');
    const node = tpl.content.firstElementChild.cloneNode(true);

    const leagueEl = node.querySelector('.league');
    const statusElLocal = node.querySelector('.status');
    const homeNameEl = node.querySelector('.homeName');
    const awayNameEl = node.querySelector('.awayName');
    const homeLogo = node.querySelector('.homeLogo');
    const awayLogo = node.querySelector('.awayLogo');
    const homeScoreEl = node.querySelector('.homeScore');
    const awayScoreEl = node.querySelector('.awayScore');
    const timeEl = node.querySelector('.time');
    const detailsBtn = node.querySelector('.detailsBtn');

    // Fill fields with best-effort mappings
    const _league2 = ev.league_name || ev.strLeague || '';
    const _country2 = ev.country_name || ev.strCountry || ev.country || '';
    leagueEl.textContent = (_country2 && _league2) ? (_country2 + ' — ' + _league2) : _league2;
    statusElLocal.textContent = ev.event_status || ev.status || '';
    homeNameEl.textContent = ev.event_home_team || ev.strHomeTeam || ev.home_team || '';
    awayNameEl.textContent = ev.event_away_team || ev.strAwayTeam || ev.away_team || '';

    const homeLogoUrl = ev.home_team_logo || ev.strHomeTeamBadge || ev.homeLogo || ev.home_badge || '';
    const awayLogoUrl = ev.away_team_logo || ev.strAwayTeamBadge || ev.awayLogo || ev.away_badge || '';
    if(homeLogoUrl){ homeLogo.src = homeLogoUrl; homeLogo.style.display = ''; homeLogo.onerror = ()=> homeLogo.remove(); } else { homeLogo.remove(); }
    if(awayLogoUrl){ awayLogo.src = awayLogoUrl; awayLogo.style.display = ''; awayLogo.onerror = ()=> awayLogo.remove(); } else { awayLogo.remove(); }

    // Score heuristics
    if(ev.event_final_result && ev.event_final_result.includes('-')){
      const parts = ev.event_final_result.split('-');
      homeScoreEl.textContent = parts[0]?.trim() || '-'; awayScoreEl.textContent = parts[1]?.trim() || '-';
    } else if(ev.home_score !== undefined && ev.away_score !== undefined){ homeScoreEl.textContent = String(ev.home_score); awayScoreEl.textContent = String(ev.away_score); }

    timeEl.textContent = ev.event_time || ev.strTime || ev.event_date || '';

    if(detailsBtn) detailsBtn.addEventListener('click', ()=> showDetails(ev));
    return node;
  }

  function render(summary){
    clear(liveListEl); clear(finishedListEl);
    const live = summary.live || [];
    const finished = summary.finished || [];
    liveCountEl.textContent = live.length;
    finishedCountEl.textContent = finished.length;

    if(!live.length){ liveListEl.classList.add('empty'); liveListEl.textContent='No live matches.'; } else { liveListEl.classList.remove('empty'); }
    if(!finished.length){ finishedListEl.classList.add('empty'); finishedListEl.textContent='No finished matches.'; } else { finishedListEl.classList.remove('empty'); }

    live.forEach(ev=> liveListEl.appendChild(createCard(ev)));
    finished.forEach(ev=> finishedListEl.appendChild(createCard(ev)));
  }

  refreshBtn.addEventListener('click', fetchSummary);
  datePicker.addEventListener('change', fetchSummary);

  // default date = today
  const today = new Date().toISOString().slice(0,10); datePicker.value = today;
  // Initial load
  fetchSummary();

})();

