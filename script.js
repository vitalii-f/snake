const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const scoreElement = document.getElementById('score');
const startScreen = document.getElementById('start-screen');
const statusElement = document.createElement('div');
statusElement.style.position = 'absolute';
statusElement.style.bottom = '10px';
statusElement.style.left = '10px';
statusElement.style.color = '#888';
document.body.appendChild(statusElement);

// Game constants
const GRID_SIZE = 20;
const TILE_COUNT = 20;

// Set canvas dimensions
canvas.width = GRID_SIZE * TILE_COUNT;
canvas.height = GRID_SIZE * TILE_COUNT;

// WebSocket Setup
// Connect to the same host/port that served the page, but use ws:// protocol
const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(`${protocol}//${location.host}`);

let players = [];
let food = { x: -1, y: -1 };
let myId = null;

ws.onopen = () => {
    statusElement.textContent = 'Connected to Server';
    statusElement.style.color = '#00ff9d';
    startScreen.classList.add('hidden'); // Hide start screen on connect
};

ws.onclose = () => {
    statusElement.textContent = 'Disconnected';
    statusElement.style.color = '#ff0055';
};

ws.onmessage = (event) => {
    const state = JSON.parse(event.data);
    players = state.players;
    food = state.food;

    // Simple update loop
    draw();
    updateScore();
};

function sendDirection(x, y) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'move', direction: { x, y } }));
    }
}

document.addEventListener('keydown', (e) => {
    switch (e.key) {
        case 'ArrowUp':
        case 'w':
        case 'W':
            sendDirection(0, -1);
            break;
        case 'ArrowDown':
        case 's':
        case 'S':
            sendDirection(0, 1);
            break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
            sendDirection(-1, 0);
            break;
        case 'ArrowRight':
        case 'd':
        case 'D':
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
        scoreElement.textContent = `Players: ${players.length} | Top Score: ${topScore}`;
    }
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
