/* History matches dashboard logic */
(function(){
  // Determine backend base: if served from a static server (e.g. 5500) assume FastAPI on 8000 same host.
  const loc = window.location;
  let apiBase = loc.origin;
  if(loc.port && loc.port !== '8000'){
    apiBase = loc.protocol + '//' + loc.hostname + ':8000';
  }

  const contentEl = document.getElementById('content');
  const daysInput = document.getElementById('daysInput');
  const endDateInput = document.getElementById('endDate');
  const leagueSelect = document.getElementById('leagueSelect');
  const fetchLeagueBtn = document.getElementById('fetchLeagueBtn');
  const loadBtn = document.getElementById('loadBtn');
  const statusEl = document.getElementById('status');

  const leagueTemplate = document.getElementById('leagueTemplate');
  const dateTemplate = document.getElementById('dateTemplate');
  const matchRowTemplate = document.getElementById('matchRowTemplate');

  let allLeagues = [];

  // Set default end date to today
  endDateInput.value = new Date().toISOString().split('T')[0];

  // Load leagues on page load
  loadLeagues();

  loadBtn.addEventListener('click', loadHistoryMatches);
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

    // Sort leagues by name
    const sortedLeagues = [...allLeagues].sort((a, b) => {
      const nameA = (a.league_name || '').toLowerCase();
      const nameB = (b.league_name || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });

    // Add league options
    sortedLeagues.forEach(league => {
      const option = document.createElement('option');
      option.value = league.league_key || league.league_id || '';
      option.textContent = league.league_name || 'Unknown League';
      leagueSelect.appendChild(option);
    });
  }

  async function loadHistoryMatches() {
    try {
      setStatus('Loading history matches...');
      contentEl.innerHTML = '';
      
      const days = parseInt(daysInput.value) || 7;
      const endDate = endDateInput.value || new Date().toISOString().split('T')[0];
      
      const url = `${apiBase}/matches/history?days=${days}&end_date=${endDate}`;
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.ok && data.data && data.data.leagues) {
        displayHistoryMatches(data.data.leagues);
        setStatus(`Loaded matches for ${Object.keys(data.data.leagues).length} leagues`);
      } else {
        throw new Error('Failed to load history matches');
      }
    } catch (error) {
      console.error('Error loading history matches:', error);
      setStatus('Error loading matches: ' + error.message, true);
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
      
      const days = parseInt(daysInput.value) || 7;
      const endDate = endDateInput.value || new Date().toISOString().split('T')[0];
      
      // Calculate start date
      const end = new Date(endDate);
      const start = new Date(end);
      start.setDate(start.getDate() - days + 1);
      
      const startDate = start.toISOString().split('T')[0];
      
      // Fetch matches for the specific league
      const url = `${apiBase}/collect`;
      const requestBody = {
        intent: "fixtures.list",
        args: {
          leagueId: selectedLeague,
          from: startDate,
          to: endDate
        }
      };
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });
      
      const data = await response.json();
      
      if (data.ok && data.data && data.data.result) {
        const matches = data.data.result;
        const selectedLeagueName = leagueSelect.options[leagueSelect.selectedIndex].textContent;
        displayLeagueMatches(matches, selectedLeagueName);
        setStatus(`Loaded ${matches.length} matches for ${selectedLeagueName}`);
      } else {
        throw new Error('Failed to load league matches');
      }
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
    dateNode.querySelector('.dateHeading').textContent = formatDate(date);
    
    const matchesContainer = dateNode.querySelector('.matches');
    
    matches.forEach(match => {
      const matchRow = createMatchRow(match);
      matchesContainer.appendChild(matchRow);
    });
    
    return dateNode;
  }

  function createMatchRow(match) {
    const matchNode = matchRowTemplate.content.firstElementChild.cloneNode(true);
    
    const homeTeam = match.event_home_team || match.strHomeTeam || 'Unknown';
    const awayTeam = match.event_away_team || match.strAwayTeam || 'Unknown';
    const time = match.event_time || match.strTime || '';
    const status = match.event_status || match.status || '';
    
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
          <span class="home-team">${homeTeam}</span>
          <span class="vs">vs</span>
          <span class="away-team">${awayTeam}</span>
        </div>
        <div class="match-details">
          <span class="time">${time}</span>
          <span class="score">${score}</span>
          <span class="status">${status}</span>
        </div>
      </div>
    `;
    
    return matchNode;
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
})();
