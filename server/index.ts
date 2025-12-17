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
    mode: 'standard' | 'rewind';
    hasMoved: boolean;
};
import { prisma } from './prisma';

let sessionHighScore = 0;
let sessionBestPlayer = '';

const MOVE_INTERVAL = 100; // Snake moves every 100ms (10 moves/sec)

const players = new Map<string, Player>();
const ghosts: Ghost[] = [];

// Ghost Class
type Ghost = {
    body: Point[];
    path: Point[][]; // Future moves to replay
    color: string;
    createdAt: number;
};

// History for Time Travel
type GameSnapshot = {
    players: { id: string, body: Point[], color: string }[];
    food: Point;
    timestamp: number;
};

const HISTORY_BUFFER_SIZE = 100; // 5 seconds at 20 TPS
const history: GameSnapshot[] = [];

function saveSnapshot() {
    // Deep copy players to avoid reference issues
    const playersSnap = Array.from(players.values()).map(p => ({
        id: p.id,
        body: JSON.parse(JSON.stringify(p.body)), // Deep copy points
        color: p.color
    }));

    history.push({
        players: playersSnap,
        food: { ...food },
        timestamp: Date.now()
    });

    if (history.length > HISTORY_BUFFER_SIZE) {
        history.shift();
    }
}

function restoreStateAndSpawnGhosts(initiatorId: string) {
    if (history.length < 60) return; // Need at least 3 seconds (60 ticks)

    // 1. Find snapshot 3 seconds ago (approx index length - 60)
    if (history.length === 0) return;
    const targetIndex = Math.max(0, history.length - 60);
    const snapshot = history[targetIndex];
    if (!snapshot) return;

    // 2. Create Ghosts from current futures (from targetIndex to now)
    // For each player that existed then AND now
    const currentPlayers = Array.from(players.values());

    // We need to build paths for ghosts.
    // The path is the sequence of body positions from targetIndex to NOW.
    // Actually, Ghost just needs to replay the HEAD positions or the whole body flow?
    // User said: "Repeat past movements". "Virtual snake".
    // Simplest: Ghost starts at snapshot position, and we assign it a list of moves (deltas) or absolute positions to interpolate.
    // Let's store absolute body states for simplicity in replay.

    // Extract paths for all active players from history[targetIndex...end]
    const recordedPaths = new Map<string, Point[][]>();

    for (let i = targetIndex; i < history.length; i++) {
        const snap = history[i];
        if (!snap) continue;
        snap.players.forEach(p => {
            if (!recordedPaths.has(p.id)) {
                recordedPaths.set(p.id, []);
            }
            // Ensure p.body is treated as Point[]
            const body = p.body as Point[];
            recordedPaths.get(p.id)!.push(body);
        });
    }

    // Spawn Ghosts
    recordedPaths.forEach((path, pid) => {
        // Only spawn ghost if player still exists or valid
        if (path.length > 0) {
            // Use the color of the original player
            const pParams = history[targetIndex]?.players.find(p => p.id === pid);
            const color = pParams ? pParams.color : '#ffffff';

            ghosts.push({
                body: path[0], // Start at beginning of replay
                path: path,
                color: `rgba(${parseInt(color.slice(1, 3), 16)}, ${parseInt(color.slice(3, 5), 16)}, ${parseInt(color.slice(5, 7), 16)}, 0.5)`, // Transparent ghost
                createdAt: Date.now()
            });
        }
    });

    // 3. Restore State
    // We only restore POSITIONS. Scores/XP are preserved (Time Travel paradox?)
    // User: "Scores/XP not mentioned to rollback". Usually mechanics preserve score to avoid griefing? 
    // "Initiator pays price". Others suffer temporal distortion.
    // Let's restore positions but keep scores for now, or maybe just positions.
    // Restoring positions:
    snapshot.players.forEach(snapP => {
        const liveP = players.get(snapP.id);
        if (liveP) {
            liveP.body = JSON.parse(JSON.stringify(snapP.body));
            // Reset velocity? Or keep current intent?
            // Resetting velocity to 0 gives them a moment to react.
            // Or maybe infer velocity from snapshot?
            // Let's set velocity to 0 to prevent instant death on resume.
            // liveP.velocity = { x: 0, y: 0 }; 
            // Actually, keeping momentum is more chaotic/fun.
        }
    });

    food = { ...snapshot.food };

    // Clear history after the restore point? 
    // No, we continue appending. 
    // Actually, we should probably trim history after the restore point to avoid jumping forward again?
    // "World rolls back". So history should probably truncate to targetIndex.
    history.length = targetIndex + 1;

    console.log(`TIME REWIND! Initiated by ${initiatorId}`);
}
let food: Point = { x: 10, y: 10 };

// Colors for players (Excluded Food Color #FF0055)
const COLORS = ['#00FF9D', '#00F3FF', '#FFFF00', '#FF00FF', '#0000FF'];

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
    player.lastMoveTime = Date.now(); // Reset move timer
    player.streak = 0;
    player.hasMoved = false;
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
        let newLevel = Math.floor(updated.xp / 1000) + 1;
        if (newLevel > updated.level) {
            await prisma.player.update({
                where: { id: player.dbId },
                data: { level: newLevel }
            });
        }

        // Update in-memory player object so client sees changes immediately
        player.xp = updated.xp;
        player.level = newLevel;
        player.achievements = newAchievements;

        console.log(`Saved progress for ${player.name}: +${currentScore} XP. New Lvl: ${newLevel}`);
    } catch (e) {
        console.error(`Failed to save player ${player.name}:`, e);
    }
}


import path from 'path';

// Resolve project root relative to this file
// If script is in /server/index.ts, root is ../
const PROJECT_ROOT = path.resolve(import.meta.dir, '..');


import type { Server } from "bun";

let server: Server<any>;
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
                // Color will be set on join, or random fallback
                const color = getRandomColor();

                const player: Player = {
                    id,
                    streak: 0,
                    xp: 0,
                    level: 1,
                    bestScore: 0,
                    achievements: [],
                    body: [{ x: 5, y: 5 }], // Initial position
                    velocity: { x: 0, y: 0 },
                    color,
                    score: 0,
                    name: 'Guest',
                    lastMoveTime: Date.now(),
                    mode: 'standard',
                    hasMoved: false
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
                    player.mode = data.mode || 'standard'; // Set game mode

                    // Validate Color (Must not be close to #FF0055)
                    if (data.color && /^#[0-9A-F]{6}$/i.test(data.color)) {
                        const r = parseInt(data.color.slice(1, 3), 16);
                        const g = parseInt(data.color.slice(3, 5), 16);
                        const b = parseInt(data.color.slice(5, 7), 16);

                        // Food Color #FF0055 -> 255, 0, 85
                        const dist = Math.sqrt(
                            Math.pow(r - 255, 2) +
                            Math.pow(g - 0, 2) +
                            Math.pow(b - 85, 2)
                        );

                        if (dist > 60) {
                            player.color = data.color;
                        }
                    }

                    // Enforce Unique Color
                    const usedColors = new Set(Array.from(players.values())
                        .filter(p => p.id !== player.id) // Exclude self
                        .map(p => p.color)
                    );

                    if (usedColors.has(player.color)) {
                        // Color taken, find a new random one
                        // Reuse getRandomColor helper or just generic random hex
                        // But getRandomColor pulls from a small list `COLORS`.
                        // Let's try 10 times to find a random random hex that isn't taken.
                        let uniqueFound = false;
                        for (let i = 0; i < 20; i++) {
                            // Generate random nice neon color? Or just random hex.
                            // Let's use simple random hex for fallback.
                            const randomColor = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0').toUpperCase();
                            if (!usedColors.has(randomColor)) {
                                player.color = randomColor;
                                uniqueFound = true;
                                break;
                            }
                        }
                        // If still failed (astronomical odds), well, they share a color.
                    }

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
                    player.hasMoved = true;
                }

                if (data.type === 'rewind') {
                    // Check conditions
                    if (!player) return;
                    if (player.mode !== 'rewind') return; // Strict mode check
                    if (player.body.length <= 5) return; // Cost check

                    // Cost: Lose 2 segments
                    player.body.pop();
                    player.body.pop();

                    // Trigger global rewind
                    restoreStateAndSpawnGhosts(player.id);

                    // Broadcast effect
                    server.publish("game", JSON.stringify({ type: 'rewind_effect' }));
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
    saveSnapshot();

    // Update Ghosts
    for (let i = ghosts.length - 1; i >= 0; i--) {
        const ghost = ghosts[i];
        if (!ghost) continue;

        if (ghost.path.length > 0) {
            ghost.body = ghost.path.shift()!; // Move to next recorded step
        } else {
            ghosts.splice(i, 1); // Remove finished ghost
        }
    }

    // Update all players
    const now = Date.now();
    for (const player of players.values()) {
        // ... (existing helper logic) ...
        if (player.velocity.x === 0 && player.velocity.y === 0) continue;

        // Throttle
        if (now - player.lastMoveTime < MOVE_INTERVAL) {
            continue;
        }
        player.lastMoveTime = now;

        const head = { ...player.body[0] };
        head.x += player.velocity.x;
        head.y += player.velocity.y;

        // Wall Collision
        if (head.x < 0 || head.x >= TILE_COUNT || head.y < 0 || head.y >= TILE_COUNT) {
            savePlayerProgress(player);
            resetPlayer(player);
            continue;
        }

        // Ghost Collision (Applies to everyone effectively, or should standard players be immune to ghosts? 
        // "Ghosts... Block space... Kill players". 
        // Assuming ghosts are physical objects in the shared world, so they kill everyone.)
        let hitGhost = false;
        for (const ghost of ghosts) {
            for (const seg of ghost.body) {
                if (head.x === seg.x && head.y === seg.y) {
                    hitGhost = true;
                    break;
                }
            }
            if (hitGhost) break;
        }

        if (hitGhost) {
            savePlayerProgress(player);
            resetPlayer(player);
            continue;
        }

        // Player Collision
        let collided = false;
        // ... (existing collision logic) ...
        for (const other of players.values()) {
            // Ignore collision if the OTHER player hasn't moved yet (spawn protection)
            // But wait, if *I* haven't moved, I'm just sitting there.
            // If *I* run into *THEM* and they haven't moved, I should pass through them.
            if (!other.hasMoved) continue;

            for (const segment of other.body) {
                if (head.x === segment.x && head.y === segment.y) {
                    collided = true;
                    break;
                }
            }
            if (collided) break;
        }

        if (collided) {
            savePlayerProgress(player);
            resetPlayer(player);
            continue;
        }

        player.body.unshift(head);

        if (head.x === food.x && head.y === food.y) {
            player.score += 10;
            player.streak = (player.streak || 0) + 1;
            // ... (Miracle logic) ...
            if (player.streak === 5) {
                const miracle = { type: 'christmas_miracle', playerId: player.id };
                server.publish("game", JSON.stringify(miracle));
            }

            spawnFood();
        } else {
            player.body.pop();
        }

        // ... (Score updates) ...
        if (player.score > sessionHighScore) {
            sessionHighScore = player.score;
            sessionBestPlayer = player.name;
        }
        if (player.score > player.bestScore) {
            player.bestScore = player.score;
        }
    }

    // Broadcast state
    const state = {
        players: Array.from(players.values()).map(p => ({ ...p, dbId: undefined })),
        ghosts,
        food,
        sessionHighScore,
        sessionBestPlayer
    };

    server.publish("game", JSON.stringify(state));

}, 50); // 20 TPS (Ticks Per Second) for faster gameplay
