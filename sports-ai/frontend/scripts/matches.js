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

  const modal = document.getElementById('matchModal');
  const modalBody = document.getElementById('modalBody');
  const closeModal = document.getElementById('closeModal');
  closeModal.addEventListener('click', ()=> modal.classList.add('hidden'));
  modal.addEventListener('click', e=>{ if(e.target === modal) modal.classList.add('hidden'); });
  document.addEventListener('keydown', e=>{ if(e.key==='Escape') modal.classList.add('hidden'); });

  function fmtScore(ev){
    const ft = ev.event_final_result || ev.event_ft_result || ev.event_halftime_result || '';
    if(ft && ft.includes('-')) return ft;
    let hs = ev.home_score || ev.event_home_result || '';
    let as = ev.away_score || ev.event_away_result || '';
    if(ev.event_status && /live|half|2nd|1st|extra|pen/i.test(ev.event_status)){
      const sc = ev.event_halftime_result || ft; if(sc) return sc;
    }
    return (hs!=='' && as!=='') ? `${hs} - ${as}` : '-';
  }

  function createCard(ev){
  const tpl = document.getElementById('cardTemplate');
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.eventKey = ev.event_key || ev.idEvent || ev.id || '';
    node.querySelector('.league').textContent = ev.league_name || ev.strLeague || '';
    const live = ev.event_live == '1';
    node.querySelector('.status').textContent = ev.event_status || (live ? 'Live' : (ev.event_time || ''));
    node.querySelector('.homeName').textContent = ev.event_home_team || ev.strHomeTeam || '';
    node.querySelector('.awayName').textContent = ev.event_away_team || ev.strAwayTeam || '';
    node.querySelector('.homeScore').textContent = (fmtScore(ev).split('-')[0]||'').trim();
    node.querySelector('.awayScore').textContent = (fmtScore(ev).split('-')[1]||'').trim();
  const hl = ev.home_team_logo || ev.strHomeTeamBadge; if(hl) { const img = node.querySelector('.homeLogo'); img.src = hl; img.onerror = () => img.remove(); } else node.querySelector('.homeLogo').remove();
  const al = ev.away_team_logo || ev.strAwayTeamBadge; if(al) { const img2 = node.querySelector('.awayLogo'); img2.src = al; img2.onerror = () => img2.remove(); } else node.querySelector('.awayLogo').remove();
    node.querySelector('.time').textContent = `${ev.event_date || ''} ${ev.event_time || ''}`.trim();
    node.querySelector('.detailsBtn').addEventListener('click', ()=> showDetails(ev));
    return node;
  }

  function showDetails(ev){
    modalBody.innerHTML = '<pre class="json"></pre>';
    const pre = modalBody.querySelector('pre');
    pre.textContent = JSON.stringify(ev, null, 2);
    modal.classList.remove('hidden');
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
  fetchSummary();
  // auto refresh live every 60s
  setInterval(()=> { if(!document.hidden) fetchSummary(); }, 60000);
})();
