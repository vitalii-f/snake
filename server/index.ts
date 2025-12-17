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

const COLORS = ['#00FF9D', '#00F3FF', '#FFFF00', '#FF00FF', '#0000FF'];

function getRandomColor() {
    return COLORS[Math.floor(Math.random() * COLORS.length)];
}

async function savePlayerProgress(player: Player) {
    if (!player.dbId) return;

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
                bestScore: { set: Math.max(player.bestScore, currentScore) },
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

        // Update in-memory player object
        player.xp = updated.xp;
        player.level = newLevel;
        player.achievements = newAchievements;

        console.log(`Saved progress for ${player.name}: +${currentScore} XP. New Lvl: ${newLevel}`);
    } catch (e) {
        console.error(`Failed to save player ${player.name}:`, e);
    }
}

class GameRoom {
    public players = new Map<string, Player>();
    public ghosts: Ghost[] = [];
    public history: GameSnapshot[] = [];
    public food: Point = { x: 10, y: 10 };
    public sessionHighScore = 0;
    public sessionBestPlayer = '';
    public mode: 'standard' | 'rewind';

    private HISTORY_BUFFER_SIZE = 100;
    private MOVE_INTERVAL = 100;

    constructor(mode: 'standard' | 'rewind') {
        this.mode = mode;
        this.spawnFood();
    }

    addPlayer(id: string, player: Player) {
        this.players.set(id, player);
    }

    removePlayer(id: string) {
        const player = this.players.get(id);
        if (player) {
            savePlayerProgress(player);
            this.players.delete(id);
        }
    }

    resetPlayer(player: Player) {
        player.body = [
            { x: Math.floor(Math.random() * TILE_COUNT), y: Math.floor(Math.random() * TILE_COUNT) }
        ];
        player.velocity = { x: 0, y: 0 };
        player.score = 0;
        player.lastMoveTime = Date.now();
        player.streak = 0;
        player.hasMoved = false;
    }

    spawnFood() {
        let valid = false;
        while (!valid) {
            this.food = {
                x: Math.floor(Math.random() * TILE_COUNT),
                y: Math.floor(Math.random() * TILE_COUNT)
            };

            valid = true;
            for (const player of this.players.values()) {
                for (const segment of player.body) {
                    if (this.food.x === segment.x && this.food.y === segment.y) {
                        valid = false;
                        break;
                    }
                }
                if (!valid) break;
            }
        }
    }

    saveSnapshot() {
        // Deep copy players
        const playersSnap = Array.from(this.players.values()).map(p => ({
            id: p.id,
            body: JSON.parse(JSON.stringify(p.body)),
            color: p.color
        }));

        this.history.push({
            players: playersSnap,
            food: { ...this.food },
            timestamp: Date.now()
        });

        if (this.history.length > this.HISTORY_BUFFER_SIZE) {
            this.history.shift();
        }
    }

    restoreStateAndSpawnGhosts(initiatorId: string) {
        if (this.history.length < 60) return;
        const targetIndex = Math.max(0, this.history.length - 60);
        const snapshot = this.history[targetIndex];
        if (!snapshot) return;

        // Create Ghosts
        const recordedPaths = new Map<string, Point[][]>();
        for (let i = targetIndex; i < this.history.length; i++) {
            const snap = this.history[i];
            if (!snap) continue;
            snap.players.forEach(p => {
                if (!recordedPaths.has(p.id)) recordedPaths.set(p.id, []);
                recordedPaths.get(p.id)!.push(p.body as Point[]);
            });
        }

        recordedPaths.forEach((path, pid) => {
            if (path.length > 0) {
                const pParams = this.history[targetIndex]?.players.find(p => p.id === pid);
                const color = pParams ? pParams.color : '#ffffff';
                this.ghosts.push({
                    body: path[0],
                    path: path,
                    color: `rgba(${parseInt(color.slice(1, 3), 16)}, ${parseInt(color.slice(3, 5), 16)}, ${parseInt(color.slice(5, 7), 16)}, 0.5)`,
                    createdAt: Date.now()
                });
            }
        });

        // Restore State
        snapshot.players.forEach(snapP => {
            const liveP = this.players.get(snapP.id);
            if (liveP) {
                liveP.body = JSON.parse(JSON.stringify(snapP.body));
                // Velocity kept or reset? Original code didn't reset, but discussed it.
                // Keeping original behavior: implicitly keeps current velocity unless logic changes.
            }
        });

        this.food = { ...snapshot.food };
        this.history.length = targetIndex + 1;
        console.log(`[${this.mode}] TIME REWIND! Initiated by ${initiatorId}`);
    }

    update(server: Server<any>) {
        this.saveSnapshot();

        // Update Ghosts
        for (let i = this.ghosts.length - 1; i >= 0; i--) {
            const ghost = this.ghosts[i];
            if (!ghost) continue;
            if (ghost.path.length > 0) {
                ghost.body = ghost.path.shift()!;
            } else {
                this.ghosts.splice(i, 1);
            }
        }

        const now = Date.now();
        for (const player of this.players.values()) {
            if (player.velocity.x === 0 && player.velocity.y === 0) continue;

            if (now - player.lastMoveTime < this.MOVE_INTERVAL) continue;
            player.lastMoveTime = now;

            const head = { ...player.body[0] };
            head.x += player.velocity.x;
            head.y += player.velocity.y;

            // Wall Collision
            if (head.x < 0 || head.x >= TILE_COUNT || head.y < 0 || head.y >= TILE_COUNT) {
                savePlayerProgress(player);
                this.resetPlayer(player);
                continue;
            }

            // Ghost Collision
            let hitGhost = false;
            for (const ghost of this.ghosts) {
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
                this.resetPlayer(player);
                continue;
            }

            // Player Collision (only within this room)
            let collided = false;
            for (const other of this.players.values()) {
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
                this.resetPlayer(player);
                continue;
            }

            player.body.unshift(head);

            if (head.x === this.food.x && head.y === this.food.y) {
                player.score += 10;
                player.streak = (player.streak || 0) + 1;
                if (player.streak === 5) {
                    const miracle = { type: 'christmas_miracle', playerId: player.id };
                    server.publish(`game-${this.mode}`, JSON.stringify(miracle));
                }
                this.spawnFood();
            } else {
                player.body.pop();
            }

            if (player.score > this.sessionHighScore) {
                this.sessionHighScore = player.score;
                this.sessionBestPlayer = player.name;
            }
            if (player.score > player.bestScore) {
                player.bestScore = player.score;
            }
        }

        // Broadcast State
        const state = {
            players: Array.from(this.players.values()).map(p => ({ ...p, dbId: undefined })),
            ghosts: this.ghosts,
            food: this.food,
            sessionHighScore: this.sessionHighScore,
            sessionBestPlayer: this.sessionBestPlayer
        };
        server.publish(`game-${this.mode}`, JSON.stringify(state));
    }
}

const rooms = {
    standard: new GameRoom('standard'),
    rewind: new GameRoom('rewind')
};

import path from 'path';
const PROJECT_ROOT = path.resolve(import.meta.dir, '..');
import type { Server } from "bun";

let server: Server<any>;
try {
    server = Bun.serve({
        port: 3021,
        fetch(req, server) {
            if (server.upgrade(req)) return;
            const url = new URL(req.url);
            let filePath = url.pathname;
            if (filePath === '/') filePath = '/index.html';
            else if (filePath === '/game') filePath = '/game.html';
            const publicDir = path.join(PROJECT_ROOT, 'public');
            const file = Bun.file(path.join(publicDir, filePath));
            return new Response(file);
        },
        websocket: {
            open(ws) {
                ws.data = { id: crypto.randomUUID() };
                // Player is NOT added yet. Wait for 'join'.
                // Or we can add them to a limbo state?
                // The current client sends 'join' immediately after open.
                console.log(`Connection opened: ${ws.data.id}`);
            },
            async message(ws, message) {
                const id = (ws.data as any).id;
                const data = JSON.parse(message as string);

                if (data.type === 'join') {
                    const name = data.name || 'Guest';
                    const mode = (data.mode === 'rewind' ? 'rewind' : 'standard') as 'standard' | 'rewind';
                    const room = rooms[mode];

                    const color = data.color || getRandomColor();

                    const player: Player = {
                        id,
                        streak: 0,
                        xp: 0,
                        level: 1,
                        bestScore: 0,
                        achievements: [],
                        body: [{ x: 5, y: 5 }],
                        velocity: { x: 0, y: 0 },
                        color,
                        score: 0,
                        name,
                        lastMoveTime: Date.now(),
                        mode: mode,
                        hasMoved: false
                    };
                    room.resetPlayer(player);

                    // Validate Color
                    if (data.color && /^#[0-9A-F]{6}$/i.test(data.color)) {
                        const r = parseInt(data.color.slice(1, 3), 16);
                        const g = parseInt(data.color.slice(3, 5), 16);
                        const b = parseInt(data.color.slice(5, 7), 16);
                        const dist = Math.sqrt(Math.pow(r - 255, 2) + Math.pow(g - 0, 2) + Math.pow(b - 85, 2));
                        if (dist > 60) player.color = data.color;
                    }

                    // Enforce Unique Color in Room
                    const usedColors = new Set(Array.from(room.players.values()).map(p => p.color));
                    if (usedColors.has(player.color)) {
                        for (let i = 0; i < 20; i++) {
                            const randomColor = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0').toUpperCase();
                            if (!usedColors.has(randomColor)) {
                                player.color = randomColor;
                                break;
                            }
                        }
                    }

                    // DB Load
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
                        console.log(`Loaded profile for ${name} in ${mode}: Lvl ${player.level}`);
                    } catch (e) {
                        console.error("DB Error on Join:", e);
                    }

                    // Join Room
                    room.addPlayer(id, player);
                    ws.subscribe(`game-${mode}`);
                    ws.data.mode = mode; // Store mode in WS data for fast lookup
                    console.log(`Player ${name} (${id}) joined room ${mode}`);
                    return;
                }

                // Handle other messages
                const mode = (ws.data as any).mode;
                if (!mode) return; // Not joined yet
                const room = rooms[mode as 'standard' | 'rewind'];
                const player = room.players.get(id);
                if (!player) return;

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
                    if (room.mode !== 'rewind') return;
                    if (player.body.length <= 5) return;

                    player.body.pop();
                    player.body.pop();

                    room.restoreStateAndSpawnGhosts(player.id);
                    server.publish(`game-rewind`, JSON.stringify({ type: 'rewind_effect' }));
                }

                if (data.type === 'ping') {
                    ws.send(JSON.stringify({ type: 'pong', timestamp: data.timestamp }));
                }
            },
            close(ws) {
                const id = (ws.data as any).id;
                const mode = (ws.data as any).mode;
                if (mode && rooms[mode as 'standard' | 'rewind']) {
                    rooms[mode as 'standard' | 'rewind'].removePlayer(id);
                    console.log(`Player ${id} left room ${mode}`);
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
    rooms.standard.update(server);
    rooms.rewind.update(server);
}, 50);
