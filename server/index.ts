const GRID_SIZE = 20;
const TILE_COUNT = 20;

type Point = { x: number, y: number };
type Player = {
    id: string;
    body: Point[];
    velocity: Point;
    color: string;
    score: number;
    name: string;
};

const players = new Map<string, Player>();
let food: Point = { x: 10, y: 10 };

// Colors for players
const COLORS = ['#FF0055', '#00FF9D', '#00F3FF', '#FFFF00', '#FF00FF', '#0000FF'];

function getRandomColor() {
    return COLORS[Math.floor(Math.random() * COLORS.length)];
}

function spawnFood() {
    food = {
        x: Math.floor(Math.random() * TILE_COUNT),
        y: Math.floor(Math.random() * TILE_COUNT)
    };
}

function resetPlayer(player: Player) {
    player.body = [
        { x: Math.floor(Math.random() * TILE_COUNT), y: Math.floor(Math.random() * TILE_COUNT) }
    ];
    player.velocity = { x: 0, y: 0 };
    player.score = 0;
}

import path from 'path';

// Resolve project root relative to this file
// If script is in /server/index.ts, root is ../
const PROJECT_ROOT = path.resolve(import.meta.dir, '..');

const server = Bun.serve({
    port: 3020,
    fetch(req, server) {
        // Upgrade to WebSocket
        if (server.upgrade(req)) {
            return;
        }

        const url = new URL(req.url);
        let filePath = '';

        // Router
        if (url.pathname === '/') filePath = 'index.html';
        else if (url.pathname === '/style.css') filePath = 'style.css';
        else if (url.pathname === '/script.js') filePath = 'script.js';
        else return new Response("Not Found", { status: 404 });

        // Serve file from Project Root
        const file = Bun.file(path.join(PROJECT_ROOT, filePath));
        return new Response(file);
    },
    websocket: {
        open(ws) {
            const id = crypto.randomUUID();
            const color = getRandomColor();

            const player: Player = {
                id,
                body: [{ x: 5, y: 5 }], // Initial position
                velocity: { x: 0, y: 0 },
                color,
                score: 0,
                name: 'Guest'
            };

            resetPlayer(player);

            players.set(id, player);
            ws.data = { id };

            ws.subscribe("game");
            console.log(`Player connected: ${id}`);
        },
        message(ws, message) {
            const id = (ws.data as any).id;
            const player = players.get(id);
            if (!player) return;

            const data = JSON.parse(message as string);

            if (data.type === 'join') {
                player.name = data.name || 'Guest';
                return;
            }

            if (data.type === 'move') {
                const { x, y } = data.direction;
                // Prevent 180 turn
                if (player.velocity.x + x === 0 && player.velocity.y + y === 0 && player.body.length > 1) {
                    return;
                }
                player.velocity = { x, y };
            }
        },
        close(ws) {
            const id = (ws.data as any).id;
            players.delete(id);
            console.log(`Player disconnected: ${id}`);
        }
    }
});

console.log(`Listening on localhost:${server.port}`);

// Game Loop
setInterval(() => {
    // Update all players
    for (const player of players.values()) {
        if (player.velocity.x === 0 && player.velocity.y === 0) continue;

        const head = { ...player.body[0] };
        head.x += player.velocity.x;
        head.y += player.velocity.y;

        // Wrap around logic (optional) or Wall Death?
        // Let's implement Wall Death for now
        if (head.x < 0 || head.x >= TILE_COUNT || head.y < 0 || head.y >= TILE_COUNT) {
            resetPlayer(player);
            continue;
        }

        // Self collision or Other player collision
        let collided = false;
        for (const other of players.values()) {
            for (const segment of other.body) {
                if (head.x === segment.x && head.y === segment.y) {
                    collided = true;
                    break;
                }
            }
            if (collided) break;
        }

        if (collided) {
            resetPlayer(player);
            continue;
        }

        player.body.unshift(head);

        // Check Food
        if (head.x === food.x && head.y === food.y) {
            player.score += 10;
            spawnFood();
            // Don't pop tail -> grow
        } else {
            player.body.pop();
        }
    }

    // Broadcast state
    const state = {
        players: Array.from(players.values()),
        food
    };

    server.publish("game", JSON.stringify(state));

}, 100); // 10 FPS for network game
