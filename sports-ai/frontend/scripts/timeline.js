// Timeline utilities extracted from match.js
// These functions are defined in the global scope so match.js can call them.

// --- Tooltip + brief caches ---
let _evtTooltip;
let _tooltipHideTimer = null;
const _eventBriefCache = new Map();

function ensureTooltip(){
  if(_evtTooltip) return _evtTooltip;
  const d = document.createElement('div');
  // Make tooltip vertically scrollable when content exceeds max-height.
  d.style.cssText = 'position:fixed;z-index:9999;max-width:420px;max-height:360px;background:linear-gradient(145deg,#ffffff,#fafafa);color:#111827;padding:16px 18px;border-radius:16px;box-shadow:0 20px 50px rgba(0,0,0,0.15),0 4px 20px rgba(0,0,0,0.08);font-size:13px;line-height:1.6;pointer-events:auto;display:none;overflow-x:hidden;overflow-y:auto;border:1px solid rgba(255,255,255,0.8);backdrop-filter:blur(8px);transform:translateY(-4px);transition:all 0.2s ease;scrollbar-width:thin;scrollbar-color:#9ca3af #f3f4f6;';
  // Custom scrollbar styling for WebKit
  try{
    d.style.setProperty('--tw-scrollbar-bg', '#f3f4f6');
    d.style.setProperty('--tw-scrollbar-thumb', '#d1d5db');
    // Attach a wheel handler to prevent page scroll when the tooltip can scroll internally
    d.addEventListener('wheel', (e)=>{
      const canScroll = d.scrollHeight > d.clientHeight;
      if(!canScroll) return; // let page scroll
      const before = d.scrollTop;
      d.scrollTop += e.deltaY;
      if(d.scrollTop !== before){
        e.preventDefault();
      }
    }, { passive:false });
  }catch(_e){}
  d.addEventListener('mouseenter', ()=>{ if(_tooltipHideTimer){ clearTimeout(_tooltipHideTimer); _tooltipHideTimer=null; } d.style.transform='translateY(-6px)'; d.style.boxShadow='0 25px 60px rgba(0,0,0,0.2),0 6px 25px rgba(0,0,0,0.1)'; });
  d.addEventListener('mouseleave', ()=>{ if(_evtTooltip){ _evtTooltip.style.display='none'; } });
  document.body.appendChild(d); _evtTooltip = d; return d;
}
function showEventTooltip(anchor, html){ 
  const d=ensureTooltip(); 
  d.innerHTML = String(html||''); 
  d.style.display='block'; 
  positionEventTooltip(anchor); 
}

function hideEventTooltip(){ 
  if(_evtTooltip) _evtTooltip.style.display='none'; 
}
function positionEventTooltip(anchor){ 
  if(!_evtTooltip) return; 
  const r = anchor.getBoundingClientRect(); 
  const pad=8; let x = r.right + pad; 
  let y = r.top - 4; 
  const vw = window.innerWidth; 
  const vh = window.innerHeight; 
  const dw = _evtTooltip.offsetWidth; 
  const dh = _evtTooltip.offsetHeight; 
  if(x+dw+12>vw) x = r.left - dw - pad; 
  if(x<4) x=4; 
  if(y+dh+12>vh) y = vh - dh - 8; 
  if(y<4) y=4; 
  _evtTooltip.style.left = `${Math.round(x)}px`;
  _evtTooltip.style.top = `${Math.round(y)}px`; 
}

// --- Icons/colors/tags ---
function getEventIcon(description, tags){ 
  const desc=String(description).toLowerCase(); 
  const tagStr = Array.isArray(tags)?tags.join(' ').toLowerCase():String(tags).toLowerCase(); 
  if(desc.includes('goal')||tagStr.includes('goal')) return '⚽'; 
  if(desc.includes('yellow')||tagStr.includes('yellow')) return '🟨'; 
  if(desc.includes('red')||tagStr.includes('red')) return '🟥';
  if(desc.includes('substitution')||tagStr.includes('substitution')) return '↔️'; 
  if(desc.includes('corner')||tagStr.includes('corner')) return '📐'; 
  if(desc.includes('penalty')||tagStr.includes('penalty')) return '⚽'; 
  if(desc.includes('offside')||tagStr.includes('offside')) return '🚩'; 
  return '⚪';
}

function getEventColor(description, tags){ 
  const desc=String(description).toLowerCase(); 
  const tagStr = Array.isArray(tags)?tags.join(' ').toLowerCase():String(tags).toLowerCase(); 
  if(desc.includes('goal')||tagStr.includes('goal')) return '#10b981'; 
  if(desc.includes('yellow')||tagStr.includes('yellow')) return '#f59e0b'; 
  if(desc.includes('red')||tagStr.includes('red')) return '#ef4444'; 
  if(desc.includes('substitution')||tagStr.includes('substitution')) return '#8b5cf6'; 
  return '#6b7280'; 
}

function getTagColor(tag){ 
  const t = String(tag).toLowerCase(); 
  if(t.includes('goal')) return '#10b981'; 
  if(t.includes('card')) return '#f59e0b'; 
  if(t.includes('substitution')) return '#8b5cf6'; 
  if(t.includes('penalty')) return '#ef4444'; 
  return '#6b7280'; 
}

// --- Player image resolution helpers ---
function ensurePlayersMap(matchCtx){
  try{
    if(!matchCtx || matchCtx._playersMap) return;
    const allPlayers = [];
    for(const k of Object.keys(matchCtx||{})){
      const v = matchCtx[k];
      if(Array.isArray(v) && v.length>0 && typeof v[0] === 'object'){
        const s = v[0];
        if(s.player_name || s.name || s.strPlayer || s.player || s.player_fullname || s.playerId || s.idPlayer) allPlayers.push(...v);
      }
    }
    if(allPlayers.length>0){
      const map = {};
      const normalize = s => (s||'').toString().replace(/[\.]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
      allPlayers.forEach(p=>{
        const name = (p.player_name || p.name || p.strPlayer || p.player || p.player_fullname || '').trim();
        if(!name) return;
        const nm = name;
        const low = nm.toLowerCase();
        const norm = normalize(nm);
        map[nm] = p; map[low] = p; map[norm] = p;
        try{
          const parts = norm.split(' ').filter(Boolean);
          if(parts.length){
            const last = parts[parts.length-1];
            if(last) map[last] = map[last] || p;
            if(parts.length>=2){
              const initLast = parts[0].charAt(0) + ' ' + last;
              const initLastNoSpace = parts[0].charAt(0) + last;
              map[initLast] = map[initLast] || p;
              map[initLastNoSpace] = map[initLastNoSpace] || p;
            }
          }
        }catch(_e){}
      });
      matchCtx._playersMap = map;
    } else {
      matchCtx._playersMap = {};
    }
  }catch(_e){}
}

function resolvePlayerAndImages(event, matchCtx){
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
  try{
    ensurePlayersMap(matchCtx);
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
              if(lookupParts.length >= 2 && lookupFirst.length === 1){
                const candFirst = candParts.length ? candParts[0].charAt(0) : '';
                if(candFirst === lookupFirst && candLast === lookupLast){ p = cand; break; }
              }
              const lookupId = event.player_id || event.playerId || event.player_key || (event.raw && (event.raw.player_id || event.raw.idPlayer || event.raw.player_key));
              const candId = cand.idPlayer || cand.player_id || cand.playerKey || cand.player_key || cand.id || cand.playerId;
              if(lookupId && candId && String(lookupId) === String(candId)){ p = cand; break; }
            }catch(_e){}
          }
        }
        if(p){
          playerImg = p.player_image || p.player_photo || p.playerImage || p.photo || p.thumb || p.photo_url || p.strThumb || p.strThumbBig || p.player_cutout || p.player_pic || p.img || p.avatar || p.headshot || p.image || '';
        }
      }
    }
  }catch(_e){}
  const playerName = event.player || event.player_name || event.playerName || event.player_fullname || '';
  return { playerImg, teamLogo, playerName };
}

// Resolve a player's image by provided name using the players map in matchCtx
function resolvePlayerImageByName(name, matchCtx){
  try{
    if(!name || !matchCtx) return '';
    ensurePlayersMap(matchCtx);
    const norm = s => (s || '').toString().replace(/[\.]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    const nRaw = String(name).trim();
    const nLow = nRaw.toLowerCase();
    const nNorm = norm(nRaw);
    let p = matchCtx._playersMap && (matchCtx._playersMap[nRaw] || matchCtx._playersMap[nLow] || matchCtx._playersMap[nNorm]);
    if(!p && matchCtx._playersMap){
      const vals = Object.values(matchCtx._playersMap);
      const parts = nNorm.split(' ').filter(Boolean);
      const last = parts.length ? parts[parts.length-1] : '';
      const first = parts.length ? parts[0] : '';
      for(const cand of vals){
        try{
          const candName = (cand.player_name || cand.name || cand.strPlayer || cand.player || cand.player_fullname || '').toString();
          const candNorm = norm(candName);
          if(!candNorm) continue;
          if(candNorm === nNorm || candNorm.includes(nNorm) || nNorm.includes(candNorm)) { p = cand; break; }
          const candParts = candNorm.split(' ').filter(Boolean);
          const candLast = candParts.length ? candParts[candParts.length-1] : '';
          if(last && candLast && last === candLast){ p = cand; break; }
          if(parts.length >= 2 && first.length === 1){
            const candFirst = candParts.length ? candParts[0].charAt(0) : '';
            if(candFirst === first && candLast === last){ p = cand; break; }
          }
        }catch(_e){}
      }
    }
    if(p){
      return p.player_image || p.player_photo || p.playerImage || p.photo || p.thumb || p.photo_url || p.strThumb || p.strThumbBig || p.player_cutout || p.player_pic || p.img || p.avatar || p.headshot || p.image || '';
    }
  }catch(_e){}
  return '';
}

// Try to parse substitution in/out player names from event structure or description
function parseSubstitutionPlayers(event){
  const out = { inName: '', outName: '' };
  try{
    if(event.player_in || event.player_out){
      out.inName = event.player_in || '';
      out.outName = event.player_out || '';
      return out;
    }
    const raw = event.raw || {};
    if(raw.home_scorer && typeof raw.home_scorer === 'object'){
      out.inName = out.inName || raw.home_scorer.in || '';
      out.outName = out.outName || raw.home_scorer.out || '';
    }
    if(raw.away_scorer && typeof raw.away_scorer === 'object'){
      out.inName = out.inName || raw.away_scorer.in || '';
      out.outName = out.outName || raw.away_scorer.out || '';
    }
    if(raw.in) out.inName = out.inName || raw.in;
    if(raw.out) out.outName = out.outName || raw.out;
    if(out.inName || out.outName) return out;
    const desc = String(event.description || event.text || '').trim();
    if(desc){
      // Common patterns: "X ON for Y", "X in for Y", "X replaces Y"
      let m = desc.match(/^(?:substitution[:,]?\s*)?(.+?)\s+(?:on|in)\s+for\s+(.+)$/i);
      if(!m) m = desc.match(/^(?:substitution[:,]?\s*)?(.+?)\s+replaces\s+(.+)$/i);
      if(!m) m = desc.match(/(.+?)\s+for\s+(.+?)(?:\.|,|;|$)/i);
      if(m){ out.inName = (out.inName || m[1] || '').trim(); out.outName = (out.outName || m[2] || '').trim(); return out; }
      // Pattern: "Y replaced by X"
      m = desc.match(/(.+?)\s+replaced\s+by\s+(.+)/i);
      if(m){ out.inName = (out.inName || m[2] || '').trim(); out.outName = (out.outName || m[1] || '').trim(); return out; }
    }
  }catch(_e){}
  return out;
}

function normalizeEventTags(evt){
  const candidates = [];
  if(evt){
    if(evt.tags !== undefined) candidates.push(evt.tags);
    if(evt.card !== undefined) candidates.push(evt.card);
    // if(evt.predicted_tags !== undefined) candidates.push(evt.predicted_tags);
    if(evt.predictedTags !== undefined) candidates.push(evt.predictedTags);
    if(evt.labels !== undefined) candidates.push(evt.labels);
    if(evt.labels_list !== undefined) candidates.push(evt.labels_list);
  }
  let raw = [];
  for(const c of candidates){ if(c === undefined || c === null) continue; if(Array.isArray(c) && c.length>0){ raw = c; break; } if(typeof c === 'string' && c.trim()){ raw = [c]; break; } if(typeof c === 'object' && !Array.isArray(c)){ raw = [c]; break; } }
  const out = []; if(!raw) return out; try{ if(!Array.isArray(raw)){ if(typeof raw === 'string') raw = [raw]; else if(typeof raw === 'object') raw = [raw]; else raw = []; } }catch(e){ return out; }
  raw.forEach(r=>{ if(r===undefined||r===null) return; 
    if(typeof r === 'string'){ const isModel = /^model[:\-\s]/i.test(r) || /\bmodel\b|\bml\b/i.test(r); 
      const text = r.replace(/^model[:\-\s]+/i,'').trim(); 
      out.push({ text: text||r, source: isModel? 'model':'rule', confidence: undefined, isModel }); 
      return; } 
      if(typeof r === 'object'){ const text = r.label||r.text||r.name||r.tag||JSON.stringify(r); 
        const src = r.source||r.origin||r.by||r.src||r.provider||''; 
        const conf = r.confidence||r.score||r.probability||r.p||r.conf||undefined; 
        const isModel = String(src).toLowerCase().includes('model')||String(src).toLowerCase().includes('ml')||/^model[:\-\s]/i.test(text)||!!r.isModel; 
        out.push({ text, source: src || (isModel ? 'model':'rule'), confidence: conf, isModel }); 
        return; } }); 
        return out;
       }

// --- Synthesis/clean/merge ---
function detectTagsFromText(text){
   if(!text) return []; const t=String(text).toLowerCase();
    const tags=new Set(); 
    if(t.includes('goal')||/scores?|scored|goal by|assist/.test(t)) tags.add('goal'); 
    
    if(t.includes('penalty')) tags.add('penalty'); 
    if(t.includes('yellow card')||t.includes('yellow')) tags.add('yellow card'); 
    if(t.includes('red card')||t.includes('sent off')||t.includes('red')) tags.add('red card'); 
    if(t.includes('substitution')||t.includes('sub')||t.includes('replaced')) tags.add('substitution'); 
    if(t.includes('corner')) tags.add('corner'); 
    if(t.includes('offside')) tags.add('offside'); 
    if(t.includes('penalty shootout')||t.includes('shootout')) tags.add('shootout'); 
    const playerMatch = String(text).match(/by\s+([A-Z][a-z]+\s?[A-Z]?[a-z]*)/); 
    if(playerMatch) tags.add('player'); 
    return Array.from(tags).map(s=>({ text: s, source: 'heuristic', confidence: undefined, isModel: false })); }

function buildCleanTimeline(ev){
  const out=[]; const goalsSrc = ev.goalscorers||ev.goals||ev.goalscorer||[]; 
  (goalsSrc||[]).forEach(g=>{ const minute = g.time||g.minute||''; 
    const player = g.home_scorer||g.away_scorer||g.scorer||g.player||''; 
    const assist = g.home_assist||g.away_assist||g.assist||''; 
    const team = (g.away_scorer? ev.event_away_team : (g.home_scorer? ev.event_home_team : '')); 
    const score = g.score||''; out.push({ minute, type:'goal', player, assist, team, description: `${minute} — ${player} (${team}) scores — assist: ${assist} — score: ${score}`, tags: ['goal'] }); 
  });
  const subs = ev.substitutes||ev.subs||ev.substitutions||[]; 
  (subs||[]).forEach(s=>{ const minute = s.time||''; 
    if(s.home_scorer && typeof s.home_scorer === 'object' && Object.keys(s.home_scorer).length>0){ 
      out.push({ minute, type:'substitution', player_in: s.home_scorer.in, player_out: s.home_scorer.out, team: ev.event_home_team || 'home', description: `${minute} — ${s.home_scorer.in} ON for ${s.home_scorer.out} (${ev.event_home_team})`, tags: ['substitution'] }); 
  } if(s.away_scorer && typeof s.away_scorer === 'object' && Object.keys(s.away_scorer).length>0){ 
    out.push({ minute, type:'substitution', player_in: s.away_scorer.in, player_out: s.away_scorer.out, team: ev.event_away_team || 'away', description: `${minute} — ${s.away_scorer.in} ON for ${s.away_scorer.out} (${ev.event_away_team})`, tags: ['substitution'] }); 
} });
  const cards = ev.cards||[];
   (cards||[]).forEach(c=>{ const minute = c.time||''; 
    const player = c.home_fault||c.away_fault||''; 
    const cardType = (c.card||'').toLowerCase(); 
    const team = c.home_fault? ev.event_home_team : (c.away_fault? ev.event_away_team : ''); 
    out.push({ minute, type:'card', player, card: cardType, team, description: `${minute} — ${cardType} for ${player} (${team})`, tags: [cardType] }); });
  
    function minuteSortKey(m){ 
    if(!m) return 0; 
    const plus = String(m).includes('+'); 
    if(plus){ const parts = String(m).split('+'); return Number(parts[0]) + Number(parts[1]) / 100; } return Number(m)||0; 
  }
  out.sort((a,b)=> minuteSortKey(a.minute) - minuteSortKey(b.minute)); return out;
}

function synthesizeTimelineFromEvent(ev){
  try{ 
    const out=[]; 
    const scorers = ev.scorers||ev.goals||ev.goal_scorers||ev.scorers_list||ev.goals_list||[]; 
    if(Array.isArray(scorers)&&scorers.length>0){ 
      scorers.forEach(s=>{ const minute = s.minute||s.time||s.minute_display||s.m||s.match_minute||''; 
        const name = s.name||s.player||s.scorer||s.player_name||s.player_fullname||''; 
        const team = s.team||s.side||s.club||''; const desc = s.description||s.text||(name?`Goal by ${name}`:'Goal'); 
        const tags = s.tags||s.predicted_tags||s.predictedTags||s.labels|| (s.type?[s.type]:[]); out.push({ minute, description: desc, player: name, team, type: s.type||'goal', predicted_tags: tags, raw: s }); 
      }); }
    const comments = ev.comments||ev.comments_list||ev.match_comments||ev.play_by_play||ev.commentary||[]; 
    if(Array.isArray(comments)&&comments.length>0){ comments.slice(0,8).forEach(c=>{ const minute = c.time||c.minute||c.comments_time||c.match_minute||''; 
      const desc = c.text||c.comment||c.comments_text||c.body||''; 
      const tags = c.tags||c.predicted_tags||c.predictedTags||c.labels||[]; 
      if(desc) out.push({ minute, description: desc, predicted_tags: tags, raw: c }); 
    }); }
    if(out.length===0){ const home = ev.event_home_team||ev.strHomeTeam||ev.home_team||ev.homeName||''; 
      const away = ev.event_away_team||ev.strAwayTeam||ev.away_team||ev.awayName||''; 
      const score = ev.event_final_result||ev.event_ft_result||(ev.home_score!=null&&ev.away_score!=null?`${ev.home_score} - ${ev.away_score}`:''); 
      if(home||away||score) out.push({ minute:'', description: `${home} vs ${away} ${score}`, predicted_tags: [], raw: ev }); 
    }
    const enriched = out.map(entry=>{ const hasTags = entry.predicted_tags && Array.isArray(entry.predicted_tags) && entry.predicted_tags.length>0; 
      if(!hasTags){ const inferred = detectTagsFromText(entry.description||''); 
        entry.predicted_tags = inferred; 
      } return entry; 
    }); 
    return enriched; 
  }catch(e){ 
    return []; 
  }
}

function buildMergedTimeline(ev){
  const base = buildCleanTimeline(ev) || [];
  let existing = ev.timeline || ev.timeline_items || ev.events || ev.event_timeline || ev.eventTimeline || ev.event_entries || [];
  if(existing && !Array.isArray(existing) && typeof existing === 'object'){
    const vals = Object.values(existing).filter(Boolean);
    existing = vals.reduce((acc, cur)=> acc.concat(Array.isArray(cur)?cur:[]), []);
  }
  const normalizeExisting = (arr)=> (Array.isArray(arr)?arr:[]).map(it=>{
    const minute = it.minute||it.time||it.min||it.m||it.match_minute||'';
    const desc = it.description||it.text||it.event||it.incident||it.detail||'';
    const hint = (it.type||it.event||it.category||'').toString().toLowerCase();
    const providerTags = it.tags||it.labels||it.labels_list;
    const predicted = it.predicted_tags||it.predictedTags;
    let inferred = null;
    if(!providerTags && !predicted){ inferred = detectTagsFromText(desc || hint); }
    const out = { minute, description: desc, raw: it };
    if(providerTags && (Array.isArray(providerTags)? providerTags.length>0 : String(providerTags).trim().length>0)){
      out.tags = providerTags;
    } else if(predicted && (Array.isArray(predicted)? predicted.length>0 : String(predicted).trim().length>0)){
      out.predicted_tags = predicted;
    } else if(inferred){ out.predicted_tags = inferred; }
    return out;
  });
  const provider = normalizeExisting(existing);
  const fromComments = synthesizeTimelineFromEvent(ev) || [];
  const key = (e)=> `${e.minute||e.time||''}::${(e.description||e.text||'').trim().toLowerCase()}`;
  const merged = []; const seen = new Set();
  for(const group of [base, provider, fromComments]){ for(const e of group){ const k = key(e); if(!seen.has(k)){ seen.add(k); merged.push(e); } } }
  const minuteSortKey = (m)=>{ if(!m) return 0; const s=String(m); if(s.includes('+')){ const parts=s.split('+'); return Number(parts[0]) + Number(parts[1]||0)/100; } return Number(m)||0; };
  merged.sort((a,b)=> minuteSortKey(a.minute||a.time) - minuteSortKey(b.minute||b.time));
  return merged;
}

// --- Horizontal helpers ---
// Converts strings like "90+3" → 93.
function toMinuteNumber(m){
  if(m===undefined||m===null) return NaN;
  const s = String(m).trim();
  if(!s) return NaN;
  if(s.includes('+')){ const [a,b] = s.split('+'); const na = Number(a)||0; const nb = Number(b)||0; return na + nb; }
  const n = Number(s.replace(/[^0-9]/g,''));
  return Number.isFinite(n) ? n : NaN;
}

function buildTooltipContent(event, matchCtx, opts){
  const _esc = (typeof window !== 'undefined' && typeof window.escapeHtml === 'function') ? window.escapeHtml : (s)=> String(s).replace(/[&<>"'`=\/]/g, (ch)=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;','`':'&#x60;','=':'&#x3D;'}[ch]));
  const minute = event.minute || event.time || (opts && opts.minute) || '';
  const description = event.description || event.text || (opts && opts.description) || '';
  const normTags = normalizeEventTags(event);
  const simpleTags = Array.isArray(normTags)? normTags : [];
  const etype = deriveEventType(description, simpleTags.map(t=>t.text), event);
  const icon = getEventIcon(description, simpleTags.map(t=>t.text));
  
  let headerHtml = '';
  if(etype === 'substitution'){
    const { inName, outName } = parseSubstitutionPlayers(event);
    const inImg = inName ? resolvePlayerImageByName(inName, matchCtx) : '';
    const outImg = outName ? resolvePlayerImageByName(outName, matchCtx) : '';
    const imgBox = (src)=> src ? `<div style="width:40px;height:40px;overflow:hidden;border-radius:10px;flex-shrink:0;background:linear-gradient(135deg,#f3f4f6,#e5e7eb);border:2px solid white;box-shadow:0 4px 8px rgba(0,0,0,0.1)"><img src="${src}" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.remove()"/></div>` : `<div style="width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#f3f4f6,#e5e7eb);color:#6b7280;border:2px solid white;box-shadow:0 4px 8px rgba(0,0,0,0.1);font-size:18px;">👤</div>`;
    headerHtml = `<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">${imgBox(inImg)}<div style="display:flex;flex-direction:column;"><div style="font-weight:700;color:#10b981;font-size:14px;">${_esc(inName||'Player In')}</div><div style="font-size:11px;color:#6b7280;margin-top:2px;">Substitute In</div></div><div style="display:flex;align-items:center;margin:0 8px;"><span style="color:#9ca3af;font-size:20px;">→</span></div>${imgBox(outImg)}<div style="display:flex;flex-direction:column;"><div style="font-weight:700;color:#ef4444;font-size:14px;">${_esc(outName||'Player Out')}</div><div style="font-size:11px;color:#6b7280;margin-top:2px;">Substitute Out</div></div></div>`;
  } else {
    const { playerImg, teamLogo, playerName } = resolvePlayerAndImages(event, matchCtx);
    const imgSrc = playerImg || teamLogo || '';
    const imgBox = imgSrc ? `<div style="width:40px;height:40px;overflow:hidden;border-radius:10px;flex-shrink:0;background:linear-gradient(135deg,#f3f4f6,#e5e7eb);border:2px solid white;box-shadow:0 4px 8px rgba(0,0,0,0.1)"><img src="${imgSrc}" style="width:100%;height:100%;object-fit:${playerImg?'cover':'contain'};display:block" onerror="this.remove()"/></div>` : `<div style="width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#f3f4f6,#e5e7eb);color:#6b7280;border:2px solid white;box-shadow:0 4px 8px rgba(0,0,0,0.1);font-size:18px;">⚽</div>`;
    headerHtml = `<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">${imgBox}<div style="display:flex;flex-direction:column;"><div style="font-weight:700;color:#111827;font-size:14px;">${_esc(playerName||'Player Event')}</div><div style="font-size:11px;color:#6b7280;margin-top:2px;text-transform:capitalize;">${etype.replace('_', ' ')}</div></div></div>`;
  }
  
  const tagsHtml = simpleTags.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px;padding-top:12px;border-top:1px solid #f3f4f6;">${simpleTags.map(t=>{
    const color = t.isModel? '#6d28d9' : getTagColor(t.text||'');
    const conf = (t.confidence!==undefined && t.confidence!==null) ? ` <small style=\"opacity:.8\">${Number(t.confidence).toFixed(2)}</small>` : '';
    return `<span style=\"background:${color};color:white;padding:4px 10px;border-radius:12px;font-size:11px;font-weight:600;box-shadow:0 2px 4px rgba(0,0,0,0.1);\">${_esc(t.text||'')}${conf}</span>`;
  }).join('')}</div>` : '';
  
  const brief = opts && opts.brief ? `<div style="margin-top:8px;color:#4b5563;background:#f9fafb;padding:8px 10px;border-radius:8px;border-left:3px solid #3b82f6;">${_esc(opts.brief)}</div>` : '';
  
  return `
    <div style="position:relative;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:12px;background:linear-gradient(135deg,#fef3c7,#fde68a);padding:8px 12px;border-radius:10px;border:1px solid #f59e0b;">
        <div style="display:flex;align-items:center;gap:8px;font-size:16px;">${icon}</div>
        <div style="display:flex;align-items:center;gap:6px;color:#92400e;font-weight:800;font-size:14px;"><span>${_esc(minute? minute+"'" : 'Live')}</span></div>
      </div>
      ${headerHtml}
      ${description ? `<div style=\"color:#374151;line-height:1.6;margin-bottom:8px;background:#f8fafc;padding:8px 10px;border-radius:8px;border-left:3px solid #10b981;\">${_esc(description)}</div>` : ''}
      ${brief}
      ${tagsHtml}
    </div>
  `;
}

// --- Rendering ---
function createTimelineEvent(event, isLast, matchCtx){
  // Fallback for escapeHtml if not present
  const _esc = (typeof window !== 'undefined' && typeof window.escapeHtml === 'function') ? window.escapeHtml : (s)=> String(s).replace(/[&<>"'`=\/]/g, (ch)=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;','`':'&#x60;','=':'&#x3D;'}[ch]));
  const eventDiv = document.createElement('div'); eventDiv.style.cssText = `display:flex;align-items:flex-start;margin-bottom:${isLast?'0':'16px'};position:relative;`;
  const normTags = normalizeEventTags(event); const tags = Array.isArray(normTags)?normTags.map(t=>t.text):[];
  const minute = event.minute || event.time || ''; const description = event.description || event.text || event.event || '';
  const timeline = document.createElement('div'); timeline.style.cssText='display:flex;flex-direction:column;align-items:center;margin-right:16px;flex-shrink:0;'; const dot = document.createElement('div'); dot.style.cssText = `width:12px;height:12px;border-radius:50%;background:${getEventColor(description,tags)};border:3px solid white;box-shadow:0 0 0 2px ${getEventColor(description,tags)};`; const line = document.createElement('div'); line.style.cssText = `width:2px;height:24px;background:#e5e7eb;${isLast? 'display:none;':''}`; timeline.appendChild(dot); timeline.appendChild(line);
  const content = document.createElement('div'); content.style.cssText='flex:1;'; const eventHeader = document.createElement('div'); eventHeader.style.cssText='display:flex;align-items:center;gap:8px;margin-bottom:4px;'; const minuteSpan = document.createElement('span'); minuteSpan.style.cssText='background:#f3f4f6;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600;color:#6b7280;'; minuteSpan.textContent = minute? `${minute}'` : '';
  const icon = document.createElement('span'); icon.style.fontSize='16px'; icon.textContent = getEventIcon(description, tags); eventHeader.appendChild(minuteSpan); eventHeader.appendChild(icon);
  // Determine event type early for inline rendering decisions
  const etypeInline = deriveEventType(description, tags, event);
  // Inline player avatar/logo next to icon (special handling for substitutions: show IN and OUT)
  try{
    if(etypeInline === 'substitution'){
      const { inName, outName } = parseSubstitutionPlayers(event);
      const inImg = inName ? resolvePlayerImageByName(inName, matchCtx) : '';
      const outImg = outName ? resolvePlayerImageByName(outName, matchCtx) : '';
      const mkAvatar = (src, label)=>{
        const wrap = document.createElement('div');
        wrap.style.cssText = 'width:20px;height:20px;border-radius:4px;overflow:hidden;flex-shrink:0;background:#1f2937;display:flex;align-items:center;justify-content:center;position:relative';
        if(label){ const b = document.createElement('span'); b.textContent = label; b.style.cssText = 'position:absolute;bottom:-6px;left:50%;transform:translateX(-50%);font-size:9px;color:#6b7280'; wrap.appendChild(b); }
        if(src){
          const img = document.createElement('img'); img.src = src; img.alt = label||'player'; img.style.cssText='width:20px;height:20px;object-fit:cover;display:block'; img.onerror=function(){ const span=document.createElement('span'); span.textContent='👤'; span.style.cssText='font-size:14px;color:#e5e7eb;display:flex;align-items:center;justify-content:center;width:18px;height:18px;'; this.replaceWith(span); }; wrap.appendChild(img);
        } else { const span=document.createElement('span'); span.textContent='👤'; span.style.cssText='font-size:14px;color:#e5e7eb;display:flex;align-items:center;justify-content:center;width:18px;height:18px;'; wrap.appendChild(span); }
        return wrap;
      };
      if(inName || outName){
        const inWrap = mkAvatar(inImg, 'IN');
        const arrow = document.createElement('span'); arrow.textContent = '→'; arrow.style.cssText='color:#6b7280;font-size:12px;padding:0 4px;';
        const outWrap = mkAvatar(outImg, 'OUT');
        eventHeader.appendChild(inWrap); eventHeader.appendChild(arrow); eventHeader.appendChild(outWrap);
      }
    } else {
      const resolved = resolvePlayerAndImages(event, matchCtx);
      if(resolved && (resolved.playerImg || resolved.teamLogo)){
        const wrap = document.createElement('div');
        wrap.style.cssText = 'width:20px;height:20px;border-radius:4px;overflow:hidden;flex-shrink:0;background:#1f2937;display:flex;align-items:center;justify-content:center';
        const img = document.createElement('img');
        img.src = resolved.playerImg || resolved.teamLogo || '';
        img.alt = resolved.playerName || 'player';
        img.style.cssText = resolved.playerImg ? 'width:20px;height:20px;object-fit:cover;display:block' : 'width:18px;height:18px;object-fit:contain;display:block';
        img.onerror = function(){
          try{
            this.onerror = null;
            if(resolved.playerImg && resolved.teamLogo){ this.src = resolved.teamLogo; return; }
            const span = document.createElement('span');
            span.textContent = '👤';
            span.style.cssText = 'font-size:14px;color:#e5e7eb;display:flex;align-items:center;justify-content:center;width:18px;height:18px;';
            this.replaceWith(span);
          }catch(_e){ this.remove(); }
        };
        wrap.appendChild(img);
        eventHeader.appendChild(wrap);
      }
    }
  }catch(_e){}
  const eventText = document.createElement('div'); eventText.style.cssText='color:#374151;margin-bottom:8px;'; eventText.textContent = description;
  content.appendChild(eventHeader); content.appendChild(eventText);
  if(Array.isArray(normTags) && normTags.length>0){ const tagsContainer = document.createElement('div'); tagsContainer.style.cssText='display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;align-items:center;'; const hasModel = normTags.some(t=>t.isModel); if(hasModel){ const mlBadge = document.createElement('span'); mlBadge.textContent='ML'; mlBadge.title='Model-predicted tag present'; mlBadge.style.cssText='background:#7c3aed;color:white;padding:2px 6px;border-radius:10px;font-size:11px;font-weight:700;'; tagsContainer.appendChild(mlBadge); } normTags.forEach(t=>{ const tagSpan = document.createElement('span'); const color = t.isModel? '#6d28d9' : getTagColor(t.text||''); tagSpan.style.cssText = `background:${color};color:white;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:500;display:inline-flex;align-items:center;gap:8px;`; const label = document.createElement('span'); label.textContent = t.text; tagSpan.appendChild(label); if(t.confidence!==undefined && t.confidence!==null){ const conf = document.createElement('small'); conf.textContent = ` ${Number(t.confidence).toFixed(2)}`; conf.style.opacity='0.9'; conf.style.marginLeft='6px'; conf.style.fontSize='10px'; tagSpan.appendChild(conf); } tagsContainer.appendChild(tagSpan); }); content.appendChild(tagsContainer); }
  const rawToggle = document.createElement('button'); rawToggle.textContent='Show raw'; rawToggle.style.cssText='margin-left:8px;background:transparent;border:1px dashed #d1d5db;color:#374151;padding:4px 8px;border-radius:6px;cursor:pointer;font-size:12px;'; const rawPre = document.createElement('pre'); rawPre.style.cssText='display:none;margin-top:8px;background:#111827;color:#e5e7eb;padding:8px;border-radius:8px;overflow:auto;max-height:240px;'; try{ rawPre.textContent = JSON.stringify(event.raw || event, null, 2); }catch(e){ rawPre.textContent = String(event.raw || event); } rawToggle.addEventListener('click', ()=>{ if(rawPre.style.display==='none'){ rawPre.style.display='block'; rawToggle.textContent='Hide raw'; } else { rawPre.style.display='none'; rawToggle.textContent='Show raw'; } }); content.appendChild(rawToggle); content.appendChild(rawPre);
  try{
    const etype = deriveEventType(description, tags, event);
    if(etype){
      dot.style.cursor = 'help';
      const onEnter = async ()=>{
        const d = ensureTooltip();
        let { playerImg, teamLogo } = resolvePlayerAndImages(event, matchCtx);

        try{
          const brief = await getEventBrief(etype, { minute, description, event, tags }, matchCtx);
          const d2 = ensureTooltip();
          let headerHtml = '';
          if(etype === 'substitution'){
            const { inName, outName } = parseSubstitutionPlayers(event);
            const inImg = inName ? resolvePlayerImageByName(inName, matchCtx) : '';
            const outImg = outName ? resolvePlayerImageByName(outName, matchCtx) : '';
            const imgBox = (src)=> src ? `<div style="width:32px;height:32px;overflow:hidden;border-radius:6px;flex-shrink:0;background:#1f2937"><img src="${src}" style="width:32px;height:32px;object-fit:cover;display:block" onerror="this.remove()"/></div>` : `<div style="width:32px;height:32px;border-radius:6px;display:flex;align-items:center;justify-content:center;background:#1f2937;color:#e5e7eb">👤</div>`;
            const inPart = `${imgBox(inImg)}<div style="font-weight:700;color:#10b981;margin:0 6px">${_esc(inName||'IN')}</div>`;
            const outPart = `${imgBox(outImg)}<div style="font-weight:700;color:#ef4444;margin:0 6px">${_esc(outName||'OUT')}</div>`;
            headerHtml = `<div style="display:flex;align-items:center;gap:8px;">${inPart}<span style="color:#9ca3af">→</span>${outPart}</div>`;
          } else {
            const titleParts = [];
            if(playerImg){ titleParts.push(`<div style="width:32px;height:32px;overflow:hidden;border-radius:6px;flex-shrink:0;background:#1f2937"><img src="${playerImg}" style="width:32px;height:32px;object-fit:cover;display:block" onerror="this.remove()"/></div>`); }
            if(!playerImg && teamLogo){ titleParts.push(`<div style=\"width:32px;height:32px;overflow:hidden;border-radius:6px;flex-shrink:0;background:#1f2937\"><img src=\"${teamLogo}\" style=\"width:32px;height:32px;object-fit:contain;display:block\" onerror=\"this.remove()\"/></div>`); }
            const nameLabel = (event.player || event.player_name || event.playerName || event.player_fullname) ? `<div style=\"margin-left:8px;font-weight:700;color:#e5e7eb\">${_esc(String(event.player || event.player_name || event.playerName || ''))}</div>` : '';
            headerHtml = `<div style=\"display:flex;align-items:center;gap:8px;\">${titleParts.join('')}${nameLabel}</div>`;
          }
          d2.innerHTML = `${headerHtml}<div style=\"margin-top:6px;color:#e5e7eb;font-size:12px;white-space:normal\">${_esc(String(brief || description || etype))}</div>`;
          d2.style.display='block';
          positionEventTooltip(dot);
        }catch(_e){
          try{ showEventTooltip(dot, description || etype); }catch(__e){}
        }
      };
      const onLeave = ()=> hideEventTooltip();
      const onMove = ()=> positionEventTooltip(dot);
      dot.addEventListener('mouseenter', onEnter);
      dot.addEventListener('mouseleave', onLeave);
      dot.addEventListener('mousemove', onMove);
    }
  }catch(_e){}
  eventDiv.appendChild(timeline); eventDiv.appendChild(content); return eventDiv;
}

function deriveEventType(description, tags, ev){ 
  const t = (Array.isArray(tags)?tags.join(' ').toLowerCase():String(tags||'').toLowerCase()); 
  const d = String(description||'').toLowerCase(); 
  if(t.includes('goal')||/\bgoal\b|scored|scores/.test(d)) 
    return 'goal'; 
  if(t.includes('red')) 
    return 'red card'; 
  if(t.includes('yellow')) 
    return 'yellow card'; 
  if(t.includes('substitution')||/\bsub\b|replaced/.test(d)) 
    return 'substitution'; 
  return null; 
}

// Caching brief results to avoid repeated calls for same event
function _briefKey(etype, payload){ 
  const p = payload||{}; 
  return [etype, p.minute||'', (p.description||'').slice(0,80), (p.event&& (p.event.player||p.event.home_scorer||p.event.away_scorer||''))||'', p.tags && p.tags.join('|')].join('::'); 
}

async function getEventBrief(etype, payload, matchCtx){
  const key = _briefKey(etype, payload);
  if(_eventBriefCache.has(key)) return _eventBriefCache.get(key);
  const ev = (payload && payload.event) || {};
  const tags = payload && payload.tags || [];
  const home = matchCtx?.event_home_team || matchCtx?.strHomeTeam || matchCtx?.home_team || '';
  const away = matchCtx?.event_away_team || matchCtx?.strAwayTeam || matchCtx?.away_team || '';
  const payloadBody = { provider: 'auto', eventId: String(matchCtx?.idEvent || matchCtx?.event_key || matchCtx?.id || matchCtx?.match_id || '' ) || undefined, eventName: (home && away) ? `${home} vs ${away}` : undefined, date: matchCtx?.event_date || matchCtx?.dateEvent || matchCtx?.date || undefined, events: [{ minute: payload.minute || ev.minute || ev.time || '', type: etype, description: payload.description || ev.description || ev.text || ev.event || '', player: ev.player || ev.home_scorer || ev.away_scorer || ev.player_name || '', team: ev.team || '', tags: Array.isArray(tags)? tags.slice(0,6) : undefined, }] };
  let brief = '';
  try{
    const base = (typeof window !== 'undefined' && window.apiBase) ? window.apiBase : (typeof apiBase !== 'undefined' ? apiBase : '');
    if(base){
      const r = await fetch(base + '/summarizer/summarize/events', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payloadBody)});
      if(r.ok){ const j = await r.json(); brief = (j && j.items && j.items[0] && j.items[0].brief) || ''; }
    }
  }catch(_e){}
  if(!brief){ const minute = payload.minute || ev.minute || ev.time || ''; const player = ev.player || ev.home_scorer || ev.away_scorer || ev.player_name || ''; if(etype==='goal') brief = `${player||'Unknown'} scores at ${minute||'?'}.'`; else if(etype==='yellow card') brief = `Yellow card for ${player||'unknown'} at ${minute||'?'}.`; else if(etype==='red card') brief = `Red card for ${player||'unknown'} at ${minute||'?'}.`; else if(etype==='substitution') brief = payload.description || 'Substitution.'; else brief = payload.description || etype; }
  _eventBriefCache.set(key, brief); return brief;
}

function renderMatchTimeline(ev, container){
  // Collect events
  let events = ev.timeline || ev.timeline_items || ev.events || ev.event_timeline || ev.eventTimeline || ev.event_entries || [];
  if(events && !Array.isArray(events) && typeof events === 'object'){
    const vals = Object.values(events).filter(Boolean);
    const arr = vals.reduce((acc, cur)=> acc.concat(Array.isArray(cur)?cur:[]), []);
    if(arr.length>0) events = arr;
  }
  if(!Array.isArray(events) || events.length===0) events = synthesizeTimelineFromEvent(ev);
  if(!Array.isArray(events) || events.length===0) return;

  // Filter to special events only (goals, yellow/red cards, substitutions)
  const specialEvents = (events||[]).filter(e=>{
    const t = normalizeEventTags(e); const tagTxt = Array.isArray(t)? t.map(tt=>tt.text) : [];
    const etype = deriveEventType(e.description||e.text||'', tagTxt, e);
    const mn = toMinuteNumber(e.minute||e.time);
    return !!etype && Number.isFinite(mn);
  });

  // Card shell
  const timelineCard = document.createElement('div');
  // Standard card width inside container; scrolling is confined to the timeline scroller only
  timelineCard.style.cssText='background:white;border-radius:16px;padding:20px 16px;margin-bottom:20px;box-shadow:0 4px 20px rgba(0,0,0,0.08);width:100%;max-width:100%;overflow:hidden;';
  const title = document.createElement('h3');
  title.style.cssText = 'margin:0 0 14px 0;color:#1f2937;font-size:20px';
  title.innerHTML = '⚽ Match Timeline';
  timelineCard.appendChild(title);

  // Domain and scale (compressed gaps + scroller)
  const minutes = events.map(e=> toMinuteNumber(e.minute||e.time)).filter(n=>Number.isFinite(n));
  const maxMinute = minutes.length ? Math.max(90, Math.max(...minutes)) : 90;
  const minMinute = 0;

  // Track baseline inside a horizontal scroller
  const scroller = document.createElement('div');
  // Allow vertical scroll on the page while enabling horizontal scroll inside the timeline only when applicable
  scroller.style.cssText = 'position:relative;overflow-x:auto;overflow-y:hidden;padding:0 8px 6px 8px;scroll-behavior:smooth;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain;width:100%;max-width:100%;box-sizing:border-box;';
  // Convert vertical wheel to horizontal scroll when hovering timeline; prevents vertical page scroll here
  try {
    scroller.addEventListener('wheel', (e) => {
      // If the user scrolls vertically more than horizontally, translate to horizontal when possible
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        const before = scroller.scrollLeft;
        scroller.scrollLeft += e.deltaY;
        const after = scroller.scrollLeft;
        const canScrollX = scroller.scrollWidth > scroller.clientWidth;
        const atEdge = (!canScrollX) ||
          (e.deltaY < 0 && after === 0) ||
          (e.deltaY > 0 && Math.ceil(after + scroller.clientWidth) >= scroller.scrollWidth);
        // Only prevent default if we actually scrolled horizontally and are not at an edge
        if (canScrollX && after !== before && !atEdge) {
          e.preventDefault();
        }
      }
    }, { passive: false });
  } catch(_e) {}
  const track = document.createElement('div');
  track.style.cssText = 'position:relative;height:104px;min-width:100%;overflow:hidden;';
  
  // Store baseline container for later
  track.baselineContainer = document.createElement('div');
  // Slight offset upward (-1px) to visually center the thicker 3px line relative to icons
  track.baselineContainer.style.cssText = 'position:absolute;left:0;right:0;top:50%;height:3px;transform:translateY(calc(-50% - 1px));';
  track.appendChild(track.baselineContainer);

  // Minute ticks (sparse)
  const pendingTicks = [0,45,90]; if(maxMinute>90) pendingTicks.push(maxMinute);
  const tickPositions = [];

  // Compute stoppage time badges for 45+ and 90+
  let stoppage45 = 0, stoppage90 = 0;
  try{
    for(const e of (events||[])){
      const raw = String(e.minute||e.time||'').trim();
      let m;
      if((m = raw.match(/^45\+(\d+)/))) stoppage45 = Math.max(stoppage45, Number(m[1])||0);
      if((m = raw.match(/^90\+(\d+)/))) stoppage90 = Math.max(stoppage90, Number(m[1])||0);
    }
  }catch(_e){}

  //Cluster events by minute with stoppage-time compression (45+ and 90+)
  const clustersMap = new Map();
  const getClusterKey = (e)=>{
    const raw = (e.minute||e.time||'').toString().trim();
    if(raw.includes('+')){
      const parts = raw.split('+');
      const base = parseInt(parts[0],10) || 0;
      const extra = parseInt((parts[1]||'').toString().replace(/[^0-9]/g,''),10) || 0;
      // For 90+N, treat as separate minutes (e.g., 95) so they appear in extra time segment
      if(base >= 90){
        return String(base + extra);
      }
      // For 45+N, keep them clustered at 45'
      return `${base}+`;
    }
    const n = toMinuteNumber(raw);
    return Number.isFinite(n) ? String(n) : 'unknown';
  };
  const getClusterPosMinute = (key)=>{
    if(key.endsWith('+')){
      const base = parseInt(key,10) || 0; return base; // place 45+ at 45, 90+ at 90
    }
    const n = Number(key); return Number.isFinite(n) ? n : null;
  };
  // Build clusters from special events only
  for(const e of specialEvents){
    const key = getClusterKey(e);
    if(!clustersMap.has(key)) clustersMap.set(key, { key, minuteNumber: getClusterPosMinute(key), events: [] });
    clustersMap.get(key).events.push(e);
  }
  const clusters = Array.from(clustersMap.values()).sort((a,b)=>{
    const am = Number.isFinite(a.minuteNumber) ? a.minuteNumber : Infinity;
    const bm = Number.isFinite(b.minuteNumber) ? b.minuteNumber : Infinity;
    return am - bm;
  });

  // Layout tuning: extra breathing room at edges and around HT
  const cfg = { pxPerMinute: 9, maxGapPx: 110, minGapPx: 20, leftPad: 36, rightPad: 44, htGapBefore: 44, htGapAfter: 56 };
  const xPos = []; // pixel x for each cluster
  let curX = cfg.leftPad;
  // Lead-in spacing from 0' to first cluster so Start stays at 0
  if(clusters.length>0){
    const firstMin = clusters[0].minuteNumber;
    if(Number.isFinite(firstMin) && firstMin>0){
      // lead-in scaled to minute with smaller clamps so there isn't too much empty space
      const scaled = firstMin * (cfg.pxPerMinute * 0.6);
      const leadGap = Math.min(72, Math.max(18, scaled));
      curX = cfg.leftPad + leadGap;
    }
  }
  for(let i=0;i<clusters.length;i++){
    if(i===0){ xPos[i] = curX; continue; }
    const prev = clusters[i-1]; const cur = clusters[i];
    let dMin = (Number.isFinite(prev.minuteNumber) && Number.isFinite(cur.minuteNumber)) ? (cur.minuteNumber - prev.minuteNumber) : 0;
    // if same minute (e.g., 45 and 45+) enforce minimum spacing
    if(dMin<=0) dMin = 0.1;
    let gap = Math.min(cfg.maxGapPx, Math.max(cfg.minGapPx, dMin * cfg.pxPerMinute));
    // Inject additional visual breathing room before and after HT (45') separately
    if(Number.isFinite(prev.minuteNumber) && Number.isFinite(cur.minuteNumber)){
      if(prev.minuteNumber < 45 && cur.minuteNumber >= 45){
        // space leading into HT
        gap += cfg.htGapBefore;
      }
      if(prev.minuteNumber <= 45 && cur.minuteNumber > 45){
        // space coming out of HT
        gap += cfg.htGapAfter;
      }
    }
    curX += gap; xPos[i] = curX;
  }
  let totalWidth = (xPos.length ? xPos[xPos.length-1] : cfg.leftPad) + cfg.rightPad;
  // Stretch to fill container width (use full screen size) to avoid overly tight layout
  const viewport = Math.max(scroller?.clientWidth || 0, window.innerWidth || 0) - 48; // padding allowance
  if(viewport > 0 && totalWidth < viewport){
    const lastX = xPos[xPos.length-1] || cfg.leftPad;
    const available = Math.max(1, viewport - cfg.leftPad - cfg.rightPad);
    const base = Math.max(1, lastX - cfg.leftPad);
    const scale = available / base;
    for(let i=0;i<xPos.length;i++){
      xPos[i] = cfg.leftPad + (xPos[i] - cfg.leftPad) * scale;
    }
    totalWidth = viewport;
  }
  // If no clusters (no special events), ensure track fills container for tick rendering
  if(clusters.length===0){
    totalWidth = Math.max(totalWidth, viewport>0? viewport : 600);
  }
  track.style.width = `${Math.max(totalWidth, 600)}px`;

  // Helper to position ticks between clusters in compressed space
  const getTickX = (m)=>{
    if(!Number.isFinite(m)) return null;
    if(clusters.length===0){
      // Linear mapping across the whole domain when no clusters
      const domain = Math.max(1, (maxMinute - minMinute));
      const span = Math.max(1, (Math.max(totalWidth, 600) - cfg.leftPad - cfg.rightPad));
      const ratio = Math.max(0, Math.min(1, (m - minMinute) / domain));
      return cfg.leftPad + ratio * span;
    }
    // before first cluster
    if(Number.isFinite(clusters[0].minuteNumber) && m <= clusters[0].minuteNumber){
      const d = clusters[0].minuteNumber - m; const add = Math.min(cfg.maxGapPx, Math.max(0, d*cfg.pxPerMinute));
      // Clamp ticks before first cluster to start at leftPad so Start aligns with baseline
      return Math.max(cfg.leftPad - add, cfg.leftPad);
    }
    // between clusters
    for(let i=1;i<clusters.length;i++){
      const mA = clusters[i-1].minuteNumber; const mB = clusters[i].minuteNumber;
      if(!Number.isFinite(mA) || !Number.isFinite(mB)) continue;
      if(m >= mA && m <= mB){
        const gapMin = Math.max(0.0001, mB - mA);
        const gapPx = xPos[i] - xPos[i-1];
        const ratio = (m - mA) / gapMin;
        return xPos[i-1] + ratio * gapPx;
      }
    }
    // after last cluster
    const lastIdx = clusters.length-1; const mL = clusters[lastIdx].minuteNumber;
    if(Number.isFinite(mL)){
      const d = m - mL; const add = Math.min(cfg.maxGapPx, Math.max(0, d*cfg.pxPerMinute));
      return xPos[lastIdx] + add;
    }
    return totalWidth - cfg.rightPad;
  };

  // Add sparse ticks using compressed mapping
  const addTick = (min, label, plusN)=>{
    const x = getTickX(min);
    if(x===null) return;
    const tick = document.createElement('div');
    tick.style.cssText = `position:absolute;left:${x}px;top:50%;width:2px;height:8px;background:#d1d5db;transform:translate(-50%,-50%);`;
    const lab = document.createElement('div');
    lab.textContent = label;
    // Bold tick labels (Start, HT, FT, etc.) per request
  // Place tick labels a bit lower to avoid colliding with event minute labels
  lab.style.cssText = 'position:absolute;top:64%;transform:translate(-50%,0);font-size:12px;color:#111827;font-weight:700;white-space:nowrap;';
  const xLabel = (min===0) ? cfg.leftPad : x;
    lab.style.left = `${xLabel}px`;
    track.appendChild(tick); track.appendChild(lab);
    // Keep for collision checks with nearby event labels
    tickPositions.push({ min, x });
    if(plusN && plusN>0){
      const badge = document.createElement('div');
      badge.textContent = `+${plusN}`;
      badge.style.cssText = `position:absolute;left:${x+14}px;top:42%;transform:translate(-50%,-50%);background:#f59e0b;color:white;font-size:10px;line-height:1;padding:3px 6px;border-radius:9999px;border:1px solid #fff;box-shadow:0 1px 2px rgba(0,0,0,0.1)`;
      track.appendChild(badge);
    }
  };
  pendingTicks.forEach(t=>{
    const plus = t===45 ? stoppage45 : (t===90 ? stoppage90 : 0);
    const label = t===0 ? 'Start' : (t===45 ? 'HT' : (t===90 ? 'FT' : `${t}'`));
    addTick(t, label, plus);
  });
  // Expose FT tick x for baseline rendering
  try {
    const ft = tickPositions.find(tp => tp.min === 90);
    if (ft && typeof ft.x === 'number') {
      track.ftX = ft.x;
    }
  } catch(_e) {}

  // Render one marker per cluster at computed x
  clusters.forEach((cluster, idx)=>{
    const x = xPos[idx];
    const wrap = document.createElement('div');
    wrap.style.cssText = `position:absolute;left:${x}px;top:50%;transform:translate(-50%,-28px);display:flex;flex-direction:column;align-items:center;gap:6px;`;
    wrap.setAttribute('data-minute', cluster.minuteNumber || 0); // Add data attribute for baseline positioning

    // Professional icon display instead of dot + icons
    const mainIcon = document.createElement('div');
    mainIcon.style.cssText = 'position:relative;display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;background:rgba(255,255,255,0.95);box-shadow:0 2px 8px rgba(0,0,0,0.1);border:1px solid rgba(0,0,0,0.08);cursor:pointer;transition:all 0.2s ease;';
    
    // Use first event for primary icon
    const first = cluster.events[0];
    const fTags = normalizeEventTags(first); const fTxt = Array.isArray(fTags)?fTags.map(t=>t.text):[];
    const primaryIcon = getEventIcon(first.description||first.text||'', fTxt);
    
    const iconSpan = document.createElement('span');
    iconSpan.textContent = primaryIcon;
    iconSpan.style.cssText = 'font-size:18px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.1));';
    mainIcon.appendChild(iconSpan);
    
    // Add hover effect
    mainIcon.addEventListener('mouseenter', () => {
      mainIcon.style.transform = 'scale(1.1)';
      mainIcon.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
    });
    mainIcon.addEventListener('mouseleave', () => {
      mainIcon.style.transform = 'scale(1)';
      mainIcon.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
    });
    
    // If multiple events, add a small indicator
    if(cluster.events.length > 1){
      const indicator = document.createElement('div');
      indicator.style.cssText = `position:absolute;top:-4px;right:-4px;width:16px;height:16px;border-radius:50%;background:#3b82f6;color:white;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.2);`;
      indicator.textContent = cluster.events.length;
      mainIcon.appendChild(indicator);
    }
    
    wrap.appendChild(mainIcon);

    // Hover: combined tooltip for cluster
    const onEnter = async ()=>{
      const parts = [];
      for(const evItem of cluster.events){
        const normT = normalizeEventTags(evItem); const tagTxt = Array.isArray(normT)?normT.map(t=>t.text):[];
        let brief='';
        try{
          const etype = deriveEventType(evItem.description||evItem.text||'', tagTxt, evItem);
          const minuteLabel = evItem.minute || evItem.time || '';
          brief = await getEventBrief(etype||'event', { minute: minuteLabel, description: evItem.description||evItem.text||'', event: evItem, tags: tagTxt }, ev);
        }catch(_e){}
        parts.push(buildTooltipContent(evItem, ev, { minute: evItem.minute||evItem.time||'', description: evItem.description||evItem.text||'', brief }));
      }
      const html = parts.join('<hr style="border:none;border-top:1px solid #e5e7eb;margin:10px 0;"/>');
      showEventTooltip(mainIcon, html);
    };
    const onMove = ()=> positionEventTooltip(mainIcon);
    const onLeave = ()=>{ if(_tooltipHideTimer){ clearTimeout(_tooltipHideTimer); } _tooltipHideTimer=setTimeout(()=>{ hideEventTooltip(); _tooltipHideTimer=null; }, 120); };
    mainIcon.addEventListener('mouseenter', onEnter);
    mainIcon.addEventListener('mousemove', onMove);
    mainIcon.addEventListener('mouseleave', onLeave);

    wrap.appendChild(mainIcon);

    // Minute label under each marker, bold like Start/HT/FT
    try{
      const firstEvt = cluster.events[0] || {};
      const rawMin = String(firstEvt.minute || firstEvt.time || '').trim();
      const minuteNum = Number.isFinite(cluster.minuteNumber) ? cluster.minuteNumber : toMinuteNumber(rawMin);
      let labelText = '';
      if(rawMin && rawMin.includes('+')){
        // If it's 90+N, show the summed minute (e.g., 97)
        const m = rawMin.match(/^(\d+)\s*\+\s*(\d+)$/);
        if(m){
          const base = parseInt(m[1], 10) || 0;
          const extra = parseInt(m[2], 10) || 0;
          if(base >= 90){
            labelText = String(base + extra);
          } else if(base === 45){
            // Keep first-half stoppage as 45+'
            labelText = '45+';
          } else {
            // Fallback: use summed minute if > 90, else raw compact
            labelText = Number.isFinite(minuteNum) && minuteNum > 90 ? String(minuteNum) : rawMin.replace(/\s+/g,'');
          }
        } else {
          // Unknown shape, fallback to computed minute or raw
          labelText = Number.isFinite(minuteNum) && minuteNum > 90 ? String(minuteNum) : rawMin.replace(/\s+/g,'');
        }
      } else if(cluster.key && /\+$/.test(String(cluster.key))){
        // Clustered stoppage at 45+
        const base = parseInt(String(cluster.key), 10) || 45;
        labelText = `${base}+`;
      } else if(Number.isFinite(minuteNum)){
        labelText = `${minuteNum}`;
      } else if(rawMin){
        labelText = rawMin.replace(/\s+/g,'');
      }
      // Avoid redundancy and overlap near Start/HT/FT and end ticks
      const suppressNearTicks = tickPositions.some(tp => {
        const isEdge = (tp.min===0 || tp.min===90 || tp.min===maxMinute);
        return isEdge && Math.abs(tp.x - x) < 40; // larger radius near Start/HT/FT/end
      });
      // Additional suppression near HT tick specifically
      const htTick = tickPositions.find(tp => tp.min === 45);
      const nearHTTick = htTick ? (Math.abs(htTick.x - x) < 36) : false;
      // Additional suppression very close to container edges
      const nearLeftEdge = Math.abs(x - cfg.leftPad) < 40;
      const nearRightEdge = Math.abs(x - (totalWidth - cfg.rightPad)) < 40;
      const isExactHTNoPlus = (minuteNum===45) && !(rawMin.includes('+'));
      if(labelText && !suppressNearTicks && !isExactHTNoPlus && !nearLeftEdge && !nearRightEdge && !nearHTTick){
        const minEl = document.createElement('div');
        minEl.textContent = `${labelText}'`;
        minEl.style.cssText = 'margin-top:4px;font-size:12px;font-weight:700;color:#111827;';
        wrap.appendChild(minEl);
      }
    }catch(_e){}
    track.appendChild(wrap);
  });

  // Add colored baseline after all events are placed
  renderColoredBaseline(track, cfg.leftPad, cfg.rightPad, totalWidth);

  scroller.appendChild(track);
  timelineCard.appendChild(scroller);
  container.appendChild(timelineCard);

  // 10) Auto-scroll near first meaningful cluster (skip minute 0 if empty)
  try{
    const firstIdx = clusters.findIndex(c=> Number.isFinite(c.minuteNumber) && c.minuteNumber>0);
    const anchorX = firstIdx>=0 ? xPos[firstIdx] : (xPos[0]||cfg.leftPad);
    if(scroller && typeof anchorX==='number'){
      const target = Math.max(0, anchorX - scroller.clientWidth*0.3);
      scroller.scrollLeft = target;
    }
  }catch(_e){}
}

function renderColoredBaseline(track, leftPad, rightPad, totalWidth) {
  if (!track.baselineContainer) return;
  
  // Find actual positions of key minutes based on rendered elements
  const findElementX = (targetMinute) => {
    const elements = track.querySelectorAll('[data-minute]');
    for (const el of elements) {
      const minute = parseInt(el.getAttribute('data-minute'));
      if (minute === targetMinute) {
        return el.offsetLeft + (el.offsetWidth / 2); // center of element
      }
    }
    return null;
  };

  // Try to find 90' position, fallback to calculated position
  // Prefer exact FT tick if available
  let ftX = (typeof track.ftX === 'number' ? track.ftX : null);
  if (!ftX) ftX = findElementX(90);
  if (!ftX) {
    // Fallback calculation - estimate 90' position
    ftX = totalWidth * 0.8; // rough estimate that 90' is about 80% across
  }

  const startX = leftPad;
  const endX = totalWidth - rightPad;

  // Green segment from start to FT (90')
  const greenSegment = document.createElement('div');
  greenSegment.style.cssText = `position:absolute;left:${startX}px;width:${ftX - startX}px;height:3px;background:linear-gradient(90deg,#10b981,#059669);box-shadow:0 0 6px rgba(16,185,129,0.35);border-radius:2px;`;

  // Red segment from FT to end (extra time)
  const redSegment = document.createElement('div');
  redSegment.style.cssText = `position:absolute;left:${ftX}px;width:${endX - ftX}px;height:3px;background:linear-gradient(90deg,#ef4444,#dc2626);box-shadow:0 0 6px rgba(239,68,68,0.35);border-radius:2px;`;

  track.baselineContainer.appendChild(greenSegment);
  track.baselineContainer.appendChild(redSegment);
}
