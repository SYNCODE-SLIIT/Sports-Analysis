// Timeline utilities extracted from match.js
// These functions are defined in the global scope so match.js can call them.

// --- Tooltip + brief caches ---
let _evtTooltip;
const _eventBriefCache = new Map();

function ensureTooltip(){
  if(_evtTooltip) return _evtTooltip;
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;z-index:9999;max-width:320px;background:#111827;color:#e5e7eb;padding:8px 10px;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,0.25);font-size:12px;line-height:1.4;pointer-events:none;display:none;';
  document.body.appendChild(d); _evtTooltip = d; return d;
}
function showEventTooltip(anchor, text){ const d=ensureTooltip(); d.textContent = String(text||''); d.style.display='block'; positionEventTooltip(anchor); }
function hideEventTooltip(){ if(_evtTooltip) _evtTooltip.style.display='none'; }
function positionEventTooltip(anchor){ if(!_evtTooltip) return; const r = anchor.getBoundingClientRect(); const pad=8; let x = r.right + pad; let y = r.top - 4; const vw = window.innerWidth; const vh = window.innerHeight; const dw = _evtTooltip.offsetWidth; const dh = _evtTooltip.offsetHeight; if(x+dw+12>vw) x = r.left - dw - pad; if(x<4) x=4; if(y+dh+12>vh) y = vh - dh - 8; if(y<4) y=4; _evtTooltip.style.left = `${Math.round(x)}px`; _evtTooltip.style.top = `${Math.round(y)}px`; }

// --- Icons/colors/tags ---
function getEventIcon(description, tags){ const desc=String(description).toLowerCase(); const tagStr = Array.isArray(tags)?tags.join(' ').toLowerCase():String(tags).toLowerCase(); if(desc.includes('goal')||tagStr.includes('goal')) return '⚽'; if(desc.includes('yellow')||tagStr.includes('yellow')) return '🟨'; if(desc.includes('red')||tagStr.includes('red')) return '🟥'; if(desc.includes('substitution')||tagStr.includes('substitution')) return '🔄'; if(desc.includes('corner')||tagStr.includes('corner')) return '📐'; if(desc.includes('penalty')||tagStr.includes('penalty')) return '⚽'; if(desc.includes('offside')||tagStr.includes('offside')) return '🚩'; return '⚪'; }
function getEventColor(description, tags){ const desc=String(description).toLowerCase(); const tagStr = Array.isArray(tags)?tags.join(' ').toLowerCase():String(tags).toLowerCase(); if(desc.includes('goal')||tagStr.includes('goal')) return '#10b981'; if(desc.includes('yellow')||tagStr.includes('yellow')) return '#f59e0b'; if(desc.includes('red')||tagStr.includes('red')) return '#ef4444'; if(desc.includes('substitution')||tagStr.includes('substitution')) return '#8b5cf6'; return '#6b7280'; }
function getTagColor(tag){ const t = String(tag).toLowerCase(); if(t.includes('goal')) return '#10b981'; if(t.includes('card')) return '#f59e0b'; if(t.includes('substitution')) return '#8b5cf6'; if(t.includes('penalty')) return '#ef4444'; return '#6b7280'; }

function normalizeEventTags(evt){
  const candidates = [];
  if(evt){
    if(evt.tags !== undefined) candidates.push(evt.tags);
    if(evt.card !== undefined) candidates.push(evt.card);
    if(evt.predicted_tags !== undefined) candidates.push(evt.predicted_tags);
    if(evt.predictedTags !== undefined) candidates.push(evt.predictedTags);
    if(evt.labels !== undefined) candidates.push(evt.labels);
    if(evt.labels_list !== undefined) candidates.push(evt.labels_list);
  }
  let raw = [];
  for(const c of candidates){ if(c === undefined || c === null) continue; if(Array.isArray(c) && c.length>0){ raw = c; break; } if(typeof c === 'string' && c.trim()){ raw = [c]; break; } if(typeof c === 'object' && !Array.isArray(c)){ raw = [c]; break; } }
  const out = []; if(!raw) return out; try{ if(!Array.isArray(raw)){ if(typeof raw === 'string') raw = [raw]; else if(typeof raw === 'object') raw = [raw]; else raw = []; } }catch(e){ return out; }
  raw.forEach(r=>{ if(r===undefined||r===null) return; if(typeof r === 'string'){ const isModel = /^model[:\-\s]/i.test(r) || /\bmodel\b|\bml\b/i.test(r); const text = r.replace(/^model[:\-\s]+/i,'').trim(); out.push({ text: text||r, source: isModel? 'model':'rule', confidence: undefined, isModel }); return; } if(typeof r === 'object'){ const text = r.label||r.text||r.name||r.tag||JSON.stringify(r); const src = r.source||r.origin||r.by||r.src||r.provider||''; const conf = r.confidence||r.score||r.probability||r.p||r.conf||undefined; const isModel = String(src).toLowerCase().includes('model')||String(src).toLowerCase().includes('ml')||/^model[:\-\s]/i.test(text)||!!r.isModel; out.push({ text, source: src || (isModel ? 'model':'rule'), confidence: conf, isModel }); return; } }); return out; }

// --- Synthesis/clean/merge ---
function detectTagsFromText(text){ if(!text) return []; const t=String(text).toLowerCase(); const tags=new Set(); if(t.includes('goal')||/scores?|scored|goal by|assist/.test(t)) tags.add('goal'); if(t.includes('penalty')) tags.add('penalty'); if(t.includes('yellow card')||t.includes('yellow')) tags.add('yellow card'); if(t.includes('red card')||t.includes('sent off')||t.includes('red')) tags.add('red card'); if(t.includes('substitution')||t.includes('sub')||t.includes('replaced')) tags.add('substitution'); if(t.includes('corner')) tags.add('corner'); if(t.includes('offside')) tags.add('offside'); if(t.includes('penalty shootout')||t.includes('shootout')) tags.add('shootout'); const playerMatch = String(text).match(/by\s+([A-Z][a-z]+\s?[A-Z]?[a-z]*)/); if(playerMatch) tags.add('player'); return Array.from(tags).map(s=>({ text: s, source: 'heuristic', confidence: undefined, isModel: false })); }

function buildCleanTimeline(ev){
  const out=[]; const goalsSrc = ev.goalscorers||ev.goals||ev.goalscorer||[]; (goalsSrc||[]).forEach(g=>{ const minute = g.time||g.minute||''; const player = g.home_scorer||g.away_scorer||g.scorer||g.player||''; const assist = g.home_assist||g.away_assist||g.assist||''; const team = (g.away_scorer? ev.event_away_team : (g.home_scorer? ev.event_home_team : '')); const score = g.score||''; out.push({ minute, type:'goal', player, assist, team, description: `${minute} — ${player} (${team}) scores — assist: ${assist} — score: ${score}`, tags: ['goal'] }); });
  const subs = ev.substitutes||ev.subs||ev.substitutions||[]; (subs||[]).forEach(s=>{ const minute = s.time||''; if(s.home_scorer && typeof s.home_scorer === 'object' && Object.keys(s.home_scorer).length>0){ out.push({ minute, type:'substitution', player_in: s.home_scorer.in, player_out: s.home_scorer.out, team: ev.event_home_team || 'home', description: `${minute} — ${s.home_scorer.in} ON for ${s.home_scorer.out} (${ev.event_home_team})`, tags: ['substitution'] }); } if(s.away_scorer && typeof s.away_scorer === 'object' && Object.keys(s.away_scorer).length>0){ out.push({ minute, type:'substitution', player_in: s.away_scorer.in, player_out: s.away_scorer.out, team: ev.event_away_team || 'away', description: `${minute} — ${s.away_scorer.in} ON for ${s.away_scorer.out} (${ev.event_away_team})`, tags: ['substitution'] }); } });
  const cards = ev.cards||[]; (cards||[]).forEach(c=>{ const minute = c.time||''; const player = c.home_fault||c.away_fault||''; const cardType = (c.card||'').toLowerCase(); const team = c.home_fault? ev.event_home_team : (c.away_fault? ev.event_away_team : ''); out.push({ minute, type:'card', player, card: cardType, team, description: `${minute} — ${cardType} for ${player} (${team})`, tags: [cardType] }); });
  function minuteSortKey(m){ if(!m) return 0; const plus = String(m).includes('+'); if(plus){ const parts = String(m).split('+'); return Number(parts[0]) + Number(parts[1]) / 100; } return Number(m)||0; }
  out.sort((a,b)=> minuteSortKey(a.minute) - minuteSortKey(b.minute)); return out;
}

function synthesizeTimelineFromEvent(ev){
  try{ const out=[]; const scorers = ev.scorers||ev.goals||ev.goal_scorers||ev.scorers_list||ev.goals_list||[]; if(Array.isArray(scorers)&&scorers.length>0){ scorers.forEach(s=>{ const minute = s.minute||s.time||s.minute_display||s.m||s.match_minute||''; const name = s.name||s.player||s.scorer||s.player_name||s.player_fullname||''; const team = s.team||s.side||s.club||''; const desc = s.description||s.text||(name?`Goal by ${name}`:'Goal'); const tags = s.tags||s.predicted_tags||s.predictedTags||s.labels|| (s.type?[s.type]:[]); out.push({ minute, description: desc, player: name, team, type: s.type||'goal', predicted_tags: tags, raw: s }); }); }
    const comments = ev.comments||ev.comments_list||ev.match_comments||ev.play_by_play||ev.commentary||[]; if(Array.isArray(comments)&&comments.length>0){ comments.slice(0,8).forEach(c=>{ const minute = c.time||c.minute||c.comments_time||c.match_minute||''; const desc = c.text||c.comment||c.comments_text||c.body||''; const tags = c.tags||c.predicted_tags||c.predictedTags||c.labels||[]; if(desc) out.push({ minute, description: desc, predicted_tags: tags, raw: c }); }); }
    if(out.length===0){ const home = ev.event_home_team||ev.strHomeTeam||ev.home_team||ev.homeName||''; const away = ev.event_away_team||ev.strAwayTeam||ev.away_team||ev.awayName||''; const score = ev.event_final_result||ev.event_ft_result||(ev.home_score!=null&&ev.away_score!=null?`${ev.home_score} - ${ev.away_score}`:''); if(home||away||score) out.push({ minute:'', description: `${home} vs ${away} ${score}`, predicted_tags: [], raw: ev }); }
    const enriched = out.map(entry=>{ const hasTags = entry.predicted_tags && Array.isArray(entry.predicted_tags) && entry.predicted_tags.length>0; if(!hasTags){ const inferred = detectTagsFromText(entry.description||''); entry.predicted_tags = inferred; } return entry; }); return enriched; }catch(e){ return []; }
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
              }
            }catch(_e){}
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

        try{
          const brief = await getEventBrief(etype, { minute, description, event, tags }, matchCtx);
          const d2 = ensureTooltip();
          const titleParts = [];
          if(playerImg){ titleParts.push(`<div style="width:32px;height:32px;overflow:hidden;border-radius:6px;flex-shrink:0;background:#1f2937"><img src="${playerImg}" style="width:32px;height:32px;object-fit:cover;display:block" onerror="this.remove()"/></div>`); }
          if(!playerImg && teamLogo){ titleParts.push(`<div style=\"width:32px;height:32px;overflow:hidden;border-radius:6px;flex-shrink:0;background:#1f2937\"><img src=\"${teamLogo}\" style=\"width:32px;height:32px;object-fit:contain;display:block\" onerror=\"this.remove()\"/></div>`); }
          const nameLabel = (event.player || event.player_name || event.playerName || event.player_fullname) ? `<div style=\"margin-left:8px;font-weight:700;color:#e5e7eb\">${_esc(String(event.player || event.player_name || event.playerName || ''))}</div>` : '';
          const headerHtml = `<div style=\"display:flex;align-items:center;gap:8px;\">${titleParts.join('')}${nameLabel}</div>`;
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

function deriveEventType(description, tags, ev){ const t = (Array.isArray(tags)?tags.join(' ').toLowerCase():String(tags||'').toLowerCase()); const d = String(description||'').toLowerCase(); if(t.includes('goal')||/\bgoal\b|scored|scores/.test(d)) return 'goal'; if(t.includes('red')) return 'red card'; if(t.includes('yellow')) return 'yellow card'; if(t.includes('substitution')||/\bsub\b|replaced/.test(d)) return 'substitution'; return null; }

function _briefKey(etype, payload){ const p = payload||{}; return [etype, p.minute||'', (p.description||'').slice(0,80), (p.event&& (p.event.player||p.event.home_scorer||p.event.away_scorer||''))||'', p.tags && p.tags.join('|')].join('::'); }
async function getEventBrief(etype, payload, matchCtx){
  const key = _briefKey(etype, payload);
  if(_eventBriefCache.has(key)) return _eventBriefCache.get(key);
  const ev = (payload && payload.event) || {};
  const tags = payload && payload.tags || [];
  const home = matchCtx?.event_home_team || matchCtx?.strHomeTeam || matchCtx?.home_team || '';
  const away = matchCtx?.event_away_team || matchCtx?.strAwayTeam || matchCtx?.away_team || '';
  const payloadBody = { provider: 'auto', eventId: String(matchCtx?.idEvent || matchCtx?.event_key || matchCtx?.id || matchCtx?.match_id || '' ) || undefined, eventName: (home && away) ? `${home} vs ${away}` : undefined, date: matchCtx?.event_date || matchCtx?.dateEvent || matchCtx?.date || undefined, events: [{ minute: payload.minute || ev.minute || ev.time || '', type: etype, description: payload.description || ev.description || ev.text || ev.event || '', player: ev.player || ev.home_scorer || ev.away_scorer || ev.player_name || '', team: ev.team || '', tags: Array.isArray(tags)? tags.slice(0,6) : undefined, }] };
  let brief = '';
  try{ const r = await fetch((typeof apiBase !== 'undefined' ? apiBase : '') + '/summarizer/summarize/events', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payloadBody)}); if(r.ok){ const j = await r.json(); brief = (j && j.items && j.items[0] && j.items[0].brief) || ''; } }catch(_e){}
  if(!brief){ const minute = payload.minute || ev.minute || ev.time || ''; const player = ev.player || ev.home_scorer || ev.away_scorer || ev.player_name || ''; if(etype==='goal') brief = `${player||'Unknown'} scores at ${minute||'?'}.'`; else if(etype==='yellow card') brief = `Yellow card for ${player||'unknown'} at ${minute||'?'}.`; else if(etype==='red card') brief = `Red card for ${player||'unknown'} at ${minute||'?'}.`; else if(etype==='substitution') brief = payload.description || 'Substitution.'; else brief = payload.description || etype; }
  _eventBriefCache.set(key, brief); return brief;
}

function renderMatchTimeline(ev, container){
  let timeline = ev.timeline || ev.timeline_items || ev.events || ev.event_timeline || ev.eventTimeline || ev.event_entries || [];
  if(timeline && !Array.isArray(timeline) && typeof timeline === 'object'){ const vals = Object.values(timeline).filter(Boolean); const arr = vals.reduce((acc, cur)=> acc.concat(Array.isArray(cur)?cur:[]), []); if(arr.length>0) timeline = arr; }
  if(!Array.isArray(timeline) || timeline.length===0) timeline = synthesizeTimelineFromEvent(ev);
  if(!Array.isArray(timeline) || timeline.length===0) return;
  const timelineCard = document.createElement('div'); timelineCard.style.cssText='background:white;border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 4px 20px rgba(0,0,0,0.08)'; const title = document.createElement('h3'); title.style.cssText='margin:0 0 20px 0;color:#1f2937;font-size:20px'; title.innerHTML='⚽ Match Timeline'; timelineCard.appendChild(title);
  const timelineContainer = document.createElement('div'); timelineContainer.style.cssText='position:relative;';
  timeline.forEach((event, index)=>{ timelineContainer.appendChild(createTimelineEvent(event, index===timeline.length-1, ev)); });
  timelineCard.appendChild(timelineContainer); container.appendChild(timelineCard);
}
