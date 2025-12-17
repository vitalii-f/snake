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
    lastMoveTime: number;
    streak: number;
    // Database fields
    xp: number;
    level: number;
    bestScore: number;
    achievements: string[]; // JSON array
    dbId?: string;
};
import { prisma } from './prisma';

let sessionHighScore = 0;
let sessionBestPlayer = '';

const MOVE_INTERVAL = 100; // Snake moves every 100ms (10 moves/sec)

const players = new Map<string, Player>();
let food: Point = { x: 10, y: 10 };

// Colors for players
const COLORS = ['#FF0055', '#00FF9D', '#00F3FF', '#FFFF00', '#FF00FF', '#0000FF'];

function getRandomColor() {
    return COLORS[Math.floor(Math.random() * COLORS.length)];
}

function spawnFood() {
    let valid = false;
    while (!valid) {
        food = {
            x: Math.floor(Math.random() * TILE_COUNT),
            y: Math.floor(Math.random() * TILE_COUNT)
        };

        valid = true;
        for (const player of players.values()) {
            for (const segment of player.body) {
                if (food.x === segment.x && food.y === segment.y) {
                    valid = false;
                    break;
                }
            }
            if (!valid) break;
        }
    }
}

function resetPlayer(player: Player) {
    player.body = [
        { x: Math.floor(Math.random() * TILE_COUNT), y: Math.floor(Math.random() * TILE_COUNT) }
    ];
    player.velocity = { x: 0, y: 0 };
    player.score = 0;
    player.score = 0;
    player.lastMoveTime = Date.now(); // Reset move timer
    player.streak = 0;
}

async function savePlayerProgress(player: Player) {
    if (!player.dbId) return;

    // Logic: Add score to XP? Or is XP just cumulative score?
    // User said: "Experience for level they received for past games"
    // Let's add current game score to XP.
    // Also check Level up? Simple formula: Level = Math.floor(Math.sqrt(XP / 100)) + 1

    // We only save if they have a DB ID (joined properly)
    try {
        const currentScore = player.score;

        // Simple achievement check
        const newAchievements = [...player.achievements];
        if (currentScore >= 100 && !newAchievements.includes('Score 100')) newAchievements.push('Score 100');
        if (player.streak >= 10 && !newAchievements.includes('Streak 10')) newAchievements.push('Streak 10');

        const updated = await prisma.player.update({
            where: { id: player.dbId },
            data: {
                xp: { increment: currentScore },
                bestScore: { set: Math.max(player.bestScore, currentScore) }, // Update best score if higher (Wait, player.bestScore is their old best. We need to compare local max)
                // Actually Prisma can't easily do "max(current, user_input)" atomically without raw SQL or two steps.
                // Let's just track it in memory correctly.
                achievements: JSON.stringify(newAchievements),
                updatedAt: new Date()
            }
        });

        // Recalculate level based on new XP
        const newLevel = Math.floor(updated.xp / 1000) + 1;
        if (newLevel > updated.level) {
            await prisma.player.update({
                where: { id: player.dbId },
                data: { level: newLevel }
            });
        }

        console.log(`Saved progress for ${player.name}: +${currentScore} XP`);
    } catch (e) {
        console.error(`Failed to save player ${player.name}:`, e);
    }
}


import path from 'path';

// Resolve project root relative to this file
// If script is in /server/index.ts, root is ../
const PROJECT_ROOT = path.resolve(import.meta.dir, '..');


let server;
try {
    server = Bun.serve({
        port: 3021,
        fetch(req, server) {
            // Upgrade to WebSocket
            if (server.upgrade(req)) {
                return;
            }

            const url = new URL(req.url);
            let filePath = url.pathname;

            // Simple router mapping
            if (filePath === '/') filePath = '/index.html';
            else if (filePath === '/game') filePath = '/game.html';

            // Serve from public directory
            const publicDir = path.join(PROJECT_ROOT, 'public');
            const file = Bun.file(path.join(publicDir, filePath));

            // If file doesn't exist (e.g. dev mode without build), return 404 or specific message
            // But usually in dev mode we hit Vite server, not this one for static files.
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
                    name: 'Guest',
                    lastMoveTime: Date.now(),
                    streak: 0,
                    xp: 0,
                    level: 1,
                    bestScore: 0,
                    achievements: []
                };

                resetPlayer(player);

                players.set(id, player);
                ws.data = { id };

                ws.subscribe("game");
                console.log(`Player connected: ${id}`);
            },
            async message(ws, message) {
                const id = (ws.data as any).id;
                const player = players.get(id);
                if (!player) return;

                const data = JSON.parse(message as string);

                if (data.type === 'join') {
                    const name = data.name || 'Guest';
                    player.name = name;

                    // Load/Create from DB
                    try {
                        const dbPlayer = await prisma.player.upsert({
                            where: { nickname: name },
                            update: {},
                            create: { nickname: name }
                        });

                        player.dbId = dbPlayer.id;
                        player.xp = dbPlayer.xp;
                        player.level = dbPlayer.level;
                        player.bestScore = dbPlayer.bestScore;
                        player.achievements = JSON.parse(dbPlayer.achievements as string || '[]');

                        console.log(`Loaded profile for ${name}: Lvl ${player.level}, XP ${player.xp}`);
                    } catch (e) {
                        console.error("DB Error on Join:", e);
                    }
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

                if (data.type === 'ping') {
                    ws.send(JSON.stringify({ type: 'pong', timestamp: data.timestamp }));
                }
            },
            close(ws) {
                const id = (ws.data as any).id;
                const player = players.get(id);
                if (player) {
                    savePlayerProgress(player); // Save on disconnect
                    players.delete(id);
                    console.log(`Player disconnected: ${id}`);
                }
            }
        }
    });

    console.log(`Listening on localhost:${server.port}`);
} catch (e) {
    console.error("FAILED TO START SERVER:", e);
    process.exit(1);
}

// Game Loop
setInterval(() => {
    // Update all players
    const now = Date.now();
    for (const player of players.values()) {
        if (player.velocity.x === 0 && player.velocity.y === 0) continue;

        // Throttle movement
        if (now - player.lastMoveTime < MOVE_INTERVAL) {
            continue; // Skip this tick if not enough time passed
        }
        player.lastMoveTime = now;

        const head = { ...player.body[0] };
        head.x += player.velocity.x;
        head.y += player.velocity.y;

        // Wrap around logic (optional) or Wall Death?
        // Let's implement Wall Death for now
        if (head.x < 0 || head.x >= TILE_COUNT || head.y < 0 || head.y >= TILE_COUNT) {
            savePlayerProgress(player); // Save on death
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
            savePlayerProgress(player); // Save on death
            resetPlayer(player);
            continue;
        }

        player.body.unshift(head);

        // Check Food
        if (head.x === food.x && head.y === food.y) {
            player.score += 10;
            player.streak = (player.streak || 0) + 1;

            if (player.streak === 5) {
                // Determine if we should broadcast to everyone or just the player? 
                // "Christmas miracle" sounds like a global or local effect? 
                // Let's send to everyone so they see the miracle.
                // Or maybe just the player? User said "when I eat 5 apples". 
                // Let's send to all clients to trigger the visual (maybe global snow is cooler).
                const miracle = { type: 'christmas_miracle', playerId: player.id };
                server.publish("game", JSON.stringify(miracle));
            }

            spawnFood();
            // Don't pop tail -> grow
        } else {
            player.body.pop();
        }

        // Update Session High Score
        if (player.score > sessionHighScore) {
            sessionHighScore = player.score;
            sessionBestPlayer = player.name;
        }
        // Update Personal Best (in memory for now, saved to DB on death)
        if (player.score > player.bestScore) {
            player.bestScore = player.score;
        }
    }

    // Broadcast state
    const state = {
        players: Array.from(players.values()).map(p => ({
            ...p,
            dbId: undefined // Don't send DB ID to client
        })),
        food,
        sessionHighScore,
        sessionBestPlayer
    };

    server.publish("game", JSON.stringify(state));

}, 50); // 20 TPS (Ticks Per Second) for faster gameplay
