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

    // Sort leagues: popular ones first, then alphabetically
    const sortedLeagues = [...allLeagues].sort((a, b) => {
      const nameA = a.league_name || '';
      const nameB = b.league_name || '';
      
      const priorityA = getLeaguePriority(nameA);
      const priorityB = getLeaguePriority(nameB);
      
      // If both are popular or both are non-popular, sort alphabetically
      if (priorityA === priorityB) {
        return nameA.toLowerCase().localeCompare(nameB.toLowerCase());
      }
      
      // Otherwise, sort by priority
      return priorityA - priorityB;
    });

    // Add league options
    sortedLeagues.forEach((league, index) => {
      const option = document.createElement('option');
      option.value = league.league_key || league.league_id || '';
      option.textContent = league.league_name || 'Unknown League';
      
      // Add visual separator after popular leagues
      const priority = getLeaguePriority(league.league_name || '');
      if (index > 0 && priority >= 1000) {
        const prevLeague = sortedLeagues[index - 1];
        const prevPriority = getLeaguePriority(prevLeague.league_name || '');
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
