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

  const leaguesRow = document.getElementById('leaguesRow');
  const leagueSearch = document.getElementById('leagueSearch');

  const leagueMatches = document.getElementById('leagueMatches');
  const selectedLeagueTitle = document.getElementById('selectedLeagueTitle');
  const matchesStatus = document.getElementById('matchesStatus');

  const datePicker = document.getElementById('datePicker');
  const applyFilterBtn = document.getElementById('applyFilterBtn');

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
  async function loadTicker(){
    set(tickerStatus, 'Loading…');
    const endpoints = ['/matches/details','/matches/details/','/matches/summary','/matches/summary/','/matches/detail','/matches','/matches/'];
    let lastErr = null;
    for(const ep of endpoints){
      try{
        const r = await fetch(apiBase + ep);
        if(!r.ok) { lastErr = new Error('HTTP '+r.status+' '+ep); continue; }
        const data = await r.json();
        renderTicker(data || {});
        set(tickerStatus, 'Updated ' + new Date().toLocaleTimeString());
        return;
      }catch(e){ lastErr = e; }
    }
    console.error('Ticker failed:', lastErr);
    set(tickerStatus, 'Error');
  }

  function renderTicker(summary){
    clear(tickerRow);
    const all = (Array.isArray(summary.live)? summary.live: []).concat(Array.isArray(summary.upcoming)? summary.upcoming: []);
    const items = liveOnlyToggle && liveOnlyToggle.checked ? (summary.live || []) : (all || []);
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

  // ===== Wire up =====
  liveOnlyToggle.addEventListener('change', loadTicker);
  leagueSearch.addEventListener('input', ()=>{
    const q = leagueSearch.value.trim().toLowerCase();
    if(!q){ filteredLeagues = allLeagues.slice(); }
    else {
      filteredLeagues = (allLeagues||[]).filter(L => getLeagueLabel(L).toLowerCase().includes(q));
    }
    renderLeagues();
  });

  applyFilterBtn.addEventListener('click', ()=> { if(selectedLeague) loadLeagueMatches(); });

  // Default date = today
  datePicker.value = new Date().toISOString().slice(0,10);

  // Initial loads
  loadTicker();
  loadLeagues();
  setInterval(()=>{ if(!document.hidden) loadTicker(); }, 60000);
})();
