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
                displayBestPlayer(bestPlayer);
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

function displayBestPlayer(bestPlayer) {
    // Find where to insert, after timeline
    const timelineElement = document.querySelector('#details_info'); // Assuming timeline is in details_info
    if (!timelineElement) return;

    const bestPlayerDiv = document.createElement('div');
    bestPlayerDiv.id = 'best_player_section';
    bestPlayerDiv.innerHTML = `
        <h3>Best Player</h3>
        <div class="best-player-body">
            <p><strong>${bestPlayer.name}</strong> - Score: ${bestPlayer.score}</p>
            <p>Reason: ${bestPlayer.reason}</p>
        </div>
    `;

    // Insert after timeline
    timelineElement.insertAdjacentElement('afterend', bestPlayerDiv);
}