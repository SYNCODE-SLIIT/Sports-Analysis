/* History matches dashboard logic */
(function(){
  // Determine backend base. Dev convenience: allow explicit override via window.__API_BASE__.
  // If not provided and frontend is localhost, default to backend on 127.0.0.1:8030 (dev server we use here).
  const loc = window.location;
  let apiBase = window.__API_BASE__ || loc.origin;
  if(!window.__API_BASE__){
    if (loc.hostname === 'localhost' || loc.hostname === '127.0.0.1'){
      apiBase = loc.protocol + '//' + loc.hostname + ':8030';
    } else if(loc.port && loc.port !== '8000'){
      apiBase = loc.protocol + '//' + loc.hostname + ':8000';
    }
  }

  const contentEl = document.getElementById('content');
  const daysInput = document.getElementById('daysInput');
  const startDateInput = document.getElementById('startDate');
  const endDateInput = document.getElementById('endDate');
  const leagueSelect = document.getElementById('leagueSelect');
  const fetchLeagueBtn = document.getElementById('fetchLeagueBtn');
  const flatBtn = document.getElementById('flatBtn');
  const loadBtn = document.getElementById('loadBtn');
  const statusEl = document.getElementById('status');

  const leagueTemplate = document.getElementById('leagueTemplate');
  const dateTemplate = document.getElementById('dateTemplate');
  const matchRowTemplate = document.getElementById('matchRowTemplate');

  // Create a modal (same UI used on matches.html) so history page can show details
  const modal = document.createElement('div'); modal.id = 'matchModal'; modal.className = 'modal hidden'; modal.setAttribute('role','dialog'); modal.setAttribute('aria-modal','true');
  modal.innerHTML = `<div class="modal-content"><button class="close" id="closeModal" aria-label="Close">&times;</button><div id="modalBody">Loading...</div></div>`;
  document.body.appendChild(modal);
  const modalBody = modal.querySelector('#modalBody');
  const closeModal = modal.querySelector('#closeModal');
  closeModal.addEventListener('click', ()=> modal.classList.add('hidden'));
  modal.addEventListener('click', e=>{ if(e.target === modal) modal.classList.add('hidden'); });
  document.addEventListener('keydown', e=>{ if(e.key==='Escape') modal.classList.add('hidden'); });

  let allLeagues = [];

  // Set default end date to today
  endDateInput.value = new Date().toISOString().split('T')[0];
  // Default start date = end date (single day) unless user changes it
  startDateInput.value = endDateInput.value;

  // Load leagues on page load
  loadLeagues();

  // NOTE: Sample data auto-load removed to prevent overriding real results.
  // If needed during development, call showSampleData() manually from console.

  loadBtn.addEventListener('click', loadHistoryMatches);
  if(flatBtn) flatBtn.addEventListener('click', loadFlatMatches);
  fetchLeagueBtn.addEventListener('click', fetchLeagueMatches);

  function setStatus(text, isError = false) {
    statusEl.textContent = text;
    statusEl.className = isError ? 'status error' : 'status';
  }

  async function loadLeagues() {
    try {
      setStatus('Loading leagues...');
      const response = await fetch(`${apiBase}/leagues`);
      const data = await response.json();
      
      if (data.ok && data.data && data.data.result) {
        allLeagues = data.data.result;
        populateLeagueDropdown();
        setStatus(`Loaded ${allLeagues.length} leagues`);
      } else {
        throw new Error('Failed to load leagues');
      }
    } catch (error) {
      console.error('Error loading leagues:', error);
      setStatus('Error loading leagues: ' + error.message, true);
    }
  }

  function populateLeagueDropdown() {
    // Clear existing options except "All Leagues"
    while (leagueSelect.children.length > 1) {
      leagueSelect.removeChild(leagueSelect.lastChild);
    }

    // Define most popular leagues (in order of popularity)
    const popularLeagues = [
      'Premier League', 'English Premier League', 'EPL',
      'UEFA Champions League', 'Champions League',
      'La Liga', 'Spanish La Liga', 'LaLiga',
      'Serie A', 'Italian Serie A',
      'Bundesliga', 'German Bundesliga',
      'Ligue 1', 'French Ligue 1',
      'UEFA Europa League', 'Europa League',
      'FIFA World Cup', 'World Cup',
      'UEFA European Championship', 'Euro Championship', 'EURO',
      'Copa America',
      'FA Cup', 'English FA Cup',
      'Copa del Rey',
      'DFB-Pokal',
      'Coppa Italia',
      'Coupe de France',
      'UEFA Conference League', 'Conference League',
      'Premier League 2', 'Championship', 'EFL Championship',
      'MLS', 'Major League Soccer',
      'Brazilian Serie A', 'Brasileirão',
      'Argentine Primera División', 'Primera División Argentina',
      'Eredivisie', 'Dutch Eredivisie',
      'Primeira Liga', 'Portuguese Liga',
      'Turkish Super Lig', 'Süper Lig',
      'Russian Premier League',
      'Ukrainian Premier League',
      'Belgian Pro League', 'Jupiler Pro League',
      'Scottish Premiership',
      'Austrian Bundesliga',
      'Swiss Super League',
      'Copa Libertadores', 'CONMEBOL Libertadores',
      'Europa Conference League',
      'Nations League', 'UEFA Nations League'
    ];

    // Function to get priority score for a league
    function getLeaguePriority(leagueName) {
      const name = leagueName.toLowerCase();
      for (let i = 0; i < popularLeagues.length; i++) {
        if (name.includes(popularLeagues[i].toLowerCase()) || 
            popularLeagues[i].toLowerCase().includes(name)) {
          return i; // Lower number = higher priority
        }
      }
      return 1000; // Low priority for non-popular leagues
    }

    // Deduplicate leagues by stable id (league_key|league_id); fallback to country+name pair
    const uniqMap = new Map();
    (allLeagues || []).forEach(L => {
      const id = String(L.league_key || L.league_id || `${L.country_name || ''}|${L.league_name || ''}`);
      if (!uniqMap.has(id)) uniqMap.set(id, L);
    });
    const uniqLeagues = Array.from(uniqMap.values());

    // Sort leagues: popular ones first (by raw league_name), then alphabetically by display label "Country — League"
    const sortedLeagues = uniqLeagues.sort((a, b) => {
      const nameA = a.league_name || '';
      const nameB = b.league_name || '';
      const dispA = ((a.country_name ? (a.country_name + ' — ') : '') + nameA).trim();
      const dispB = ((b.country_name ? (b.country_name + ' — ') : '') + nameB).trim();

      const priorityA = getLeaguePriority(nameA);
      const priorityB = getLeaguePriority(nameB);

      // If both are popular or both are non-popular, sort alphabetically by display name including country
      if (priorityA === priorityB) {
        return dispA.toLowerCase().localeCompare(dispB.toLowerCase());
      }

      // Otherwise, sort by priority
      return priorityA - priorityB;
    });

    // Add league options with Country — League display label
    sortedLeagues.forEach((league, index) => {
      const option = document.createElement('option');
      option.value = league.league_key || league.league_id || '';
      const country = league.country_name || league.strCountry || '';
      const lname = league.league_name || league.strLeague || 'Unknown League';
      const label = country ? `${country} — ${lname}` : lname;
      option.textContent = label;
      option.title = label;

      // Add visual separator after popular leagues
      const priority = getLeaguePriority(lname);
      if (index > 0 && priority >= 1000) {
        const prevLeague = sortedLeagues[index - 1];
        const prevPriority = getLeaguePriority(prevLeague.league_name || prevLeague.strLeague || '');
        if (prevPriority < 1000) {
          // Add a separator option
          const separator = document.createElement('option');
          separator.disabled = true;
          separator.textContent = '─────────────────────';
          separator.style.backgroundColor = '#2c3a46';
          separator.style.color = '#6b7280';
          leagueSelect.appendChild(separator);
        }
      }

      leagueSelect.appendChild(option);
    });
  }

  function _rangeToDays(start, end){
    try{
      const s = new Date(start);
      const e = new Date(end);
      const ms = e.setHours(0,0,0,0) - s.setHours(0,0,0,0);
      return Math.max(1, Math.min(31, Math.floor(ms / (24*3600*1000)) + 1));
    }catch(_e){ return null; }
  }

  async function loadHistoryMatches() {
    try {
      setStatus('Loading history matches...');
      contentEl.innerHTML = '';
      
      const endDate = endDateInput.value || new Date().toISOString().split('T')[0];
      const startDate = startDateInput.value || '';
      let days = parseInt(daysInput.value) || 7;
      if(startDate){ const d = _rangeToDays(startDate, endDate); if(d) days = d; }
      
      const url = `${apiBase}/matches/history?days=${days}&end_date=${endDate}`;
      console.log('Loading from URL:', url);
      const response = await fetch(url);
      const data = await response.json();
      
      console.log('History data received:', data);
      
      if (data.ok && data.data && data.data.leagues) {
        displayHistoryMatches(data.data.leagues);
        setStatus(`Loaded matches for ${Object.keys(data.data.leagues).length} leagues`);
      } else {
        console.error('No leagues data found:', data);
        // Try to show some sample data for testing
        showSampleData();
      }
    } catch (error) {
      console.error('Error loading history matches:', error);
      setStatus('Error loading matches: ' + error.message, true);
      // Show sample data for testing
      showSampleData();
    }
  }

  // New: Flat matches (no league grouping) — includes internationals
  async function loadFlatMatches() {
    try {
      setStatus('Loading flat matches...');
      contentEl.innerHTML = '';

      const endDate = endDateInput.value || new Date().toISOString().split('T')[0];
      const startDate = startDateInput.value || '';
      let days = parseInt(daysInput.value) || 7;
      if(startDate){ const d = _rangeToDays(startDate, endDate); if(d) days = d; }

      const url = `${apiBase}/matches/history_raw?days=${days}&end_date=${endDate}`;
      const response = await fetch(url);
      const data = await response.json();

      // Router returns raw object with top-level matches array
      const ok = !!(data && (data.ok === true || typeof data.ok === 'undefined'));
      const matches = (data && (data.matches || (data.data && data.data.matches))) || [];

      if(!ok) throw new Error('Failed to load flat matches');

      // Group by date (newest first) for readability, but do NOT group by league
      const byDate = {};
      matches.forEach(m => {
        const d = m.event_date || m.dateEvent || m.date || 'Unknown Date';
        (byDate[d] = byDate[d] || []).push(m);
      });

      const dates = Object.keys(byDate).sort().reverse();

      // Header
      const hdr = document.createElement('h2');
      hdr.textContent = `Flat Matches — ${matches.length} total`;
      hdr.style.margin = '16px';
      contentEl.appendChild(hdr);

      dates.forEach(d => {
        const section = createDateSection(d, byDate[d]);
        contentEl.appendChild(section);
      });

      setStatus(`Loaded flat matches for ${dates.length} dates`);
    } catch (error) {
      console.error('Error loading flat matches:', error);
      setStatus('Error loading flat matches: ' + (error && error.message ? error.message : String(error)), true);
    }
  }

  async function fetchLeagueMatches() {
    const selectedLeague = leagueSelect.value;
    if (selectedLeague === '__ALL__') {
      loadHistoryMatches();
      return;
    }

    try {
      setStatus('Loading league matches...');
      contentEl.innerHTML = '';

      const callIntent = async (intent, args) => {
        const resp = await fetch(`${apiBase}/collect`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({intent, args}) });
        if(!resp.ok) throw new Error(`HTTP ${resp.status} for ${intent}`);
        return resp.json();
      };

      const selectedLeagueName = leagueSelect.options[leagueSelect.selectedIndex].textContent;

      // Build explicit date window (AllSports responds reliably when from/to are provided)
      const endDate = (endDateInput.value || new Date().toISOString().slice(0,10));
      let startDate = startDateInput.value || '';
      if(!startDate){
        const days = parseInt(daysInput.value || '7', 10) || 7;
        const end = new Date(endDate);
        const start = new Date(end);
        start.setDate(start.getDate() - days + 1);
        startDate = start.toISOString().slice(0,10);
      }

      const args = { leagueId: selectedLeague, from: startDate, to: endDate };
      let res = await callIntent('events.list', args);
      let matches = [];
      if(res && res.ok && res.data){
        matches = res.data.result || res.data.events || res.data.results || [];
      }
      if((!Array.isArray(matches) || matches.length === 0)){
        // Try fixtures.list alias with same params
        res = await callIntent('fixtures.list', args);
        if(res && res.ok && res.data){
          matches = res.data.result || res.data.events || res.data.results || [];
        }
      }

      displayLeagueMatches(Array.isArray(matches) ? matches : [], selectedLeagueName);
      setStatus(`Loaded ${Array.isArray(matches)?matches.length:0} matches for ${selectedLeagueName} (${startDate} → ${endDate})`);
    } catch (error) {
      console.error('Error loading league matches:', error);
      setStatus('Error loading league matches: ' + error.message, true);
    }
  }

  function displayHistoryMatches(leagues) {
    contentEl.innerHTML = '';
    
    // Sort leagues by name
    const sortedLeagueNames = Object.keys(leagues).sort();
    
    sortedLeagueNames.forEach(leagueName => {
      const leagueData = leagues[leagueName];
      const leagueSection = createLeagueSection(leagueName, leagueData);
      contentEl.appendChild(leagueSection);
    });
  }

  function displayLeagueMatches(matches, leagueName) {
    contentEl.innerHTML = '';
    
    // Group matches by date
    const matchesByDate = {};
    matches.forEach(match => {
      const date = match.event_date || match.dateEvent || 'Unknown Date';
      if (!matchesByDate[date]) {
        matchesByDate[date] = [];
      }
      matchesByDate[date].push(match);
    });
    
    // Create league structure
    const leagueData = { dates: matchesByDate };
    const leagueSection = createLeagueSection(leagueName, leagueData);
    contentEl.appendChild(leagueSection);
  }

  function createLeagueSection(leagueName, leagueData) {
    const leagueNode = leagueTemplate.content.firstElementChild.cloneNode(true);
    leagueNode.querySelector('.leagueTitle').textContent = leagueName;
    
    const datesContainer = leagueNode.querySelector('.dates');
    
    // Sort dates in descending order (newest first)
    const sortedDates = Object.keys(leagueData.dates || {}).sort().reverse();
    
    sortedDates.forEach(date => {
      const matches = leagueData.dates[date];
      const dateSection = createDateSection(date, matches);
      datesContainer.appendChild(dateSection);
    });
    
    return leagueNode;
  }

  function createDateSection(date, matches) {
    const dateNode = dateTemplate.content.firstElementChild.cloneNode(true);
    dateNode.querySelector('.dateHeading').textContent = formatDate(date || 'Unknown Date');
    
    const matchesContainer = dateNode.querySelector('.matches');
    
    matches.forEach(match => {
      const matchRow = createMatchRow(match);
      matchesContainer.appendChild(matchRow);
    });
    
    return dateNode;
  }

  function createMatchRow(match) {
    const matchNode = matchRowTemplate.content.firstElementChild.cloneNode(true);
    const pick = (obj, keys) => { for(const k of keys){ if(obj && obj[k] != null && obj[k] !== '') return obj[k]; } return ''; };
    const homeTeam = pick(match, ['event_home_team','strHomeTeam','home_team','homeTeam','home','localteam','homeTeamName']);
    const awayTeam = pick(match, ['event_away_team','strAwayTeam','away_team','awayTeam','away','visitorteam','awayTeamName']);
    const time = pick(match, ['event_time','strTime','match_time','time']);
    const status = pick(match, ['event_status','status','match_status']);
    const date = pick(match, ['event_date','dateEvent','match_date','date']);
    
    // Format score
    let score = '-';
    if (match.event_final_result) {
      score = match.event_final_result;
    } else if (match.event_ft_result) {
      score = match.event_ft_result;
    } else if (match.home_score !== undefined && match.away_score !== undefined) {
      score = `${match.home_score} - ${match.away_score}`;
    } else if (match.event_home_result !== undefined && match.event_away_result !== undefined) {
      score = `${match.event_home_result} - ${match.event_away_result}`;
    }
    
    matchNode.innerHTML = `
      <div class="match-info">
        <div class="teams">
          <span class="home-team">${homeTeam || 'Unknown'}</span>
          <span class="vs">vs</span>
          <span class="away-team">${awayTeam || 'Unknown'}</span>
        </div>
        <div class="match-details">
          <span class="time">${time || ''}</span>
          <span class="score">${score}</span>
          <span class="status">${status || ''}</span>
        </div>
      </div>
      <div style="margin-top:8px"><button class="detailsBtn">Details</button></div>
    `;
    const detailsBtn = matchNode.querySelector('.detailsBtn');
    if(detailsBtn) detailsBtn.addEventListener('click', ()=> showDetails(match));
    return matchNode;
  }

  // --- Modal & details logic (copied/adapted from matches.js) ---
  function showDetails(ev){
    console.log('showDetails called with event:', ev);
    modalBody.innerHTML = `
      <div class="details-pane">
        <div class="details-controls" style="margin-bottom:.5rem;display:flex;gap:.5rem;flex-wrap:wrap;">
          <button id="augmentTagsBtn">Augment Timeline Tags</button>
          <button id="playerAnalyticsBtn">Player Analytics</button>
          <button id="multimodalBtn">Multimodal Extract</button>
        </div>
        <div id="summary_section" class="summary">
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
            <div id="comments_section" class="extra-section"><h4>Comments</h4><div class="body">Loading…</div></div>
            <div id="seasons_section" class="extra-section"><h4>Seasons</h4><div class="body">Loading…</div></div>
          </div>
        </div>
      </div>`;
    
    const detailsInfo = modalBody.querySelector('#details_info');
  console.log('Rendering event details...');
  // Build a clean, match-relevant timeline from the event payload and attach it so the UI renders it
  try{ ev.timeline = buildCleanTimeline(ev); }catch(e){ console.warn('buildCleanTimeline failed', e); }
  renderEventDetails(ev, detailsInfo);
  // Auto-augment with model predictions (runs in background; will re-render when complete)
  setTimeout(()=> { try{ augmentEventTags(ev); }catch(e){ console.warn('auto augment failed', e); } }, 300);
    // Fetch AI match summary
    fetchMatchSummary(ev).catch(err => {
      console.error('Summary error:', err);
      const sumEl = modalBody.querySelector('#summary_section .summary-body');
      if(sumEl) sumEl.textContent = 'Summary error: ' + (err && err.message ? err.message : String(err));
    });
    
    // wire new feature buttons
    const augmentBtn = modalBody.querySelector('#augmentTagsBtn');
    const playerBtn = modalBody.querySelector('#playerAnalyticsBtn');
    const multimodalBtn = modalBody.querySelector('#multimodalBtn');
    if(augmentBtn) augmentBtn.addEventListener('click', ()=> augmentEventTags(ev));
    if(playerBtn) playerBtn.addEventListener('click', ()=> runPlayerAnalytics(ev));
    if(multimodalBtn) multimodalBtn.addEventListener('click', ()=> runMultimodalExtract(ev));

    modal.classList.remove('hidden');
    console.log('Modal opened, fetching highlights and extras...');
    
    fetchHighlights(ev).catch(err => { 
      console.error('Highlights error:', err);
      const body = modalBody.querySelector('#highlights .hl-body'); 
      if(body) body.textContent = 'Highlights error: ' + (err && err.message ? err.message : String(err)); 
    });
    
    fetchExtras(ev).catch(err => { 
      console.error('Extras error:', err);
      const sec = modalBody.querySelector('#extras .extras-body'); 
      if(sec) sec.textContent = 'Extras error: ' + (err && err.message ? err.message : String(err)); 
    });
  }  // Render a beautiful, football-focused match details view
  function renderEventDetails(ev, container){
    console.log('renderEventDetails called with:', ev, container);
    if(!container) {
      console.error('No container provided to renderEventDetails');
      return;
    }
    container.innerHTML = '';

    const home = ev.event_home_team || ev.strHomeTeam || ev.home_team || '';
    const away = ev.event_away_team || ev.strAwayTeam || ev.away_team || '';
    const league = ev.league_name || ev.strLeague || '';
    const date = ev.event_date || ev.dateEvent || ev.date || '';
    const time = ev.event_time || ev.strTime || '';
    const status = ev.event_status || ev.status || '';
    const venue = ev.venue || ev.stadium || ev.strVenue || ev.location || ev.event_venue || '';

    console.log('Event details:', { home, away, league, date, time, status, venue });

    // Score determination
    let homeScore = '', awayScore = '';
    if (ev.event_final_result && ev.event_final_result.includes('-')) {
      const parts = ev.event_final_result.split('-');
      homeScore = parts[0]?.trim() || '';
      awayScore = parts[1]?.trim() || '';
    } else if (ev.home_score !== undefined && ev.away_score !== undefined) {
      homeScore = String(ev.home_score);
      awayScore = String(ev.away_score);
    } else if (ev.event_home_result !== undefined && ev.event_away_result !== undefined) {
      homeScore = String(ev.event_home_result);
      awayScore = String(ev.event_away_result);
    }

    console.log('Scores:', { homeScore, awayScore });

    // Main match card
    const matchCard = document.createElement('div');
    matchCard.style.cssText = `
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-radius: 16px;
      padding: 24px;
      color: white;
      margin-bottom: 20px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.1);
    `;

    // League and status bar
    const leagueBar = document.createElement('div');
    leagueBar.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      font-size: 14px;
      opacity: 0.9;
    `;
    leagueBar.innerHTML = `
      <span style="background: rgba(255,255,255,0.2); padding: 4px 12px; border-radius: 20px;">${league}</span>
      <span style="background: ${getStatusColor(status)}; padding: 4px 12px; border-radius: 20px;">${status || 'Finished'}</span>
    `;

    // Teams and score section
    const teamsSection = document.createElement('div');
    teamsSection.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    `;

    const homeTeam = createTeamDisplay(home, ev.home_team_logo || ev.strHomeTeamBadge, true);
    const scoreDisplay = createScoreDisplay(homeScore, awayScore);
    const awayTeam = createTeamDisplay(away, ev.away_team_logo || ev.strAwayTeamBadge, false);

    teamsSection.appendChild(homeTeam);
    teamsSection.appendChild(scoreDisplay);
    teamsSection.appendChild(awayTeam);

    // Match info
    const matchInfo = document.createElement('div');
    matchInfo.style.cssText = `
      display: flex;
      gap: 20px;
      flex-wrap: wrap;
      font-size: 14px;
      opacity: 0.9;
    `;
    if(date) matchInfo.innerHTML += `<span>📅 ${formatDate(date)}</span>`;
    if(time) matchInfo.innerHTML += `<span>🕐 ${time}</span>`;
    if(venue) matchInfo.innerHTML += `<span>🏟️ ${venue}</span>`;
    if(ev.referee) matchInfo.innerHTML += `<span>👨‍⚖️ ${ev.referee}</span>`;
    if(ev.attendance) matchInfo.innerHTML += `<span>👥 ${ev.attendance}</span>`;

    matchCard.appendChild(leagueBar);
    matchCard.appendChild(teamsSection);
    matchCard.appendChild(matchInfo);
    container.appendChild(matchCard);

    // Match Statistics
    renderMatchStats(ev, container);

    // Timeline / Events
    renderMatchTimeline(ev, container);

    // Additional Info Cards
    renderAdditionalInfo(ev, container);
  }

  function createTeamDisplay(teamName, logo, isHome) {
    const team = document.createElement('div');
    team.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: ${isHome ? 'flex-start' : 'flex-end'};
      flex: 1;
    `;

    if(logo) {
      const logoImg = document.createElement('img');
      logoImg.src = logo;
      logoImg.style.cssText = 'width: 48px; height: 48px; object-fit: contain; margin-bottom: 8px;';
      logoImg.onerror = () => logoImg.remove();
      team.appendChild(logoImg);
    }

    const name = document.createElement('div');
    name.style.cssText = 'font-weight: 600; font-size: 18px;';
    name.textContent = teamName;
    team.appendChild(name);

    return team;
  }

  function createScoreDisplay(homeScore, awayScore) {
    const scoreContainer = document.createElement('div');
    scoreContainer.style.cssText = `
      display: flex;
      align-items: center;
      gap: 16px;
      font-size: 36px;
      font-weight: 700;
      text-shadow: 0 2px 4px rgba(0,0,0,0.3);
    `;

    scoreContainer.innerHTML = `
      <span>${homeScore || '-'}</span>
      <span style="font-size: 24px; opacity: 0.7;">:</span>
      <span>${awayScore || '-'}</span>
    `;

    return scoreContainer;
  }

  function getStatusColor(status) {
    const s = String(status).toLowerCase();
    if(s.includes('live') || s.includes('1st') || s.includes('2nd')) return 'rgba(34, 197, 94, 0.8)';
    if(s.includes('finished') || s.includes('ft')) return 'rgba(107, 114, 128, 0.8)';
    if(s.includes('postponed') || s.includes('cancelled')) return 'rgba(239, 68, 68, 0.8)';
    return 'rgba(107, 114, 128, 0.8)';
  }

  function renderMatchStats(ev, container) {
    const statsData = extractMatchStats(ev);
    if(Object.keys(statsData).length === 0) return;

    const statsCard = document.createElement('div');
    statsCard.style.cssText = `
      background: white;
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 20px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.08);
    `;

    const title = document.createElement('h3');
    title.style.cssText = 'margin: 0 0 20px 0; color: #1f2937; font-size: 20px;';
    title.innerHTML = '📊 Match Statistics';
    statsCard.appendChild(title);

    Object.entries(statsData).forEach(([statName, values]) => {
      const statRow = createStatRow(statName, values.home, values.away);
      statsCard.appendChild(statRow);
    });

    container.appendChild(statsCard);
  }

  function extractMatchStats(ev) {
    const stats = {};
    const statMappings = {
      'Possession': ['possession_home', 'possession_away'],
      'Shots': ['shots_home', 'shots_away'],
      'Shots on Target': ['shots_on_target_home', 'shots_on_target_away'],
      'Corners': ['corners_home', 'corners_away'],
      'Yellow Cards': ['yellow_cards_home', 'yellow_cards_away'],
      'Red Cards': ['red_cards_home', 'red_cards_away'],
      'Fouls': ['fouls_home', 'fouls_away'],
      'Offsides': ['offsides_home', 'offsides_away']
    };

    Object.entries(statMappings).forEach(([displayName, [homeKey, awayKey]]) => {
      if(ev[homeKey] !== undefined || ev[awayKey] !== undefined) {
        stats[displayName] = {
          home: ev[homeKey] || 0,
          away: ev[awayKey] || 0
        };
      }
    });

    return stats;
  }

  function createStatRow(statName, homeValue, awayValue) {
    const row = document.createElement('div');
    row.style.cssText = 'margin-bottom: 16px;';

    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
      font-weight: 600;
      color: #374151;
    `;
    header.innerHTML = `<span>${homeValue}</span><span>${statName}</span><span>${awayValue}</span>`;

    const progressBar = createProgressBar(homeValue, awayValue, statName.includes('Possession'));
    
    row.appendChild(header);
    row.appendChild(progressBar);
    return row;
  }

  function createProgressBar(homeValue, awayValue, isPercentage) {
    const container = document.createElement('div');
    container.style.cssText = `
      height: 8px;
      background: #e5e7eb;
      border-radius: 4px;
      overflow: hidden;
      display: flex;
    `;

    const homeNum = parseFloat(homeValue) || 0;
    const awayNum = parseFloat(awayValue) || 0;
    const total = homeNum + awayNum;

    if(total > 0) {
      const homePercent = isPercentage ? homeNum : (homeNum / total) * 100;
      const awayPercent = isPercentage ? awayNum : (awayNum / total) * 100;

      const homeBar = document.createElement('div');
      homeBar.style.cssText = `
        width: ${homePercent}%;
        background: linear-gradient(90deg, #3b82f6, #1d4ed8);
        transition: width 0.3s ease;
      `;

      const awayBar = document.createElement('div');
      awayBar.style.cssText = `
        width: ${awayPercent}%;
        background: linear-gradient(90deg, #ef4444, #dc2626);
        transition: width 0.3s ease;
      `;

      container.appendChild(homeBar);
      container.appendChild(awayBar);
    }

    return container;
  }

  function renderMatchTimeline(ev, container) {
    // Accept many timeline shapes; if empty try to synthesize from scorers/comments
    let timeline = ev.timeline || ev.timeline_items || ev.events || ev.event_timeline || ev.eventTimeline || ev.event_entries || [];

    // If provider returned an object-of-arrays, flatten into an array
    if(timeline && !Array.isArray(timeline) && typeof timeline === 'object'){
      const vals = Object.values(timeline).filter(Boolean);
      const arr = vals.reduce((acc, cur) => acc.concat(Array.isArray(cur) ? cur : []), []);
      if(arr.length>0) timeline = arr;
    }

    // If still empty, attempt to synthesize a simple timeline from common fields
    if(!Array.isArray(timeline) || timeline.length === 0){
      timeline = synthesizeTimelineFromEvent(ev);
    }
    if(!Array.isArray(timeline) || timeline.length === 0) return;

    const timelineCard = document.createElement('div');
    timelineCard.style.cssText = `
      background: white;
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 20px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.08);
    `;

    const title = document.createElement('h3');
    title.style.cssText = 'margin: 0 0 20px 0; color: #1f2937; font-size: 20px;';
    title.innerHTML = '⚽ Match Timeline';
    timelineCard.appendChild(title);

    const timelineContainer = document.createElement('div');
    timelineContainer.style.cssText = 'position: relative;';

    timeline.forEach((event, index) => {
      const eventElement = createTimelineEvent(event, index === timeline.length - 1, ev);
      timelineContainer.appendChild(eventElement);
    });

    timelineCard.appendChild(timelineContainer);
    container.appendChild(timelineCard);
  }

  // Create a minimal timeline when provider doesn't include one
  function synthesizeTimelineFromEvent(ev){
    try{
      const out = [];
      // scorers / goals (many provider shapes)
      const scorers = ev.scorers || ev.goals || ev.goal_scorers || ev.scorers_list || ev.goals_list || [];
      if(Array.isArray(scorers) && scorers.length>0){
        scorers.forEach(s => {
          const minute = s.minute || s.time || s.minute_display || s.m || s.match_minute || '';
          const name = s.name || s.player || s.scorer || s.player_name || s.player_fullname || '';
          const team = s.team || s.side || s.club || '';
          const desc = s.description || s.text || (name ? `Goal by ${name}` : 'Goal');
          const tags = s.tags || s.predicted_tags || s.predictedTags || s.labels || (s.type? [s.type]: []);
          out.push({ minute, description: desc, player: name, team, type: s.type || 'goal', predicted_tags: tags, raw: s });
        });
      }

      // comments / play-by-play as timeline entries (take first few)
      const comments = ev.comments || ev.comments_list || ev.match_comments || ev.play_by_play || ev.commentary || [];
      if(Array.isArray(comments) && comments.length>0){
        comments.slice(0,8).forEach(c => {
          const minute = c.time || c.minute || c.comments_time || c.match_minute || '';
          const desc = c.text || c.comment || c.comments_text || c.body || '';
          const tags = c.tags || c.predicted_tags || c.predictedTags || c.labels || [];
          if(desc) out.push({ minute, description: desc, predicted_tags: tags, raw: c });
        });
      }

      // fallback: create an entry for final result
      if(out.length === 0){
        const home = ev.event_home_team || ev.strHomeTeam || ev.home_team || ev.homeName || '';
        const away = ev.event_away_team || ev.strAwayTeam || ev.away_team || ev.awayName || '';
        const score = ev.event_final_result || ev.event_ft_result || (ev.home_score!=null && ev.away_score!=null ? `${ev.home_score} - ${ev.away_score}` : '');
        if(home || away || score){
          out.push({ minute: '', description: `${home} vs ${away} ${score}`, predicted_tags: [], raw: ev });
        }
      }

      // If entries exist but have no tags, run a small heuristic detector to surface likely tags
      const enriched = out.map(entry => {
        const hasTags = entry.predicted_tags && Array.isArray(entry.predicted_tags) && entry.predicted_tags.length>0;
        if(!hasTags){
          const inferred = detectTagsFromText(entry.description || '');
          entry.predicted_tags = inferred;
        }
        return entry;
      });

      return enriched;
    }catch(e){ return []; }
  }

  // Lightweight heuristic tag detection from text for better UX when no model tags available
  function detectTagsFromText(text){
    if(!text) return [];
    const t = String(text).toLowerCase();
    const tags = new Set();
    if(t.includes('goal') || /scores?|scored|goal by|assist/.test(t)) tags.add('goal');
    if(t.includes('penalty')) tags.add('penalty');
    if(t.includes('yellow card') || t.includes('yellow')) tags.add('yellow card');
    if(t.includes('red card') || t.includes('sent off') || t.includes('red')) tags.add('red card');
    if(t.includes('substitution') || t.includes('sub') || t.includes('replaced')) tags.add('substitution');
    if(t.includes('corner')) tags.add('corner');
    if(t.includes('offside')) tags.add('offside');
    if(t.includes('penalty shootout') || t.includes('shootout')) tags.add('shootout');
    // simple player detection
    const playerMatch = text.match(/by\s+([A-Z][a-z]+\s?[A-Z]?[a-z]*)/);
    if(playerMatch) tags.add('player');
    return Array.from(tags).map(s => ({ text: s, source: 'heuristic', confidence: undefined, isModel: false }));
  }

  // Build a clean, minimal timeline from provider event JSON focusing on goals, subs, and cards
  function buildCleanTimeline(ev){
    const out = [];
    // Goals / goalscorers
    const goals = ev.goalscorers || ev.goals || ev.goalscorer || ev.goalscorers_list || ev.goalscorers_list || ev.goalscorers || ev.goalscorers || ev.goals || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || [];
    // Use the canonical names used in your sample
    const goalsCanonical = ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || [];
    const goalsSrc = ev.goalscorers || ev.goals || ev.goalscorer || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || ev.goalscorers || [];
    (goalsSrc||[]).forEach(g => {
      const minute = g.time || g.minute || '';
      const player = g.home_scorer || g.away_scorer || g.scorer || g.player || '';
      const assist = g.home_assist || g.away_assist || g.assist || '';
      const team = (g.away_scorer? ev.event_away_team : (g.home_scorer? ev.event_home_team : ''));
      const score = g.score || '';
      out.push({ minute, type: 'goal', player, assist, team, description: `${minute} — ${player} (${team}) scores — assist: ${assist} — score: ${score}`, tags: ['goal'] });
    });

    // Substitutions
    const subs = ev.substitutes || ev.subs || ev.substitutions || [];
    (subs||[]).forEach(s => {
      const minute = s.time || '';
      // home_scorer object can contain in/out
      if(s.home_scorer && typeof s.home_scorer === 'object' && Object.keys(s.home_scorer).length>0){
        out.push({ minute, type: 'substitution', player_in: s.home_scorer.in, player_out: s.home_scorer.out, team: ev.event_home_team || 'home', description: `${minute} — ${s.home_scorer.in} ON for ${s.home_scorer.out} (${ev.event_home_team})`, tags: ['substitution'] });
      }
      if(s.away_scorer && typeof s.away_scorer === 'object' && Object.keys(s.away_scorer).length>0){
        out.push({ minute, type: 'substitution', player_in: s.away_scorer.in, player_out: s.away_scorer.out, team: ev.event_away_team || 'away', description: `${minute} — ${s.away_scorer.in} ON for ${s.away_scorer.out} (${ev.event_away_team})`, tags: ['substitution'] });
      }
    });

    // Cards
    const cards = ev.cards || [];
    (cards||[]).forEach(c => {
      const minute = c.time || '';
      const player = c.home_fault || c.away_fault || '';
      const cardType = (c.card || '').toLowerCase();
      const team = c.home_fault? ev.event_home_team : (c.away_fault? ev.event_away_team : '');
      out.push({ minute, type: 'card', player, card: cardType, team, description: `${minute} — ${cardType} for ${player} (${team})`, tags: [cardType] });
    });

    // Sort by minute (handle '90+4' as 90.04 to keep order)
    function minuteSortKey(m){ if(!m) return 0; const plus = m.includes('+'); if(plus){ const parts = m.split('+'); return Number(parts[0]) + Number(parts[1]) / 100; } return Number(m)||0; }
    out.sort((a,b)=> minuteSortKey(a.minute) - minuteSortKey(b.minute));
    return out;
  }

  function createTimelineEvent(event, isLast, matchCtx) {
    const eventDiv = document.createElement('div');
    eventDiv.style.cssText = `
      display: flex;
      align-items: flex-start;
      margin-bottom: ${isLast ? '0' : '16px'};
      position: relative;
    `;

    // Normalize tags early so color/icon logic can use them
    const normTags = normalizeEventTags(event);
    const tags = Array.isArray(normTags) ? normTags.map(t=>t.text) : [];

    const minute = event.minute || event.time || '';
    const description = event.description || event.text || event.event || '';

    // Timeline dot and line
    const timeline = document.createElement('div');
    timeline.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
      margin-right: 16px;
      flex-shrink: 0;
    `;

  const dot = document.createElement('div');
    dot.style.cssText = `
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: ${getEventColor(description, tags)};
      border: 3px solid white;
      box-shadow: 0 0 0 2px ${getEventColor(description, tags)};
    `;

    const line = document.createElement('div');
    line.style.cssText = `
      width: 2px;
      height: 24px;
      background: #e5e7eb;
      ${isLast ? 'display: none;' : ''}
    `;

    timeline.appendChild(dot);
    timeline.appendChild(line);

    // Event content
    const content = document.createElement('div');
    content.style.cssText = 'flex: 1;';

    const eventHeader = document.createElement('div');
    eventHeader.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    `;

    const minuteSpan = document.createElement('span');
    minuteSpan.style.cssText = `
      background: #f3f4f6;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
      color: #6b7280;
    `;
    minuteSpan.textContent = minute ? `${minute}'` : '';

    const icon = document.createElement('span');
    icon.style.fontSize = '16px';
    icon.textContent = getEventIcon(description, tags);

    eventHeader.appendChild(minuteSpan);
  eventHeader.appendChild(icon);

    const eventText = document.createElement('div');
    eventText.style.cssText = 'color: #374151; margin-bottom: 8px;';
    eventText.textContent = description;

    // Tags (render normalized, mark model-derived tags specially)
    content.appendChild(eventHeader);
    content.appendChild(eventText);
    if(Array.isArray(normTags) && normTags.length > 0){
      const tagsContainer = document.createElement('div');
      tagsContainer.style.cssText = 'display: flex; gap: 6px; flex-wrap: wrap; margin-top:6px; align-items:center;';

      // show a small ML badge when any tag is model-derived
      const hasModel = normTags.some(t=>t.isModel);
      if(hasModel){
        const mlBadge = document.createElement('span');
        mlBadge.textContent = 'ML';
        mlBadge.title = 'Model-predicted tag present';
        mlBadge.style.cssText = 'background:#7c3aed;color:white;padding:2px 6px;border-radius:10px;font-size:11px;font-weight:700;';
        tagsContainer.appendChild(mlBadge);
      }

      normTags.forEach(t => {
        const tagSpan = document.createElement('span');
        const color = t.isModel ? '#6d28d9' : getTagColor(t.text || '');
        tagSpan.style.cssText = `
          background: ${color};
          color: white;
          padding: 2px 8px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 500;
          display:inline-flex;align-items:center;gap:8px;
        `;
        // show confidence if available
        const label = document.createElement('span'); label.textContent = t.text;
        tagSpan.appendChild(label);
        if(t.confidence !== undefined && t.confidence !== null){
          const conf = document.createElement('small'); conf.textContent = ` ${Number(t.confidence).toFixed(2)}`; conf.style.opacity = '0.9'; conf.style.marginLeft = '6px'; conf.style.fontSize='10px'; tagSpan.appendChild(conf);
        }
        tagsContainer.appendChild(tagSpan);
      });

      content.appendChild(tagsContainer);
    }

    // Add a small 'Show raw' toggle for debugging and details
    const rawToggle = document.createElement('button');
    rawToggle.textContent = 'Show raw';
    rawToggle.style.cssText = 'margin-left:8px;background:transparent;border:1px dashed #d1d5db;color:#374151;padding:4px 8px;border-radius:6px;cursor:pointer;font-size:12px;';
    const rawPre = document.createElement('pre');
    rawPre.style.cssText = 'display:none;margin-top:8px;background:#111827;color:#e5e7eb;padding:8px;border-radius:8px;overflow:auto;max-height:240px;';
    try{ rawPre.textContent = JSON.stringify(event.raw || event, null, 2); }catch(e){ rawPre.textContent = String(event.raw || event); }
    rawToggle.addEventListener('click', ()=>{
      if(rawPre.style.display === 'none'){
        rawPre.style.display = 'block'; rawToggle.textContent = 'Hide raw';
      } else { rawPre.style.display = 'none'; rawToggle.textContent = 'Show raw'; }
    });
    content.appendChild(rawToggle);
    content.appendChild(rawPre);

    // Hover brief on the movement dot for special events
    try{
      const etype = deriveEventType(description, tags, event);
      if(etype){
        dot.style.cursor = 'help';
        const onEnter = async ()=>{
          showEventTooltip(dot, 'Summarizing…');
          try{
            const brief = await getEventBrief(etype, { minute, description, event, tags }, matchCtx);
            showEventTooltip(dot, brief);
          }catch(err){ showEventTooltip(dot, description || etype); }
        };
        const onLeave = ()=> hideEventTooltip();
        const onMove = ()=> positionEventTooltip(dot);
        dot.addEventListener('mouseenter', onEnter);
        dot.addEventListener('mouseleave', onLeave);
        dot.addEventListener('mousemove', onMove);
      }
    }catch(_e){ /* ignore hover errors */ }

    eventDiv.appendChild(timeline);
    eventDiv.appendChild(content);

    return eventDiv;
  }

  // ---- Event brief tooltip helpers (shared) ----
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
      const loc = window.location; let apiBase = loc.origin; if(loc.port && loc.port !== '8000'){ apiBase = loc.protocol + '//' + loc.hostname + ':8000'; }
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
  function ensureTooltip(){ if(_evtTooltip) return _evtTooltip; const d = document.createElement('div'); d.style.cssText = 'position:fixed;z-index:9999;max-width:320px;background:#111827;color:#e5e7eb;padding:8px 10px;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,0.25);font-size:12px;line-height:1.4;pointer-events:none;display:none;'; document.body.appendChild(d); _evtTooltip = d; return d; }
  function showEventTooltip(anchor, text){ const d=ensureTooltip(); d.textContent = String(text||''); d.style.display='block'; positionEventTooltip(anchor); }
  function hideEventTooltip(){ if(_evtTooltip) _evtTooltip.style.display='none'; }
  function positionEventTooltip(anchor){ if(!_evtTooltip) return; const r = anchor.getBoundingClientRect(); const pad=8; let x = r.right + pad; let y = r.top - 4; const vw = window.innerWidth; const vh = window.innerHeight; const dw = _evtTooltip.offsetWidth; const dh = _evtTooltip.offsetHeight; if(x+dw+12>vw) x = r.left - dw - pad; if(x<4) x=4; if(y+dh+12>vh) y = vh - dh - 8; if(y<4) y=4; _evtTooltip.style.left = `${Math.round(x)}px`; _evtTooltip.style.top = `${Math.round(y)}px`; }

  function getEventIcon(description, tags) {
    const desc = String(description).toLowerCase();
    const tagStr = Array.isArray(tags) ? tags.join(' ').toLowerCase() : String(tags).toLowerCase();
    
    if(desc.includes('goal') || tagStr.includes('goal')) return '⚽';
    if(desc.includes('yellow') || tagStr.includes('yellow')) return '🟨';
    if(desc.includes('red') || tagStr.includes('red')) return '🟥';
    if(desc.includes('substitution') || tagStr.includes('substitution')) return '🔄';
    if(desc.includes('corner') || tagStr.includes('corner')) return '📐';
    if(desc.includes('penalty') || tagStr.includes('penalty')) return '⚽';
    if(desc.includes('offside') || tagStr.includes('offside')) return '🚩';
    return '⚪';
  }

  function getEventColor(description, tags) {
    const desc = String(description).toLowerCase();
    const tagStr = Array.isArray(tags) ? tags.join(' ').toLowerCase() : String(tags).toLowerCase();
    
    if(desc.includes('goal') || tagStr.includes('goal')) return '#10b981';
    if(desc.includes('yellow') || tagStr.includes('yellow')) return '#f59e0b';
    if(desc.includes('red') || tagStr.includes('red')) return '#ef4444';
    if(desc.includes('substitution') || tagStr.includes('substitution')) return '#8b5cf6';
    return '#6b7280';
  }

  function getTagColor(tag) {
    const t = String(tag).toLowerCase();
    if(t.includes('goal')) return '#10b981';
    if(t.includes('card')) return '#f59e0b';
    if(t.includes('substitution')) return '#8b5cf6';
    if(t.includes('penalty')) return '#ef4444';
    return '#6b7280';
  }

  // Normalize tags into objects: { text, source, confidence, isModel }
  function normalizeEventTags(evt){
    // Accept multiple naming conventions and nested shapes
    // Prefer the first non-empty candidate so an empty `predicted_tags` doesn't mask provider `tags`.
    const candidates = [];
    if(evt){
      if(evt.predicted_tags !== undefined) candidates.push(evt.predicted_tags);
      if(evt.predictedTags !== undefined) candidates.push(evt.predictedTags);
      if(evt.tags !== undefined) candidates.push(evt.tags);
      if(evt.labels !== undefined) candidates.push(evt.labels);
      if(evt.labels_list !== undefined) candidates.push(evt.labels_list);
    }
    let raw = [];
    for(const c of candidates){
      if(c === undefined || c === null) continue;
      // choose the first candidate that is a non-empty array or a non-empty string/object
      if(Array.isArray(c) && c.length>0){ raw = c; break; }
      if(typeof c === 'string' && c.trim()) { raw = [c]; break; }
      if(typeof c === 'object' && !Array.isArray(c)) { raw = [c]; break; }
      // otherwise skip empty arrays (so predicted_tags: [] won't mask tags)
    }
    const out = [];
  if(!raw) return out;
    try{
      if(!Array.isArray(raw)){
        if(typeof raw === 'string') raw = [raw];
        else if(typeof raw === 'object') raw = [raw];
        else raw = [];
      }
    }catch(e){ return out; }

    raw.forEach(r => {
      if(r === undefined || r === null) return;
      if(typeof r === 'string'){
        const isModel = /^model[:\-\s]/i.test(r) || /\bmodel\b|\bml\b/i.test(r);
        const text = r.replace(/^model[:\-\s]+/i, '').trim();
        out.push({ text: text || r, source: isModel ? 'model' : 'rule', confidence: undefined, isModel });
        return;
      }
      if(typeof r === 'object'){
  // Heuristic objects may have { text, label, name, score, source }
  const text = r.label || r.text || r.name || r.tag || JSON.stringify(r);
  const src = r.source || r.origin || r.by || r.src || r.provider || '';
  const conf = r.confidence || r.score || r.probability || r.p || r.conf || undefined;
  const isModel = String(src).toLowerCase().includes('model') || String(src).toLowerCase().includes('ml') || /^model[:\-\s]/i.test(text) || !!r.isModel;
  out.push({ text, source: src || (isModel ? 'model' : 'rule'), confidence: conf, isModel });
        return;
      }
    });

    return out;
  }

  function renderAdditionalInfo(ev, container) {
    const infoCard = document.createElement('div');
    infoCard.style.cssText = `
      background: white;
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.08);
    `;

    const title = document.createElement('h3');
    title.style.cssText = 'margin: 0 0 16px 0; color: #1f2937; font-size: 20px;';
    title.innerHTML = 'ℹ️ Additional Information';
    infoCard.appendChild(title);

    const infoGrid = document.createElement('div');
    infoGrid.style.cssText = `
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
    `;

    // Add various info items
    const infoItems = [
      ['Event ID', ev.idEvent || ev.event_key || 'N/A'],
      ['League ID', ev.league_key || ev.idLeague || 'N/A'],
      ['Season', ev.season || ev.strSeason || 'N/A'],
      ['Round', ev.round || ev.intRound || 'N/A'],
      ['Weather', ev.weather || 'N/A'],
      ['Temperature', ev.temperature || 'N/A']
    ].filter(([label, value]) => value && value !== 'N/A');

    infoItems.forEach(([label, value]) => {
      const item = document.createElement('div');
      item.style.cssText = `
        padding: 12px;
        background: #f9fafb;
        border-radius: 8px;
        border-left: 4px solid #3b82f6;
      `;
      item.innerHTML = `
        <div style="font-size: 12px; color: #6b7280; font-weight: 500; margin-bottom: 4px;">${label}</div>
        <div style="color: #1f2937; font-weight: 600;">${value}</div>
      `;
      infoGrid.appendChild(item);
    });

    if(infoGrid.children.length > 0) {
      infoCard.appendChild(infoGrid);
      container.appendChild(infoCard);
    }

    // Video links
    const videoUrl = ev.strYoutube || ev.video_url || ev.video;
    if(videoUrl) {
      const videoCard = document.createElement('div');
      videoCard.style.cssText = `
        background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
        border-radius: 16px;
        padding: 20px;
        margin-top: 16px;
        text-align: center;
      `;
      
      const videoLink = document.createElement('a');
      videoLink.href = videoUrl;
      videoLink.target = '_blank';
      videoLink.rel = 'noopener noreferrer';
      videoLink.style.cssText = `
        color: white;
        text-decoration: none;
        font-weight: 600;
        font-size: 16px;
        display: inline-flex;
        align-items: center;
        gap: 8px;
      `;
      videoLink.innerHTML = '🎥 Watch Match Highlights';
      
      videoCard.appendChild(videoLink);
      container.appendChild(videoCard);
    }
  }

  function escapeHtml(unsafe) {
    return unsafe.replace(/[&<"'`=\/]/g, function (s) {
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

  // Beautiful card creators for extras sections
  function createTeamCard(teamName, result) {
    const card = document.createElement('div');
    card.style.cssText = `
      background: white;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      border-left: 4px solid #3b82f6;
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
      background: linear-gradient(135deg, #3b82f6, #1d4ed8);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: bold;
    `;
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
        infoGrid.style.cssText = `
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
          gap: 12px;
        `;

        const teamInfo = [
          ['Founded', team.team_founded || team.intFormedYear || 'N/A'],
          ['Stadium', team.team_venue || team.strStadium || 'N/A'],
          ['Manager', team.team_manager || team.strManager || 'N/A'],
          ['League', team.league_name || team.strLeague || 'N/A'],
          ['Country', team.team_country || team.strCountry || 'N/A']
        ].filter(([label, value]) => value && value !== 'N/A');

        teamInfo.forEach(([label, value]) => {
          const item = document.createElement('div');
          item.style.cssText = `
            padding: 8px;
            background: #f8fafc;
            border-radius: 6px;
          `;
          item.innerHTML = `
            <div style="font-size: 11px; color: #6b7280; font-weight: 500; margin-bottom: 2px;">${label}</div>
            <div style="color: #1f2937; font-weight: 600; font-size: 13px;">${value}</div>
          `;
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
    card.style.cssText = `
      background: white;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      border-left: 4px solid #10b981;
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
      background: linear-gradient(135deg, #10b981, #059669);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: bold;
    `;
    icon.textContent = '👥';

    const title = document.createElement('h4');
    title.style.cssText = 'margin: 0; color: #1f2937; font-size: 18px;';
    title.textContent = `${teamName} Squad`;

    header.appendChild(icon);
    header.appendChild(title);
    card.appendChild(header);

    // Normalize players array from many provider shapes (AllSports uses data.result)
    let players = [];
    let errorMsg = null;
    try {
      if (!result) {
        players = [];
      } else if (result.status === 'rejected') {
        errorMsg = (result.reason && result.reason.message) ? result.reason.message : 'Request rejected';
      } else if (result.status === 'fulfilled' && result.value) {
        const v = result.value;
        // prefer v.data.result (AllSports), then v.data, then v.result / v.players
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
        // some providers nest under value.result.result
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
    playersGrid.style.cssText = `
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 8px;
      max-height: 360px;
      overflow-y: auto;
      padding-right: 6px;
    `;

    players.slice(0, 40).forEach(player => {
      const playerItem = document.createElement('div');
      playerItem.style.cssText = `
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px;
        background: #f8fafc;
        border-radius: 6px;
        border: 1px solid #e2e8f0;
      `;

      const imgWrap = document.createElement('div');
      imgWrap.style.cssText = `
        width: 48px;
        height: 48px;
        border-radius: 8px;
        overflow: hidden;
        flex-shrink: 0;
        background: linear-gradient(135deg,#e6eefc,#dbeafe);
        display:flex;align-items:center;justify-content:center;
      `;

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

      const rating = document.createElement('div');
      rating.style.cssText = 'font-size:11px;color:#111827;font-weight:600;background:#eef2ff;padding:2px 6px;border-radius:6px;';
      const ratingVal = player.player_rating || player.rating || player.player_rating || player.player_rating;
      rating.textContent = ratingVal ? `★ ${String(ratingVal)}` : '';

      const stats = document.createElement('div');
      stats.style.cssText = 'font-size:11px;color:#6b7280;';
      const goals = player.player_goals || player.goals || player.scored || '';
      const assists = player.player_assists || player.assists || '';
      const minutes = player.player_minutes || player.minutes || '';
      const parts = [];
      if (goals !== undefined && goals !== null && String(goals).trim() !== '') parts.push(`G:${goals}`);
      if (assists !== undefined && assists !== null && String(assists).trim() !== '') parts.push(`A:${assists}`);
      if (minutes !== undefined && minutes !== null && String(minutes).trim() !== '') parts.push(`${minutes}m`);
      stats.textContent = parts.join(' • ');

      metaRow.appendChild(position);
      if (rating.textContent) metaRow.appendChild(rating);
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
    card.style.cssText = `
      background: white;
      border-radius: 12px;
      padding: 16px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      border-left: 4px solid #f59e0b;
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
      background: linear-gradient(135deg, #f59e0b, #d97706);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: bold;
    `;
    icon.textContent = '🏆';

    const title = document.createElement('h4');
    title.style.cssText = 'margin: 0; color: #1f2937; font-size: 18px;';
    title.textContent = 'League Table';

    header.appendChild(icon);
    header.appendChild(title);
    card.appendChild(header);

    // Normalize many possible shapes returned by different providers (AllSports uses result.total)
    let teams = [];
    if (Array.isArray(data)) {
      teams = data;
    } else if (data) {
      // common shapes
      if (Array.isArray(data.total)) teams = data.total;
      else if (Array.isArray(data.teams)) teams = data.teams;
      else if (Array.isArray(data.result)) teams = data.result;
      else if (Array.isArray(data.table)) teams = data.table;
      else if (Array.isArray(data.standings)) teams = data.standings;
      else if (Array.isArray(data.rows)) teams = data.rows;
      else if (Array.isArray(data.rows_list)) teams = data.rows_list;
      else if (Array.isArray(data.league_table)) teams = data.league_table;
      // providers sometimes wrap under result.total or data.result.total
      else if (data.result && Array.isArray(data.result.total)) teams = data.result.total;
      else if (data.data && Array.isArray(data.data.total)) teams = data.data.total;
      else teams = [];
    }

    if(Array.isArray(teams) && teams.length > 0) {
      const table = document.createElement('div');
      table.style.cssText = 'overflow-x: auto;';

      const tableHeader = document.createElement('div');
      tableHeader.style.cssText = `
        display: grid;
        grid-template-columns: 40px 1fr 60px 60px 60px 60px 60px;
        gap: 8px;
        padding: 8px;
        background: #f8fafc;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        color: #6b7280;
        margin-bottom: 4px;
      `;
      tableHeader.innerHTML = '<div>Pos</div><div>Team</div><div>P</div><div>W</div><div>D</div><div>L</div><div>PTS</div>';

      table.appendChild(tableHeader);

      teams.slice(0, 10).forEach((team, index) => {
        const row = document.createElement('div');
        row.style.cssText = `
          display: grid;
          grid-template-columns: 40px 1fr 60px 60px 60px 60px;
          gap: 8px;
          padding: 8px;
          border-radius: 6px;
          font-size: 13px;
          ${index % 2 === 0 ? 'background: #f9fafb;' : ''}
          border-left: 3px solid ${getPositionColor(index + 1)};
        `;

        // Support AllSports 'standing_*' fields and common alternatives
        const position = team.standing_place || team.position || team.overall_league_position || (index + 1);
        const teamName = team.standing_team || team.team_name || team.strTeam || team.name || 'Unknown';
        const played = team.standing_P || team.standing_P || team.overall_league_payed || team.overall_league_played || team.played || team.matches || team.games || '-';
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

    // Debug: show raw payload toggle to inspect provider response shapes
    try{
      const dbgWrap = document.createElement('div');
      dbgWrap.style.cssText = 'margin-top:12px;';
      const dbgBtn = document.createElement('button');
      dbgBtn.textContent = 'Show raw JSON';
      dbgBtn.style.cssText = 'font-size:12px;padding:6px 10px;border-radius:8px;background:#f3f4f6;border:1px solid #e5e7eb;cursor:pointer;';
      const pre = document.createElement('pre');
      pre.style.cssText = 'display:none;max-height:240px;overflow:auto;background:#0f1724;color:#e6eef6;padding:12px;border-radius:8px;margin-top:8px;';
      pre.textContent = JSON.stringify(data, null, 2);
      dbgBtn.addEventListener('click', ()=>{
        if(pre.style.display === 'none'){
          pre.style.display = 'block'; dbgBtn.textContent = 'Hide raw JSON';
        } else { pre.style.display = 'none'; dbgBtn.textContent = 'Show raw JSON'; }
      });
      dbgWrap.appendChild(dbgBtn);
      dbgWrap.appendChild(pre);
      card.appendChild(dbgWrap);
    }catch(e){ /* ignore debug UI errors */ }

    return card;
  }

  function getPositionColor(position) {
    if(position <= 4) return '#10b981'; // Champions League
    if(position <= 6) return '#3b82f6'; // Europa League
    if(position >= 18) return '#ef4444'; // Relegation
    return '#6b7280'; // Mid-table
  }

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
          row132.innerHTML = `<div style="color:#6b7280;font-weight:600">1X2</div><div style="display:flex;gap:8px"><span style=\"color:#3b82f6;\">H:${h}</span><span style=\"color:#f59e0b;\">D:${d}</span><span style=\"color:#ef4444;\">A:${a}</span></div>`;
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
    card.style.cssText = `
      background: white;
      border-radius: 12px;
      padding: 16px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      border-left: 4px solid #06b6d4;
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
      background: linear-gradient(135deg, #06b6d4, #0891b2);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: bold;
    `;
    icon.textContent = '📊';

    const title = document.createElement('h4');
    title.style.cssText = 'margin: 0; color: #1f2937; font-size: 18px;';
    title.textContent = 'Match Probabilities';

    header.appendChild(icon);
    header.appendChild(title);
    card.appendChild(header);

    // Normalize the various shapes providers return to a single probability object
    let obj = null;
    try{
      if(!data) obj = null;
      else if(Array.isArray(data) && data.length>0) obj = data[0];
      else if(Array.isArray(data.result) && data.result.length>0) obj = data.result[0];
      else if(Array.isArray(data.data) && data.data.length>0) obj = data.data[0];
      else if(data.probabilities && Array.isArray(data.probabilities) && data.probabilities.length>0) obj = data.probabilities[0];
      else obj = data.result || data.data || data.probabilities || data;
      if(obj && Array.isArray(obj) && obj.length===0) obj = null;
    }catch(e){ obj = null; }

    if(!obj) {
      const noData = document.createElement('div');
      noData.style.cssText = 'color: #6b7280; font-style: italic; text-align: center; padding: 20px;';
      noData.textContent = 'No probability data available';
      card.appendChild(noData);
      return card;
    }

    // Helper to parse numeric-like strings (AllSports returns strings like "73.00")
    const p = (v) => {
      if(v === null || v === undefined || v === '') return 0;
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    };

    // Primary 1X2 probabilities (AllSports: event_HW, event_D, event_AW)
    const home = p(obj.event_HW || obj.prob_HW || obj.home || obj.prob_home || obj.home_prob || obj.homeProbability);
    const draw = p(obj.event_D || obj.prob_D || obj.draw || obj.prob_draw || obj.draw_prob);
    const away = p(obj.event_AW || obj.prob_AW || obj.away || obj.prob_away || obj.away_prob || obj.awayProbability);

    const probBars = document.createElement('div');
    probBars.style.cssText = 'margin-bottom: 12px;';

    ['Home Win', 'Draw', 'Away Win'].forEach((label, index) => {
      const value = [home, draw, away][index] || 0;
      const color = ['#3b82f6', '#f59e0b', '#ef4444'][index];

      const barContainer = document.createElement('div');
      barContainer.style.cssText = 'margin-bottom: 10px;';

      const labelRow = document.createElement('div');
      labelRow.style.cssText = `
        display: flex;
        justify-content: space-between;
        margin-bottom: 6px;
        font-size: 13px;
      `;
      labelRow.innerHTML = `<span style="color: #1f2937; font-weight: 500;">${label}</span><span style="color: ${color}; font-weight: 600;">${value.toFixed(1)}%</span>`;

      const bar = document.createElement('div');
      bar.style.cssText = `
        height: 8px;
        background: #e5e7eb;
        border-radius: 4px;
        overflow: hidden;
      `;

      const fill = document.createElement('div');
      fill.style.cssText = `
        height: 100%;
        width: ${Math.max(0, Math.min(100, value))}%;
        background: ${color};
        transition: width 0.3s ease;
      `;

      bar.appendChild(fill);
      barContainer.appendChild(labelRow);
      barContainer.appendChild(bar);
      probBars.appendChild(barContainer);
    });

    card.appendChild(probBars);

    // Additional probability breakdowns (BTTS, Over/Under variants, AH slices)
    const extras = document.createElement('div');
    extras.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;';

    // BTTS
    if(obj.event_bts !== undefined || obj.bts !== undefined || obj.event_btts !== undefined) {
      const btsVal = p(obj.event_bts || obj.bts || obj.event_btts);
      const bts = document.createElement('div');
      bts.style.cssText = 'padding:8px;background:#f8fafc;border-radius:8px;border:1px solid #e6eef6;min-width:120px;';
      bts.innerHTML = `<div style="font-size:12px;color:#6b7280;font-weight:600;margin-bottom:6px">BTTS</div><div style="font-weight:700;color:#10b981">${btsVal.toFixed(1)}%</div>`;
      extras.appendChild(bts);
    }

    // General O/U pair
    if(obj.event_O !== undefined && obj.event_U !== undefined) {
      const o = p(obj.event_O), u = p(obj.event_U);
      const ou = document.createElement('div');
      ou.style.cssText = 'padding:8px;background:#f8fafc;border-radius:8px;border:1px solid #e6eef6;min-width:160px;';
      ou.innerHTML = `<div style="font-size:12px;color:#6b7280;font-weight:600;margin-bottom:6px">Over / Under (general)</div><div style="font-weight:700;color:#3b82f6">O: ${o.toFixed(1)}%</div><div style="font-weight:700;color:#ef4444">U: ${u.toFixed(1)}%</div>`;
      extras.appendChild(ou);
    }

    // Specific O/U variants (look for keys like event_O_1 / event_U_1, event_O_3 / event_U_3 etc.)
    Object.keys(obj).forEach(k => {
      const match = k.match(/^event_O_(\d+)$/);
      if(match) {
        const suffix = match[1];
        const keyO = `event_O_${suffix}`;
        const keyU = `event_U_${suffix}`;
        if(obj[keyO] !== undefined && obj[keyU] !== undefined) {
          const o = p(obj[keyO]), u = p(obj[keyU]);
          const ouv = document.createElement('div');
          ouv.style.cssText = 'padding:8px;background:#f8fafc;border-radius:8px;border:1px solid #e6eef6;min-width:160px;';
          ouv.innerHTML = `<div style="font-size:12px;color:#6b7280;font-weight:600;margin-bottom:6px">O/U ${suffix.replace(/^0+/, '')}</div><div style="font-weight:700;color:#3b82f6">O: ${o.toFixed(1)}%</div><div style="font-weight:700;color:#ef4444">U: ${u.toFixed(1)}%</div>`;
          extras.appendChild(ouv);
        }
      }
    });

    // Asian-handicap slices (event_ah_h_45 / event_ah_a_45 etc.)
    const ahKeys = Object.keys(obj).filter(k => /^event_ah_[ha]_/i.test(k));
    if(ahKeys.length > 0) {
      const ahWrap = document.createElement('div');
      ahWrap.style.cssText = 'padding:8px;background:#f8fafc;border-radius:8px;border:1px solid #e6eef6;min-width:220px;';
      const title = document.createElement('div'); title.style.cssText='font-size:12px;color:#6b7280;font-weight:600;margin-bottom:6px'; title.textContent='Asian Handicap slices';
      ahWrap.appendChild(title);
      const list = document.createElement('div'); list.style.cssText='display:flex;flex-direction:column;gap:4px;max-height:120px;overflow:auto';
      // collect unique suffixes
      const suff = new Set();
      ahKeys.forEach(k => { const m = k.match(/^event_ah_([ha])_(\d+)/i); if(m) suff.add(m[2]); });
      suff.forEach(s => {
        const hK = `event_ah_h_${s}`; const aK = `event_ah_a_${s}`;
        if(obj[hK] !== undefined || obj[aK] !== undefined) {
          const hv = p(obj[hK]), av = p(obj[aK]);
          const row = document.createElement('div'); row.style.cssText='display:flex;justify-content:space-between;gap:8px;font-size:12px';
          row.innerHTML = `<div>AH ${s}</div><div style="color:#3b82f6">H:${hv.toFixed(1)}%</div><div style="color:#ef4444">A:${av.toFixed(1)}%</div>`;
          list.appendChild(row);
        }
      });
      ahWrap.appendChild(list);
      extras.appendChild(ahWrap);
    }

    if(extras.children.length>0) card.appendChild(extras);

    // Debug raw payload toggle
    try{
      const dbg = document.createElement('details'); dbg.style.marginTop='8px';
      const summary = document.createElement('summary'); summary.textContent = 'Show raw probabilities response'; dbg.appendChild(summary);
      const pre = document.createElement('pre'); pre.style.cssText = 'max-height:240px;overflow:auto;padding:8px;background:#0b1220;color:#e6eef6;border-radius:6px;margin-top:6px'; pre.textContent = JSON.stringify(obj, null, 2);
      dbg.appendChild(pre);
      card.appendChild(dbg);
    }catch(e){}

    return card;
  }

  function createCommentsCard(data) {
    const card = document.createElement('div');
    card.style.cssText = `
      background: white;
      border-radius: 12px;
      padding: 16px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      border-left: 4px solid #ec4899;
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
      background: linear-gradient(135deg, #ec4899, #db2777);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: bold;
    `;
    icon.textContent = '💬';

    const title = document.createElement('h4');
    title.style.cssText = 'margin: 0; color: #1f2937; font-size: 18px;';
    title.textContent = 'Fan Comments';

    header.appendChild(icon);
    header.appendChild(title);
    card.appendChild(header);

    // Normalize comments from different provider shapes. AllSports returns an object keyed by match id.
    let comments = [];
    try{
      if(!data) comments = [];
      else if(Array.isArray(data)) comments = data;
      else if(Array.isArray(data.comments)) comments = data.comments;
      else if(Array.isArray(data.result)) comments = data.result;
      else if(data.result && typeof data.result === 'object'){
        // flatten object-of-arrays (e.g. { "1608408": [ ... ] })
        const vals = Object.values(data.result).filter(Boolean);
        comments = vals.reduce((acc, cur) => acc.concat(Array.isArray(cur) ? cur : []), []);
      } else if(Array.isArray(data.data)) comments = data.data;
      else if(Array.isArray(data.comments_list)) comments = data.comments_list;
    }catch(e){ comments = []; }

    if(!Array.isArray(comments) || comments.length === 0) {
      const noComments = document.createElement('div');
      noComments.style.cssText = 'color: #6b7280; font-style: italic; text-align: center; padding: 20px;';
      noComments.textContent = 'No comments available';
      card.appendChild(noComments);
      return card;
    }

    const commentsContainer = document.createElement('div');
    commentsContainer.style.cssText = `
      max-height: 380px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
    `;

    // helper to parse a time like "01:29" -> "1' 29" or simple minute
    const formatCommentTime = (t) => {
      if(!t) return '';
      if(typeof t !== 'string') return String(t);
      const parts = t.split(':').map(s => s.trim());
      if(parts.length === 2 && !isNaN(parseInt(parts[0],10))) return `${parseInt(parts[0],10)}'`;
      return t;
    };

    comments.slice(0, 200).forEach((comment, index) => {
      const commentItem = document.createElement('div');
      commentItem.style.cssText = `
        padding: 10px;
        background: ${index % 2 === 0 ? '#f9fafb' : '#ffffff'};
        border-radius: 6px;
        border-left: 3px solid #ec4899;
        display:flex;gap:12px;align-items:flex-start;
      `;

      const time = formatCommentTime(comment.comments_time || comment.time || comment.timestamp || comment.comments_time_display || '');
      const timeEl = document.createElement('div');
      timeEl.style.cssText = 'min-width:44px;background:#fff;color:#6b7280;border-radius:6px;padding:6px 8px;font-size:12px;text-align:center;border:1px solid #eef2f7;';
      timeEl.textContent = time;

      const body = document.createElement('div'); body.style.cssText='flex:1;';
      const commentText = comment.comments_text || comment.text || comment.comment || comment.message || 'No comment text';
      const author = comment.comments_state_info || comment.author || comment.user || comment.username || '';

      const textDiv = document.createElement('div'); textDiv.style.cssText='font-size:13px;color:#1f2937;margin-bottom:6px;line-height:1.3'; textDiv.textContent = commentText;
      const metaDiv = document.createElement('div'); metaDiv.style.cssText='font-size:11px;color:#6b7280;display:flex;justify-content:space-between;gap:8px;align-items:center';
      const authSpan = document.createElement('span'); authSpan.textContent = author ? `👤 ${author}` : '';
      const idSpan = document.createElement('span'); idSpan.textContent = comment.match_id ? `id:${comment.match_id}` : '';
      metaDiv.appendChild(authSpan); metaDiv.appendChild(idSpan);

      body.appendChild(textDiv); body.appendChild(metaDiv);

      commentItem.appendChild(timeEl);
      commentItem.appendChild(body);
      commentsContainer.appendChild(commentItem);
    });

    card.appendChild(commentsContainer);

    return card;
  }

  function createSeasonsCard(data) {
    const card = document.createElement('div');
    card.style.cssText = `
      background: white;
      border-radius: 12px;
      padding: 16px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      border-left: 4px solid #84cc16;
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
      background: linear-gradient(135deg, #84cc16, #65a30d);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: bold;
    `;
    icon.textContent = '📅';

    const title = document.createElement('h4');
    title.style.cssText = 'margin: 0; color: #1f2937; font-size: 18px;';
    title.textContent = 'Seasons';

    header.appendChild(icon);
    header.appendChild(title);
    card.appendChild(header);

    const seasons = data.seasons || data.result || [];
    if(Array.isArray(seasons) && seasons.length > 0) {
      const seasonsGrid = document.createElement('div');
      seasonsGrid.style.cssText = `
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
        gap: 8px;
      `;

      seasons.slice(0, 12).forEach(season => {
        const seasonItem = document.createElement('div');
        seasonItem.style.cssText = `
          padding: 12px;
          background: #f8fafc;
          border-radius: 6px;
          text-align: center;
          border: 1px solid #e2e8f0;
        `;

        const seasonName = season.season_name || season.strSeason || season.name || season.season || 'Unknown';
        
        seasonItem.innerHTML = `
          <div style="font-weight: 600; color: #1f2937; font-size: 14px;">${seasonName}</div>
        `;

        seasonsGrid.appendChild(seasonItem);
      });

      card.appendChild(seasonsGrid);
    } else {
      const noSeasons = document.createElement('div');
      noSeasons.style.cssText = 'color: #6b7280; font-style: italic; text-align: center; padding: 20px;';
      noSeasons.textContent = 'No seasons information available';
      card.appendChild(noSeasons);
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

          // Build row with logos and names (like matches.js)
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

          // Make row clickable to open match details if available
          matchItem.style.cursor = 'pointer';
          matchItem.addEventListener('click', ()=>{
            try{ if(typeof showDetails === 'function'){ showDetails(match); } }
            catch(e){ console.warn('showDetails error', e); }
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

  // --- New feature integrations ---
  async function augmentEventTags(ev){
    const pre = modalBody.querySelector('pre');
    const hlBody = modalBody.querySelector('#highlights .hl-body');
    if(hlBody) hlBody.textContent = 'Augmenting tags...';
    const args = {};
    if(ev.idEvent) args.eventId = ev.idEvent; else if(ev.event_key) args.eventId = ev.event_key;
    try{
      // attempt to use a local model path (frontend dev environment) if available
  // point to model file location on the server filesystem (relative to project root)
  const modelPath = window.EVENT_TAG_MODEL_PATH || 'sports-ai/backend/app/models/event_tag_model.pkl';
      const resp = await fetch(apiBase + '/collect', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ intent: 'event.get', args: Object.assign({ augment_tags: true, model_path: modelPath }, args) }) });
      if(!resp.ok) throw new Error('HTTP '+resp.status);
      const j = await resp.json();
      if(!j || !j.ok) throw new Error((j && j.error && j.error.message) ? j.error.message : 'No data');
      // update displayed JSON and highlights status
      pre.textContent = JSON.stringify(j.data || j.result || j, null, 2);
      if(hlBody) hlBody.textContent = 'Tags augmented (see Timeline items for predicted_tags).';

      // merge predicted_tags into our in-memory ev.timeline if present in response
      try{
        const retEvent = (j.data && j.data.result && j.data.result[0]) ? j.data.result[0] : (j.data && j.data.event) ? j.data.event : null;
        if(retEvent && Array.isArray(retEvent.timeline)){
          // robust merge: try exact key (minute+desc), minute+substring, player match, then index fallback
          const localTimeline = Array.isArray(ev.timeline) ? ev.timeline : [];
          const keyOf = item => `${item.minute || ''}||${(item.description||'').slice(0,80)}`;
          const localMap = new Map((localTimeline||[]).map(i=>[keyOf(i), i]));

          const unmatched = [];
          retEvent.timeline.forEach((rt, idx) => {
            try{
              let local = null;
              // 1) exact key
              const k = keyOf(rt);
              if(localMap.has(k)) local = localMap.get(k);

              // 2) minute + description contains
              if(!local && (rt.minute || rt.time)){
                const m = rt.minute || rt.time || '';
                const rdesc = (rt.description || rt.text || '').toLowerCase();
                local = localTimeline.find(li => {
                  const ld = (li.description || li.text || '').toLowerCase();
                  return String(li.minute || '') === String(m) && (rdesc && ld.includes(rdesc) || rdesc && rdesc.includes(ld) || ld.includes((rdesc||'').slice(0,20)));
                }) || null;
              }

              // 3) player-based match
              if(!local){
                const rplayer = (rt.player || rt.player_in || rt.player_out || rt.scorer || '').toString().toLowerCase();
                if(rplayer){
                  local = localTimeline.find(li => {
                    const lplayer = (li.player || li.player_in || li.player_out || '').toString().toLowerCase();
                    return lplayer && rplayer && (lplayer === rplayer || lplayer.includes(rplayer) || rplayer.includes(lplayer));
                  }) || null;
                }
              }

              // 4) fallback to same index when counts match or index exists
              if(!local && idx < localTimeline.length){
                local = localTimeline[idx];
              }

              if(local){
                local.predicted_tags = rt.predicted_tags || rt.predictedTags || rt.tags || local.predicted_tags || [];
              } else {
                unmatched.push({ idx, rt });
              }
            }catch(e){ console.warn('merge item failed', e, rt); }
          });

          if(unmatched.length) console.debug('augment merge: unmatched items', unmatched.length, unmatched.slice(0,5));

          // If no local items got tags but the returned timeline has tags, fallback to index-copying
          try{
            const localHasAny = (localTimeline || []).some(i => Array.isArray(i.predicted_tags) && i.predicted_tags.length>0);
            const retHasAny = Array.isArray(retEvent.timeline) && retEvent.timeline.some(i => Array.isArray(i.predicted_tags) && i.predicted_tags.length>0);
            if(!localHasAny && retHasAny){
              if(localTimeline.length === 0){
                // replace entirely
                ev.timeline = retEvent.timeline.map(x=>({ ...x }));
                console.debug('augment merge: replaced local timeline with returned timeline (fallback)');
              } else {
                // copy by index where possible
                for(let i=0;i<Math.min(localTimeline.length, retEvent.timeline.length); i++){
                  const r = retEvent.timeline[i];
                  if(r && (r.predicted_tags || r.predictedTags || r.tags)){
                    localTimeline[i].predicted_tags = r.predicted_tags || r.predictedTags || r.tags || localTimeline[i].predicted_tags || [];
                  }
                }
                console.debug('augment merge: applied index-based fallback merge');
              }
            }
          }catch(e){ console.warn('augment merge fallback failed', e); }

          // re-render details to reflect updated tags
          renderEventDetails(ev, modalBody.querySelector('#details_info'));
        }
      }catch(e){ console.warn('merge augment failed', e); }
    }catch(e){ if(hlBody) hlBody.textContent = 'Augment error: ' + (e && e.message ? e.message : String(e)); }
  }

  async function runPlayerAnalytics(ev){
    // Ask user for player name or id
    let player = '';
    // try to auto-suggest a likely goal-scorer from event (not always available)
    if(ev.scorers && ev.scorers.length) player = ev.scorers[0].name || '';
    const val = window.prompt('Enter player name or id for analytics', player || '');
    if(!val) return;
    const analyticsRootId = 'analytics_section';
    let analyticsSection = modalBody.querySelector('#'+analyticsRootId);
    if(!analyticsSection){
      analyticsSection = document.createElement('div'); analyticsSection.id = analyticsRootId; analyticsSection.className='extra-section';
      analyticsSection.innerHTML = `<h4>Analytics</h4><div class="body">Loading analytics...</div>`;
      const extrasBody = modalBody.querySelector('#extras .extras-body'); if(extrasBody) extrasBody.insertBefore(analyticsSection, extrasBody.firstChild);
    }
    const body = analyticsSection.querySelector('.body'); if(body) body.textContent = 'Loading analytics...';
    try{
      const args = { playerName: val, recent_games: 10 };
      const resp = await fetch(apiBase + '/collect', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ intent: 'player.performance_analytics', args }) });
      if(!resp.ok) throw new Error('HTTP '+resp.status);
      const j = await resp.json();
      if(!j || !j.ok) throw new Error((j && j.error && j.error.message) ? j.error.message : 'No data');
      renderAnalytics(j.data || j.result || j, analyticsSection.querySelector('.body'));
    }catch(e){ if(body) body.textContent = 'Analytics error: ' + (e && e.message ? e.message : String(e)); }
  }

  function renderAnalytics(data, root){
    if(!root) return;
    root.innerHTML = '';
    const pre = document.createElement('pre'); pre.textContent = JSON.stringify(data, null, 2); root.appendChild(pre);
    // small summary if available
    if(data && data.streak){ const s = document.createElement('div'); s.style.marginTop='.5rem'; s.textContent = `Hot streak: ${data.streak.description || data.streak.type || ''} (score ${data.streak.score || ''})`; root.appendChild(s); }
  }

  async function runMultimodalExtract(ev){
    const url = window.prompt('Enter YouTube URL for multimodal extraction (or cancel):', '');
    if(!url) return;
    const hlBody = modalBody.querySelector('#highlights .hl-body'); if(hlBody) hlBody.textContent = 'Running multimodal extraction...';
    try{
      const args = { youtube_url: url, clip_duration: 30 };
      const resp = await fetch(apiBase + '/collect', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ intent: 'highlights.multimodal.extract', args }) });
      if(!resp.ok) throw new Error('HTTP '+resp.status);
      const j = await resp.json();
      if(!j || !j.ok) throw new Error((j && j.error && j.error.message) ? j.error.message : 'No data');
      // render returned clips or metadata into highlights area
      const clips = j.data && (j.data.clips || j.data.results || j.data.videos) ? (j.data.clips || j.data.results || j.data.videos) : [];
      renderMultimodalResults(clips, hlBody);
    }catch(e){ if(hlBody) hlBody.textContent = 'Multimodal error: ' + (e && e.message ? e.message : String(e)); }
  }

  function renderMultimodalResults(clips, container){
    if(!container) return;
    container.innerHTML = '';
    if(!Array.isArray(clips) || clips.length===0){ container.textContent = 'No clips returned.'; return; }
    const list = document.createElement('div'); list.className='hl-list';
    clips.forEach(c=>{
      const item = document.createElement('div'); item.className='hl-item';
      const title = c.title || c.name || (c.start ? `Clip ${c.start}-${c.end || ''}` : 'Clip');
      const url = c.url || c.video_url || c.youtube || c.strYoutube || '';
      const meta = document.createElement('div'); meta.className='hl-meta';
      const t = document.createElement('div'); t.className='hl-title'; t.textContent = title; meta.appendChild(t);
      if(url){ const a = document.createElement('a'); a.href = url; a.target='_blank'; a.rel='noopener noreferrer'; a.textContent='Open'; a.className='hl-link'; meta.appendChild(a); }
      if(c.score) { const info = document.createElement('div'); info.className='hl-info'; info.textContent = 'score: '+String(c.score); meta.appendChild(info); }
      item.appendChild(meta); list.appendChild(item);
    });
    container.appendChild(list);
  }

  async function fetchHighlights(ev){
    const container = modalBody.querySelector('#highlights .hl-body');
    if(!container) return;
    container.textContent = 'Loading highlights...';
    const args = {};
    if(ev.idEvent) args.eventId = ev.idEvent;
    else if(ev.event_key) args.eventId = ev.event_key;
    const evtName = ev.strEvent || (ev.event_home_team && ev.event_away_team ? `${ev.event_home_team} vs ${ev.event_away_team}` : '');
    if(evtName) args.eventName = evtName;
    try{
      const resp = await fetch(apiBase + '/collect', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({intent:'video.highlights', args}) });
      if(!resp.ok){ container.textContent = 'Highlights request failed: HTTP ' + resp.status; return; }
      const j = await resp.json();
      if(!j || !j.ok){ const msg = (j && j.error && j.error.message) ? j.error.message : 'No highlights available'; container.textContent = 'No highlights: ' + msg; return; }
      const body = j.data || {};
      let vids = body.videos || body.result || body.results || body.event || body.events || [];
      if(!Array.isArray(vids)) vids = [];
      if(vids.length === 0){ container.textContent = 'No highlights found.'; return; }
      renderHighlights(vids, container);
      addEventHighlightSearchUI(container, ev);
    }catch(e){ container.textContent = 'Highlights fetch error: ' + (e && e.message ? e.message : String(e)); }
  }

  function renderHighlights(vids, container){
    container.innerHTML = '';
    const list = document.createElement('div'); list.className = 'hl-list';
    vids.forEach(v => {
      const item = document.createElement('div'); item.className = 'hl-item';
      const title = v.title || v.strTitle || v.strVideo || v.name || v.video_title || v.title_short || '';
      const url = v.strVideo || v.url || v.link || v.video_url || v.strYoutube || v.strYoutubeUrl || v.video || v.source || '';
      const thumb = v.strThumb || v.thumbnail || v.thumb || v.strThumbBig || v.cover || '';
      if(thumb){ const img = document.createElement('img'); img.className = 'hl-thumb'; img.src = thumb; img.alt = title || 'highlight'; img.onerror = () => img.remove(); item.appendChild(img); }
      const meta = document.createElement('div'); meta.className = 'hl-meta'; const t = document.createElement('div'); t.className = 'hl-title'; t.textContent = title || (url ? url : 'Video'); meta.appendChild(t);
      if(url){ const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'Open'; a.className = 'hl-link'; meta.appendChild(a); }
      const info = document.createElement('div'); info.className = 'hl-info'; if(v.source) info.textContent = v.source; else if(v._source) info.textContent = v._source; else if(v._sources) info.textContent = String(v._sources.join(',')); if(v.duration) info.textContent += (info.textContent ? ' • ' : '') + String(v.duration); if(info.textContent) meta.appendChild(info);
      item.appendChild(meta); list.appendChild(item);
    });
    container.appendChild(list);
    addEventHighlightSearchUI(container, currentEventContext);
  }

  let currentEventContext = null;

  // --- AI Match Summary ---
  async function fetchMatchSummary(ev){
    const container = modalBody.querySelector('#summary_section .summary-body');
    if(!container) return;
    container.textContent = 'Loading summary…';

  // Build payload: prefer eventId; fallback to event name and date
  const payload = { provider: 'auto' };
  // Align selection order with matches.js so we pick canonical ids first
  const eventId = ev.idEvent || ev.event_key || ev.id || ev.match_id;
  if (eventId) payload.eventId = String(eventId);
  const home = ev.event_home_team || ev.strHomeTeam || ev.home_team || '';
  const away = ev.event_away_team || ev.strAwayTeam || ev.away_team || '';
  // Prefer explicit home vs away naming like matches.js
  if (home && away) payload.eventName = `${home} vs ${away}`;
    const date = ev.event_date || ev.dateEvent || ev.date || '';
    if(date) payload.date = date;

    try{
      console.debug('[summarizer] POST', apiBase + '/summarizer/summarize', 'payload=', payload);
      const resp = await fetch(apiBase + '/summarizer/summarize', {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)
      });
      if(!resp.ok){
        const txt = await resp.text().catch(()=> '');
        throw new Error(`HTTP ${resp.status} ${txt}`.trim());
      }
      const j = await resp.json();
      renderSummary(j, container);
    }catch(e){
      container.textContent = 'Unable to load summary.';
      console.error('fetchMatchSummary error:', e);
    }
  }

  function renderSummary(summary, container){
    if(!container) return;
    container.innerHTML = '';
    if(!summary || summary.ok === false){
      container.textContent = 'No summary available.';
      return;
    }
    const wrap = document.createElement('div');
    wrap.style.cssText = 'background:#fff;border-radius:12px;padding:16px;box-shadow:0 2px 10px rgba(0,0,0,0.08);';

    if(summary.headline){
      const h = document.createElement('h4');
      h.style.cssText = 'margin:0 0 8px 0;color:#111827;font-size:18px;';
      h.textContent = summary.headline;
      wrap.appendChild(h);
    }

    if(summary.one_paragraph){
      const p = document.createElement('p');
      p.style.cssText = 'margin:0 0 10px 0;color:#374151;line-height:1.4;';
      p.textContent = summary.one_paragraph;
      wrap.appendChild(p);
    }

    if(Array.isArray(summary.bullets) && summary.bullets.length){
      const ul = document.createElement('ul');
      ul.style.cssText = 'margin:8px 0 0 1rem;color:#374151;';
      summary.bullets.slice(0,6).forEach(b=>{ const li=document.createElement('li'); li.textContent=String(b); ul.appendChild(li); });
      wrap.appendChild(ul);
    }

    const meta = summary.source_meta || {};
    const bundle = meta.bundle || {};
    const metaLine = document.createElement('div');
    metaLine.style.cssText = 'margin-top:8px;font-size:12px;color:#6b7280;';
    const prov = meta.provider_used ? `via ${meta.provider_used}` : '';
    const idInfo = bundle.event_id ? `id ${bundle.event_id}` : '';
    metaLine.textContent = [prov, idInfo].filter(Boolean).join(' · ');
    if(metaLine.textContent) wrap.appendChild(metaLine);

    container.appendChild(wrap);
  }

  function addEventHighlightSearchUI(container, ev){
    currentEventContext = ev;
    if(container.querySelector('.event-highlight-search')) return;
    const wrap = document.createElement('div'); wrap.className = 'event-highlight-search'; wrap.innerHTML = `
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
    const form = wrap.querySelector('form'); const status = wrap.querySelector('.ehs-status'); const resultsDiv = wrap.querySelector('.ehs-results'); const ytBtn = form.querySelector('button[data-action="openYt"]');
    ytBtn.addEventListener('click', ()=>{ const baseQuery = buildBaseQuery(ev, form.minute.value, form.player.value, form.event_type.value); window.open('https://www.youtube.com/results?search_query=' + encodeURIComponent(baseQuery), '_blank'); });
    form.addEventListener('submit', async (e)=>{ e.preventDefault(); resultsDiv.innerHTML = ''; status.textContent = 'Searching...'; try{ const params = new URLSearchParams(); params.set('home', ev.event_home_team || ev.strHomeTeam || ''); params.set('away', ev.event_away_team || ev.strAwayTeam || ''); if(ev.event_date) params.set('date', ev.event_date); const minute = form.minute.value.trim(); if(minute) params.set('minute', minute); const player = form.player.value.trim(); if(player) params.set('player', player); const eventType = form.event_type.value.trim(); if(eventType) params.set('event_type', eventType); const url = apiBase + '/highlight/event?' + params.toString(); const r = await fetch(url); if(!r.ok) throw new Error('HTTP '+r.status); const j = await r.json(); if(!j || j.ok === false) throw new Error(j && j.error && j.error.message ? j.error.message : 'Search failed'); status.textContent = 'Query: ' + (j.query || '(unknown)') + ' — Variants: ' + (j.variants ? j.variants.length : 0); renderEventHighlightResults(j, resultsDiv); }catch(err){ status.textContent = 'Error: ' + (err && err.message ? err.message : String(err)); } });
  }

  function renderEventHighlightResults(j, root){
    root.innerHTML = '';
    const scraped = (j.results && j.results.duckduckgo_scraped) || [];
    if(scraped.length){ const list = document.createElement('div'); list.className='ehs-list'; scraped.forEach(r=>{ const row = document.createElement('div'); row.className='ehs-item'; const a = document.createElement('a'); a.href = r.url; a.textContent = r.title || r.url; a.target='_blank'; a.rel='noopener noreferrer'; row.appendChild(a); if(r.videoId){ const small = document.createElement('span'); small.style.fontSize='.7rem'; small.style.marginLeft='.5rem'; small.textContent='('+r.videoId+')'; row.appendChild(small); } list.appendChild(row); }); root.appendChild(list); } else { const none = document.createElement('div'); none.textContent='No direct video links scraped. Use search links below.'; root.appendChild(none); }
    const links = document.createElement('div'); links.className='ehs-links'; links.style.marginTop='.5rem'; const yt = document.createElement('a'); yt.href = j.results.youtube_search_url; yt.target='_blank'; yt.rel='noopener'; yt.textContent='Open YouTube Search'; links.appendChild(yt); const web = document.createElement('a'); web.href = j.results.duckduckgo_search_url; web.target='_blank'; web.rel='noopener'; web.style.marginLeft='1rem'; web.textContent='Open Web Search'; links.appendChild(web); root.appendChild(links);
  }

  // small helper used by fetchExtras
  function _pick(obj, keys){ for(const k of keys) if(obj && obj[k]) return obj[k]; return undefined; }

  async function fetchExtras(ev){
    const extrasRoot = modalBody.querySelector('#extras');
    if(!extrasRoot) return;

  const get = (klist) => _pick(ev, klist) || '';
  const eventId = get(['idEvent','event_key','id', 'event_key']);
  const leagueId = get(['league_key','idLeague','league_key']);
  const leagueName = get(['league_name','strLeague','league_name']);
  const homeName = get(['event_home_team','strHomeTeam','home_team','strHomeTeam']);
  const awayName = get(['event_away_team','strAwayTeam','away_team','strAwayTeam']);
  const homeKey = _pick(ev, ['home_team_key','home_team_id','homeId','homeTeamId','event_home_team_key','event_home_team_id']) || '';
  const awayKey = _pick(ev, ['away_team_key','away_team_id','awayId','awayTeamId','event_away_team_key','event_away_team_id']) || '';

    // Helper to call /collect
    async function callIntent(intent, args){
      const resp = await fetch(apiBase + '/collect', {
        method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({intent, args})
      });
      if(!resp.ok) throw new Error('HTTP '+resp.status+' for '+intent);
      return resp.json();
    }

    // Detect whether a /collect response (or a settled result) contains usable data
    function _responseHasData(res){
      try{
        // accept either a settled result ({status:'fulfilled', value:...}) or a direct response object
        const v = (res && res.status === 'fulfilled') ? res.value : res;
        if(!v) return false;
        const payload = v.data || v.result || v.probabilities || v.comments || v || {};

        const isNonEmptyArray = x => Array.isArray(x) && x.length > 0;
        if(isNonEmptyArray(payload)) return true;

        const arrFields = ['result','data','seasons','teams','players','odds','probabilities','comments','comments_list','total','rows','standings'];
        for(const f of arrFields) if(isNonEmptyArray(payload[f])) return true;

        // object-of-arrays (AllSports): check any array value
        if(typeof payload === 'object'){
          const vals = Object.values(payload).filter(Boolean);
          if(vals.some(vv => Array.isArray(vv) && vv.length>0)) return true;
        }

        // probabilities: check for presence of event_* fields
        if(payload && payload.result && Array.isArray(payload.result) && payload.result.length>0){
          const first = payload.result[0];
          if(first && (first.event_HW || first.event_D || first.event_AW || first.event_bts || first.event_O || first.event_U)) return true;
        }

        return false;
      }catch(e){ return false; }
    }

    // Teams: try to fetch team.get / teams.list for home and away
    const teamsBody = modalBody.querySelector('#teams_section .body');
    teamsBody.textContent = 'Loading teams...';
    try{
      const p = [];
  // Prefer team IDs when available (AllSports uses home_team_key / away_team_key)
  if(homeKey && String(homeKey).match(/^\d+$/)) p.push(callIntent('team.get', {teamId: String(homeKey)}));
  else if(homeName) p.push(callIntent('team.get', {teamName: homeName}));
  if(awayKey && String(awayKey).match(/^\d+$/)) p.push(callIntent('team.get', {teamId: String(awayKey)}));
  else if(awayName) p.push(callIntent('team.get', {teamName: awayName}));
      const res = await Promise.allSettled(p);
      teamsBody.innerHTML = '';
      res.forEach((r, idx)=>{
        const title = idx===0 ? (homeName||'Home') : (awayName||'Away');
        const teamCard = createTeamCard(title, r);
        teamsBody.appendChild(teamCard);
      });
  // debug raw responses
      try{
        const dbg = document.createElement('details'); dbg.style.marginTop='8px';
        const summary = document.createElement('summary'); summary.textContent = 'Show raw teams responses'; dbg.appendChild(summary);
        const pre = document.createElement('pre'); pre.style.cssText='max-height:240px;overflow:auto;padding:8px;background:#0b1220;color:#e6eef6;border-radius:6px;margin-top:6px'; pre.textContent = JSON.stringify(res, null, 2);
        dbg.appendChild(pre);
        teamsBody.appendChild(dbg);
      }catch(e){}
  // hide section if no data
  try{ const teamsSectionEl = modalBody.querySelector('#teams_section'); if(teamsSectionEl) teamsSectionEl.style.display = _responseHasData(res[0]) || _responseHasData(res[1]) ? 'block' : 'none'; }catch(e){}
    }catch(e){ teamsBody.textContent = 'Teams error: '+e.message; }

    // Players: try players.list for each teamName if available
    const playersBody = modalBody.querySelector('#players_section .body');
    playersBody.textContent = 'Loading players...';
    try{
      const tasks = [];
  // Prefer team IDs for players.list
  if(homeKey && String(homeKey).match(/^\d+$/)) tasks.push(callIntent('players.list',{teamId: String(homeKey)}));
  else if(homeName) tasks.push(callIntent('players.list',{teamName: homeName}));
  if(awayKey && String(awayKey).match(/^\d+$/)) tasks.push(callIntent('players.list',{teamId: String(awayKey)}));
  else if(awayName) tasks.push(callIntent('players.list',{teamName: awayName}));
      const rr = await Promise.allSettled(tasks);
      playersBody.innerHTML = '';
      rr.forEach((r, idx)=>{
        const lbl = idx===0 ? (homeName||'Home') : (awayName||'Away');
        const playerCard = createPlayersCard(lbl, r);
        playersBody.appendChild(playerCard);
      });
        // debug raw players responses
        try{
          const dbgP = document.createElement('details'); dbgP.style.marginTop='8px';
          const summaryP = document.createElement('summary'); summaryP.textContent = 'Show raw players responses'; dbgP.appendChild(summaryP);
          const preP = document.createElement('pre'); preP.style.cssText='max-height:240px;overflow:auto;padding:8px;background:#0b1220;color:#e6eef6;border-radius:6px;margin-top:6px'; preP.textContent = JSON.stringify(rr, null, 2);
          dbgP.appendChild(preP);
          playersBody.appendChild(dbgP);
        }catch(e){}
    // hide players section if no results
    try{ const playersSectionEl = modalBody.querySelector('#players_section'); if(playersSectionEl) playersSectionEl.style.display = (_responseHasData(rr[0]) || _responseHasData(rr[1])) ? 'block' : 'none'; }catch(e){}
    }catch(e){ playersBody.textContent = 'Players error: '+e.message; }

    // League table
    const tableBody = modalBody.querySelector('#league_table_section .body');
    tableBody.textContent = 'Loading league table...';
    try{
      const args = {};
      // league.table may accept leagueId, idLeague or leagueKey depending on backend
      if(leagueId) {
        args.leagueId = leagueId;
        args.idLeague = leagueId;
        args.leagueKey = leagueId;
      } else if(leagueName) args.leagueName = leagueName;
      let j = await callIntent('league.table', args);
      let okTable = (j && j.ok) ? (function(payload){
        try{
          const d = payload.data || payload.result || payload || {};
          if(Array.isArray(d)) return d.length>0;
          const arrs = ['total','table','result','standings','rows','league_table'];
          return arrs.some(k => Array.isArray(d[k]) && d[k].length>0) || (d.data && Array.isArray(d.data.total) && d.data.total.length>0);
        }catch(e){ return false; }
      })(j) : false;

      // Fallback: if empty, try season-specific calls derived from event date or fields
      if(!okTable){
        const yearStr = (ev.event_date || ev.dateEvent || '').slice(0,4);
        const leagueSeason = ev.league_season || ev.season || ev.league_year || '';
        const yr = parseInt(yearStr || '', 10);
        const cands = [];
        if(leagueSeason) cands.push(String(leagueSeason));
        if(yr && !Number.isNaN(yr)){
          cands.push(String(yr));
          cands.push(`${yr-1}/${yr}`);
          cands.push(`${yr}/${yr+1}`);
        }
        for(const s of cands){
          try{
            const j2 = await callIntent('league.table', { ...args, season: s });
            const d2 = j2 && (j2.data || j2.result || j2 || {});
            const nonEmpty = (()=>{
              if(Array.isArray(d2)) return d2.length>0;
              const arrs=['total','table','result','standings','rows','league_table'];
              return arrs.some(k => Array.isArray(d2[k]) && d2[k].length>0) || (d2.data && Array.isArray(d2.data.total) && d2.data.total.length>0);
            })();
            if(nonEmpty){ j = j2; okTable = true; break; }
          }catch(_e){ /* try next */ }
        }
      }

      if(okTable){
        const tableCard = createLeagueTableCard(j.data || j.result || {});
        tableBody.innerHTML = '';
        tableBody.appendChild(tableCard);
      } else {
        tableBody.textContent = 'No table available';
      }
      // debug league.table raw
      try{
        const dbgT = document.createElement('details'); dbgT.style.marginTop='8px';
        const summaryT = document.createElement('summary'); summaryT.textContent = 'Show raw league.table response'; dbgT.appendChild(summaryT);
        const preT = document.createElement('pre'); preT.style.cssText='max-height:240px;overflow:auto;padding:8px;background:#0b1220;color:#e6eef6;border-radius:6px;margin-top:6px'; preT.textContent = JSON.stringify(j, null, 2);
        dbgT.appendChild(preT);
        tableBody.appendChild(dbgT);
      }catch(e){}
  // hide league table section when empty
  try{ const tableSectionEl = modalBody.querySelector('#league_table_section'); if(tableSectionEl) tableSectionEl.style.display = _responseHasData(j) ? 'block' : 'none'; }catch(e){}
    }catch(e){ tableBody.textContent = 'League table error: '+e.message; }

    // Odds (list + live)
    const oddsBody = modalBody.querySelector('#odds_section .body');
    oddsBody.textContent = 'Loading odds...';
    try{
  const args = {};
  // supply multiple common param names so different intent implementations accept them
  if(eventId){ args.matchId = eventId; args.eventId = eventId; args.fixtureId = eventId; args.event_key = eventId; }
  else if(ev.event_date) args.date = ev.event_date;
      const [listJ, liveJ] = await Promise.allSettled([callIntent('odds.list', args), callIntent('odds.live', args)]);
      oddsBody.innerHTML = '';

  const hasList = _responseHasData(listJ);
  const hasLive = _responseHasData(liveJ);
  if(hasList){ const oddsCard = createOddsCard('Pre-Match Odds', listJ); oddsBody.appendChild(oddsCard); }
  if(hasLive){ const oddsCard = createOddsCard('Live Odds', liveJ); oddsBody.appendChild(oddsCard); }
  if(!hasList && !hasLive){ const noOdds = document.createElement('div'); noOdds.style.cssText = 'color: #6b7280; font-style: italic; text-align: center; padding: 20px;'; noOdds.textContent = 'No odds available'; oddsBody.appendChild(noOdds); }
  try{ const oddsSectionEl = modalBody.querySelector('#odds_section'); if(oddsSectionEl) oddsSectionEl.style.display = (hasList || hasLive) ? 'block' : 'none'; }catch(e){}
      // debug raw odds responses
      try{
        const dbgO = document.createElement('details'); dbgO.style.marginTop='8px';
        const summaryO = document.createElement('summary'); summaryO.textContent = 'Show raw odds responses'; dbgO.appendChild(summaryO);
        const preO = document.createElement('pre'); preO.style.cssText='max-height:240px;overflow:auto;padding:8px;background:#0b1220;color:#e6eef6;border-radius:6px;margin-top:6px'; preO.textContent = JSON.stringify([listJ, liveJ], null, 2);
        dbgO.appendChild(preO);
        oddsBody.appendChild(dbgO);
      }catch(e){}
    }catch(e){ oddsBody.textContent = 'Odds error: '+e.message; }

    // Probabilities
    const probBody = modalBody.querySelector('#prob_section .body');
    probBody.textContent = 'Loading probabilities...';
    try{
  const args = {};
  if(eventId) { args.matchId = eventId; args.eventId = eventId; args.fixtureId = eventId; }
  else if(leagueId) { args.leagueId = leagueId; args.idLeague = leagueId; args.leagueKey = leagueId; }
      const j = await callIntent('probabilities.list', args);
      if(j && j.ok) {
        const probCard = createProbabilitiesCard(j.data || j.result || {});
        probBody.innerHTML = '';
        probBody.appendChild(probCard);
      } else probBody.textContent = 'No probabilities';
      // debug probabilities raw
      try{
        const dbgPr = document.createElement('details'); dbgPr.style.marginTop='8px';
        const summaryPr = document.createElement('summary'); summaryPr.textContent = 'Show raw probabilities response'; dbgPr.appendChild(summaryPr);
        const prePr = document.createElement('pre'); prePr.style.cssText='max-height:240px;overflow:auto;padding:8px;background:#0b1220;color:#e6eef6;border-radius:6px;margin-top:6px'; prePr.textContent = JSON.stringify(j, null, 2);
        dbgPr.appendChild(prePr);
        probBody.appendChild(dbgPr);
      }catch(e){}
  }catch(e){ probBody.textContent = 'Probabilities error: '+e.message; }
  try{ const probSectionEl = modalBody.querySelector('#prob_section'); if(probSectionEl) probSectionEl.style.display = _responseHasData(j) ? 'block' : 'none'; }catch(e){}

    // Comments
    const commBody = modalBody.querySelector('#comments_section .body');
    commBody.textContent = 'Loading comments...';
    try{
      const args = {};
      if(eventId) args.matchId = eventId; else if(ev.event_home_team) args.eventName = ev.event_home_team + ' vs ' + (ev.event_away_team || '');
      const j = await callIntent('comments.list', args);
      if(j && j.ok) {
        const commentsCard = createCommentsCard(j.data || j.result || {});
        commBody.innerHTML = '';
        commBody.appendChild(commentsCard);
      } else commBody.textContent = 'No comments';
      // debug comments raw
      try{
        const dbgC = document.createElement('details'); dbgC.style.marginTop='8px';
        const summaryC = document.createElement('summary'); summaryC.textContent = 'Show raw comments response'; dbgC.appendChild(summaryC);
        const preC = document.createElement('pre'); preC.style.cssText='max-height:240px;overflow:auto;padding:8px;background:#0b1220;color:#e6eef6;border-radius:6px;margin-top:6px'; preC.textContent = JSON.stringify(j, null, 2);
        dbgC.appendChild(preC);
        commBody.appendChild(dbgC);
      }catch(e){}
  }catch(e){ commBody.textContent = 'Comments error: '+e.message; }
  try{ const commentsSectionEl = modalBody.querySelector('#comments_section'); if(commentsSectionEl) commentsSectionEl.style.display = _responseHasData(j) ? 'block' : 'none'; }catch(e){}

    // Seasons (leagues.list raw)
    const seasBody = modalBody.querySelector('#seasons_section .body');
    seasBody.textContent = 'Loading seasons...';
    let seasonsResp = null;
    try{
      const args = {};
      if(leagueId) args.leagueId = leagueId; else if(leagueName) args.leagueName = leagueName;
      seasonsResp = await callIntent('seasons.list', args);
      if(seasonsResp && seasonsResp.ok) {
        const seasonsCard = createSeasonsCard(seasonsResp.data || seasonsResp.result || {});
        seasBody.innerHTML = '';
        seasBody.appendChild(seasonsCard);
      } else seasBody.textContent = 'No seasons info';
      // debug seasons raw
      try{
        const dbgS = document.createElement('details'); dbgS.style.marginTop='8px';
        const summaryS = document.createElement('summary'); summaryS.textContent = 'Show raw seasons response'; dbgS.appendChild(summaryS);
        const preS = document.createElement('pre'); preS.style.cssText='max-height:240px;overflow:auto;padding:8px;background:#0b1220;color:#e6eef6;border-radius:6px;margin-top:6px'; preS.textContent = JSON.stringify(seasonsResp, null, 2);
        dbgS.appendChild(preS);
        seasBody.appendChild(dbgS);
      }catch(e){}
  }catch(e){ seasBody.textContent = 'Seasons error: '+e.message; }
  try{ const seasonsSectionEl = modalBody.querySelector('#seasons_section'); if(seasonsSectionEl) seasonsSectionEl.style.display = _responseHasData(seasonsResp) ? 'block' : 'none'; }catch(e){}

    // H2H (Head-to-Head) — use AllSports via intent 'h2h'
    const h2hContainer = document.createElement('div'); h2hContainer.className='extra-section';
    const h2hTitle = document.createElement('h4'); h2hTitle.textContent = 'H2H (Head-to-Head)'; h2hContainer.appendChild(h2hTitle);
    const h2hBody = document.createElement('div'); h2hBody.className='body'; h2hBody.textContent = 'Loading H2H...'; h2hContainer.appendChild(h2hBody);
    const extrasBody = modalBody.querySelector('#extras .extras-body');
    if(extrasBody) extrasBody.appendChild(h2hContainer);
    try{
      const firstTeamId = ev.home_team_key || ev.home_team_id || ev.homeId || ev.homeTeamId || ev.home_team || ev.strHomeTeam || '';
      const secondTeamId = ev.away_team_key || ev.away_team_id || ev.awayId || ev.awayTeamId || ev.away_team || ev.strAwayTeam || '';
      const args = {};
      if(firstTeamId && String(firstTeamId).match(/^\d+$/)) args.firstTeamId = String(firstTeamId);
      else if(ev.event_home_team) args.firstTeamId = ev.event_home_team;
      else if(ev.strHomeTeam) args.firstTeamId = ev.strHomeTeam;
      if(secondTeamId && String(secondTeamId).match(/^\d+$/)) args.secondTeamId = String(secondTeamId);
      else if(ev.event_away_team) args.secondTeamId = ev.event_away_team;
      else if(ev.strAwayTeam) args.secondTeamId = ev.strAwayTeam;

      const j = await callIntent('h2h', args);
      if(j && j.ok && j.data){
        const d = j.data || {};
        const res = d.result || d.data || d || {};
        const out = document.createElement('div'); out.className='h2h-block';
        const makeList = (arr)=>{
          const ul = document.createElement('ul'); (Array.isArray(arr)?arr:[]).slice(0,20).forEach(it=>{
            const li = document.createElement('li');
            const date = it.event_date || it.date || '';
            const home = it.event_home_team || it.home_team || it.strHomeTeam || '';
            const away = it.event_away_team || it.away_team || it.strAwayTeam || '';
            const score = it.event_final_result || it.event_ft_result || (it.home_score!=null && it.away_score!=null ? (it.home_score+' - '+it.away_score) : (it.score||''));
            li.textContent = `${date} — ${home} ${score ? (' ' + score) : ''} vs ${away}`;
            ul.appendChild(li);
          });
          return ul;
        };
        if(res.H2H) { out.appendChild(document.createElement('h5')).textContent='Mutual H2H'; out.appendChild(makeList(res.H2H)); }
        if(res.firstTeamResults) { out.appendChild(document.createElement('h5')).textContent='First team recent'; out.appendChild(makeList(res.firstTeamResults)); }
        if(res.secondTeamResults) { out.appendChild(document.createElement('h5')).textContent='Second team recent'; out.appendChild(makeList(res.secondTeamResults)); }
        if(out.children.length===0) h2hBody.textContent = 'No H2H data'; else { 
          const h2hCard = createH2HCard(res);
          h2hBody.innerHTML=''; 
          h2hBody.appendChild(h2hCard); 
        }
        // debug h2h raw
        try{
          const dbgH = document.createElement('details'); dbgH.style.marginTop='8px';
          const summaryH = document.createElement('summary'); summaryH.textContent = 'Show raw H2H response'; dbgH.appendChild(summaryH);
          const preH = document.createElement('pre'); preH.style.cssText='max-height:240px;overflow:auto;padding:8px;background:#0b1220;color:#e6eef6;border-radius:6px;margin-top:6px'; preH.textContent = JSON.stringify(j, null, 2);
          dbgH.appendChild(preH);
          h2hBody.appendChild(dbgH);
        }catch(e){}
      } else {
        h2hBody.textContent = 'No H2H: ' + (j && j.error && j.error.message ? j.error.message : 'no data');
      }
    }catch(e){ h2hBody.textContent = 'H2H error: '+(e && e.message?e.message:String(e)); }
  }

  function formatDate(dateStr) {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch (error) {
      return dateStr;
    }
  }

  // Sample data for testing when no real data is available
  function showSampleData() {
    console.log('Showing sample data for testing...');
    const sampleData = {
      "Premier League": {
        dates: {
          "2025-09-01": [
            {
              idEvent: "12345",
              event_key: "12345",
              event_home_team: "Manchester United",
              event_away_team: "Liverpool",
              event_date: "2025-09-01",
              event_time: "15:00",
              event_status: "Finished",
              event_final_result: "2 - 1",
              home_score: 2,
              away_score: 1,
              league_name: "Premier League",
              venue: "Old Trafford",
              referee: "Michael Oliver",
              attendance: "74,310",
              home_team_logo: "https://logos.footballapi.com/manchester-united.png",
              away_team_logo: "https://logos.footballapi.com/liverpool.png",
              possession_home: 52,
              possession_away: 48,
              shots_home: 15,
              shots_away: 12,
              shots_on_target_home: 6,
              shots_on_target_away: 4,
              corners_home: 7,
              corners_away: 5,
              yellow_cards_home: 2,
              yellow_cards_away: 3,
              red_cards_home: 0,
              red_cards_away: 1,
              timeline: [
                {
                  minute: "23",
                  description: "Goal by Bruno Fernandes",
                  predicted_tags: ["goal", "penalty"]
                },
                {
                  minute: "45",
                  description: "Yellow card for Mohamed Salah",
                  predicted_tags: ["yellow card"]
                },
                {
                  minute: "67",
                  description: "Goal by Marcus Rashford",
                  predicted_tags: ["goal", "header"]
                },
                {
                  minute: "89",
                  description: "Goal by Darwin Núñez",
                  predicted_tags: ["goal"]
                }
              ]
            }
          ],
          "2025-08-31": [
            {
              idEvent: "12346",
              event_key: "12346",
              event_home_team: "Arsenal",
              event_away_team: "Chelsea",
              event_date: "2025-08-31",
              event_time: "17:30",
              event_status: "Finished",
              event_final_result: "1 - 1",
              home_score: 1,
              away_score: 1,
              league_name: "Premier League",
              venue: "Emirates Stadium",
              referee: "Anthony Taylor",
              attendance: "60,260",
              possession_home: 58,
              possession_away: 42,
              shots_home: 18,
              shots_away: 9,
              shots_on_target_home: 5,
              shots_on_target_away: 3,
              corners_home: 9,
              corners_away: 3,
              yellow_cards_home: 1,
              yellow_cards_away: 2,
              timeline: [
                {
                  minute: "34",
                  description: "Goal by Bukayo Saka",
                  predicted_tags: ["goal"]
                },
                {
                  minute: "78",
                  description: "Goal by Christopher Nkunku",
                  predicted_tags: ["goal", "substitution"]
                }
              ]
            }
          ]
        }
      },
      "La Liga": {
        dates: {
          "2025-09-01": [
            {
              idEvent: "12347",
              event_key: "12347",
              event_home_team: "Real Madrid",
              event_away_team: "Barcelona",
              event_date: "2025-09-01",
              event_time: "21:00",
              event_status: "Finished",
              event_final_result: "3 - 2",
              home_score: 3,
              away_score: 2,
              league_name: "La Liga",
              venue: "Santiago Bernabéu",
              referee: "Jesús Gil Manzano",
              attendance: "81,044",
              possession_home: 45,
              possession_away: 55,
              shots_home: 12,
              shots_away: 16,
              shots_on_target_home: 7,
              shots_on_target_away: 8,
              corners_home: 4,
              corners_away: 8,
              yellow_cards_home: 3,
              yellow_cards_away: 2,
              timeline: [
                {
                  minute: "12",
                  description: "Goal by Vinícius Jr.",
                  predicted_tags: ["goal"]
                },
                {
                  minute: "28",
                  description: "Goal by Robert Lewandowski",
                  predicted_tags: ["goal", "header"]
                },
                {
                  minute: "56",
                  description: "Goal by Jude Bellingham",
                  predicted_tags: ["goal"]
                },
                {
                  minute: "73",
                  description: "Goal by Pedri",
                  predicted_tags: ["goal"]
                },
                {
                  minute: "90+2",
                  description: "Goal by Karim Benzema",
                  predicted_tags: ["goal", "penalty"]
                }
              ]
            }
          ]
        }
      }
    };
    
    displayHistoryMatches(sampleData);
    setStatus('Showing sample data for testing');
  }
})();
