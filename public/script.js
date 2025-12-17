const canvas = document.getElementById('game-canvas');

// If we are not on the game page (no canvas), stop execution or handle gracefully
if (!canvas) {
    console.log('No game canvas found, skipping game script initialization');
    // We can just return or throw to stop execution if this script is only for game
    // But since we are at top level, we can wrap everything in a block or just exit if possible.
    // Since we can't easily "return" from top level, we will wrap the logic.
}

const ctx = canvas ? canvas.getContext('2d') : null;
const scoreElement = document.getElementById('score');
const statusElement = document.createElement('div');
statusElement.style.position = 'absolute';
statusElement.style.bottom = '10px';
statusElement.style.left = '10px';
statusElement.style.color = '#888';
document.body.appendChild(statusElement);

// Game constants
const GRID_SIZE = 20;
const TILE_COUNT = 20;

if (canvas) {
    // Set canvas dimensions
    canvas.width = GRID_SIZE * TILE_COUNT;
    canvas.height = GRID_SIZE * TILE_COUNT;
}

// WebSocket Setup
const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(`${protocol}//${location.host}`);

let players = [];
let food = { x: -1, y: -1 };
let myId = null;
let sessionHighScore = 0;
let sessionBestPlayer = '';

// Profile Display
// const profileDiv = document.createElement('div');
// profileDiv.id = 'profile-display';
// ... (code removed) ...
// Instead we user #profile-card defined in HTML


ws.onopen = () => {
    // Handled in specific logic below
};

// ... other connection primitives ...

const pingDisplay = document.getElementById('ping-display');
const fpsDisplay = document.getElementById('fps-display');
const showPing = localStorage.getItem('snake_show_ping') === 'true';
const showFps = localStorage.getItem('snake_show_fps') === 'true';

if (pingDisplay && showPing) pingDisplay.classList.remove('hidden');
if (fpsDisplay && showFps) fpsDisplay.classList.remove('hidden');

// FPS Counter declaration
let frameCount = 0;
let lastFpsTime = Date.now();
let fps = 0;

if (showFps && fpsDisplay) {
    setInterval(() => {
        fps = frameCount;
        frameCount = 0;
        fpsDisplay.textContent = `FPS: ${fps}`;
    }, 1000);
}

// Ping Logic
if (showPing) {
    setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            const start = Date.now();
            ws.send(JSON.stringify({ type: 'ping', timestamp: start }));
        }
    }, 2000);
}

// Handle Pong in message handler is tricky because we overwrite ws.onmessage.
// Better to attach a new listener or modify existing.
// Let's modify the existing onmessage handler above.

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'pong') {
        const latency = Date.now() - data.timestamp;
        if (pingDisplay) pingDisplay.textContent = `Ping: ${latency} ms`;
        return;
    }

    if (data.type === 'christmas_miracle') {
        // Trigger snow and tree
        const tree = document.getElementById('christmas-tree');
        if (tree) {
            tree.classList.remove('hidden');
            tree.style.opacity = '1';
            tree.style.transform = 'scale(1.2) rotate(5deg)';
            setTimeout(() => { tree.style.transform = 'scale(1) rotate(0deg)'; }, 300);
        }
        createSnow();
        return;
    }

    if (data.type === 'rewind_effect') {
        // Visual distortion
        document.body.style.filter = 'invert(1) hue-rotate(180deg)';
        setTimeout(() => {
            document.body.style.filter = 'none';
        }, 200);
        return;
    }

    // Normal game state
    // We should assume if data has 'players' it is game state.
    if (data.players) {
        players = data.players;
        food = data.food;

        // Handle Ghosts
        if (data.ghosts) {
            drawGhosts(data.ghosts);
        } else {
            // Clear ghosts if none sent (or draw function handles empty list)
            drawGhosts([]);
        }

        if (data.sessionHighScore !== undefined) {
            // ...
            sessionHighScore = data.sessionHighScore;
            sessionBestPlayer = data.sessionBestPlayer || '';
        }
        if (typeof updateLeaderboard === 'function') updateLeaderboard();
        if (typeof updateProfile === 'function') updateProfile();
        if (typeof updateScore === 'function') updateScore();
    }
};

function updateProfile() {
    const myPlayer = players.find(p => p.name === savedNickname);
    if (!myPlayer) return;

    const pName = document.getElementById('p-name');
    const pLevel = document.getElementById('p-level');
    const pXp = document.getElementById('p-xp');
    const pBest = document.getElementById('p-best');

    if (pName) pName.textContent = myPlayer.name;
    if (pLevel) pLevel.textContent = myPlayer.level || 1;
    if (pXp) pXp.textContent = myPlayer.xp || 0;
    if (pBest) pBest.textContent = myPlayer.bestScore || 0;
}

// Render Loop
function gameLoop() {
    if (typeof draw === 'function') {
        draw();
        frameCount++;
    }
    requestAnimationFrame(gameLoop);
}

// Start the loop
if (canvas) {
    requestAnimationFrame(gameLoop);
}

const nicknameInput = document.getElementById('nickname-input'); // Likely null on game page, check existence
const joinBtn = document.getElementById('join-btn'); // Likely null
const leaderboardList = document.getElementById('leaderboard-list');
const exitBtn = document.getElementById('exit-btn');

if (exitBtn) {
    exitBtn.addEventListener('click', () => {
        window.location.href = '/';
    });
}

let isGameActive = false;

// Auto-join if on game page
const savedNickname = localStorage.getItem('snake_nickname');
if (!savedNickname) {
    // Redirect to menu if no nickname
    window.location.href = '/';
}

ws.onopen = () => {
    if (savedNickname) {
        const savedColor = localStorage.getItem('snake_color');
        // Get mode from URL
        const urlParams = new URLSearchParams(window.location.search);
        const gameMode = urlParams.get('mode') || 'standard';

        if (gameMode === 'rewind') {
            const hint = document.getElementById('rewind-controls-hint');
            if (hint) hint.style.display = 'flex';
        }

        ws.send(JSON.stringify({
            type: 'join',
            name: savedNickname,
            color: savedColor,
            mode: gameMode
        }));
        isGameActive = true;
    }
};

document.addEventListener('keydown', (e) => {
    if (!isGameActive) return;

    if (e.code === 'Space') {
        ws.send(JSON.stringify({ type: 'rewind' }));
        return;
    }
});

// joinBtn.addEventListener('click', joinGame); // Removed
// nicknameInput.addEventListener('keydown', (e) => { // Removed
//     if (e.key === 'Enter') joinGame();
// });

// function joinGame() { ... } // Removed

function updateLeaderboard() {
    // Sort players by score
    const sortedPlayers = [...players].sort((a, b) => b.score - a.score);

    leaderboardList.innerHTML = sortedPlayers.map(p => `
        <div class="leaderboard-item">
            <span class="leaderboard-name" style="color: ${p.color}">${p.name} (Lvl ${p.level || 1})</span>
            <span class="leaderboard-score">${p.score}</span>
        </div>
    `).join('');
}

function sendDirection(x, y) {
    if (ws.readyState === WebSocket.OPEN && isGameActive) {
        ws.send(JSON.stringify({ type: 'move', direction: { x, y } }));
    }
}

document.addEventListener('keydown', (e) => {
    if (!isGameActive) return;

    switch (e.code) {
        case 'ArrowUp':
        case 'KeyW':
            sendDirection(0, -1);
            break;
        case 'ArrowDown':
        case 'KeyS':
            sendDirection(0, 1);
            break;
        case 'ArrowLeft':
        case 'KeyA':
            sendDirection(-1, 0);
            break;
        case 'ArrowRight':
        case 'KeyD':
            sendDirection(1, 0);
            break;
    }
});

function updateScore() {
    // Ideally we know which player is "us", but simple approach:
    // We display top score or total active players?
    // Let's just sum all scores for now or find max
    if (players.length > 0) {
        const topScore = Math.max(...players.map(p => p.score));
        scoreElement.innerHTML = `Players: ${players.length} | Session Best: ${sessionHighScore} (${sessionBestPlayer})`;
    }
}

let currentGhosts = [];

function drawGhosts(ghosts) {
    currentGhosts = ghosts;
}

function draw() {
    // Clear screen
    ctx.fillStyle = '#050510';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw grid
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 1;
    for (let i = 0; i <= TILE_COUNT; i++) {
        ctx.beginPath();
        ctx.moveTo(i * GRID_SIZE, 0);
        ctx.lineTo(i * GRID_SIZE, canvas.height);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, i * GRID_SIZE);
        ctx.lineTo(canvas.width, i * GRID_SIZE);
        ctx.stroke();
    }

    // Draw Ghosts
    if (currentGhosts) {
        currentGhosts.forEach(g => {
            g.body.forEach((segment, index) => {
                const x = segment.x * GRID_SIZE;
                const y = segment.y * GRID_SIZE;
                ctx.fillStyle = g.color || 'rgba(255, 255, 255, 0.3)';
                ctx.fillRect(x + 1, y + 1, GRID_SIZE - 2, GRID_SIZE - 2);
            });
        });
    }

    // Draw Food
    if (food.x >= 0) {
        const x = food.x * GRID_SIZE;
        const y = food.y * GRID_SIZE;
        ctx.fillStyle = '#ff0055';
        ctx.shadowColor = '#ff0055';
        ctx.shadowBlur = 15;
        ctx.beginPath();
        ctx.arc(x + GRID_SIZE / 2, y + GRID_SIZE / 2, GRID_SIZE / 2 - 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
    }

    // Draw Players
    players.forEach(p => {
        p.body.forEach((segment, index) => {
            const x = segment.x * GRID_SIZE;
            const y = segment.y * GRID_SIZE;

            ctx.fillStyle = p.color || '#00ff9d';

            // Blur effect for head
            if (index === 0) {
                ctx.shadowColor = p.color;
                ctx.shadowBlur = 10;
                ctx.fillStyle = '#fff'; // White head center
            }

            ctx.fillRect(x + 1, y + 1, GRID_SIZE - 2, GRID_SIZE - 2);
            ctx.shadowBlur = 0;
        });
    });
}

function createSnow() {
    const snowContainer = document.createElement('div');
    snowContainer.id = 'snow-container';
    snowContainer.style.position = 'fixed';
    snowContainer.style.top = '0';
    snowContainer.style.left = '0';
    snowContainer.style.width = '100%';
    snowContainer.style.height = '100%';
    snowContainer.style.pointerEvents = 'none';
    snowContainer.style.zIndex = '999';
    document.body.appendChild(snowContainer);

    for (let i = 0; i < 50; i++) {
        const snowflake = document.createElement('div');
        snowflake.textContent = '❄';
        snowflake.style.position = 'absolute';
        snowflake.style.color = 'white';
        snowflake.style.opacity = Math.random();
        snowflake.style.fontSize = Math.random() * 20 + 10 + 'px';
        snowflake.style.left = Math.random() * 100 + 'vw';
        snowflake.style.animation = `fall ${Math.random() * 3 + 2}s linear infinite`;
        snowflake.style.animationDelay = Math.random() * 5 + 's';

        snowContainer.appendChild(snowflake);
    }
}
