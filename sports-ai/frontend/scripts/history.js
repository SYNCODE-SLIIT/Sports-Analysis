(function(){
  const loc = window.location; let apiBase = loc.origin; if(loc.port && loc.port!=='8000'){ apiBase = loc.protocol+'//'+loc.hostname+':8000'; }
  const daysInput = document.getElementById('daysInput');
  const endDate = document.getElementById('endDate');
  const loadBtn = document.getElementById('loadBtn');
  const leagueSelect = document.getElementById('leagueSelect');
  const fetchLeagueBtn = document.getElementById('fetchLeagueBtn');
  const statusEl = document.getElementById('status');
  const content = document.getElementById('content');

  const leagueTpl = document.getElementById('leagueTemplate');
  const dateTpl = document.getElementById('dateTemplate');
  const matchTpl = document.getElementById('matchRowTemplate');
  let leaguesCatalogLoaded = false;

  function clear(el){ while(el.firstChild) el.removeChild(el.firstChild); }

  function matchLabel(m){
    const time = (m.event_time || m.strTime || '').padStart(5,'0');
    const home = m.event_home_team || m.strHomeTeam || '?';
    const away = m.event_away_team || m.strAwayTeam || '?';
    const score = m.event_final_result || m.event_ft_result || m.event_halftime_result || m.score || '';
    const status = m.event_status || m.status || '';
    return `${time}  ${home} ${score?(' '+score+' '):' vs '} ${away}  ${status}`.trim();
  }

  async function load(){
    const days = parseInt(daysInput.value,10) || 7;
    const end = endDate.value || '';
    // try the raw flat history first, then fall back to dual/single provider endpoints
    const endpoints = ['/matches/history_raw','/history_raw','/matches/history_dual','/history_dual','/matches/history','/history','/matches/history/','/matches/historical','/matches/historical/'];
    statusEl.textContent = 'Loading...';
    let lastErr = null;
    for(const ep of endpoints){
      try{
        const url = new URL(apiBase + ep);
        url.searchParams.set('days', days);
        if(end) url.searchParams.set('end_date', end);
        const r = await fetch(url.toString());
        if(!r.ok){ lastErr = new Error('HTTP '+r.status+' '+ep); continue; }
        const data = await r.json();
        console.log('[history] success via', ep);
        // If backend returned a flat 'matches' array (raw mode), convert into the
        // grouped-by-league/date shape the renderer expects so the UI shows all games.
        if(data && Array.isArray(data.matches)){
          const matches = data.matches;
          const dateMap = {};
          matches.forEach(m => {
            const d = m.event_date || m.dateEvent || m.date || '';
            (dateMap[d] = dateMap[d] || []).push(m);
          });
          const orderedDates = Object.keys(dateMap).sort((a,b)=> b.localeCompare(a)).map(d=>{
            const arr = dateMap[d];
            arr.sort((a,b)=> (b.event_time||b.strTime||'').localeCompare(a.event_time||a.strTime||''));
            return {date: d, matches: arr, count: arr.length};
          });
          const league = {league_name: 'All Matches', league_key: '__ALL__', country_name:'', dates: orderedDates, total_matches: matches.length};
          const summary = {ok:true, end_date: data.end_date || end, days: data.days || days, dates: Object.keys(dateMap), leagues: [league], league_count: 1, match_count: matches.length};
          render(summary);
          statusEl.textContent = `Loaded ${summary.match_count} matches.`;
          return;
        }
        render(data);
        statusEl.textContent = `Loaded ${data.match_count} matches across ${data.league_count} leagues.`;
        return;
      }catch(e){ lastErr = e; }
    }
    console.warn('[history] backend history endpoints unavailable, falling back to client aggregation');
    await fallbackClientAggregate(days, end);
  }

  async function fallbackClientAggregate(days, end){
    try{
      const today = end ? new Date(end) : new Date();
      const dateList = [];
      for(let i=0;i<days;i++){
        const d = new Date(today.getTime() - i*86400000);
        dateList.push(d.toISOString().slice(0,10));
      }
      const leaguesMap = {}; // key -> {league_name, league_key, country_name, dates: {date: []}}
      let matchCount = 0;
      for(const d of dateList){
        statusEl.textContent = `Fetching ${d} ...`;
        const resp = await fetch(apiBase + '/collect', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({intent:'events.list', args:{date:d}})});
        if(!resp.ok){ console.warn('Failed day', d, resp.status); continue; }
        const body = await resp.json();
        if(!body.ok) continue;
        const data = body.data || {};
        const events = data.events || data.result || data.results || [];
        for(const ev of events){
          const league_name = ev.league_name || ev.strLeague || 'Unknown League';
          const league_key = ''+(ev.league_key || ev.idLeague || '');
          const lid = league_key + '|' + league_name;
          const bucket = leaguesMap[lid] || (leaguesMap[lid] = {league_name, league_key, country_name: ev.country_name || ev.strCountry, dates:{}});
          (bucket.dates[d] = bucket.dates[d] || []).push(ev);
          matchCount++;
        }
      }
      // Transform to backend-like shape
      const leagues = Object.values(leaguesMap).map(info => {
        const ordered = Object.keys(info.dates).sort((a,b)=> b.localeCompare(a)).map(date => {
          const matches = info.dates[date];
          matches.sort((a,b)=> (b.event_time||b.strTime||'').localeCompare(a.event_time||a.strTime||''));
          return {date, matches, count: matches.length};
        });
        const total = ordered.reduce((s,x)=>s+x.count,0);
        return {league_name: info.league_name, league_key: info.league_key, country_name: info.country_name, dates: ordered, total_matches: total};
      });
      leagues.sort((a,b)=> b.total_matches - a.total_matches);
      const summary = {ok:true,end_date: end || dateList[0], days, dates: dateList, leagues, league_count: leagues.length, match_count: matchCount};
      render(summary);
      statusEl.textContent = `Loaded (client) ${matchCount} matches across ${leagues.length} leagues.`;
    }catch(e){
      console.error(e); statusEl.textContent = 'Fallback error: '+ e.message;
    }
  }

  function render(summary){
    clear(content);
    // Populate league selector (keep existing selection if present)
    const prev = leagueSelect.value;
    const leagues = (summary.leagues||[]);
    const seen = new Set();
    while(leagueSelect.options.length>1) leagueSelect.remove(1);
    leagues.forEach(l => {
      if(seen.has(l.league_name)) return; seen.add(l.league_name);
      const opt = document.createElement('option'); opt.value = l.league_name; opt.textContent = l.league_name + ` (${l.total_matches})`;
      leagueSelect.appendChild(opt);
    });
    if([...leagueSelect.options].some(o=>o.value===prev)) leagueSelect.value = prev;
  // If only one league in aggregation, still fetch catalog (once) to allow user to pick others
  if(!leaguesCatalogLoaded && leagues.length <= 1){ fetchLeaguesCatalog(); }
    (summary.leagues||[]).forEach(league => {
      const lnode = leagueTpl.content.firstElementChild.cloneNode(true);
      lnode.querySelector('.leagueTitle').textContent = `${league.league_name} (${league.total_matches})`;
      const datesDiv = lnode.querySelector('.dates');
      league.dates.forEach(d => {
        const dnode = dateTpl.content.firstElementChild.cloneNode(true);
        dnode.querySelector('.dateHeading').textContent = `${d.date} (${d.count})`;
        const matchesDiv = dnode.querySelector('.matches');
        d.matches.forEach(m => {
          const mnode = matchTpl.content.firstElementChild.cloneNode(true);
          mnode.textContent = matchLabel(m);
          matchesDiv.appendChild(mnode);
        });
        datesDiv.appendChild(dnode);
      });
      content.appendChild(lnode);
    });
  }

  loadBtn.addEventListener('click', load);
  fetchLeagueBtn.addEventListener('click', ()=> fetchSpecificLeague());
  const today = new Date().toISOString().slice(0,10); endDate.value = today;
  load();

  async function fetchSpecificLeague(){
    const leagueName = leagueSelect.value;
    if(!leagueName || leagueName==='__ALL__'){ load(); return; }
    const days = parseInt(daysInput.value,10) || 7;
    const end = endDate.value || '';
    statusEl.textContent = 'Loading league '+leagueName+' ...';
    try{
      const today = end ? new Date(end) : new Date();
      const dateList = [];
      for(let i=0;i<days;i++){
        const d = new Date(today.getTime() - i*86400000);
        dateList.push(d.toISOString().slice(0,10));
      }
      const leaguesMap = {}; let matchCount=0;
      for(const d of dateList){
        const resp = await fetch(apiBase + '/collect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({intent:'events.list', args:{date:d, leagueName}})});
        if(!resp.ok) continue; const body = await resp.json(); if(!body.ok) continue;
        const data = body.data || {}; const events = data.events || data.result || data.results || [];
        for(const ev of events){
          const league_name = ev.league_name || ev.strLeague || leagueName;
          const league_key = ''+(ev.league_key || ev.idLeague || '');
          const lid = league_key + '|' + league_name;
          const bucket = leaguesMap[lid] || (leaguesMap[lid] = {league_name, league_key, country_name: ev.country_name || ev.strCountry, dates:{}});
          (bucket.dates[d] = bucket.dates[d] || []).push(ev);
          matchCount++;
        }
      }
      const leaguesOut = Object.values(leaguesMap).map(info => {
        const ordered = Object.keys(info.dates).sort((a,b)=> b.localeCompare(a)).map(date => {
          const matches = info.dates[date]; matches.sort((a,b)=> (b.event_time||'').localeCompare(a.event_time||''));
          return {date, matches, count: matches.length};
        });
        const total = ordered.reduce((s,x)=>s+x.count,0);
        return {league_name: info.league_name, league_key: info.league_key, country_name: info.country_name, dates: ordered, total_matches: total};
      });
      const summary = {ok:true, mode:'single_league', end_date: end || dateList[0], days, dates: dateList, leagues: leaguesOut, league_count: leaguesOut.length, match_count: matchCount};
      render(summary);
      statusEl.textContent = `Loaded ${matchCount} matches for ${leagueName}.`;
    }catch(e){ console.error(e); statusEl.textContent='Error: '+e.message; }
  }

  async function fetchLeaguesCatalog(){
    try{
      leaguesCatalogLoaded = true;
      const resp = await fetch(apiBase + '/collect', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({intent:'leagues.list', args:{}})});
      if(!resp.ok) return;
      const body = await resp.json();
      if(!body.ok) return;
      const data = body.data || {};
      const raw = data.leagues || data.result || [];
      // Preserve existing selected value
      const current = leagueSelect.value;
      const existing = new Set([...leagueSelect.options].map(o=>o.value));
      raw.forEach(l => {
        const name = l.strLeague || l.league_name || l.name;
        if(!name || existing.has(name)) return;
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        leagueSelect.appendChild(opt);
      });
      if([...leagueSelect.options].some(o=>o.value===current)) leagueSelect.value = current;
    }catch(e){ console.warn('league catalog fetch failed', e); }
  }
})();
