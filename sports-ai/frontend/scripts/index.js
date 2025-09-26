/* Home page logic: live ticker, leagues row, league matches + date filter */
(function(){
  // Base URL detection (same pattern as matches/history pages)
  const loc = window.location;
  let apiBase = loc.origin;
  if(loc.port && loc.port !== '8000'){
    apiBase = loc.protocol + '//' + loc.hostname + ':8000';
  }

  // Elements
  const tickerRow = document.getElementById('liveTicker');
  const tickerStatus = document.getElementById('tickerStatus');
  const liveOnlyToggle = document.getElementById('liveOnlyToggle');
  const refreshTickerBtn = document.getElementById('refreshTickerBtn');

  const leaguesRow = document.getElementById('leaguesRow');
  const leagueSearch = document.getElementById('leagueSearch');

  const leagueMatches = document.getElementById('leagueMatches');
  const selectedLeagueTitle = document.getElementById('selectedLeagueTitle');
  const matchesStatus = document.getElementById('matchesStatus');

  const datePicker = document.getElementById('datePicker');
  const applyFilterBtn = document.getElementById('applyFilterBtn');

  const nlSearchInput = document.getElementById('nlSearch');
  const nlSearchBtn = document.getElementById('nlSearchBtn');
  const nlStatus = document.getElementById('nlStatus');
  const nlResults = document.getElementById('nlResults');
  const nlCount = document.getElementById('nlCount');

  let allLeagues = [];
  let filteredLeagues = [];
  let selectedLeague = null; // { id, label }

  // Helpers
  function clear(el){ while(el && el.firstChild) el.removeChild(el.firstChild); }
  function set(el, text){ if(el) el.textContent = text; }

  // Generic /collect caller
  async function callIntent(intent, args){
    const resp = await fetch(apiBase + '/collect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent, args })
    });
    if(!resp.ok) throw new Error(`HTTP ${resp.status} for ${intent}`);
    return resp.json();
  }

  // ===== Live ticker =====
  let lastTickerSummary = null;

  async function loadTicker(){
    set(tickerStatus, 'Loading…');
    const endpoints = ['/matches/details','/matches/details/','/matches/summary','/matches/summary/','/matches/detail','/matches','/matches/'];
    let lastErr = null;
    for(const ep of endpoints){
      try{
        const r = await fetch(apiBase + ep);
        if(!r.ok) { lastErr = new Error('HTTP '+r.status+' '+ep); continue; }
        const data = await r.json();
        lastTickerSummary = data || {};
        renderTicker(lastTickerSummary);
        set(tickerStatus, 'Updated ' + new Date().toLocaleTimeString());
        return;
      }catch(e){ lastErr = e; }
    }
    console.error('Ticker failed:', lastErr);
    set(tickerStatus, 'Error');
  }

  function renderTicker(summary){
    clear(tickerRow);
    // Backend returns { live: [...], finished: [...] } via /matches/details.
    // Older variants might expose 'upcoming'. Merge live + (upcoming|finished).
    const live = Array.isArray(summary.live) ? summary.live : [];
    const upcoming = Array.isArray(summary.upcoming) ? summary.upcoming : [];
    const finished = Array.isArray(summary.finished) ? summary.finished : [];
    const all = live.concat(upcoming, finished);
    const items = liveOnlyToggle && liveOnlyToggle.checked ? live : all;
    if(!items.length){
      const msg = document.createElement('div');
      msg.className = 'empty';
      msg.textContent = 'No matches to show.';
      tickerRow.appendChild(msg);
      return;
    }
    items.forEach(ev => tickerRow.appendChild(createTickerCard(ev)));
  }

  function createTickerCard(ev){
    const card = document.createElement('div');
    card.className = 'ticker-card';

    const leagueName = ev.league_name || ev.strLeague || '';
    const country = ev.country_name || ev.strCountry || ev.country || '';
    const status = ev.event_status || ev.status || '';
    const home = ev.event_home_team || ev.strHomeTeam || ev.home_team || '';
    const away = ev.event_away_team || ev.strAwayTeam || ev.away_team || '';
    const homeLogo = ev.home_team_logo || ev.strHomeTeamBadge || ev.home_badge || '';
    const awayLogo = ev.away_team_logo || ev.strAwayTeamBadge || ev.away_badge || '';
    let hScore = '', aScore = '';
    if(ev.event_final_result && ev.event_final_result.includes('-')){
      const [h,a] = ev.event_final_result.split('-'); hScore = (h||'').trim(); aScore = (a||'').trim();
    } else if(ev.home_score !== undefined && ev.away_score !== undefined){ hScore = String(ev.home_score); aScore = String(ev.away_score); }

    const top = document.createElement('div');
    top.className = 'ticker-top';
    const leagueLabel = country && leagueName ? `${country} — ${leagueName}` : (leagueName || country || '');
    top.innerHTML = `<span>${leagueLabel || '&nbsp;'}</span><span class="badge">${status || '—'}</span>`;

    const teams = document.createElement('div');
    teams.className = 'ticker-teams';
    teams.innerHTML = `
      <div class="t-team">
        ${homeLogo ? `<img class="t-logo" src="${homeLogo}" alt="${home} logo" onerror="this.remove()"/>` : ''}
        <div class="t-name" title="${home}">${home}</div>
      </div>
      <div class="t-score">${hScore || '-'} : ${aScore || '-'}</div>
      <div class="t-team" style="justify-content:flex-end">
        <div class="t-name" title="${away}" style="text-align:right">${away}</div>
        ${awayLogo ? `<img class="t-logo" src="${awayLogo}" alt="${away} logo" onerror="this.remove()"/>` : ''}
      </div>`;

    card.appendChild(top);
    card.appendChild(teams);
    card.tabIndex = 0;
    card.addEventListener('click', ()=> navigateToDetails(ev));
    card.addEventListener('keypress', (e)=>{ if(e.key==='Enter') navigateToDetails(ev); });
    return card;
  }

  // ===== Leagues =====
  async function loadLeagues(){
    try{
      const r = await fetch(apiBase + '/leagues');
      const j = await r.json();
      const list = (j && j.ok && j.data && (j.data.result || j.data.leagues)) || [];
      allLeagues = Array.isArray(list) ? list : [];
      filteredLeagues = allLeagues.slice();
      renderLeagues();
    }catch(e){
      console.error('Leagues error', e);
      leaguesRow.innerHTML = '<div class="empty">Unable to load leagues</div>';
    }
  }

  function getLeagueId(L){ return L.league_key || L.league_id || L.id || L.key || ''; }
  function getLeagueLabel(L){
    const name = L.league_name || L.strLeague || 'Unknown League';
    const country = L.country_name || L.strCountry || '';
    return country ? `${country} — ${name}` : name;
  }
  function isPopular(name){
    const popular = ['Premier League','UEFA Champions League','La Liga','Serie A','Bundesliga','Ligue 1','Europa League'];
    const s = (name||'').toLowerCase();
    return popular.some(p=> s.includes(p.toLowerCase()));
  }

  function renderLeagues(){
    clear(leaguesRow);
    if(!filteredLeagues.length){ leaguesRow.innerHTML = '<div class="empty">No leagues</div>'; return; }
    // Sort: popular first then alpha by label
    const uniqMap = new Map();
    filteredLeagues.forEach(L=>{ const id = String(getLeagueId(L)); if(!uniqMap.has(id)) uniqMap.set(id, L); });
    const uniq = Array.from(uniqMap.values());
    uniq.sort((a,b)=>{
      const la = getLeagueLabel(a); const lb = getLeagueLabel(b);
      const pa = isPopular(la) ? 0 : 1; const pb = isPopular(lb) ? 0 : 1;
      if(pa !== pb) return pa - pb; return la.localeCompare(lb);
    });
    uniq.forEach(L => leaguesRow.appendChild(createLeagueChip(L)));
  }

  function getLeagueLogo(L){
    if(!L) return '';
    const raw = (L.league_logo || L.league_logo_url || '').trim();
    // AllSports sometimes returns just the base path; build a best-effort URL using key + slug
    if(raw && !/\/logo_leagues\/$/.test(raw)) return raw; // looks like a real file path
    const key = String(L.league_key || L.league_id || '').trim();
    const name = String(L.league_name || L.strLeague || '').trim();
    if(raw && /\/logo_leagues\/$/.test(raw) && key && name){
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
      return `${raw}${key}_${slug}.png`;
    }
    // TSDB / others
    const fallbacks = ['league_badge','leagueCrest','logo','badge','image','strLogo','strBadge','strBadgeWide','country_logo'];
    for(const k of fallbacks){
      const v = L[k]; if(typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  }

  function createLeagueChip(L){
    const chip = document.createElement('button');
    chip.className = 'league-chip';
    const label = getLeagueLabel(L);
    const id = getLeagueId(L);

    const icon = document.createElement('span');
    icon.className='chip-icon';
    const logo = getLeagueLogo(L);
    if(logo){
      const img = document.createElement('img');
      img.src = logo; img.alt = (label||'') + ' logo';
      img.loading = 'lazy';
      img.onerror = function(){ this.remove(); icon.textContent = (label||'?').slice(0,2).toUpperCase(); };
      icon.appendChild(img);
    } else {
      icon.textContent = (label || '?').slice(0,2).toUpperCase();
    }

    const text = document.createElement('span'); text.textContent = label;
    chip.appendChild(icon); chip.appendChild(text);
    chip.setAttribute('role','listitem');
    chip.addEventListener('click', ()=> selectLeague({id, label}));
    if(selectedLeague && selectedLeague.id === id) chip.classList.add('active');
    return chip;
  }

  function selectLeague(league){
    selectedLeague = league; // {id,label}
    // update active state
    Array.from(leaguesRow.children).forEach(c=> c.classList.toggle('active', c.querySelector('span+span')?.textContent === league.label));
    set(selectedLeagueTitle, league.label);
    loadLeagueMatches();
  }

  // ===== League matches with date filter =====
  async function loadLeagueMatches(){
    if(!selectedLeague){ clear(leagueMatches); set(matchesStatus, ''); return; }
    clear(leagueMatches); set(matchesStatus, 'Loading…');
    const date = datePicker.value || new Date().toISOString().slice(0,10);
    const args = { leagueId: selectedLeague.id, from: date, to: date };
    try{
      let res = await callIntent('events.list', args);
      let matches = (res && res.ok && res.data && (res.data.result || res.data.events || res.data.results)) || [];
      if(!Array.isArray(matches) || matches.length === 0){
        res = await callIntent('fixtures.list', args);
        matches = (res && res.ok && res.data && (res.data.result || res.data.events || res.data.results)) || [];
      }
      renderLeagueMatches(Array.isArray(matches)? matches : []);
      set(matchesStatus, `Updated ${new Date().toLocaleTimeString()}`);
    }catch(e){
      console.error('League matches error', e);
      set(matchesStatus, 'Error');
      leagueMatches.innerHTML = '<div class="empty">Unable to load matches</div>';
    }
  }

  function renderLeagueMatches(list){
    clear(leagueMatches);
    if(!list.length){ leagueMatches.innerHTML = '<div class="empty">No matches for selected date.</div>'; return; }
    list.forEach(ev => leagueMatches.appendChild(createMatchCard(ev)));
  }

  function createMatchCard(ev){
    const card = document.createElement('div');
    card.className = 'match-card';
    const leagueName = ev.league_name || ev.strLeague || '';
    const country = ev.country_name || ev.strCountry || ev.country || '';
    const leagueLabel = country && leagueName ? `${country} — ${leagueName}` : (leagueName || country || '');
    const status = ev.event_status || ev.status || '';
    const time = ev.event_time || ev.strTime || ev.event_date || ev.dateEvent || '';
    const home = ev.event_home_team || ev.strHomeTeam || ev.home_team || '';
    const away = ev.event_away_team || ev.strAwayTeam || ev.away_team || '';
    const homeLogo = ev.home_team_logo || ev.strHomeTeamBadge || ev.home_badge || '';
    const awayLogo = ev.away_team_logo || ev.strAwayTeamBadge || ev.away_badge || '';
    let hScore = '-', aScore = '-';
    if(ev.event_final_result && ev.event_final_result.includes('-')){
      const [h,a] = ev.event_final_result.split('-'); hScore = (h||'-').trim(); aScore = (a||'-').trim();
    } else if(ev.home_score !== undefined && ev.away_score !== undefined){ hScore = String(ev.home_score); aScore = String(ev.away_score); }

    const top = document.createElement('div'); top.className = 'match-top';
    top.innerHTML = `<span>${leagueLabel || '&nbsp;'}</span><span class="badge">${status || '—'}</span>`;

    const teams = document.createElement('div'); teams.className = 'teams';
    teams.innerHTML = `
      <div class="team">
        ${homeLogo ? `<img class="logo" src="${homeLogo}" alt="${home} logo" onerror="this.remove()"/>` : ''}
        <div class="name" title="${home}">${home}</div>
      </div>
      <div class="score">${hScore} : ${aScore}</div>
      <div class="team" style="justify-content:flex-end">
        <div class="name" style="text-align:right" title="${away}">${away}</div>
        ${awayLogo ? `<img class="logo" src="${awayLogo}" alt="${away} logo" onerror="this.remove()"/>` : ''}
      </div>`;

    const meta = document.createElement('div'); meta.className = 'meta';
    meta.innerHTML = `<span>${time || ''}</span>`;

    card.appendChild(top); card.appendChild(teams); card.appendChild(meta);
    card.tabIndex = 0;
    card.addEventListener('click', ()=> navigateToDetails(ev));
    card.addEventListener('keypress', (e)=>{ if(e.key==='Enter') navigateToDetails(ev); });
    return card;
  }

  function extractEventId(ev){
    return ev.idEvent || ev.event_key || ev.eventId || ev.match_id || ev.id || ev.fixture_id || ev.game_id || ev.tsdb_event_id || '';
  }

  function navigateToDetails(ev){
    try{
      const sid = Math.random().toString(36).slice(2);
      sessionStorage.setItem('sa_selected_event_' + sid, JSON.stringify(ev));
      const id = extractEventId(ev);
      const url = new URL('./match.html', window.location.href);
      url.searchParams.set('sid', sid);
      if(id) url.searchParams.set('eventId', String(id));
      window.location.href = url.toString();
    }catch(e){ console.error('navigateToDetails failed', e); }
  }

  // ===== Natural language search =====
  function describeSource(src){
    if(!src || typeof src !== 'object') return '';
    const primary = src.primary || '';
    const fallback = src.fallback ? ` → ${src.fallback}` : '';
    return (primary + fallback).trim();
  }

  function renderCandidateSummary(results){
    if(!Array.isArray(results) || results.length === 0) return null;
    const tried = results.map(r => {
      const label = r.reason || r.intent || 'intent';
      const status = r.ok ? '✓' : '×';
      return `${status} ${label}`;
    }).join(' · ');
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-top:12px;padding:10px 12px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0;font-size:12px;color:#64748b;';
    wrap.textContent = `Tried: ${tried}`;
    return wrap;
  }

  function renderNlMatches(hit){
    clear(nlResults);
    if(!hit || !Array.isArray(hit.items) || hit.items.length === 0){
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No matches found for that query.';
      nlResults.appendChild(empty);
      return;
    }
    const maxItems = 10;
    hit.items.slice(0, maxItems).forEach(ev => nlResults.appendChild(createMatchCard(ev)));
    if(hit.items.length > maxItems){
      const more = document.createElement('div');
      more.style.cssText = 'margin-top:8px;font-size:12px;color:#64748b;';
      more.textContent = `Showing ${maxItems} of ${hit.items.length} results.`;
      nlResults.appendChild(more);
    }
  }

  function renderHlResults(hit){
    clear(nlResults);
    if(!hit || !Array.isArray(hit.items) || hit.items.length === 0){
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No highlights found.';
      nlResults.appendChild(empty);
      return;
    }
    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:10px;';
    hit.items.slice(0, 8).forEach(v => {
      const card = document.createElement('a');
      card.style.cssText = 'display:flex;gap:12px;align-items:center;padding:12px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;text-decoration:none;color:#1f2937;box-shadow:0 1px 3px rgb(0 0 0 / 0.08);';
      card.target = '_blank';
      card.rel = 'noopener noreferrer';
      const url = v.strVideo || v.url || v.link || v.video_url || v.strYoutube || v.source || '';
      if(url) card.href = url;
      const thumb = v.strThumb || v.thumbnail || v.thumb || v.cover || '';
      if(thumb){
        const img = document.createElement('img');
        img.src = thumb;
        img.alt = v.title || v.strTitle || 'highlight';
        img.style.cssText = 'width:72px;height:48px;object-fit:cover;border-radius:8px;background:#e2e8f0;';
        img.onerror = () => img.remove();
        card.appendChild(img);
      }
      const meta = document.createElement('div');
      meta.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
      const title = document.createElement('div');
      title.style.cssText = 'font-weight:600;font-size:14px;';
      title.textContent = v.title || v.strTitle || v.name || 'Highlight';
      const desc = document.createElement('div');
      desc.style.cssText = 'font-size:12px;color:#64748b;';
      desc.textContent = v.description || v.strDescription || v.video_title || v.strCompetition || '';
      meta.appendChild(title);
      meta.appendChild(desc);
      card.appendChild(meta);
      list.appendChild(card);
    });
    nlResults.appendChild(list);
  }

  function renderGenericResult(hit){
    clear(nlResults);
    const pre = document.createElement('pre');
    pre.style.cssText = 'background:#0f172a;color:#e2e8f0;padding:12px;border-radius:10px;overflow:auto;font-size:12px;';
    try{
      pre.textContent = JSON.stringify(hit.items || hit.data || {}, null, 2);
    }catch(e){
      pre.textContent = 'Unsupported result format.';
    }
    nlResults.appendChild(pre);
  }

  function renderNlResults(resp){
    if(!resp){
      clear(nlResults);
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Search failed.';
      nlResults.appendChild(empty);
      set(nlCount, '0');
      return;
    }
    const hits = Array.isArray(resp.hits) ? resp.hits : [];
    const primary = hits[0];
    const statusNote = primary && (primary.reason || primary.intent);

    if(primary && primary.ok){
      set(nlCount, String(primary.count || 0));
      const source = describeSource(primary.source);
      set(nlStatus, `${statusNote || 'Results'}${source ? ' · ' + source : ''}`);
      const intent = String(primary.intent || '');
      if(/events|fixtures|h2h/.test(intent)){
        renderNlMatches(primary);
      }else if(intent === 'video.highlights'){
        renderHlResults(primary);
      }else{
        renderGenericResult(primary);
      }
    } else {
      set(nlCount, '0');
      const msg = primary && primary.error ? (primary.error.message || primary.error.code || 'No results') : 'No results found';
      set(nlStatus, msg);
      clear(nlResults);
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No results found. Try another query.';
      nlResults.appendChild(empty);
    }

    const summary = renderCandidateSummary(resp.results);
    if(summary){
      nlResults.appendChild(summary);
    }
  }

  async function performNlSearch(query){
    if(!nlResults) return;
    clear(nlResults);
    nlResults.innerHTML = '<div class="status">Searching…</div>';
    set(nlStatus, 'Searching…');
    set(nlCount, '0');
    try{
      const resp = await fetch(apiBase + '/search/nl', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ query }),
      });
      if(!resp.ok){
        throw new Error('HTTP ' + resp.status);
      }
      const data = await resp.json();
      renderNlResults(data);
    }catch(e){
      set(nlStatus, e && e.message ? e.message : 'Search error');
      clear(nlResults);
      const err = document.createElement('div');
      err.className = 'empty';
      err.textContent = 'Unable to complete search. Please try again.';
      nlResults.appendChild(err);
    }
  }

  function handleNlSubmit(){
    if(!nlSearchInput) return;
    const query = nlSearchInput.value.trim();
    if(!query){
      set(nlStatus, 'Enter a query to search.');
      set(nlCount, '0');
      clear(nlResults);
      const note = document.createElement('div');
      note.className = 'empty';
      note.textContent = 'Type a query and press Search.';
      nlResults.appendChild(note);
      nlSearchInput.focus();
      return;
    }
    performNlSearch(query);
  }


  // ===== Wire up =====
  // Do not auto-fetch; only fetch on explicit Refresh click.
  if(refreshTickerBtn) refreshTickerBtn.addEventListener('click', loadTicker);
  // Re-render locally when toggling live-only filter (no network call).
  if(liveOnlyToggle) liveOnlyToggle.addEventListener('change', ()=> renderTicker(lastTickerSummary || {}));
  leagueSearch.addEventListener('input', ()=>{
    const q = leagueSearch.value.trim().toLowerCase();
    if(!q){ filteredLeagues = allLeagues.slice(); }
    else {
      filteredLeagues = (allLeagues||[]).filter(L => getLeagueLabel(L).toLowerCase().includes(q));
    }
    renderLeagues();
  });

  if(nlSearchBtn) nlSearchBtn.addEventListener('click', handleNlSubmit);
  if(nlSearchInput) nlSearchInput.addEventListener('keydown', (e)=>{
    if(e.key === 'Enter'){ e.preventDefault(); handleNlSubmit(); }
  });

  applyFilterBtn.addEventListener('click', ()=> { if(selectedLeague) loadLeagueMatches(); });

  // Default date = today
  datePicker.value = new Date().toISOString().slice(0,10);

  // Initial loads (no ticker auto-fetch)
  set(tickerStatus, 'Idle — click Refresh');
  loadLeagues();
})();
