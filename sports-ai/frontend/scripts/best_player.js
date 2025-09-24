// best_player.js - Handles fetching and displaying the best player for a match

document.addEventListener('DOMContentLoaded', function() {
    // Wait for timeline to load, then fetch best player
    setTimeout(fetchBestPlayer, 2000); // Adjust delay as needed
});

async function fetchBestPlayer() {
    const urlParams = new URLSearchParams(window.location.search);
    const eventId = urlParams.get('eventId') || urlParams.get('matchId');
    console.log('Best Player: eventId =', eventId);
    if (!eventId) {
        console.log('Best Player: No eventId found');
        return;
    }

    try {
        const apiBase = window.apiBase || window.location.origin;
        console.log('Best Player: Fetching from', apiBase + '/collect');
        const response = await fetch(apiBase + '/collect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                intent: 'event.get',
                args: { eventId: eventId, include_best_player: true }
            })
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        console.log('Best Player: API response', data);
        if (data.ok && data.data && data.data.result && data.data.result[0]) {
            const event = data.data.result[0];
            const bestPlayer = event.best_player;
            console.log('Best Player: bestPlayer =', bestPlayer);
            if (bestPlayer) {
                displayBestPlayer(bestPlayer, event);
            } else {
                console.log('Best Player: No best_player in event');
            }
        } else {
            console.log('Best Player: No data in response');
        }
    } catch (error) {
        console.error('Error fetching best player:', error);
    }
}

// Attempt to resolve player image & team logo using logic similar to timeline.js
function resolveBestPlayerAssets(bestPlayer, event) {
    if (!bestPlayer || !event) return { playerImg: '', teamLogo: '' };

    const name = (bestPlayer.name || '').trim();
    let playerImg = '';
    let teamLogo = '';

    // If timeline.js is loaded we can reuse its resolver for richer matching
    try {
        if (typeof resolvePlayerImageByName === 'function') {
            playerImg = resolvePlayerImageByName(name, event) || '';
        }
    } catch (_e) {}

    // Fallback manual scan over event arrays for a matching player object
    if (!playerImg) {
        try {
            const norm = s => (s || '').toString().replace(/[\.]/g,'').replace(/\s+/g,' ').trim().toLowerCase();
            const target = norm(name);
            for (const k of Object.keys(event)) {
                const v = event[k];
                if (Array.isArray(v) && v.length && typeof v[0] === 'object') {
                    for (const p of v) {
                        const pName = (p.player_name || p.name || p.strPlayer || p.player || p.player_fullname || '').trim();
                        if (pName && norm(pName) === target) {
                            playerImg = p.player_image || p.player_photo || p.playerImage || p.photo || p.thumb || p.photo_url || p.strThumb || p.strThumbBig || p.player_cutout || p.player_pic || p.img || p.avatar || p.headshot || p.image || '';
                            break;
                        }
                    }
                    if (playerImg) break;
                }
            }
        } catch (_e) {}
    }

    // Determine whether player is home or away using goalscorers list
    let side = '';
    try {
        const goalscorers = Array.isArray(event.goalscorers) ? event.goalscorers : [];
        for (const g of goalscorers) {
            if (g.home_scorer && g.home_scorer === name) { side = 'home'; break; }
            if (g.away_scorer && g.away_scorer === name) { side = 'away'; break; }
        }
    } catch (_e) {}

    // Team logo resolution
    const homeLogo = event.home_team_logo || event.strHomeTeamBadge || event.homeLogo || event.home_team_badge;
    const awayLogo = event.away_team_logo || event.strAwayTeamBadge || event.awayLogo || event.away_team_badge;
    if (side === 'home') teamLogo = homeLogo || '';
    else if (side === 'away') teamLogo = awayLogo || '';
    else {
        // Fallback: pick whichever exists (prefer home)
        teamLogo = homeLogo || awayLogo || '';
    }

    return { playerImg, teamLogo };
}

function displayBestPlayer(bestPlayer, event) {
    const timelineElement = document.querySelector('#details_info');
    if (!timelineElement) return;

    const { playerImg, teamLogo } = resolveBestPlayerAssets(bestPlayer, event);

    // Remove previous section if re-rendering
    const existing = document.getElementById('best_player_section');
    if (existing) existing.remove();

    const bestPlayerDiv = document.createElement('div');
    bestPlayerDiv.id = 'best_player_section';
    bestPlayerDiv.style.cssText = 'margin:16px 0;padding:16px;border:1px solid #e5e7eb;border-radius:16px;background:linear-gradient(135deg,#ffffff,#f8fafc);box-shadow:0 4px 12px rgba(0,0,0,0.04);';

    const imgHtml = playerImg ? `<div class="bp-avatar"><img src="${playerImg}" alt="${bestPlayer.name}" onerror="this.remove()"/></div>` : `<div class="bp-avatar placeholder">👤</div>`;
    const teamHtml = teamLogo ? `<div class="bp-teamlogo"><img src="${teamLogo}" alt="Team Logo" onerror="this.remove()"/></div>` : '';

    bestPlayerDiv.innerHTML = `
        <style>
          #best_player_section .bp-header{display:flex;align-items:center;gap:14px;margin-bottom:12px;}
          #best_player_section .bp-avatar{width:72px;height:72px;border-radius:18px;overflow:hidden;background:#1f2937;display:flex;align-items:center;justify-content:center;font-size:28px;color:#e5e7eb;flex-shrink:0;box-shadow:0 4px 10px rgba(0,0,0,0.15);border:2px solid #fff;}
          #best_player_section .bp-avatar img{width:100%;height:100%;object-fit:cover;display:block;}
          #best_player_section .bp-teamlogo{width:48px;height:48px;border-radius:12px;overflow:hidden;background:#0f1419;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 2px 6px rgba(0,0,0,0.1);border:2px solid #fff;}
          #best_player_section .bp-teamlogo img{width:100%;height:100%;object-fit:contain;display:block;background:#0f1419;}
          #best_player_section h3{margin:0 0 8px;font-size:18px;color:#0f172a;}
          #best_player_section .bp-meta{display:flex;align-items:center;gap:12px;}
          #best_player_section .bp-body p{margin:4px 0;font-size:13px;color:#374151;}
          #best_player_section .bp-score-badge{background:#10b981;color:#fff;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:600;box-shadow:0 2px 4px rgba(16,185,129,0.4);}
          #best_player_section .bp-reason{background:#f1f5f9;padding:8px 10px;border-radius:10px;border-left:3px solid #10b981;font-size:12px;color:#334155;margin-top:6px;}
        </style>
        <div class="bp-header">
          ${imgHtml}
          <div style="flex:1;display:flex;flex-direction:column;gap:4px;">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
              <h3 style="flex:1;">Best Player</h3>
              <span class="bp-score-badge" title="Composite performance score">Score: ${bestPlayer.score}</span>
              ${teamHtml}
            </div>
            <div style="font-size:15px;font-weight:700;color:#111827;">${bestPlayer.name}</div>
          </div>
        </div>
        <div class="bp-body">
          <div class="bp-reason">${bestPlayer.reason}</div>
        </div>
    `;

    timelineElement.insertAdjacentElement('afterend', bestPlayerDiv);
}